//! Entropy-rate and permutation-entropy scoring for a 1-minute action stream.
//!
//! No OS types. Diversity is the LZ76 entropy rate `c(n)·log_5(n)/n` of the
//! action-type sequence. Timing is Bandt–Pompe permutation entropy on the dominant
//! class when it is ≥70% of the window.

use std::collections::VecDeque;

pub const SYMBOL_RING_CAP: usize = 2048;
pub const MIN_SYMBOLS: usize = 12;
pub const PE_ORDER: usize = 3;
pub const PE_MIN_INTERVALS: usize = 16;
pub const DOMINANT_FRACTION: f64 = 0.70;
pub const DIVERSITY_WEIGHT: f32 = 0.65;
pub const TIMING_WEIGHT: f32 = 0.35;
const ACTION_ALPHABET: f64 = 5.0;

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
}

impl ComplexityScore {
    /// Live density: `0.65 · LZ76 + 0.35 · PE`. Sparse windows scale in instead of
    /// snapping to 0 / 45 / 100. Minute persist still uses [`Self::quality`] (`None` if short).
    pub fn continuous(&self, symbol_count: usize) -> f32 {
        if symbol_count == 0 {
            return 0.0;
        }
        let raw = (DIVERSITY_WEIGHT * self.diversity + TIMING_WEIGHT * self.timing).clamp(0.0, 1.0);
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
    let quality = if symbols.len() < MIN_SYMBOLS {
        None
    } else {
        Some((DIVERSITY_WEIGHT * diversity + TIMING_WEIGHT * timing).clamp(0.0, 1.0))
    };
    ComplexityScore {
        diversity,
        timing,
        quality,
    }
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
            .map(|i| Symbol {
                category,
                timestamp_ms: i as i64 * step_ms,
            })
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
                Symbol {
                    category: cats[idx],
                    timestamp_ms: i as i64 * (17 + (i as i64 % 11) * 3),
                }
            })
            .collect()
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
            .map(|i| Symbol {
                category: ActionCategory::Click,
                timestamp_ms: (0..i).map(|j| 20 + (j * 13) % 97).sum::<i64>(),
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
            ring.push(Symbol {
                category: ActionCategory::Move,
                timestamp_ms: i as i64,
            });
        }
        ring.push(Symbol {
            category: ActionCategory::Key,
            timestamp_ms: 10_000,
        });
        ring.push(Symbol {
            category: ActionCategory::Click,
            timestamp_ms: 10_010,
        });
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
            .map(|i| Symbol {
                category: if i % 2 == 0 {
                    ActionCategory::Key
                } else {
                    ActionCategory::Click
                },
                timestamp_ms: i as i64 * 50,
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
}
