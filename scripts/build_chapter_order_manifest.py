#!/usr/bin/env python3

import argparse
import json
import pathlib
import re
import sys
import xml.etree.ElementTree as ET


ALIASES = {
    "Salmo": "Salmos",
    "Cantar de los Cantares": "Cantares",
    "Nahúm": "Nahum",
}

LINE_PATTERN = re.compile(r"^(?P<book>.+?)\s+(?P<chapter>\d+)$")


def slugify(value: str) -> str:
    normalized = value.lower()
    for src, dst in {
        "á": "a",
        "é": "e",
        "í": "i",
        "ó": "o",
        "ú": "u",
        "ü": "u",
        "ñ": "n",
    }.items():
        normalized = normalized.replace(src, dst)
    normalized = re.sub(r"[^a-z0-9]+", "-", normalized).strip("-")
    return normalized


def load_xml_index(xml_path: pathlib.Path) -> dict[tuple[str, int], int]:
    root = ET.parse(xml_path).getroot()
    index: dict[tuple[str, int], int] = {}
    for book in root.findall("BIBLEBOOK"):
        book_name = book.attrib["bname"]
        for chapter in book.findall("CHAPTER"):
            chapter_number = int(chapter.attrib["cnumber"])
            index[(book_name, chapter_number)] = len(chapter.findall("VERS"))
    return index


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build an editable chapter-order manifest from an expanded reading order and an XML Bible."
    )
    parser.add_argument("reading_file", type=pathlib.Path)
    parser.add_argument("bible_xml", type=pathlib.Path)
    parser.add_argument("--manifest-id", default="lectura-expandida-rv60")
    parser.add_argument("--title", default="Lectura Expandida RV60")
    parser.add_argument("--bible-version", default="RV60")
    parser.add_argument("--output", type=pathlib.Path)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    xml_index = load_xml_index(args.bible_xml)

    lines = [
        line.strip()
        for line in args.reading_file.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]

    entries: list[dict[str, object]] = []
    resolved_count = 0
    unresolved_count = 0
    duplicates: dict[str, int] = {}

    for sequence, source_text in enumerate(lines, start=1):
        match = LINE_PATTERN.match(source_text)
        if not match:
            unresolved_count += 1
            entries.append(
                {
                    "id": f"unresolved-{sequence}",
                    "sequence": sequence,
                    "sourceText": source_text,
                    "bookInput": source_text,
                    "chapter": 1,
                    "status": "unresolved",
                    "bookCanonical": None,
                    "chapterRefCanonical": None,
                    "verseCount": None,
                    "notes": ["Line does not match '<book> <chapter>' pattern"],
                }
            )
            continue

        book_input = match.group("book")
        chapter = int(match.group("chapter"))
        book_canonical = ALIASES.get(book_input, book_input)
        canonical_ref = f"{book_canonical} {chapter}"
        notes: list[str] = []

        if book_canonical != book_input:
            notes.append(f"Alias normalized from '{book_input}' to '{book_canonical}'")

        verse_count = xml_index.get((book_canonical, chapter))
        if verse_count is None:
            unresolved_count += 1
            status = "unresolved"
            notes.append("Reference not found in the selected XML Bible")
            book_value = None
            canonical_value = None
        else:
            resolved_count += 1
            status = "alias-resolved" if book_canonical != book_input else "ok"
            book_value = book_canonical
            canonical_value = canonical_ref

        base_id = slugify(f"{book_canonical}-{chapter}")
        duplicates[base_id] = duplicates.get(base_id, 0) + 1
        entry_id = base_id if duplicates[base_id] == 1 else f"{base_id}-{duplicates[base_id]}"

        entries.append(
            {
                "id": entry_id,
                "sequence": sequence,
                "sourceText": source_text,
                "bookInput": book_input,
                "bookCanonical": book_value,
                "chapter": chapter,
                "chapterRefCanonical": canonical_value,
                "verseCount": verse_count,
                "status": status,
                "notes": notes,
            }
        )

    payload = {
        "manifestId": args.manifest_id,
        "title": args.title,
        "source": {
            "readingFile": str(args.reading_file),
            "bibleXmlFile": str(args.bible_xml),
            "bibleVersion": args.bible_version,
        },
        "normalizationAliases": ALIASES,
        "stats": {
            "sourceLineCount": len(lines),
            "xmlChapterCount": len(xml_index),
            "resolvedEntryCount": resolved_count,
            "unresolvedEntryCount": unresolved_count,
        },
        "entries": entries,
    }

    serialized = json.dumps(payload, ensure_ascii=False, indent=2)
    if args.output:
        args.output.write_text(serialized + "\n", encoding="utf-8")
    else:
        sys.stdout.write(serialized + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
