#!/usr/bin/env python3

import json
import pathlib
import sys


ROOT = pathlib.Path(__file__).resolve().parents[1]
SCHEMA_PATH = ROOT / "docs" / "contracts" / "timeline.schema.json"


def fail(message: str) -> int:
    print(f"INVALID: {message}", file=sys.stderr)
    return 1


def load_json(path: pathlib.Path) -> object:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def validate_timeline(payload: object) -> list[str]:
    errors: list[str] = []

    if not isinstance(payload, dict):
        return ["Root must be a JSON object"]

    allowed_root_keys = {"timeline"}
    extra_root_keys = set(payload.keys()) - allowed_root_keys
    if extra_root_keys:
        errors.append(f"Unexpected root keys: {sorted(extra_root_keys)}")

    timeline = payload.get("timeline")
    if not isinstance(timeline, list):
        return errors + ["timeline must be an array"]

    if not timeline:
        errors.append("timeline must contain at least one event")
        return errors

    previous_order = 0
    seen_orders: set[int] = set()
    required_keys = {"order", "year", "event", "description"}

    for index, entry in enumerate(timeline, start=1):
        if not isinstance(entry, dict):
            errors.append(f"timeline[{index}] must be an object")
            continue

        extra_keys = set(entry.keys()) - required_keys
        missing_keys = required_keys - set(entry.keys())
        if missing_keys:
            errors.append(f"timeline[{index}] missing keys: {sorted(missing_keys)}")
        if extra_keys:
            errors.append(f"timeline[{index}] unexpected keys: {sorted(extra_keys)}")

        order = entry.get("order")
        year = entry.get("year")
        event = entry.get("event")
        description = entry.get("description")

        if not isinstance(order, int) or order < 1:
            errors.append(f"timeline[{index}].order must be an integer >= 1")
        else:
            if order in seen_orders:
                errors.append(f"timeline[{index}].order {order} is duplicated")
            if order <= previous_order:
                errors.append(
                    f"timeline[{index}].order {order} must be greater than previous order {previous_order}"
                )
            seen_orders.add(order)
            previous_order = order

        if not isinstance(year, str) or not year.strip():
            errors.append(f"timeline[{index}].year must be a non-empty string")
        if not isinstance(event, str) or not event.strip():
            errors.append(f"timeline[{index}].event must be a non-empty string")
        if not isinstance(description, str) or not description.strip():
            errors.append(f"timeline[{index}].description must be a non-empty string")

    return errors


def main() -> int:
    if len(sys.argv) != 2:
        return fail("Usage: python3 scripts/validate_timeline.py <timeline.json>")

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

    errors = validate_timeline(payload)
    if errors:
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return fail("Timeline does not satisfy the repository contract")

    print(f"VALID: {target}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
