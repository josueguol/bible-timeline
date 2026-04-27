#!/usr/bin/env python3

import json
import pathlib
import sys


ROOT = pathlib.Path(__file__).resolve().parents[1]
SCHEMA_PATH = ROOT / "docs" / "contracts" / "timeline-viewport-request.schema.json"


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

    allowed = {
        "timelineId",
        "zoomFactor",
        "focusSequence",
        "focusRef",
        "focusEventId",
        "viewportEventBudget",
        "includeAncestors",
    }
    extra = sorted(set(payload) - allowed)
    if extra:
        errors.append(f"Unexpected properties: {', '.join(extra)}")

    timeline_id = payload.get("timelineId")
    zoom_factor = payload.get("zoomFactor")
    focus_sequence = payload.get("focusSequence")
    focus_ref = payload.get("focusRef")
    focus_event_id = payload.get("focusEventId")
    viewport_event_budget = payload.get("viewportEventBudget")
    include_ancestors = payload.get("includeAncestors")

    if not isinstance(timeline_id, str) or not timeline_id.strip():
        errors.append("timelineId must be a non-empty string")
    if not isinstance(zoom_factor, (int, float)) or not 0 <= float(zoom_factor) <= 1:
        errors.append("zoomFactor must be a number between 0 and 1")
    if focus_sequence is not None and (not isinstance(focus_sequence, int) or focus_sequence < 1):
        errors.append("focusSequence must be an integer >= 1 when provided")
    if focus_ref is not None and (not isinstance(focus_ref, str) or not focus_ref.strip()):
        errors.append("focusRef must be a non-empty string when provided")
    if focus_event_id is not None and (not isinstance(focus_event_id, str) or not focus_event_id.strip()):
        errors.append("focusEventId must be a non-empty string when provided")
    if viewport_event_budget is not None and (
        not isinstance(viewport_event_budget, int) or viewport_event_budget < 1
    ):
        errors.append("viewportEventBudget must be an integer >= 1 when provided")
    if include_ancestors is not None and not isinstance(include_ancestors, bool):
        errors.append("includeAncestors must be boolean when provided")

    return errors


def main() -> int:
    if len(sys.argv) != 2:
        return fail("Usage: python3 scripts/validate_timeline_viewport_request.py <request.json>")

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
        return fail("Viewport request does not satisfy the repository contract")

    print(f"VALID: {target}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
