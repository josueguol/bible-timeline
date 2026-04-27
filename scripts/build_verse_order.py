#!/usr/bin/env python3

import argparse
import json
import pathlib
import re
import sys
import xml.etree.ElementTree as ET


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


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Expand a chapter-order manifest to verse-level chronological order."
    )
    parser.add_argument("manifest_json", type=pathlib.Path)
    parser.add_argument("--output", type=pathlib.Path)
    return parser.parse_args()


def load_json(path: pathlib.Path) -> object:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def load_xml_index(xml_path: pathlib.Path) -> dict[tuple[str, int], list[tuple[int, str]]]:
    root = ET.parse(xml_path).getroot()
    index: dict[tuple[str, int], list[tuple[int, str]]] = {}
    for book in root.findall("BIBLEBOOK"):
        book_name = book.attrib["bname"]
        for chapter in book.findall("CHAPTER"):
            chapter_number = int(chapter.attrib["cnumber"])
            verses: list[tuple[int, str]] = []
            for verse in chapter.findall("VERS"):
                verse_number = int(verse.attrib["vnumber"])
                text = " ".join((verse.text or "").split())
                verses.append((verse_number, text))
            index[(book_name, chapter_number)] = verses
    return index


def main() -> int:
    args = parse_args()
    manifest = load_json(args.manifest_json)
    if not isinstance(manifest, dict):
        print("INVALID: manifest must be a JSON object", file=sys.stderr)
        return 1

    source = manifest.get("source")
    entries = manifest.get("entries")
    if not isinstance(source, dict) or not isinstance(entries, list):
        print("INVALID: manifest is missing source or entries", file=sys.stderr)
        return 1

    bible_xml_file = source.get("bibleXmlFile")
    bible_version = source.get("bibleVersion")
    if not isinstance(bible_xml_file, str) or not isinstance(bible_version, str):
        print("INVALID: source.bibleXmlFile and source.bibleVersion are required", file=sys.stderr)
        return 1

    xml_index = load_xml_index(pathlib.Path(bible_xml_file))

    verses: list[dict[str, object]] = []
    verse_sequence = 1

    for entry in entries:
        if not isinstance(entry, dict):
            print("INVALID: every manifest entry must be an object", file=sys.stderr)
            return 1
        if entry.get("status") == "unresolved":
            print(
                f"INVALID: unresolved manifest entry cannot be expanded: {entry.get('sourceText')}",
                file=sys.stderr,
            )
            return 1

        entry_id = entry.get("id")
        book = entry.get("bookCanonical")
        chapter = entry.get("chapter")
        if not isinstance(entry_id, str) or not isinstance(book, str) or not isinstance(chapter, int):
            print("INVALID: manifest entry is missing id, bookCanonical or chapter", file=sys.stderr)
            return 1

        chapter_verses = xml_index.get((book, chapter))
        if chapter_verses is None:
            print(f"INVALID: chapter not found in XML: {book} {chapter}", file=sys.stderr)
            return 1

        for verse_number, text in chapter_verses:
            ref = f"{book} {chapter}:{verse_number}"
            status = "ok"
            notes: list[str] = []
            if not text:
                status = "empty-source"
                notes.append("Verse text is empty in the selected XML Bible source")
            verses.append(
                {
                    "id": slugify(ref),
                    "sequence": verse_sequence,
                    "entryId": entry_id,
                    "book": book,
                    "chapter": chapter,
                    "verse": verse_number,
                    "ref": ref,
                    "text": text,
                    "status": status,
                    "notes": notes,
                }
            )
            verse_sequence += 1

    payload = {
        "timelineId": manifest.get("manifestId"),
        "title": f"{manifest.get('title')} Verse Order",
        "sourceManifest": str(args.manifest_json),
        "bibleVersion": bible_version,
        "stats": {
            "chapterEntryCount": len(entries),
            "verseCount": len(verses),
        },
        "verses": verses,
    }

    serialized = json.dumps(payload, ensure_ascii=False, indent=2)
    if args.output:
        args.output.write_text(serialized + "\n", encoding="utf-8")
    else:
        sys.stdout.write(serialized + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
