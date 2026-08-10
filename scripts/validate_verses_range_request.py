#!/usr/bin/env python3

import json
import pathlib
import sys


ROOT = pathlib.Path(__file__).resolve().parents[1]
SCHEMA_PATH = ROOT / "docs" / "contracts" / "verses-range-request.schema.json"

ALLOWED = {
    "versions",
    "fromRef",
    "toRef",
    "fromSequence",
    "toSequence",
    "manifestId",
    "limit",
    "includeStrong",
    "strongLang",
}


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

    versions = payload.get("versions")
    if not isinstance(versions, list) or not 1 <= len(versions) <= 3:
        errors.append("versions must be an array with 1..3 entries")
    else:
        for index, code in enumerate(versions):
            if not isinstance(code, str) or not code.strip():
                errors.append(f"versions[{index}] must be a non-empty string")
        if len(set(versions)) != len(versions):
            errors.append("versions must not repeat")

    from_ref = payload.get("fromRef")
    to_ref = payload.get("toRef")
    from_sequence = payload.get("fromSequence")
    to_sequence = payload.get("toSequence")

    has_refs = from_ref is not None or to_ref is not None
    has_seqs = from_sequence is not None or to_sequence is not None

    if has_refs and has_seqs:
        errors.append("Use EITHER fromRef/toRef OR fromSequence/toSequence, not both")
    if not has_refs and not has_seqs:
        errors.append("Must provide fromRef/toRef OR fromSequence/toSequence")

    if has_refs:
        for key, value in (("fromRef", from_ref), ("toRef", to_ref)):
            if value is None:
                errors.append(f"{key} is required when using ref-based range")
            elif not isinstance(value, str) or not value.strip():
                errors.append(f"{key} must be a non-empty string")

    if has_seqs:
        for key, value in (("fromSequence", from_sequence), ("toSequence", to_sequence)):
            if value is None:
                errors.append(f"{key} is required when using sequence-based range")
            elif not isinstance(value, int) or value < 1:
                errors.append(f"{key} must be an integer >= 1")
        if (
            isinstance(from_sequence, int)
            and isinstance(to_sequence, int)
            and from_sequence > to_sequence
        ):
            errors.append("fromSequence must be <= toSequence")

    manifest_id = payload.get("manifestId")
    if manifest_id is not None and (not isinstance(manifest_id, str) or not manifest_id.strip()):
        errors.append("manifestId must be a non-empty string when provided")

    limit = payload.get("limit")
    if limit is not None and (not isinstance(limit, int) or not 1 <= limit <= 1000):
        errors.append("limit must be an integer in 1..1000 when provided")

    include_strong = payload.get("includeStrong")
    if include_strong is not None and not isinstance(include_strong, bool):
        errors.append("includeStrong must be boolean when provided")

    strong_lang = payload.get("strongLang")
    if strong_lang is not None and strong_lang not in {"es", "en"}:
        errors.append("strongLang must be es or en when provided")

    return errors


def main() -> int:
    if len(sys.argv) != 2:
        return fail(
            "Usage: python3 scripts/validate_verses_range_request.py <request.json>"
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
        return fail("Verses range request does not satisfy the repository contract")

    print(f"VALID: {target}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
