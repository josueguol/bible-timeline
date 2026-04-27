#!/usr/bin/env python3

import json
import pathlib
import sys


ROOT = pathlib.Path(__file__).resolve().parents[1]
SCHEMA_PATH = ROOT / "docs" / "contracts" / "versions-list-response.schema.json"

ALLOWED_ITEM_KEYS = {
    "versionId",
    "code",
    "title",
    "language",
    "languageFamily",
    "isPrimary",
    "verseCount",
    "sourcePath",
}

REQUIRED_ITEM_KEYS = {
    "versionId",
    "code",
    "title",
    "language",
    "isPrimary",
}

ALLOWED_LANGUAGE_FAMILIES = {"es", "original-hebrew", "original-greek", "other"}


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

    extra = sorted(set(payload) - {"versions"})
    if extra:
        errors.append(f"Unexpected properties: {', '.join(extra)}")
    if "versions" not in payload:
        errors.append("Missing 'versions'")
        return errors

    versions = payload["versions"]
    if not isinstance(versions, list) or not versions:
        errors.append("'versions' must be a non-empty array")
        return errors

    seen_ids: set[str] = set()
    seen_codes: set[str] = set()
    primary_count = 0

    for index, item in enumerate(versions):
        prefix = f"versions[{index}]"
        if not isinstance(item, dict):
            errors.append(f"{prefix}: must be an object")
            continue

        missing = REQUIRED_ITEM_KEYS - set(item)
        if missing:
            errors.append(f"{prefix}: missing {sorted(missing)}")
        unexpected = sorted(set(item) - ALLOWED_ITEM_KEYS)
        if unexpected:
            errors.append(f"{prefix}: unexpected properties {unexpected}")

        for key in ("versionId", "code", "title", "language"):
            value = item.get(key)
            if not isinstance(value, str) or not value.strip():
                errors.append(f"{prefix}.{key} must be a non-empty string")

        language_family = item.get("languageFamily")
        if language_family is not None and language_family not in ALLOWED_LANGUAGE_FAMILIES:
            errors.append(
                f"{prefix}.languageFamily must be one of {sorted(ALLOWED_LANGUAGE_FAMILIES)}"
            )

        if not isinstance(item.get("isPrimary"), bool):
            errors.append(f"{prefix}.isPrimary must be boolean")
        if item.get("isPrimary") is True:
            primary_count += 1

        verse_count = item.get("verseCount")
        if verse_count is not None and (not isinstance(verse_count, int) or verse_count < 1):
            errors.append(f"{prefix}.verseCount must be integer >= 1 when provided")

        source_path = item.get("sourcePath")
        if source_path is not None and (not isinstance(source_path, str) or not source_path.strip()):
            errors.append(f"{prefix}.sourcePath must be non-empty string when provided")

        version_id = item.get("versionId")
        if isinstance(version_id, str):
            if version_id in seen_ids:
                errors.append(f"{prefix}.versionId duplicated: {version_id}")
            else:
                seen_ids.add(version_id)

        code = item.get("code")
        if isinstance(code, str):
            if code in seen_codes:
                errors.append(f"{prefix}.code duplicated: {code}")
            else:
                seen_codes.add(code)

    if primary_count != 1:
        errors.append(f"Exactly one version must have isPrimary=true (found {primary_count})")

    return errors


def main() -> int:
    if len(sys.argv) != 2:
        return fail(
            "Usage: python3 scripts/validate_versions_list_response.py <response.json>"
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
        return fail("Versions list response does not satisfy the repository contract")

    print(f"VALID: {target}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
