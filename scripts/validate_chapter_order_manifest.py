#!/usr/bin/env python3

import json
import pathlib
import sys
import xml.etree.ElementTree as ET


ROOT = pathlib.Path(__file__).resolve().parents[1]
SCHEMA_PATH = ROOT / "docs" / "contracts" / "chapter-order-manifest.schema.json"


def fail(message: str) -> int:
    print(f"INVALID: {message}", file=sys.stderr)
    return 1


def load_json(path: pathlib.Path) -> object:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def load_xml_index(xml_path: pathlib.Path) -> set[tuple[str, int]]:
    root = ET.parse(xml_path).getroot()
    refs: set[tuple[str, int]] = set()
    for book in root.findall("BIBLEBOOK"):
        book_name = book.attrib["bname"]
        for chapter in book.findall("CHAPTER"):
            refs.add((book_name, int(chapter.attrib["cnumber"])))
    return refs


def validate_manifest(payload: object) -> list[str]:
    errors: list[str] = []

    if not isinstance(payload, dict):
        return ["Root must be a JSON object"]

    source = payload.get("source")
    entries = payload.get("entries")
    stats = payload.get("stats")

    if not isinstance(source, dict):
        return ["source must be an object"]
    if not isinstance(entries, list):
        return ["entries must be an array"]
    if not isinstance(stats, dict):
        return ["stats must be an object"]

    bible_xml = source.get("bibleXmlFile")
    if not isinstance(bible_xml, str) or not bible_xml.strip():
        return ["source.bibleXmlFile must be a non-empty string"]

    xml_refs = load_xml_index(pathlib.Path(bible_xml))

    seen_ids: set[str] = set()
    seen_refs: set[str] = set()
    expected_sequence = 1
    resolved = 0
    unresolved = 0

    for entry in entries:
        if not isinstance(entry, dict):
            errors.append("Every entry must be an object")
            continue

        entry_id = entry.get("id")
        sequence = entry.get("sequence")
        chapter = entry.get("chapter")
        status = entry.get("status")
        book_canonical = entry.get("bookCanonical")
        chapter_ref = entry.get("chapterRefCanonical")

        if not isinstance(entry_id, str) or not entry_id:
            errors.append(f"Entry at sequence {sequence} must have a non-empty id")
        elif entry_id in seen_ids:
            errors.append(f"Duplicate entry id: {entry_id}")
        else:
            seen_ids.add(entry_id)

        if sequence != expected_sequence:
            errors.append(f"Entry sequence {sequence} must equal {expected_sequence}")
            expected_sequence = sequence if isinstance(sequence, int) else expected_sequence
        expected_sequence += 1

        if status == "unresolved":
            unresolved += 1
            continue

        resolved += 1
        if not isinstance(book_canonical, str) or not isinstance(chapter, int):
            errors.append(f"Entry {entry_id} must include bookCanonical and chapter")
            continue

        if (book_canonical, chapter) not in xml_refs:
            errors.append(f"Entry {entry_id} references unknown chapter {book_canonical} {chapter}")

        if not isinstance(chapter_ref, str) or not chapter_ref:
            errors.append(f"Entry {entry_id} must include chapterRefCanonical")
        elif chapter_ref in seen_refs:
            errors.append(f"Duplicate canonical chapter ref: {chapter_ref}")
        else:
            seen_refs.add(chapter_ref)

    if stats.get("resolvedEntryCount") != resolved:
        errors.append(
            f"stats.resolvedEntryCount {stats.get('resolvedEntryCount')} does not match resolved entries {resolved}"
        )
    if stats.get("unresolvedEntryCount") != unresolved:
        errors.append(
            f"stats.unresolvedEntryCount {stats.get('unresolvedEntryCount')} does not match unresolved entries {unresolved}"
        )

    return errors


def main() -> int:
    if len(sys.argv) != 2:
        return fail("Usage: python3 scripts/validate_chapter_order_manifest.py <manifest.json>")

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

    errors = validate_manifest(payload)
    if errors:
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return fail("Chapter-order manifest does not satisfy the repository contract")

    print(f"VALID: {target}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
