#!/usr/bin/env python3

import json
import pathlib
import sys


ROOT = pathlib.Path(__file__).resolve().parents[1]
SCHEMA_PATH = ROOT / "docs" / "contracts" / "search-request.schema.json"

ALLOWED = {"q", "versionId", "timelineId", "categories", "limit"}
ALLOWED_CATEGORIES = {"reference", "event", "text"}


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

    unexpected = sorted(set(payload) - ALLOWED)
    if unexpected:
        errors.append(f"Unexpected properties: {', '.join(unexpected)}")

    q = payload.get("q")
    if not isinstance(q, str) or not q.strip() or len(q) > 256:
        errors.append("q must be a non-empty string <= 256 chars")

    for key in ("versionId", "timelineId"):
        value = payload.get(key)
        if value is not None and (not isinstance(value, str) or not value.strip()):
            errors.append(f"{key} must be a non-empty string when provided")

    categories = payload.get("categories")
    if categories is not None:
        if not isinstance(categories, list) or not categories:
            errors.append("categories must be a non-empty array when provided")
        else:
            for index, category in enumerate(categories):
                if category not in ALLOWED_CATEGORIES:
                    errors.append(
                        f"categories[{index}] must be one of {sorted(ALLOWED_CATEGORIES)}"
                    )
            if len(set(categories)) != len(categories):
                errors.append("categories must not repeat")

    limit = payload.get("limit")
    if limit is not None and (not isinstance(limit, int) or not 1 <= limit <= 50):
        errors.append("limit must be integer 1..50 when provided")

    return errors


def main() -> int:
    if len(sys.argv) != 2:
        return fail("Usage: python3 scripts/validate_search_request.py <request.json>")

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
        return fail("Search request does not satisfy the repository contract")

    print(f"VALID: {target}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
