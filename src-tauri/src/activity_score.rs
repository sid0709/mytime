//! Shared volume-based intensity scoring (must stay in lockstep with
//! `src/app/constants/activityScore.ts`).

pub const STANDARD_APM_MAX: u32 = 250;

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

pub fn effective_score(
    key_presses: u32,
    mouse_clicks: u32,
    scroll_events: u32,
    mouse_moves: u32,
) -> u32 {
    volume_score(key_presses, mouse_clicks, scroll_events, mouse_moves).min(STANDARD_APM_MAX)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn effective_score_is_volume_capped_at_standard_max() {
        assert_eq!(effective_score(2, 0, 0, 0), 24);
        assert_eq!(effective_score(100, 100, 100, 100), STANDARD_APM_MAX);
    }
}
