#!/usr/bin/env python3

import json
import pathlib
import sys


ROOT = pathlib.Path(__file__).resolve().parents[1]
SCHEMA_PATH = ROOT / "docs" / "contracts" / "event-detail-response.schema.json"

ROOT_ALLOWED = {"timelineId", "event", "ancestors", "childrenSummary"}
ROOT_REQUIRED = ROOT_ALLOWED

EVENT_ALLOWED = {
    "id",
    "parentId",
    "zoomLevel",
    "sequence",
    "title",
    "startLabel",
    "endLabel",
    "startRef",
    "endRef",
    "startSequence",
    "endSequence",
    "summary",
    "importance",
    "canonical",
    "scriptureRefs",
    "sources",
}
EVENT_REQUIRED = {
    "id",
    "parentId",
    "zoomLevel",
    "sequence",
    "title",
    "startLabel",
    "endLabel",
    "startRef",
    "endRef",
    "startSequence",
    "endSequence",
    "summary",
    "importance",
    "canonical",
}

ANCESTOR_ALLOWED = {"id", "title", "zoomLevel"}
ANCESTOR_REQUIRED = ANCESTOR_ALLOWED

SOURCE_TYPES = {"scripture", "historical-note"}


def fail(message: str) -> int:
    print(f"INVALID: {message}", file=sys.stderr)
    return 1


def load_json(path: pathlib.Path) -> object:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def validate_event(event: object) -> list[str]:
    errors: list[str] = []
    if not isinstance(event, dict):
        return ["event must be an object"]
    missing = EVENT_REQUIRED - set(event)
    if missing:
        errors.append(f"event: missing {sorted(missing)}")
    unexpected = sorted(set(event) - EVENT_ALLOWED)
    if unexpected:
        errors.append(f"event: unexpected properties {unexpected}")

    event_id = event.get("id")
    if not isinstance(event_id, str) or not event_id.strip():
        errors.append("event.id must be non-empty string")

    parent_id = event.get("parentId")
    if parent_id is not None and (not isinstance(parent_id, str) or not parent_id.strip()):
        errors.append("event.parentId must be string or null")

    zoom_level = event.get("zoomLevel")
    if not isinstance(zoom_level, int) or zoom_level < 0:
        errors.append("event.zoomLevel must be integer >= 0")

    for key in ("sequence", "startSequence", "endSequence"):
        value = event.get(key)
        if not isinstance(value, int) or value < 1:
            errors.append(f"event.{key} must be integer >= 1")

    start_seq = event.get("startSequence")
    end_seq = event.get("endSequence")
    if isinstance(start_seq, int) and isinstance(end_seq, int) and start_seq > end_seq:
        errors.append("event.startSequence must be <= event.endSequence")

    for key in ("title", "startLabel", "endLabel", "startRef", "endRef", "summary"):
        value = event.get(key)
        if not isinstance(value, str) or not value.strip():
            errors.append(f"event.{key} must be non-empty string")

    importance = event.get("importance")
    if not isinstance(importance, int) or not 1 <= importance <= 100:
        errors.append("event.importance must be integer 1..100")

    if not isinstance(event.get("canonical"), bool):
        errors.append("event.canonical must be boolean")

    scripture_refs = event.get("scriptureRefs")
    if scripture_refs is not None:
        if not isinstance(scripture_refs, list):
            errors.append("event.scriptureRefs must be array when provided")
        else:
            for index, ref in enumerate(scripture_refs):
                if not isinstance(ref, str) or not ref.strip():
                    errors.append(f"event.scriptureRefs[{index}] must be non-empty string")

    sources = event.get("sources")
    if sources is not None:
        if not isinstance(sources, list):
            errors.append("event.sources must be array when provided")
        else:
            for index, source in enumerate(sources):
                if not isinstance(source, dict):
                    errors.append(f"event.sources[{index}] must be an object")
                    continue
                missing_src = {"sourceRef", "sourceType"} - set(source)
                if missing_src:
                    errors.append(f"event.sources[{index}] missing {sorted(missing_src)}")
                unexpected_src = sorted(set(source) - {"sourceRef", "sourceType"})
                if unexpected_src:
                    errors.append(f"event.sources[{index}] unexpected {unexpected_src}")
                source_ref = source.get("sourceRef")
                if not isinstance(source_ref, str) or not source_ref.strip():
                    errors.append(f"event.sources[{index}].sourceRef must be non-empty string")
                if source.get("sourceType") not in SOURCE_TYPES:
                    errors.append(
                        f"event.sources[{index}].sourceType must be one of {sorted(SOURCE_TYPES)}"
                    )

    return errors


def validate_ancestor(ancestor: object, index: int) -> list[str]:
    errors: list[str] = []
    prefix = f"ancestors[{index}]"
    if not isinstance(ancestor, dict):
        return [f"{prefix}: must be an object"]
    missing = ANCESTOR_REQUIRED - set(ancestor)
    if missing:
        errors.append(f"{prefix}: missing {sorted(missing)}")
    unexpected = sorted(set(ancestor) - ANCESTOR_ALLOWED)
    if unexpected:
        errors.append(f"{prefix}: unexpected properties {unexpected}")

    for key in ("id", "title"):
        value = ancestor.get(key)
        if not isinstance(value, str) or not value.strip():
            errors.append(f"{prefix}.{key} must be non-empty string")
    zoom = ancestor.get("zoomLevel")
    if not isinstance(zoom, int) or zoom < 0:
        errors.append(f"{prefix}.zoomLevel must be integer >= 0")
    return errors


def validate_children_summary(summary: object) -> list[str]:
    errors: list[str] = []
    if not isinstance(summary, dict):
        return ["childrenSummary must be an object"]
    missing = {"total", "byZoomLevel"} - set(summary)
    if missing:
        errors.append(f"childrenSummary missing {sorted(missing)}")
    unexpected = sorted(set(summary) - {"total", "byZoomLevel"})
    if unexpected:
        errors.append(f"childrenSummary unexpected {unexpected}")

    total = summary.get("total")
    if not isinstance(total, int) or total < 0:
        errors.append("childrenSummary.total must be integer >= 0")

    by_level = summary.get("byZoomLevel")
    if not isinstance(by_level, dict):
        errors.append("childrenSummary.byZoomLevel must be an object")
    else:
        running = 0
        for key, value in by_level.items():
            if not isinstance(value, int) or value < 0:
                errors.append(f"childrenSummary.byZoomLevel['{key}'] must be integer >= 0")
                continue
            running += value
        if isinstance(total, int) and running != total:
            errors.append(
                f"childrenSummary.byZoomLevel sums to {running} but total is {total}"
            )
    return errors


def validate_payload(payload: object) -> list[str]:
    errors: list[str] = []
    if not isinstance(payload, dict):
        return ["Root must be a JSON object"]

    missing = ROOT_REQUIRED - set(payload)
    if missing:
        errors.append(f"Missing root properties: {sorted(missing)}")
    unexpected = sorted(set(payload) - ROOT_ALLOWED)
    if unexpected:
        errors.append(f"Unexpected root properties: {unexpected}")

    timeline_id = payload.get("timelineId")
    if not isinstance(timeline_id, str) or not timeline_id.strip():
        errors.append("timelineId must be non-empty string")

    errors.extend(validate_event(payload.get("event")))

    ancestors = payload.get("ancestors")
    if not isinstance(ancestors, list):
        errors.append("ancestors must be an array")
    else:
        for index, ancestor in enumerate(ancestors):
            errors.extend(validate_ancestor(ancestor, index))

    errors.extend(validate_children_summary(payload.get("childrenSummary")))

    return errors


def main() -> int:
    if len(sys.argv) != 2:
        return fail(
            "Usage: python3 scripts/validate_event_detail_response.py <response.json>"
        )

    target = pathlib.Path(sys.argv[1]).resolve()
    if not target.is_file():
        return fail(f"File not found: {target}")

    try:
        load_json(SCHEMA_PATH)
        payload = load_json(target)
    except json.JSONDecodeError as exc:
        return fail(f"Invalid JSON: {exc}")
    except OSError as exc:
        return fail(str(exc))

    errors = validate_payload(payload)
    if errors:
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return fail("Event detail response does not satisfy the repository contract")

    print(f"VALID: {target}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
