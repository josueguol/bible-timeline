#!/usr/bin/env python3

import json
import pathlib
import sys


ROOT = pathlib.Path(__file__).resolve().parents[1]
SCHEMA_PATH = ROOT / "docs" / "contracts" / "verse-order.schema.json"


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

    verses = payload.get("verses")
    stats = payload.get("stats")
    if not isinstance(verses, list):
        return ["verses must be an array"]
    if not isinstance(stats, dict):
        return ["stats must be an object"]

    seen_ids: set[str] = set()
    seen_refs: set[str] = set()
    expected_sequence = 1

    for verse in verses:
        if not isinstance(verse, dict):
            errors.append("Every verse must be an object")
            continue

        verse_id = verse.get("id")
        sequence = verse.get("sequence")
        ref = verse.get("ref")
        text = verse.get("text")
        status = verse.get("status", "ok")

        if sequence != expected_sequence:
            errors.append(f"Verse sequence {sequence} must equal {expected_sequence}")
            expected_sequence = sequence if isinstance(sequence, int) else expected_sequence
        expected_sequence += 1

        if not isinstance(verse_id, str) or not verse_id:
            errors.append(f"Verse at sequence {sequence} must have a non-empty id")
        elif verse_id in seen_ids:
            errors.append(f"Duplicate verse id: {verse_id}")
        else:
            seen_ids.add(verse_id)

        if not isinstance(ref, str) or not ref:
            errors.append(f"Verse at sequence {sequence} must include a ref")
        elif ref in seen_refs:
            errors.append(f"Duplicate verse ref: {ref}")
        else:
            seen_refs.add(ref)

        if not isinstance(text, str):
            errors.append(f"Verse {ref or sequence} must include text as string")
        elif not text.strip() and status != "empty-source":
            errors.append(f"Verse {ref or sequence} must include non-empty text unless status is empty-source")

    if stats.get("verseCount") != len(verses):
        errors.append(f"stats.verseCount {stats.get('verseCount')} does not match verses length {len(verses)}")

    return errors


def main() -> int:
    if len(sys.argv) != 2:
        return fail("Usage: python3 scripts/validate_verse_order.py <verse-order.json>")

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
        return fail("Verse-order payload does not satisfy the repository contract")

    print(f"VALID: {target}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
