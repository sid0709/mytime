//! Shared volume and effective-intensity scoring (must stay in lockstep with
//! `src/app/constants/activityScore.ts`).

use crate::models::AppInputMinuteDto;
use std::collections::BTreeMap;
use std::sync::OnceLock;

pub const STANDARD_APM_MAX: u32 = 250;

pub const DEFAULT_HANDS_ON_THRESHOLD: f32 = 0.25;
pub const DEFAULT_BROWSING_TARGET: f32 = 0.45;
pub const DEFAULT_PERSIST_MIN: f32 = 0.25;
pub const DEFAULT_LIVE_WINDOW_MS: u32 = 20_000;

/// Cross-language fixture — keep identical to `BUCKET_INTENSITY_FIXTURE` in
/// `src/app/constants/activityScore.ts`.
#[allow(dead_code)]
pub const BUCKET_INTENSITY_FIXTURE: BucketIntensityFixture = BucketIntensityFixture {
    key_presses: 10,
    mouse_clicks: 2,
    scroll_events: 4,
    mouse_moves: 5,
    quality: 0.5,
    expected: 94,
};

#[allow(dead_code)]
pub struct BucketIntensityFixture {
    pub key_presses: u32,
    pub mouse_clicks: u32,
    pub scroll_events: u32,
    pub mouse_moves: u32,
    pub quality: f32,
    pub expected: u32,
}

struct QualityMixConfig {
    hands_on_threshold: f32,
    browsing_target: f32,
    persist_min: f32,
    live_window_ms: u32,
}

fn load_dotenv_files() {
    let mut paths = vec![
        std::path::PathBuf::from(".env"),
        std::path::PathBuf::from("../.env"),
    ];
    if let Ok(manifest) = std::env::var("CARGO_MANIFEST_DIR") {
        let root = std::path::Path::new(&manifest);
        paths.insert(0, root.join("..").join(".env"));
        paths.insert(1, root.join(".env"));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            paths.push(dir.join(".env"));
        }
    }
    for path in paths {
        if dotenvy::from_path(&path).is_ok() {
            break;
        }
    }
}

fn env_unit(key: &str, default: f32) -> f32 {
    std::env::var(key)
        .ok()
        .and_then(|value| value.parse::<f32>().ok())
        .filter(|value| *value > 0.0 && *value <= 1.0)
        .unwrap_or(default)
}

fn env_ms(key: &str, default: u32) -> u32 {
    std::env::var(key)
        .ok()
        .and_then(|value| value.parse::<u32>().ok())
        .filter(|value| *value >= 1_000 && *value <= 120_000)
        .unwrap_or(default)
}

fn quality_mix_config() -> &'static QualityMixConfig {
    static CONFIG: OnceLock<QualityMixConfig> = OnceLock::new();
    CONFIG.get_or_init(|| {
        load_dotenv_files();
        QualityMixConfig {
            hands_on_threshold: env_unit("QUALITY_HANDS_ON_THRESHOLD", DEFAULT_HANDS_ON_THRESHOLD),
            browsing_target: env_unit("QUALITY_BROWSING_TARGET", DEFAULT_BROWSING_TARGET),
            persist_min: env_unit("QUALITY_PERSIST_MIN", DEFAULT_PERSIST_MIN),
            live_window_ms: env_ms("QUALITY_LIVE_WINDOW_MS", DEFAULT_LIVE_WINDOW_MS),
        }
    })
}

/// Load `.env` quality knobs once at process start.
pub fn load_quality_env() {
    let _ = quality_mix_config();
}

/// 30s-slot mean below this skips activity SQLite writes (`skipActivityPersist`).
pub fn persist_min() -> f32 {
    quality_mix_config().persist_min
}

pub fn live_window_ms() -> u32 {
    quality_mix_config().live_window_ms
}

pub fn volume_score(
    key_presses: u32,
    mouse_clicks: u32,
    scroll_events: u32,
    mouse_moves: u32,
) -> u32 {
    key_presses
        .saturating_mul(12)
        .saturating_add(mouse_clicks.saturating_mul(10))
        .saturating_add(scroll_events.saturating_mul(8))
        .saturating_add(mouse_moves.saturating_mul(3))
}

pub fn quality_or_one(quality: Option<f32>) -> f64 {
    quality
        .map(|value| (value as f64).clamp(0.0, 1.0))
        .unwrap_or(1.0)
}

/// Key+click share of volume. Scroll/move-heavy minutes (feeds) sit low;
/// typing and game input sit high.
pub fn hands_on_fraction(
    key_presses: u32,
    mouse_clicks: u32,
    scroll_events: u32,
    mouse_moves: u32,
) -> f64 {
    let total = volume_score(key_presses, mouse_clicks, scroll_events, mouse_moves) as f64;
    if total == 0.0 {
        return 1.0;
    }
    let hands = key_presses
        .saturating_mul(12)
        .saturating_add(mouse_clicks.saturating_mul(10)) as f64;
    (hands / total).clamp(0.0, 1.0)
}

/// Entropy quality scaled by hands-on mix. Below the `.env` threshold this
/// lands near `QUALITY_BROWSING_TARGET` (social/feeds); at or above it, gaming
/// and typing keep the entropy score (~1).
pub fn mixed_quality(
    key_presses: u32,
    mouse_clicks: u32,
    scroll_events: u32,
    mouse_moves: u32,
    quality: Option<f32>,
) -> f64 {
    let base = quality_or_one(quality);
    let fraction = hands_on_fraction(key_presses, mouse_clicks, scroll_events, mouse_moves);
    let cfg = quality_mix_config();
    let threshold = cfg.hands_on_threshold as f64;
    let target = cfg.browsing_target as f64;
    let lo = (threshold - 0.04).max(0.0);
    let span = (threshold - lo).max(1e-6);
    let t = ((fraction - lo) / span).clamp(0.0, 1.0);
    target + t * (base - target)
}

pub fn effective_score(
    key_presses: u32,
    mouse_clicks: u32,
    scroll_events: u32,
    mouse_moves: u32,
    quality: Option<f32>,
) -> u32 {
    let volume = volume_score(key_presses, mouse_clicks, scroll_events, mouse_moves) as f64;
    ((volume * quality_or_one(quality)).round() as u32).min(STANDARD_APM_MAX)
}

pub fn smoothed_quality(qualities: &BTreeMap<u32, f64>, minute: u32) -> f64 {
    let mut sum = 0.0;
    let mut n = 0_u32;
    let start = minute.saturating_sub(1);
    let end = minute.saturating_add(1);
    for m in start..=end {
        if let Some(quality) = qualities.get(&m) {
            sum += *quality;
            n = n.saturating_add(1);
        }
    }
    if n == 0 {
        1.0
    } else {
        sum / n as f64
    }
}

pub fn qualities_by_minute(minutes: &[AppInputMinuteDto]) -> BTreeMap<u32, f64> {
    minutes
        .iter()
        .filter(|bucket| {
            bucket.key_presses > 0
                || bucket.mouse_clicks > 0
                || bucket.mouse_moves > 0
                || bucket.scroll_events > 0
        })
        .map(|bucket| {
            (
                bucket.minute_of_day,
                mixed_quality(
                    bucket.key_presses,
                    bucket.mouse_clicks,
                    bucket.scroll_events,
                    bucket.mouse_moves,
                    bucket.quality,
                ),
            )
        })
        .collect()
}

pub fn bucket_activity_score_smoothed(
    bucket: &AppInputMinuteDto,
    qualities: &BTreeMap<u32, f64>,
) -> u32 {
    let quality = smoothed_quality(qualities, bucket.minute_of_day) as f32;
    effective_score(
        bucket.key_presses,
        bucket.mouse_clicks,
        bucket.scroll_events,
        bucket.mouse_moves,
        Some(quality),
    )
}

pub fn centi_from_quality(value: Option<f32>) -> Option<i32> {
    value.map(|v| (v.clamp(0.0, 1.0) * 100.0).round() as i32)
}

pub fn quality_from_centi(value: Option<i32>) -> Option<f32> {
    value.map(|v| (v as f32 / 100.0).clamp(0.0, 1.0))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fixture_matches_volume_times_quality() {
        let got = effective_score(
            BUCKET_INTENSITY_FIXTURE.key_presses,
            BUCKET_INTENSITY_FIXTURE.mouse_clicks,
            BUCKET_INTENSITY_FIXTURE.scroll_events,
            BUCKET_INTENSITY_FIXTURE.mouse_moves,
            Some(BUCKET_INTENSITY_FIXTURE.quality),
        );
        assert_eq!(got, BUCKET_INTENSITY_FIXTURE.expected);
    }

    #[test]
    fn null_quality_is_full_volume() {
        assert_eq!(effective_score(2, 0, 0, 0, None), 24);
    }

    #[test]
    fn three_minute_mean_uses_neighbors() {
        let mut map = BTreeMap::new();
        map.insert(10, 0.0);
        map.insert(11, 1.0);
        map.insert(12, 0.5);
        let mean = smoothed_quality(&map, 11);
        assert!((mean - 0.5).abs() < 1e-6);
    }

    #[test]
    fn browsing_mix_lands_near_target() {
        let quality = mixed_quality(0, 2, 40, 80, Some(0.99));
        assert!(
            (0.40..=0.52).contains(&quality),
            "browsing quality={quality}"
        );
    }

    #[test]
    fn gaming_mix_keeps_high_entropy_score() {
        let quality = mixed_quality(40, 20, 4, 50, Some(0.96));
        assert!(quality > 0.9, "gaming quality={quality}");
    }
}
