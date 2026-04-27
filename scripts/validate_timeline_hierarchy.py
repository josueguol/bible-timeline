#!/usr/bin/env python3

import json
import pathlib
import sys


ROOT = pathlib.Path(__file__).resolve().parents[1]
SCHEMA_PATH = ROOT / "docs" / "contracts" / "timeline-hierarchy.schema.json"


def fail(message: str) -> int:
    print(f"INVALID: {message}", file=sys.stderr)
    return 1


def load_json(path: pathlib.Path) -> object:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def validate_event_tree(
    events: list[object],
    parent_id: str | None,
    expected_zoom: int,
    max_defined_zoom: int | None,
    seen_ids: set[str],
    errors: list[str],
) -> None:
    previous_sequence = 0

    for index, raw_event in enumerate(events, start=1):
        if not isinstance(raw_event, dict):
            errors.append(f"Event {index} under parent {parent_id or 'ROOT'} must be an object")
            continue

        event_id = raw_event.get("id")
        current_parent_id = raw_event.get("parentId")
        zoom_level = raw_event.get("zoomLevel")
        sequence = raw_event.get("sequence")
        title = raw_event.get("title")
        summary = raw_event.get("summary")
        start_label = raw_event.get("startLabel")
        end_label = raw_event.get("endLabel")
        start_ref = raw_event.get("startRef")
        end_ref = raw_event.get("endRef")
        start_sequence = raw_event.get("startSequence")
        end_sequence = raw_event.get("endSequence")
        importance = raw_event.get("importance")
        scripture_refs = raw_event.get("scriptureRefs")
        children = raw_event.get("children")

        if not isinstance(event_id, str) or not event_id:
            errors.append(f"Event {index} under parent {parent_id or 'ROOT'} must have a non-empty id")
            continue
        if event_id in seen_ids:
            errors.append(f"Duplicate event id: {event_id}")
        seen_ids.add(event_id)

        if current_parent_id != parent_id:
            errors.append(f"Event {event_id} parentId must be {parent_id!r}")
        if zoom_level != expected_zoom:
            errors.append(f"Event {event_id} zoomLevel must be {expected_zoom}")
        if isinstance(max_defined_zoom, int) and isinstance(zoom_level, int) and zoom_level > max_defined_zoom:
            errors.append(
                f"Event {event_id} zoomLevel {zoom_level} exceeds navigation max level {max_defined_zoom}"
            )
        if not isinstance(sequence, int) or sequence < 1:
            errors.append(f"Event {event_id} sequence must be an integer >= 1")
        elif sequence <= previous_sequence:
            errors.append(
                f"Event {event_id} sequence {sequence} must be greater than previous sibling sequence {previous_sequence}"
            )
        else:
            previous_sequence = sequence

        if not isinstance(title, str) or not title.strip():
            errors.append(f"Event {event_id} title must be a non-empty string")
        if not isinstance(summary, str) or not summary.strip():
            errors.append(f"Event {event_id} summary must be a non-empty string")
        if not isinstance(start_label, str) or not start_label.strip():
            errors.append(f"Event {event_id} startLabel must be a non-empty string")
        if not isinstance(end_label, str) or not end_label.strip():
            errors.append(f"Event {event_id} endLabel must be a non-empty string")
        if start_ref is not None and (not isinstance(start_ref, str) or not start_ref.strip()):
            errors.append(f"Event {event_id} startRef must be a non-empty string when provided")
        if end_ref is not None and (not isinstance(end_ref, str) or not end_ref.strip()):
            errors.append(f"Event {event_id} endRef must be a non-empty string when provided")
        if start_sequence is not None and (not isinstance(start_sequence, int) or start_sequence < 1):
            errors.append(f"Event {event_id} startSequence must be an integer >= 1 when provided")
        if end_sequence is not None and (not isinstance(end_sequence, int) or end_sequence < 1):
            errors.append(f"Event {event_id} endSequence must be an integer >= 1 when provided")
        if (
            isinstance(start_sequence, int)
            and isinstance(end_sequence, int)
            and start_sequence > end_sequence
        ):
            errors.append(f"Event {event_id} startSequence must be <= endSequence")
        if not isinstance(importance, int) or not 1 <= importance <= 100:
            errors.append(f"Event {event_id} importance must be an integer between 1 and 100")
        if not isinstance(scripture_refs, list) or not scripture_refs:
            errors.append(f"Event {event_id} must include at least one scriptureRefs entry")
        elif any(not isinstance(reference, str) or not reference.strip() for reference in scripture_refs):
            errors.append(f"Event {event_id} scriptureRefs entries must be non-empty strings")

        if not isinstance(children, list):
            errors.append(f"Event {event_id} children must be an array")
            continue

        validate_event_tree(children, event_id, expected_zoom + 1, max_defined_zoom, seen_ids, errors)


def validate_payload(payload: object) -> list[str]:
    errors: list[str] = []

    if not isinstance(payload, dict):
        return ["Root must be a JSON object"]

    timeline_id = payload.get("timelineId")
    title = payload.get("title")
    navigation = payload.get("navigation")
    events = payload.get("events")

    if not isinstance(timeline_id, str) or not timeline_id.strip():
        errors.append("timelineId must be a non-empty string")
    if not isinstance(title, str) or not title.strip():
        errors.append("title must be a non-empty string")
    if not isinstance(navigation, dict):
        return errors + ["navigation must be an object"]
    if not isinstance(events, list):
        return errors + ["events must be an array"]

    root_event_count = navigation.get("rootEventCount")
    expansion_mode = navigation.get("expansionMode")
    zoom_levels = navigation.get("zoomLevels")

    if not isinstance(root_event_count, int) or root_event_count < 1:
        errors.append("navigation.rootEventCount must be an integer >= 1")
    if expansion_mode != "children":
        errors.append("navigation.expansionMode must be 'children'")
    max_zoom_level = None
    if not isinstance(zoom_levels, list) or not zoom_levels:
        errors.append("navigation.zoomLevels must be a non-empty array")
    else:
        previous_level = -1
        previous_max_zoom = 0.0
        previous_target_visible = 0
        for zoom_level in zoom_levels:
            if not isinstance(zoom_level, dict):
                errors.append("Each navigation.zoomLevels entry must be an object")
                continue

            level = zoom_level.get("level")
            min_zoom = zoom_level.get("minZoomFactor")
            max_zoom = zoom_level.get("maxZoomFactor")
            target_visible = zoom_level.get("targetVisibleEvents")
            label = zoom_level.get("label")
            description = zoom_level.get("description")

            if not isinstance(level, int) or level < 0:
                errors.append("navigation.zoomLevels.level must be an integer >= 0")
                continue
            if level != previous_level + 1:
                errors.append(
                    f"navigation.zoomLevels level {level} must follow previous level {previous_level}"
                )
            previous_level = level
            max_zoom_level = level

            if not isinstance(label, str) or not label.strip():
                errors.append(f"navigation.zoomLevels[{level}].label must be a non-empty string")
            if not isinstance(description, str) or not description.strip():
                errors.append(f"navigation.zoomLevels[{level}].description must be a non-empty string")
            if not isinstance(min_zoom, (int, float)) or not 0 <= min_zoom <= 1:
                errors.append(f"navigation.zoomLevels[{level}].minZoomFactor must be between 0 and 1")
                min_zoom = None
            if not isinstance(max_zoom, (int, float)) or not 0 <= max_zoom <= 1:
                errors.append(f"navigation.zoomLevels[{level}].maxZoomFactor must be between 0 and 1")
                max_zoom = None
            if isinstance(min_zoom, (int, float)) and isinstance(max_zoom, (int, float)):
                if min_zoom >= max_zoom:
                    errors.append(
                        f"navigation.zoomLevels[{level}] minZoomFactor must be less than maxZoomFactor"
                    )
                if level == 0 and min_zoom != 0:
                    errors.append("navigation.zoomLevels[0].minZoomFactor must be 0")
                if min_zoom < previous_max_zoom:
                    errors.append(
                        f"navigation.zoomLevels[{level}].minZoomFactor must be >= previous maxZoomFactor {previous_max_zoom}"
                    )
                previous_max_zoom = float(max_zoom)

            if not isinstance(target_visible, int) or target_visible < 1:
                errors.append(
                    f"navigation.zoomLevels[{level}].targetVisibleEvents must be an integer >= 1"
                )
            elif target_visible <= previous_target_visible:
                errors.append(
                    f"navigation.zoomLevels[{level}].targetVisibleEvents must be greater than previous level"
                )
            else:
                previous_target_visible = target_visible

        if previous_max_zoom != 1:
            errors.append("The last navigation.zoomLevels.maxZoomFactor must be 1")

    seen_ids: set[str] = set()
    validate_event_tree(events, None, 0, max_zoom_level, seen_ids, errors)

    if isinstance(root_event_count, int) and len(events) != root_event_count:
        errors.append(
            f"events root count {len(events)} does not match navigation.rootEventCount {root_event_count}"
        )
    return errors


def main() -> int:
    if len(sys.argv) != 2:
        return fail("Usage: python3 scripts/validate_timeline_hierarchy.py <timeline.json>")

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
        return fail("Hierarchical timeline does not satisfy the repository contract")

    print(f"VALID: {target}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
