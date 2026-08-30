//! Shared collapsing of repeated mouse-move / scroll-wheel events into "sequences".
//!
//! Both the live-feed aggregator and the app-usage monitor treat a run of rapid mouse
//! moves (or scroll ticks) as a single logical event so stats and feeds aren't dominated
//! by motion noise. This module is the single source of truth for that rule, with tests.

use crate::input_monitor::InputMonitorEventDto;

/// Max gap between consecutive mouse-move events still considered one sequence.
const MOVE_SEQUENCE_GAP_MS: i64 = 650;
/// Max gap between consecutive scroll-wheel events still considered one sequence.
const SCROLL_SEQUENCE_GAP_MS: i64 = 450;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum SequenceKind {
    MouseMove,
    ScrollWheel,
    Other,
}

#[derive(Clone, Copy, Debug)]
pub struct SequenceState {
    pub kind: SequenceKind,
    pub timestamp_ms: i64,
}

impl SequenceState {
    /// Snapshot the sequence-relevant fields of an event.
    pub fn from_event(event: &InputMonitorEventDto) -> Self {
        Self {
            kind: event_kind(event),
            timestamp_ms: event.timestamp,
        }
    }
}

/// Classify an event for sequence-collapsing purposes.
pub fn event_kind(event: &InputMonitorEventDto) -> SequenceKind {
    match (event.kind, event.action) {
        ("mouse", "move") => SequenceKind::MouseMove,
        ("scroll", "wheel") => SequenceKind::ScrollWheel,
        _ => SequenceKind::Other,
    }
}

/// Returns `true` if `event` continues the previous same-kind sequence within the gap window.
/// Only mouse-move and scroll-wheel collapse; every other event is always its own sequence.
pub fn is_continuation(last: Option<SequenceState>, event: &InputMonitorEventDto) -> bool {
    let Some(last) = last else {
        return false;
    };

    match event_kind(event) {
        SequenceKind::MouseMove => {
            last.kind == SequenceKind::MouseMove
                && event.timestamp.saturating_sub(last.timestamp_ms) <= MOVE_SEQUENCE_GAP_MS
        }
        SequenceKind::ScrollWheel => {
            last.kind == SequenceKind::ScrollWheel
                && event.timestamp.saturating_sub(last.timestamp_ms) <= SCROLL_SEQUENCE_GAP_MS
        }
        SequenceKind::Other => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn event(kind: &'static str, action: &'static str, timestamp: i64) -> InputMonitorEventDto {
        InputMonitorEventDto {
            kind,
            action,
            label: String::new(),
            state_key: None,
            button: None,
            direction: None,
            x: None,
            y: None,
            timestamp,
        }
    }

    #[test]
    fn no_previous_state_is_never_a_continuation() {
        assert!(!is_continuation(None, &event("mouse", "move", 1000)));
    }

    #[test]
    fn close_moves_collapse_but_distant_ones_do_not() {
        let first = SequenceState::from_event(&event("mouse", "move", 1000));
        assert!(is_continuation(
            Some(first),
            &event("mouse", "move", 1000 + MOVE_SEQUENCE_GAP_MS)
        ));
        assert!(!is_continuation(
            Some(first),
            &event("mouse", "move", 1000 + MOVE_SEQUENCE_GAP_MS + 1)
        ));
    }

    #[test]
    fn scroll_uses_its_own_gap_window() {
        let first = SequenceState::from_event(&event("scroll", "wheel", 0));
        assert!(is_continuation(
            Some(first),
            &event("scroll", "wheel", SCROLL_SEQUENCE_GAP_MS)
        ));
        assert!(!is_continuation(
            Some(first),
            &event("scroll", "wheel", SCROLL_SEQUENCE_GAP_MS + 1)
        ));
    }

    #[test]
    fn different_kinds_do_not_continue_each_other() {
        let mouse = SequenceState::from_event(&event("mouse", "move", 0));
        assert!(!is_continuation(Some(mouse), &event("scroll", "wheel", 10)));

        let scroll = SequenceState::from_event(&event("scroll", "wheel", 0));
        assert!(!is_continuation(Some(scroll), &event("mouse", "move", 10)));
    }

    #[test]
    fn clicks_and_keys_are_never_continuations() {
        let prev = SequenceState::from_event(&event("mouse", "move", 0));
        assert!(!is_continuation(Some(prev), &event("mouse", "press", 10)));
        assert!(!is_continuation(
            Some(prev),
            &event("keyboard", "press", 10)
        ));
    }
}
