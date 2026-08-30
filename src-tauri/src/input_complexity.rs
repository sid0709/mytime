//! Entropy-rate and permutation-entropy scoring for a 1-minute action stream.
//!
//! No OS types. Diversity is the LZ76 entropy rate `c(n)·log_5(n)/n` of the
//! action-type sequence. Timing is Bandt–Pompe permutation entropy on the dominant
//! class when it is ≥70% of the window.
//!
//! When a window is almost entirely `Move` symbols (`move_fraction ≥ MOUSE_BLEND_LO`)
//! the type-sequence has nothing left to say, so the quality of that window is judged
//! from the *geometry* of the cursor path instead — see [`mouse_dynamics_score`].
//! The two regimes are cross-faded by `move_fraction` so there is no cliff.

use std::collections::VecDeque;

pub const SYMBOL_RING_CAP: usize = 2048;
pub const MIN_SYMBOLS: usize = 12;
pub const PE_ORDER: usize = 3;
pub const PE_MIN_INTERVALS: usize = 16;
pub const DOMINANT_FRACTION: f64 = 0.70;
pub const DIVERSITY_WEIGHT: f32 = 0.65;
pub const TIMING_WEIGHT: f32 = 0.35;
const ACTION_ALPHABET: f64 = 5.0;

// --- Mouse-movement dynamics (pure-`Move` windows) -----------------------------
//
// Q_mouse = V^wv · B^wb · T^wt · S^ws   (weighted geometric mean, all terms in [ε,1])
//
//   V (vigor)      logistic of the 75th-percentile step speed  → slow jiggle ≈ 0
//   B (burstiness) 1 - exp(-λ · Var(ln speed))                  → constant speed ≈ 0
//   T (turning)    1 - ‖Σ w·e^{iΔθ}‖ / Σ w  (circular var of    → constant curvature ≈ 0
//                  the per-step heading change, distance-weighted)
//   S (spread)     tanh(radius-of-gyration / ref)               → tiny area ≈ 0
//
// Gaming motion (wide speed range, erratic heading, real travel) → ~0.9.
// Point-to-point web browsing → ~0.6. Smooth slow / linear / circular movers → <0.15.

/// Min positioned `Move` samples in a window before dynamics are scored at all.
pub const MOUSE_MIN_SAMPLES: usize = 11;
/// `move_fraction` at/below which dynamics are ignored (pure type-sequence quality).
pub const MOUSE_BLEND_LO: f32 = 0.70;
/// `move_fraction` at/above which quality is the dynamics score alone.
pub const MOUSE_BLEND_HI: f32 = 0.92;
/// Step speed (px/ms) at which vigor V = 0.5. ~80 px/s.
const MOUSE_SPEED_HALF: f64 = 0.08;
/// Logistic sharpness for vigor.
const MOUSE_SPEED_SHARP: f64 = 1.6;
/// Speeds below this (px/ms, ~5 px/s) are treated as "not moving" so pauses do not
/// blow up Var(ln speed).
const MOUSE_SPEED_FLOOR: f64 = 0.005;
/// λ in the burstiness map.
const MOUSE_BURST_LAMBDA: f64 = 1.0;
/// Radius of gyration (px) at which spread S = tanh(1) ≈ 0.76.
const MOUSE_GYRATION_REF: f64 = 60.0;
const MOUSE_W_VIGOR: f64 = 0.35;
const MOUSE_W_BURST: f64 = 0.25;
const MOUSE_W_TURN: f64 = 0.25;
const MOUSE_W_SPREAD: f64 = 0.15;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[repr(u8)]
pub enum ActionCategory {
    Key = 0,
    Click = 1,
    Move = 2,
    Scroll = 3,
    FocusSwitch = 4,
}

impl ActionCategory {
    pub fn from_event(kind: &str, action: &str) -> Option<Self> {
        match (kind, action) {
            ("keyboard", "press") => Some(Self::Key),
            ("mouse", "press") => Some(Self::Click),
            ("mouse", "move") => Some(Self::Move),
            ("scroll", "wheel") => Some(Self::Scroll),
            ("scroll", "press") => Some(Self::Click),
            ("focus", "switch") => Some(Self::FocusSwitch),
            _ => None,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Symbol {
    pub category: ActionCategory,
    pub timestamp_ms: i64,
    /// Screen position for `Move` symbols; `None` for every other category and for
    /// platforms that do not report coordinates.
    pub pos: Option<(i32, i32)>,
}

impl Symbol {
    pub fn new(category: ActionCategory, timestamp_ms: i64) -> Self {
        Self {
            category,
            timestamp_ms,
            pos: None,
        }
    }

    pub fn moved(timestamp_ms: i64, x: i32, y: i32) -> Self {
        Self {
            category: ActionCategory::Move,
            timestamp_ms,
            pos: Some((x, y)),
        }
    }
}

#[derive(Clone, Debug)]
pub struct SymbolRing {
    inner: VecDeque<Symbol>,
    cap: usize,
}

impl SymbolRing {
    pub fn new() -> Self {
        Self {
            inner: VecDeque::with_capacity(SYMBOL_RING_CAP),
            cap: SYMBOL_RING_CAP,
        }
    }

    pub fn push(&mut self, symbol: Symbol) {
        if self.inner.len() == self.cap {
            self.inner.pop_front();
        }
        self.inner.push_back(symbol);
    }

    pub fn clear(&mut self) {
        self.inner.clear();
    }

    #[allow(dead_code)]
    pub fn len(&self) -> usize {
        self.inner.len()
    }

    pub fn as_slice(&self) -> Vec<Symbol> {
        self.inner.iter().copied().collect()
    }

    pub fn in_range(&self, start_ms: i64, end_ms_exclusive: i64) -> Vec<Symbol> {
        self.inner
            .iter()
            .copied()
            .filter(|symbol| {
                symbol.timestamp_ms >= start_ms && symbol.timestamp_ms < end_ms_exclusive
            })
            .collect()
    }

    #[allow(dead_code)]
    pub fn iter(&self) -> impl Iterator<Item = &Symbol> {
        self.inner.iter()
    }
}

impl Default for SymbolRing {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct ComplexityScore {
    pub diversity: f32,
    pub timing: f32,
    pub quality: Option<f32>,
    /// Cursor-path dynamics score for `Move`-dominated windows; `None` otherwise.
    pub mouse_dynamics: Option<f32>,
    /// Fraction of symbols that are `Move`, in `[0, 1]`.
    pub move_fraction: f32,
}

impl ComplexityScore {
    /// Type-sequence quality: `0.65 · LZ76 + 0.35 · PE`, cross-faded into the
    /// cursor-path dynamics score as the window fills with `Move` symbols.
    pub fn blended_raw(&self) -> f32 {
        let base = (DIVERSITY_WEIGHT * self.diversity + TIMING_WEIGHT * self.timing).clamp(0.0, 1.0);
        match self.mouse_dynamics {
            Some(dynamics) => {
                let g = smoothstep(MOUSE_BLEND_LO, MOUSE_BLEND_HI, self.move_fraction);
                ((1.0 - g) * base + g * dynamics).clamp(0.0, 1.0)
            }
            None => base,
        }
    }

    /// Live density. Sparse windows scale in instead of snapping to 0 / 45 / 100.
    /// Minute persist still uses [`Self::quality`] (`None` if short).
    pub fn continuous(&self, symbol_count: usize) -> f32 {
        if symbol_count == 0 {
            return 0.0;
        }
        let raw = self.blended_raw();
        if symbol_count < MIN_SYMBOLS {
            raw * (symbol_count as f32 / MIN_SYMBOLS as f32)
        } else {
            raw
        }
    }
}

pub fn score_symbols(symbols: &[Symbol]) -> ComplexityScore {
    let diversity = diversity_lz76(symbols);
    let timing = timing_permutation_entropy(symbols);
    let move_fraction = if symbols.is_empty() {
        0.0
    } else {
        symbols
            .iter()
            .filter(|s| s.category == ActionCategory::Move)
            .count() as f32
            / symbols.len() as f32
    };
    let mouse_dynamics = if move_fraction >= MOUSE_BLEND_LO {
        mouse_dynamics_score(symbols)
    } else {
        None
    };
    let mut score = ComplexityScore {
        diversity,
        timing,
        quality: None,
        mouse_dynamics,
        move_fraction,
    };
    score.quality = if symbols.len() < MIN_SYMBOLS {
        None
    } else {
        Some(score.blended_raw())
    };
    score
}

/// Hermite smoothstep, clamped. `smoothstep(a, b, x) = 0` for `x ≤ a`, `1` for `x ≥ b`.
fn smoothstep(edge0: f32, edge1: f32, x: f32) -> f32 {
    if edge1 <= edge0 {
        return if x < edge0 { 0.0 } else { 1.0 };
    }
    let t = ((x - edge0) / (edge1 - edge0)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

/// Quality of a cursor path from its geometry alone. `None` when there are fewer
/// than [`MOUSE_MIN_SAMPLES`] positioned `Move` samples. See the module header for
/// the formula.
pub fn mouse_dynamics_score(symbols: &[Symbol]) -> Option<f32> {
    let pts: Vec<(f64, f64, f64)> = symbols
        .iter()
        .filter(|s| s.category == ActionCategory::Move)
        .filter_map(|s| s.pos.map(|(x, y)| (s.timestamp_ms as f64, x as f64, y as f64)))
        .collect();
    if pts.len() < MOUSE_MIN_SAMPLES {
        return None;
    }
    let n = pts.len();

    let mut speeds = Vec::with_capacity(n - 1);
    let mut headings = Vec::with_capacity(n - 1);
    let mut step_dist = Vec::with_capacity(n - 1);
    for w in pts.windows(2) {
        let dt = (w[1].0 - w[0].0).max(1.0);
        let dx = w[1].1 - w[0].1;
        let dy = w[1].2 - w[0].2;
        let dist = dx.hypot(dy);
        step_dist.push(dist);
        speeds.push((dist / dt).max(MOUSE_SPEED_FLOOR));
        headings.push(dy.atan2(dx));
    }

    // V — vigor: logistic of the 75th-percentile step speed.
    let mut sorted = speeds.clone();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let p75 = sorted[(sorted.len() * 3) / 4];
    let vigor = 1.0 / (1.0 + (MOUSE_SPEED_HALF / p75).powf(MOUSE_SPEED_SHARP));

    // B — burstiness: 1 - exp(-λ · Var(ln speed)).
    let ln_v: Vec<f64> = speeds.iter().map(|v| v.ln()).collect();
    let mean_ln = ln_v.iter().sum::<f64>() / ln_v.len() as f64;
    let var_ln = ln_v.iter().map(|l| (l - mean_ln).powi(2)).sum::<f64>() / ln_v.len() as f64;
    let burst = 1.0 - (-MOUSE_BURST_LAMBDA * var_ln).exp();

    // T — turning irregularity: 1 - distance-weighted mean resultant length of Δheading.
    let mut rx = 0.0;
    let mut ry = 0.0;
    let mut wsum = 0.0;
    for i in 1..headings.len() {
        let mut delta = headings[i] - headings[i - 1];
        while delta > std::f64::consts::PI {
            delta -= 2.0 * std::f64::consts::PI;
        }
        while delta < -std::f64::consts::PI {
            delta += 2.0 * std::f64::consts::PI;
        }
        let weight = (step_dist[i] * step_dist[i - 1]).sqrt();
        rx += weight * delta.cos();
        ry += weight * delta.sin();
        wsum += weight;
    }
    let turning = if wsum > 0.0 {
        1.0 - rx.hypot(ry) / wsum
    } else {
        0.0
    };

    // S — spatial spread: tanh(radius of gyration / ref).
    let (mut cx, mut cy) = (0.0, 0.0);
    for p in &pts {
        cx += p.1;
        cy += p.2;
    }
    cx /= n as f64;
    cy /= n as f64;
    let var_pos = pts
        .iter()
        .map(|p| (p.1 - cx).powi(2) + (p.2 - cy).powi(2))
        .sum::<f64>()
        / n as f64;
    let spread = (var_pos.sqrt() / MOUSE_GYRATION_REF).tanh();

    let eps = 1e-4_f64;
    let log_sum = MOUSE_W_VIGOR * vigor.clamp(eps, 1.0).ln()
        + MOUSE_W_BURST * burst.clamp(eps, 1.0).ln()
        + MOUSE_W_TURN * turning.clamp(eps, 1.0).ln()
        + MOUSE_W_SPREAD * spread.clamp(eps, 1.0).ln();
    Some(log_sum.exp().clamp(0.0, 1.0) as f32)
}

pub fn diversity_lz76(symbols: &[Symbol]) -> f32 {
    if symbols.len() < 2 {
        return 1.0;
    }
    let seq: Vec<u8> = symbols.iter().map(|s| s.category as u8).collect();
    let c = lz76_complexity(&seq) as f64;
    let n = symbols.len() as f64;
    let log_a_n = n.ln() / ACTION_ALPHABET.ln();
    (c * log_a_n / n).clamp(0.0, 1.0) as f32
}

/// Markov-1 conditional Shannon entropy, normalized by log2(|A|). Cross-check only.
#[allow(dead_code)]
pub fn markov1_normalized(seq: &[u8], alphabet: usize) -> f32 {
    if seq.len() < 2 || alphabet < 2 {
        return 1.0;
    }
    let mut joint = vec![0u32; alphabet * alphabet];
    let mut prev_counts = vec![0u32; alphabet];
    for pair in seq.windows(2) {
        let a = pair[0] as usize;
        let b = pair[1] as usize;
        if a >= alphabet || b >= alphabet {
            continue;
        }
        joint[a * alphabet + b] = joint[a * alphabet + b].saturating_add(1);
        prev_counts[a] = prev_counts[a].saturating_add(1);
    }
    let pairs: u32 = prev_counts.iter().sum();
    if pairs == 0 {
        return 1.0;
    }
    let h_joint = shannon(&joint, pairs);
    let h_prev = shannon(&prev_counts, pairs);
    let cond = (h_joint - h_prev).max(0.0);
    let max_h = (alphabet as f64).log2();
    if max_h == 0.0 {
        1.0
    } else {
        (cond / max_h).clamp(0.0, 1.0) as f32
    }
}

fn shannon(counts: &[u32], total: u32) -> f64 {
    if total == 0 {
        return 0.0;
    }
    let mut h = 0.0;
    for &c in counts {
        if c == 0 {
            continue;
        }
        let p = c as f64 / total as f64;
        h -= p * p.log2();
    }
    h
}

pub fn lz76_complexity(seq: &[u8]) -> usize {
    let n = seq.len();
    if n == 0 {
        return 0;
    }
    let mut phrases = 0;
    let mut pos = 0;
    while pos < n {
        let mut longest = 0;
        for end in pos + 1..=n {
            if slice_in_prefix(&seq[..pos], &seq[pos..end]) {
                longest = end - pos;
            } else {
                break;
            }
        }
        if longest == 0 {
            pos += 1;
        } else if pos + longest < n {
            pos += longest + 1;
        } else {
            pos = n;
        }
        phrases += 1;
    }
    phrases
}

fn slice_in_prefix(prefix: &[u8], needle: &[u8]) -> bool {
    if needle.is_empty() || needle.len() > prefix.len() {
        return false;
    }
    prefix.windows(needle.len()).any(|window| window == needle)
}

fn timing_permutation_entropy(symbols: &[Symbol]) -> f32 {
    let n = symbols.len();
    if n == 0 {
        return 1.0;
    }
    let mut counts = [0usize; 5];
    for symbol in symbols {
        counts[symbol.category as usize] = counts[symbol.category as usize].saturating_add(1);
    }
    let (dominant_idx, dominant) = counts
        .iter()
        .copied()
        .enumerate()
        .max_by_key(|(_, c)| *c)
        .unwrap_or((0, 0));
    if (dominant as f64) / (n as f64) < DOMINANT_FRACTION {
        return 1.0;
    }
    let times: Vec<i64> = symbols
        .iter()
        .filter(|s| s.category as usize == dominant_idx)
        .map(|s| s.timestamp_ms)
        .collect();
    if times.len() < PE_MIN_INTERVALS + 1 {
        return 1.0;
    }
    let intervals: Vec<f64> = times
        .windows(2)
        .map(|w| (w[1] - w[0]).max(0) as f64)
        .collect();
    permutation_entropy(&intervals, PE_ORDER)
}

pub fn permutation_entropy(series: &[f64], order: usize) -> f32 {
    if order < 2 || series.len() < order {
        return 1.0;
    }
    let n_patterns = factorial(order);
    let mut counts = vec![0u32; n_patterns];
    let mut total = 0.0;
    for window in series.windows(order) {
        let idx = ordinal_index(window);
        if idx < counts.len() {
            counts[idx] = counts[idx].saturating_add(1);
            total += 1.0;
        }
    }
    if total == 0.0 {
        return 1.0;
    }
    let mut h = 0.0;
    for c in counts {
        if c == 0 {
            continue;
        }
        let p = c as f64 / total;
        h -= p * p.log2();
    }
    let max_h = (n_patterns as f64).log2();
    if max_h == 0.0 {
        1.0
    } else {
        (h / max_h).clamp(0.0, 1.0) as f32
    }
}

fn factorial(n: usize) -> usize {
    (1..=n).product()
}

fn ordinal_index(window: &[f64]) -> usize {
    let n = window.len();
    let mut idx: Vec<usize> = (0..n).collect();
    idx.sort_by(|&a, &b| {
        window[a]
            .partial_cmp(&window[b])
            .unwrap_or(std::cmp::Ordering::Equal)
            .then(a.cmp(&b))
    });
    let mut unused: Vec<usize> = (0..n).collect();
    let mut code = 0;
    let mut fact = factorial(n);
    for &value in &idx {
        if unused.is_empty() {
            break;
        }
        fact /= unused.len();
        let pos = unused.iter().position(|&x| x == value).unwrap_or(0);
        code += pos * fact;
        unused.remove(pos);
    }
    code
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seq(category: ActionCategory, n: usize, step_ms: i64) -> Vec<Symbol> {
        (0..n)
            .map(|i| Symbol::new(category, i as i64 * step_ms))
            .collect()
    }

    fn mixed(n: usize) -> Vec<Symbol> {
        let cats = [
            ActionCategory::Key,
            ActionCategory::Click,
            ActionCategory::Move,
            ActionCategory::Scroll,
            ActionCategory::FocusSwitch,
        ];
        (0..n)
            .map(|i| {
                let mut x = (i as u32).wrapping_mul(0x9E37_79B9);
                x ^= x >> 16;
                let idx = (x as usize) % cats.len();
                Symbol::new(cats[idx], i as i64 * (17 + (i as i64 % 11) * 3))
            })
            .collect()
    }

    /// `Move` symbols tracing `f(i) -> (x, y)` at `t = Σ dt(i)`.
    fn moves(n: usize, dt: impl Fn(usize) -> i64, path: impl Fn(usize) -> (i32, i32)) -> Vec<Symbol> {
        let mut t = 0_i64;
        (0..n)
            .map(|i| {
                t += dt(i).max(1);
                let (x, y) = path(i);
                Symbol::moved(t, x, y)
            })
            .collect()
    }

    fn hash(i: usize) -> u32 {
        let mut x = (i as u32).wrapping_mul(0x9E37_79B9);
        x ^= x >> 15;
        x = x.wrapping_mul(0x85EB_CA6B);
        x ^= x >> 13;
        x
    }

    fn jiggle_circle() -> Vec<Symbol> {
        // Constant angular velocity, 20 px radius, one sample every 400 ms (~0.02 px/ms).
        moves(
            48,
            |_| 400,
            |i| {
                let a = i as f64 * 0.4;
                ((20.0 * a.cos()) as i32, (20.0 * a.sin()) as i32)
            },
        )
    }

    fn jiggle_line() -> Vec<Symbol> {
        // Smooth back-and-forth over ~60 px, slow.
        moves(
            48,
            |_| 350,
            |i| ((30.0 * (i as f64 * 0.35).sin()) as i32, 0),
        )
    }

    fn browsing() -> Vec<Symbol> {
        // Point-to-point: three fast steps toward a target, then a ~550 ms dwell.
        let mut out = Vec::new();
        let (mut x, mut y) = (0.0_f64, 0.0_f64);
        let mut t = 0_i64;
        for seg in 0..12 {
            let ang = (hash(seg) % 628) as f64 / 100.0;
            let reach = 90.0 + (hash(seg * 3) % 60) as f64;
            for k in 0..3 {
                t += 45 + k as i64 * 12;
                x += reach * ang.cos();
                y += reach * ang.sin();
                out.push(Symbol::moved(t, x as i32, y as i32));
            }
            t += 550;
            x += 2.0;
            y -= 1.0;
            out.push(Symbol::moved(t, x as i32, y as i32));
        }
        out
    }

    fn gaming() -> Vec<Symbol> {
        // Wide speed range (flicks + micro-adjustments), erratic heading, real travel.
        let mut out = Vec::new();
        let (mut x, mut y) = (0.0_f64, 0.0_f64);
        let mut t = 0_i64;
        for i in 0..60 {
            let h = hash(i);
            let flick = h % 3 == 0;
            let step = if flick {
                120.0 + (h % 90) as f64
            } else {
                5.0 + (h % 14) as f64
            };
            let ang = (hash(i * 7 + 1) % 628) as f64 / 100.0;
            x += step * ang.cos();
            y += step * ang.sin();
            t += 55 + (h % 70) as i64;
            out.push(Symbol::moved(t, x as i32, y as i32));
        }
        out
    }

    #[test]
    fn all_scroll_has_near_zero_diversity() {
        let symbols = seq(ActionCategory::Scroll, 80, 40);
        let score = score_symbols(&symbols);
        assert!(score.diversity < 0.35, "diversity={}", score.diversity);
        assert!(score.quality.unwrap() < 0.5);
    }

    #[test]
    fn all_key_and_all_move_have_near_zero_diversity() {
        for category in [
            ActionCategory::Key,
            ActionCategory::Move,
            ActionCategory::Click,
        ] {
            let score = score_symbols(&seq(category, 60, 50));
            assert!(
                score.diversity < 0.35,
                "{category:?} diversity={}",
                score.diversity
            );
        }
    }

    #[test]
    fn mixed_irregular_has_high_diversity() {
        let mixed_score = score_symbols(&mixed(80));
        let monotone = score_symbols(&seq(ActionCategory::Scroll, 80, 40));
        assert!(
            mixed_score.diversity > monotone.diversity,
            "mixed={} monotone={}",
            mixed_score.diversity,
            monotone.diversity
        );
        assert!(
            mixed_score.diversity > 0.5,
            "mixed diversity should approach 1 after rate normalization, got {}",
            mixed_score.diversity
        );
        assert!(mixed_score.quality.is_some());
    }

    #[test]
    fn metronomic_one_class_has_low_permutation_entropy() {
        let symbols = seq(ActionCategory::Click, 40, 100);
        let pe = timing_permutation_entropy(&symbols);
        assert!(pe < 0.35, "pe={pe}");
    }

    #[test]
    fn irregular_one_class_has_higher_permutation_entropy() {
        let symbols: Vec<Symbol> = (0..40)
            .map(|i| {
                Symbol::new(
                    ActionCategory::Click,
                    (0..i).map(|j| 20 + (j * 13) % 97).sum::<i64>(),
                )
            })
            .collect();
        let pe = timing_permutation_entropy(&symbols);
        assert!(pe > 0.4, "pe={pe}");
    }

    #[test]
    fn short_minute_omits_quality() {
        let score = score_symbols(&seq(ActionCategory::Key, 8, 30));
        assert!(score.quality.is_none());
        let live = score.continuous(8);
        assert!(live > 0.0 && live < score.continuous(12));
    }

    #[test]
    fn continuous_is_not_three_plateaus() {
        let mixed_q = score_symbols(&mixed(80)).continuous(80);
        let scroll_q = score_symbols(&seq(ActionCategory::Scroll, 80, 40)).continuous(80);
        assert!((scroll_q - 0.45).abs() > 0.05);
        assert!(mixed_q > scroll_q);
    }

    #[test]
    fn ring_overwrite_keeps_later_key_and_click() {
        let mut ring = SymbolRing::new();
        for i in 0..SYMBOL_RING_CAP {
            ring.push(Symbol::new(ActionCategory::Move, i as i64));
        }
        ring.push(Symbol::new(ActionCategory::Key, 10_000));
        ring.push(Symbol::new(ActionCategory::Click, 10_010));
        assert_eq!(ring.len(), SYMBOL_RING_CAP);
        let cats: Vec<_> = ring.iter().map(|s| s.category).collect();
        assert!(cats.contains(&ActionCategory::Key));
        assert!(cats.contains(&ActionCategory::Click));
        let score = score_symbols(&ring.as_slice());
        assert!(
            score.diversity > 0.0,
            "late Key/Click must not be crowded out"
        );
        assert_ne!(
            cats.iter().filter(|c| **c == ActionCategory::Move).count(),
            SYMBOL_RING_CAP
        );
    }

    #[test]
    fn two_class_metronome_is_a_known_high_quality_limitation() {
        // Deliberate key,click,key,click… stays below the 70% dominant-class PE gate.
        // Layer 2 is not an adversarial-bot detector; this documents the hole.
        let symbols: Vec<Symbol> = (0..40)
            .map(|i| {
                let category = if i % 2 == 0 {
                    ActionCategory::Key
                } else {
                    ActionCategory::Click
                };
                Symbol::new(category, i as i64 * 50)
            })
            .collect();
        let score = score_symbols(&symbols);
        assert!(score.timing >= 0.99);
        assert!(score.quality.unwrap() > 0.2);
    }

    #[test]
    fn markov1_is_low_for_constant_and_higher_for_mixed() {
        let constant: Vec<u8> = vec![2; 80];
        let mixed: Vec<u8> = (0..80)
            .map(|i| if i % 2 == 0 { 0 } else { (1 + (i % 3)) as u8 })
            .collect();
        assert!(markov1_normalized(&constant, 5) < 0.15);
        assert!(markov1_normalized(&mixed, 5) > 0.2);
    }

    // --- mouse-movement dynamics ---------------------------------------------

    fn mouse_q(symbols: &[Symbol]) -> f32 {
        mouse_dynamics_score(symbols).expect("enough positioned move samples")
    }

    #[test]
    fn smooth_slow_movement_scores_low() {
        let circle = mouse_q(&jiggle_circle());
        let line = mouse_q(&jiggle_line());
        assert!(circle < 0.08, "circle jiggle = {circle}");
        assert!(line < 0.30, "line jiggle = {line}");
    }

    #[test]
    fn gaming_movement_scores_high_browsing_normal() {
        let game = mouse_q(&gaming());
        let browse = mouse_q(&browsing());
        assert!(game > 0.62, "gaming = {game}");
        assert!(
            (0.40..0.85).contains(&browse),
            "browsing = {browse} (want a middling score)"
        );
        assert!(game > browse, "gaming {game} !> browsing {browse}");
    }

    #[test]
    fn dynamics_spectrum_is_monotonic() {
        let circle = mouse_q(&jiggle_circle());
        let line = mouse_q(&jiggle_line());
        let browse = mouse_q(&browsing());
        let game = mouse_q(&gaming());
        assert!(
            circle < line && line < browse && browse < game,
            "expected circle {circle} < line {line} < browse {browse} < game {game}"
        );
    }

    #[test]
    fn move_dominated_minute_uses_dynamics_for_quality() {
        // A pure jiggle minute: type-sequence quality alone would be ~0.5, dynamics pulls it down.
        let jiggle = jiggle_circle();
        let score = score_symbols(&jiggle);
        assert!(score.move_fraction > 0.99);
        assert_eq!(
            score.mouse_dynamics.map(|q| q < 0.1),
            Some(true),
            "dynamics = {:?}",
            score.mouse_dynamics
        );
        assert!(
            score.quality.unwrap() < 0.15,
            "blended quality = {}",
            score.quality.unwrap()
        );
    }

    #[test]
    fn gaming_minute_keeps_high_quality() {
        let score = score_symbols(&gaming());
        assert!(score.quality.unwrap() > 0.6, "quality = {}", score.quality.unwrap());
    }

    #[test]
    fn mixed_minute_ignores_mouse_dynamics() {
        // Half real mouse jiggle, half keystrokes: below MOUSE_BLEND_LO, so the
        // dynamics score must not be blended in.
        let mut symbols = jiggle_circle();
        symbols.truncate(24);
        for i in 0..24 {
            symbols.push(Symbol::new(ActionCategory::Key, 200 + i as i64 * 130));
        }
        let score = score_symbols(&symbols);
        assert!(score.move_fraction < MOUSE_BLEND_LO);
        let base = (DIVERSITY_WEIGHT * score.diversity + TIMING_WEIGHT * score.timing).clamp(0.0, 1.0);
        assert!((score.quality.unwrap() - base).abs() < 1e-6);
    }

    #[test]
    fn dynamics_needs_positions() {
        // `seq` builds Move symbols with no coordinates → no dynamics score.
        assert!(mouse_dynamics_score(&seq(ActionCategory::Move, 60, 50)).is_none());
    }

    #[test]
    fn linear_auto_mover_scores_low() {
        // Constant-velocity straight drag across the screen: fast and wide-ranging,
        // but zero speed variance and zero turning.
        let mover = moves(40, |_| 120, |i| (i as i32 * 40, i as i32 * 15));
        let q = mouse_q(&mover);
        assert!(q < 0.15, "linear mover = {q}");
    }
}

