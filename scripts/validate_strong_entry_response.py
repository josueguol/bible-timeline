#!/usr/bin/env python3

import json
import pathlib
import sys


ROOT = pathlib.Path(__file__).resolve().parents[1]
SCHEMA_PATH = ROOT / "docs" / "contracts" / "strong-entry-response.schema.json"

ALLOWED = {
    "strongNumber",
    "language",
    "lemma",
    "transliteration",
    "pronunciation",
    "definition",
    "derivation",
    "kjvDefinition",
    "definitionLanguage",
    "translationStatus",
    "source",
}
REQUIRED = {
    "strongNumber",
    "language",
    "lemma",
    "definition",
    "definitionLanguage",
    "translationStatus",
    "source",
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

    missing = REQUIRED - set(payload)
    if missing:
        errors.append(f"Missing root properties: {sorted(missing)}")
    unexpected = sorted(set(payload) - ALLOWED)
    if unexpected:
        errors.append(f"Unexpected properties: {unexpected}")

    strong_number = payload.get("strongNumber")
    if (
        not isinstance(strong_number, str)
        or strong_number[0:1] not in {"G", "H"}
        or not strong_number[1:].isdigit()
    ):
        errors.append("strongNumber must match ^[GH][0-9]+$")

    if payload.get("language") not in {"hebrew", "greek"}:
        errors.append("language must be hebrew or greek")

    for key in ("lemma", "definition", "source"):
        value = payload.get(key)
        if not isinstance(value, str) or not value.strip():
            errors.append(f"{key} must be non-empty string")

    for key in ("transliteration", "pronunciation", "derivation", "kjvDefinition"):
        value = payload.get(key)
        if value is not None and not isinstance(value, str):
            errors.append(f"{key} must be string when provided")

    if payload.get("definitionLanguage") not in {"es", "en"}:
        errors.append("definitionLanguage must be es or en")

    if payload.get("translationStatus") not in {"source", "machine", "reviewed", "fallback"}:
        errors.append("translationStatus must be source, machine, reviewed, or fallback")

    return errors


def main() -> int:
    if len(sys.argv) != 2:
        return fail(
            "Usage: python3 scripts/validate_strong_entry_response.py <response.json>"
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
        return fail("Strong entry response does not satisfy the repository contract")

    print(f"VALID: {target}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
