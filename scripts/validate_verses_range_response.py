#!/usr/bin/env python3

import json
import pathlib
import sys


ROOT = pathlib.Path(__file__).resolve().parents[1]
SCHEMA_PATH = ROOT / "docs" / "contracts" / "verses-range-response.schema.json"

ROOT_ALLOWED = {"manifestId", "versions", "range", "rows"}
ROOT_REQUIRED = {"manifestId", "versions", "rows"}

RANGE_ALLOWED = {"fromSequence", "toSequence", "fromRef", "toRef"}
RANGE_REQUIRED = {"fromSequence", "toSequence"}

ROW_ALLOWED = {"sequence", "ref", "book", "chapter", "verse", "texts"}
ROW_REQUIRED = ROW_ALLOWED


def fail(message: str) -> int:
    print(f"INVALID: {message}", file=sys.stderr)
    return 1


def load_json(path: pathlib.Path) -> object:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def validate_row(row: object, versions: list[str], index: int) -> list[str]:
    errors: list[str] = []
    prefix = f"rows[{index}]"
    if not isinstance(row, dict):
        return [f"{prefix}: must be an object"]

    missing = ROW_REQUIRED - set(row)
    if missing:
        errors.append(f"{prefix}: missing {sorted(missing)}")
    unexpected = sorted(set(row) - ROW_ALLOWED)
    if unexpected:
        errors.append(f"{prefix}: unexpected properties {unexpected}")

    sequence = row.get("sequence")
    if not isinstance(sequence, int) or sequence < 1:
        errors.append(f"{prefix}.sequence must be integer >= 1")

    for key in ("ref", "book"):
        value = row.get(key)
        if not isinstance(value, str) or not value.strip():
            errors.append(f"{prefix}.{key} must be a non-empty string")

    for key in ("chapter", "verse"):
        value = row.get(key)
        if not isinstance(value, int) or value < 1:
            errors.append(f"{prefix}.{key} must be integer >= 1")

    texts = row.get("texts")
    if not isinstance(texts, dict) or not texts:
        errors.append(f"{prefix}.texts must be a non-empty object")
    else:
        for code in versions:
            if code not in texts:
                errors.append(f"{prefix}.texts missing key '{code}'")
        extra_codes = sorted(set(texts) - set(versions))
        if extra_codes:
            errors.append(f"{prefix}.texts has unexpected versions {extra_codes}")
        for code, value in texts.items():
            if value is not None and not isinstance(value, str):
                errors.append(f"{prefix}.texts['{code}'] must be string or null")

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

    manifest_id = payload.get("manifestId")
    if not isinstance(manifest_id, str) or not manifest_id.strip():
        errors.append("manifestId must be non-empty string")

    versions = payload.get("versions")
    if not isinstance(versions, list) or not 1 <= len(versions) <= 3:
        errors.append("versions must be an array with 1..3 entries")
        versions = []
    else:
        for index, code in enumerate(versions):
            if not isinstance(code, str) or not code.strip():
                errors.append(f"versions[{index}] must be a non-empty string")

    range_value = payload.get("range")
    if range_value is not None:
        if not isinstance(range_value, dict):
            errors.append("range must be an object when provided")
        else:
            range_missing = RANGE_REQUIRED - set(range_value)
            if range_missing:
                errors.append(f"range missing {sorted(range_missing)}")
            range_unexpected = sorted(set(range_value) - RANGE_ALLOWED)
            if range_unexpected:
                errors.append(f"range unexpected {range_unexpected}")
            for key in ("fromSequence", "toSequence"):
                value = range_value.get(key)
                if value is not None and (not isinstance(value, int) or value < 1):
                    errors.append(f"range.{key} must be integer >= 1")
            for key in ("fromRef", "toRef"):
                value = range_value.get(key)
                if value is not None and (not isinstance(value, str) or not value.strip()):
                    errors.append(f"range.{key} must be non-empty string when provided")

    rows = payload.get("rows")
    if not isinstance(rows, list) or not rows:
        errors.append("rows must be a non-empty array")
    else:
        previous_sequence = 0
        for index, row in enumerate(rows):
            row_errors = validate_row(row, versions if isinstance(versions, list) else [], index)
            errors.extend(row_errors)
            if isinstance(row, dict):
                sequence = row.get("sequence")
                if isinstance(sequence, int):
                    if sequence <= previous_sequence:
                        errors.append(
                            f"rows[{index}].sequence must be strictly increasing (got {sequence} after {previous_sequence})"
                        )
                    previous_sequence = sequence

    return errors


def main() -> int:
    if len(sys.argv) != 2:
        return fail(
            "Usage: python3 scripts/validate_verses_range_response.py <response.json>"
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
        return fail("Verses range response does not satisfy the repository contract")

    print(f"VALID: {target}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
