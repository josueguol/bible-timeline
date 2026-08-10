#!/usr/bin/env python3

import json
import pathlib
import sys


ROOT = pathlib.Path(__file__).resolve().parents[1]
SCHEMA_PATH = ROOT / "docs" / "contracts" / "verses-range-response.schema.json"

ROOT_ALLOWED = {"manifestId", "versions", "range", "rows", "lexicon"}
ROOT_REQUIRED = {"manifestId", "versions", "rows"}

RANGE_ALLOWED = {"fromSequence", "toSequence", "fromRef", "toRef"}
RANGE_REQUIRED = {"fromSequence", "toSequence"}

ROW_ALLOWED = {"sequence", "ref", "book", "chapter", "verse", "texts", "segments"}
ROW_REQUIRED = {"sequence", "ref", "book", "chapter", "verse", "texts"}

LEXICON_ALLOWED = {
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
LEXICON_REQUIRED = {
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

    segments = row.get("segments")
    if segments is not None:
        if not isinstance(segments, dict) or not segments:
            errors.append(f"{prefix}.segments must be a non-empty object when provided")
        else:
            extra_codes = sorted(set(segments) - set(versions))
            if extra_codes:
                errors.append(f"{prefix}.segments has unexpected versions {extra_codes}")
            for code, segment_list in segments.items():
                segment_prefix = f"{prefix}.segments['{code}']"
                if not isinstance(segment_list, list) or not segment_list:
                    errors.append(f"{segment_prefix} must be a non-empty array")
                    continue
                previous_position = 0
                for segment_index, segment in enumerate(segment_list):
                    item_prefix = f"{segment_prefix}[{segment_index}]"
                    if not isinstance(segment, dict):
                        errors.append(f"{item_prefix} must be an object")
                        continue
                    unexpected_segment = sorted(set(segment) - {"position", "text", "strongs"})
                    if unexpected_segment:
                        errors.append(f"{item_prefix}: unexpected properties {unexpected_segment}")
                    for required in ("position", "text", "strongs"):
                        if required not in segment:
                            errors.append(f"{item_prefix}: missing {required}")
                    position = segment.get("position")
                    if not isinstance(position, int) or position < 1:
                        errors.append(f"{item_prefix}.position must be integer >= 1")
                    elif position <= previous_position:
                        errors.append(f"{item_prefix}.position must be strictly increasing")
                    if isinstance(position, int):
                        previous_position = position
                    text = segment.get("text")
                    if not isinstance(text, str) or not text.strip():
                        errors.append(f"{item_prefix}.text must be non-empty string")
                    strongs = segment.get("strongs")
                    if not isinstance(strongs, list):
                        errors.append(f"{item_prefix}.strongs must be an array")
                    else:
                        for strong_index, strong in enumerate(strongs):
                            strong_prefix = f"{item_prefix}.strongs[{strong_index}]"
                            if not isinstance(strong, dict):
                                errors.append(f"{strong_prefix} must be an object")
                                continue
                            unexpected_strong = sorted(set(strong) - {"strongNumber", "strongRaw"})
                            if unexpected_strong:
                                errors.append(f"{strong_prefix}: unexpected properties {unexpected_strong}")
                            strong_number = strong.get("strongNumber")
                            if not isinstance(strong_number, str) or not strong_number:
                                errors.append(f"{strong_prefix}.strongNumber must be non-empty string")
                            elif strong_number[0] not in {"G", "H"} or not strong_number[1:].isdigit():
                                errors.append(f"{strong_prefix}.strongNumber must match ^[GH][0-9]+$")
                            strong_raw = strong.get("strongRaw")
                            if not isinstance(strong_raw, str) or not strong_raw.strip():
                                errors.append(f"{strong_prefix}.strongRaw must be non-empty string")

    return errors


def validate_lexicon(lexicon: object) -> list[str]:
    errors: list[str] = []
    if lexicon is None:
        return errors
    if not isinstance(lexicon, dict):
        return ["lexicon must be an object when provided"]

    for key, item in lexicon.items():
        prefix = f"lexicon['{key}']"
        if not isinstance(key, str) or key[0:1] not in {"G", "H"} or not key[1:].isdigit():
            errors.append(f"{prefix}: key must match ^[GH][0-9]+$")
        if not isinstance(item, dict):
            errors.append(f"{prefix} must be an object")
            continue
        missing = LEXICON_REQUIRED - set(item)
        if missing:
            errors.append(f"{prefix}: missing {sorted(missing)}")
        unexpected = sorted(set(item) - LEXICON_ALLOWED)
        if unexpected:
            errors.append(f"{prefix}: unexpected properties {unexpected}")
        strong_number = item.get("strongNumber")
        if strong_number != key:
            errors.append(f"{prefix}.strongNumber must equal lexicon key")
        language = item.get("language")
        if language not in {"hebrew", "greek"}:
            errors.append(f"{prefix}.language must be hebrew or greek")
        for text_key in ("lemma", "definition", "source"):
            value = item.get(text_key)
            if not isinstance(value, str) or not value.strip():
                errors.append(f"{prefix}.{text_key} must be non-empty string")
        for optional_key in ("transliteration", "pronunciation", "derivation", "kjvDefinition"):
            value = item.get(optional_key)
            if value is not None and not isinstance(value, str):
                errors.append(f"{prefix}.{optional_key} must be string when provided")
        if item.get("definitionLanguage") not in {"es", "en"}:
            errors.append(f"{prefix}.definitionLanguage must be es or en")
        if item.get("translationStatus") not in {"source", "machine", "reviewed", "fallback"}:
            errors.append(
                f"{prefix}.translationStatus must be source, machine, reviewed, or fallback"
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
    referenced_strongs: set[str] = set()
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
                segments = row.get("segments")
                if isinstance(segments, dict):
                    for segment_list in segments.values():
                        if isinstance(segment_list, list):
                            for segment in segment_list:
                                if isinstance(segment, dict) and isinstance(segment.get("strongs"), list):
                                    for strong in segment["strongs"]:
                                        if isinstance(strong, dict) and isinstance(strong.get("strongNumber"), str):
                                            referenced_strongs.add(strong["strongNumber"])

    lexicon = payload.get("lexicon")
    errors.extend(validate_lexicon(lexicon))
    if referenced_strongs:
        if not isinstance(lexicon, dict):
            errors.append("lexicon is required when segments reference Strong numbers")
        else:
            missing = sorted(referenced_strongs - set(lexicon))
            if missing:
                errors.append(f"lexicon missing referenced Strong numbers {missing}")

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
