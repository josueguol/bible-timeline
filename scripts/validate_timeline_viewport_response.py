#!/usr/bin/env python3

import json
import pathlib
import sys


ROOT = pathlib.Path(__file__).resolve().parents[1]
SCHEMA_PATH = ROOT / "docs" / "contracts" / "timeline-viewport-response.schema.json"


def fail(message: str) -> int:
    print(f"INVALID: {message}", file=sys.stderr)
    return 1


def load_json(path: pathlib.Path) -> object:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def validate_payload(payload: object) -> list[str]:
    errors: list[str] = []
    if not isinstance(payload, dict):
        return ["Root must be a JSON object"]

    timeline_id = payload.get("timelineId")
    zoom_level = payload.get("zoomLevel")
    focus = payload.get("focus")
    visible_events = payload.get("visibleEvents")
    stats = payload.get("stats")

    if not isinstance(timeline_id, str) or not timeline_id.strip():
        errors.append("timelineId must be a non-empty string")
    if not isinstance(zoom_level, dict):
        errors.append("zoomLevel must be an object")
    if not isinstance(focus, dict):
        errors.append("focus must be an object")
    if not isinstance(visible_events, list) or not visible_events:
        errors.append("visibleEvents must be a non-empty array")
    if not isinstance(stats, dict):
        errors.append("stats must be an object")
    if errors:
        return errors

    level = zoom_level.get("level")
    min_zoom = zoom_level.get("minZoomFactor")
    max_zoom = zoom_level.get("maxZoomFactor")
    target_visible = zoom_level.get("targetVisibleEvents")
    if not isinstance(level, int) or level < 0:
        errors.append("zoomLevel.level must be an integer >= 0")
    if not isinstance(min_zoom, (int, float)) or not 0 <= float(min_zoom) <= 1:
        errors.append("zoomLevel.minZoomFactor must be between 0 and 1")
    if not isinstance(max_zoom, (int, float)) or not 0 <= float(max_zoom) <= 1:
        errors.append("zoomLevel.maxZoomFactor must be between 0 and 1")
    if isinstance(min_zoom, (int, float)) and isinstance(max_zoom, (int, float)) and min_zoom >= max_zoom:
        errors.append("zoomLevel.minZoomFactor must be < zoomLevel.maxZoomFactor")
    if not isinstance(target_visible, int) or target_visible < 1:
        errors.append("zoomLevel.targetVisibleEvents must be an integer >= 1")

    resolved_focus_sequence = focus.get("resolvedFocusSequence")
    focused_event_id = focus.get("focusedEventId")
    focus_path = focus.get("focusPath")
    if not isinstance(resolved_focus_sequence, int) or resolved_focus_sequence < 1:
        errors.append("focus.resolvedFocusSequence must be an integer >= 1")
    if not isinstance(focused_event_id, str) or not focused_event_id.strip():
        errors.append("focus.focusedEventId must be a non-empty string")
    if not isinstance(focus_path, list) or not focus_path:
        errors.append("focus.focusPath must be a non-empty array")

    display_order = 0
    focused_count = 0
    for index, event in enumerate(visible_events, start=1):
        if not isinstance(event, dict):
            errors.append(f"visibleEvents[{index}] must be an object")
            continue

        event_id = event.get("id")
        state = event.get("state")
        start_sequence = event.get("startSequence")
        end_sequence = event.get("endSequence")
        current_display_order = event.get("displayOrder")
        is_focused = event.get("isFocused")
        path = event.get("path")

        if not isinstance(event_id, str) or not event_id.strip():
            errors.append(f"visibleEvents[{index}].id must be a non-empty string")
        if state not in {"expanded", "collapsed"}:
            errors.append(f"visibleEvents[{index}].state must be expanded or collapsed")
        if not isinstance(start_sequence, int) or start_sequence < 1:
            errors.append(f"visibleEvents[{index}].startSequence must be an integer >= 1")
        if not isinstance(end_sequence, int) or end_sequence < 1:
            errors.append(f"visibleEvents[{index}].endSequence must be an integer >= 1")
        if (
            isinstance(start_sequence, int)
            and isinstance(end_sequence, int)
            and start_sequence > end_sequence
        ):
            errors.append(f"visibleEvents[{index}].startSequence must be <= endSequence")
        if not isinstance(current_display_order, int) or current_display_order < 1:
            errors.append(f"visibleEvents[{index}].displayOrder must be an integer >= 1")
        elif current_display_order <= display_order:
            errors.append(
                f"visibleEvents[{index}].displayOrder must be greater than previous displayOrder {display_order}"
            )
        else:
            display_order = current_display_order
        if not isinstance(is_focused, bool):
            errors.append(f"visibleEvents[{index}].isFocused must be boolean")
        elif is_focused:
            focused_count += 1
        if not isinstance(path, list) or not path:
            errors.append(f"visibleEvents[{index}].path must be a non-empty array")

    visible_count = stats.get("visibleCount")
    viewport_event_budget = stats.get("viewportEventBudget")
    if not isinstance(visible_count, int) or visible_count != len(visible_events):
        errors.append("stats.visibleCount must equal visibleEvents length")
    if not isinstance(viewport_event_budget, int) or viewport_event_budget < 1:
        errors.append("stats.viewportEventBudget must be an integer >= 1")
    if focused_count != 1:
        errors.append("visibleEvents must contain exactly one focused event")

    return errors


def main() -> int:
    if len(sys.argv) != 2:
        return fail("Usage: python3 scripts/validate_timeline_viewport_response.py <response.json>")

    target = pathlib.Path(sys.argv[1]).resolve()
    if not target.is_file():
        return fail(f"File not found: {target}")

    try:
        schema = load_json(SCHEMA_PATH)
        payload = load_json(target)
    except json.JSONDecodeError as exc:
        return fail(f"Invalid JSON: {exc}")
    except OSError as exc:
        return fail(str(exc))

    if not isinstance(schema, dict):
        return fail(f"Schema at {SCHEMA_PATH} is not a JSON object")

    errors = validate_payload(payload)
    if errors:
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return fail("Viewport response does not satisfy the repository contract")

    print(f"VALID: {target}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
