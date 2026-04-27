#!/usr/bin/env python3

import json
import pathlib
import sys


ROOT = pathlib.Path(__file__).resolve().parents[1]
SCHEMA_PATH = ROOT / "docs" / "contracts" / "search-response.schema.json"

ROOT_ALLOWED = {"query", "results"}
ITEM_ALLOWED = {"category", "label", "description", "focus", "score", "preview"}
ITEM_REQUIRED = {"category", "label", "focus"}
FOCUS_ALLOWED = {"focusRef", "focusSequence", "focusEventId"}
CATEGORIES = {"reference", "event", "text"}


def fail(message: str) -> int:
    print(f"INVALID: {message}", file=sys.stderr)
    return 1


def load_json(path: pathlib.Path) -> object:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def validate_focus(focus: object, prefix: str) -> list[str]:
    errors: list[str] = []
    if not isinstance(focus, dict):
        return [f"{prefix} must be an object"]
    unexpected = sorted(set(focus) - FOCUS_ALLOWED)
    if unexpected:
        errors.append(f"{prefix}: unexpected properties {unexpected}")
    if not any(key in focus for key in FOCUS_ALLOWED):
        errors.append(f"{prefix}: must contain focusRef, focusSequence, or focusEventId")

    focus_sequence = focus.get("focusSequence")
    if focus_sequence is not None and (not isinstance(focus_sequence, int) or focus_sequence < 1):
        errors.append(f"{prefix}.focusSequence must be integer >= 1 when provided")

    for key in ("focusRef", "focusEventId"):
        value = focus.get(key)
        if value is not None and (not isinstance(value, str) or not value.strip()):
            errors.append(f"{prefix}.{key} must be non-empty string when provided")
    return errors


def validate_item(item: object, index: int) -> list[str]:
    errors: list[str] = []
    prefix = f"results[{index}]"
    if not isinstance(item, dict):
        return [f"{prefix}: must be an object"]

    missing = ITEM_REQUIRED - set(item)
    if missing:
        errors.append(f"{prefix}: missing {sorted(missing)}")
    unexpected = sorted(set(item) - ITEM_ALLOWED)
    if unexpected:
        errors.append(f"{prefix}: unexpected properties {unexpected}")

    category = item.get("category")
    if category not in CATEGORIES:
        errors.append(f"{prefix}.category must be one of {sorted(CATEGORIES)}")

    label = item.get("label")
    if not isinstance(label, str) or not label.strip():
        errors.append(f"{prefix}.label must be non-empty string")

    description = item.get("description")
    if description is not None and not isinstance(description, str):
        errors.append(f"{prefix}.description must be string when provided")

    preview = item.get("preview")
    if preview is not None and not isinstance(preview, str):
        errors.append(f"{prefix}.preview must be string when provided")

    score = item.get("score")
    if score is not None:
        if not isinstance(score, (int, float)) or not 0 <= float(score) <= 1:
            errors.append(f"{prefix}.score must be number in [0,1] when provided")

    errors.extend(validate_focus(item.get("focus"), f"{prefix}.focus"))
    return errors


def validate_payload(payload: object) -> list[str]:
    errors: list[str] = []
    if not isinstance(payload, dict):
        return ["Root must be a JSON object"]

    missing = {"query", "results"} - set(payload)
    if missing:
        errors.append(f"Missing properties: {sorted(missing)}")
    unexpected = sorted(set(payload) - ROOT_ALLOWED)
    if unexpected:
        errors.append(f"Unexpected properties: {unexpected}")

    query = payload.get("query")
    if not isinstance(query, str) or not query.strip():
        errors.append("query must be non-empty string")

    results = payload.get("results")
    if not isinstance(results, list):
        errors.append("results must be an array")
    else:
        for index, item in enumerate(results):
            errors.extend(validate_item(item, index))

    return errors


def main() -> int:
    if len(sys.argv) != 2:
        return fail("Usage: python3 scripts/validate_search_response.py <response.json>")

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
        return fail("Search response does not satisfy the repository contract")

    print(f"VALID: {target}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
