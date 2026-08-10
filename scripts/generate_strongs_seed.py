#!/usr/bin/env python3
"""
Generate SQL seed data for Strong dictionaries and word-level verse segments.

Default inputs:
  - OpenScriptures Strong Hebrew/Greek JS dictionaries
  - resources/biblias/HEB_OSHB.xml
  - resources/biblias/GRC_TR.xml

The generated SQL is intentionally separate from the RV60 timeline bundle.
It inserts the original-language versions, their plain verse text, Strong
dictionary entries, and word-level segments for tagged verses.
"""

import argparse
import json
import pathlib
import re
import subprocess
import sys
import urllib.request
import xml.etree.ElementTree as ET
from collections.abc import Iterable

from import_bible_version import BOOK_NAMES_ES


ROOT = pathlib.Path(__file__).resolve().parents[1]

DEFAULT_GREEK_DICTIONARY = (
    "https://raw.githubusercontent.com/openscriptures/strongs/master/"
    "greek/strongs-greek-dictionary.js"
)
DEFAULT_HEBREW_DICTIONARY = (
    "https://raw.githubusercontent.com/openscriptures/strongs/master/"
    "hebrew/strongs-hebrew-dictionary.js"
)
DEFAULT_SPANISH_TRANSLATIONS = ROOT / "resources" / "diccionarios" / "strongs.es.jsonl"

BATCH_SIZE = 2000


def escape_sql(value: str) -> str:
    return value.replace("'", "''")


def sql_str(value: str) -> str:
    return f"'{escape_sql(value)}'"


def normalize_text(value: str) -> str:
    return " ".join(value.split())


def read_text(source: str) -> str:
    if source.startswith(("http://", "https://")):
        try:
            with urllib.request.urlopen(source, timeout=30) as response:
                return response.read().decode("utf-8")
        except Exception as urllib_error:
            fallback = subprocess.run(
                ["curl", "-fsSL", source],
                check=False,
                capture_output=True,
                text=True,
            )
            if fallback.returncode == 0:
                return fallback.stdout
            raise RuntimeError(
                f"Could not download {source} with urllib or curl. "
                f"urllib: {urllib_error}; curl: {fallback.stderr.strip()}"
            ) from urllib_error
    return pathlib.Path(source).read_text(encoding="utf-8-sig")


def load_js_dictionary(source: str, language: str) -> dict[str, dict[str, str]]:
    content = read_text(source)
    start = content.find("{")
    end = content.rfind("}")
    if start < 0 or end <= start:
        raise ValueError(f"Could not find JS dictionary object in {source}")

    payload = json.loads(content[start : end + 1])
    if not isinstance(payload, dict):
        raise ValueError(f"Dictionary root must be an object: {source}")

    entries: dict[str, dict[str, str]] = {}
    for key, raw_entry in payload.items():
        strong_number = normalize_strong(key)
        if strong_number is None:
            continue
        if not isinstance(raw_entry, dict):
            continue
        entries[strong_number] = {
            "strong_number": strong_number,
            "language": language,
            "lemma": str(raw_entry.get("lemma") or strong_number),
            "transliteration": str(
                raw_entry.get("translit")
                or raw_entry.get("xlit")
                or ""
            ),
            "pronunciation": str(
                raw_entry.get("pron")
                or raw_entry.get("pronunciation")
                or ""
            ),
            "definition": str(
                raw_entry.get("strongs_def")
                or raw_entry.get("definition")
                or raw_entry.get("kjv_def")
                or ""
            ),
            "derivation": str(raw_entry.get("derivation") or ""),
            "kjv_definition": str(raw_entry.get("kjv_def") or ""),
            "source": source,
        }
    return entries


def normalize_strong(value: str) -> str | None:
    match = re.fullmatch(r"([GH])0*(\d+)", value.strip(), flags=re.IGNORECASE)
    if not match:
        return None
    return f"{match.group(1).upper()}{int(match.group(2))}"


def format_insert(table: str, columns: list[str], rows: list[str], conflict: str) -> str:
    return (
        f"INSERT INTO {table} ({', '.join(columns)}) VALUES\n"
        + ",\n".join(rows)
        + "\n"
        + conflict
        + "\n\n"
    )


def chunks(values: list[str], size: int = BATCH_SIZE) -> Iterable[list[str]]:
    for index in range(0, len(values), size):
        yield values[index : index + size]


def strong_entry_row(entry: dict[str, str]) -> str:
    return (
        "("
        + ", ".join(
            [
                sql_str(entry["strong_number"]),
                sql_str(entry["language"]),
                sql_str(entry["lemma"]),
                sql_str(entry["transliteration"]),
                sql_str(entry["pronunciation"]),
                sql_str(entry["definition"]),
                sql_str(entry["derivation"]),
                sql_str(entry["kjv_definition"]),
                sql_str(entry["source"]),
            ]
        )
        + ")"
    )


def strong_translation_row(entry: dict[str, str]) -> str:
    return (
        "("
        + ", ".join(
            [
                sql_str(entry["strong_number"]),
                sql_str("es"),
                sql_str(entry["definition"]),
                sql_str(entry.get("derivation", "")),
                sql_str(entry.get("kjv_definition", "")),
                sql_str(entry["translation_status"]),
                sql_str(entry["source"]),
            ]
        )
        + ")"
    )


def load_spanish_translations(
    source: pathlib.Path | None,
    known_strongs: set[str],
) -> dict[str, dict[str, str]]:
    if source is None or not source.is_file():
        return {}

    translations: dict[str, dict[str, str]] = {}
    with source.open("r", encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, start=1):
            line = line.strip()
            if not line:
                continue
            try:
                payload = json.loads(line)
            except json.JSONDecodeError as exc:
                raise ValueError(f"{source}:{line_number}: invalid JSONL row: {exc}") from exc
            if not isinstance(payload, dict):
                raise ValueError(f"{source}:{line_number}: row must be an object")

            raw_strong = str(payload.get("strong_number") or payload.get("strongNumber") or "")
            strong_number = normalize_strong(raw_strong)
            if strong_number is None:
                raise ValueError(f"{source}:{line_number}: invalid Strong number: {raw_strong}")
            if strong_number not in known_strongs:
                continue

            definition = normalize_text(str(payload.get("definition") or ""))
            if not definition:
                raise ValueError(f"{source}:{line_number}: definition is required")

            translation_status = str(payload.get("translation_status") or payload.get("translationStatus") or "machine")
            if translation_status not in {"machine", "reviewed"}:
                raise ValueError(
                    f"{source}:{line_number}: translation_status must be machine or reviewed"
                )

            translations[strong_number] = {
                "strong_number": strong_number,
                "definition": definition,
                "derivation": normalize_text(str(payload.get("derivation") or "")),
                "kjv_definition": normalize_text(
                    str(payload.get("kjv_definition") or payload.get("kjvDefinition") or "")
                ),
                "translation_status": translation_status,
                "source": str(payload.get("source") or source),
            }

    return translations


def version_row(version_id: str, code: str, title: str, language: str, source_path: str) -> str:
    return (
        "("
        + ", ".join(
            [
                sql_str(version_id),
                sql_str(code),
                sql_str(title),
                sql_str(language),
                sql_str(source_path),
            ]
        )
        + ")"
    )


def verse_row(version_id: str, ref: str, book: str, chapter: int, verse: int, text: str) -> str:
    return (
        "("
        + ", ".join(
            [
                sql_str(version_id),
                sql_str(ref),
                sql_str(book),
                str(chapter),
                str(verse),
                sql_str(text),
            ]
        )
        + ")"
    )


def segment_row(version_id: str, ref: str, position: int, text: str) -> str:
    return (
        "("
        + ", ".join([sql_str(version_id), sql_str(ref), str(position), sql_str(text)])
        + ")"
    )


def segment_strong_row(
    version_id: str,
    ref: str,
    position: int,
    sequence: int,
    strong_number: str,
    strong_raw: str,
) -> str:
    return (
        "("
        + ", ".join(
            [
                sql_str(version_id),
                sql_str(ref),
                str(position),
                str(sequence),
                sql_str(strong_number),
                sql_str(strong_raw),
            ]
        )
        + ")"
    )


def append_segment(
    rows: list[str],
    strong_rows: list[str],
    known_strongs: set[str],
    version_id: str,
    ref: str,
    position: int,
    text: str,
    raw_strongs: list[str],
) -> int:
    clean_text = normalize_text(text)
    if not clean_text:
        return position

    rows.append(segment_row(version_id, ref, position, clean_text))

    sequence = 1
    seen: set[str] = set()
    for raw in raw_strongs:
        strong_number = normalize_strong(raw)
        if strong_number is None or strong_number not in known_strongs or strong_number in seen:
            continue
        strong_rows.append(
            segment_strong_row(version_id, ref, position, sequence, strong_number, raw)
        )
        seen.add(strong_number)
        sequence += 1

    return position + 1


def extract_bible_rows(
    bible_xml: pathlib.Path,
    version_id: str,
    known_strongs: set[str],
) -> tuple[list[str], list[str], list[str]]:
    root = ET.parse(bible_xml).getroot()
    verse_rows: list[str] = []
    segment_rows: list[str] = []
    strong_rows: list[str] = []

    for book_el in root.iter("BIBLEBOOK"):
        bnumber = int(book_el.get("bnumber", "0"))
        book_name = BOOK_NAMES_ES.get(bnumber)
        if book_name is None:
            continue

        for chapter_el in book_el:
            if chapter_el.tag != "CHAPTER":
                continue
            chapter = int(chapter_el.get("cnumber", "0"))
            for verse_el in chapter_el:
                if verse_el.tag != "VERS":
                    continue
                verse = int(verse_el.get("vnumber", "0"))
                ref = f"{book_name} {chapter}:{verse}"
                verse_text = normalize_text("".join(verse_el.itertext()))
                if verse_text:
                    verse_rows.append(verse_row(version_id, ref, book_name, chapter, verse, verse_text))

                position = 1
                position = append_segment(
                    segment_rows,
                    strong_rows,
                    known_strongs,
                    version_id,
                    ref,
                    position,
                    verse_el.text or "",
                    [],
                )
                for child in verse_el:
                    raw_strongs = []
                    if child.tag == "gr":
                        raw_strongs = (child.get("str") or "").split()
                    position = append_segment(
                        segment_rows,
                        strong_rows,
                        known_strongs,
                        version_id,
                        ref,
                        position,
                        "".join(child.itertext()),
                        raw_strongs,
                    )
                    position = append_segment(
                        segment_rows,
                        strong_rows,
                        known_strongs,
                        version_id,
                        ref,
                        position,
                        child.tail or "",
                        [],
                    )

    return verse_rows, segment_rows, strong_rows


def write_batched(
    handle,
    table: str,
    columns: list[str],
    rows: list[str],
    conflict: str,
) -> None:
    for batch in chunks(rows):
        handle.write(format_insert(table, columns, batch, conflict))


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Generate SQL seed data for Strong dictionaries and word-level segments."
    )
    parser.add_argument("--output", type=pathlib.Path, required=True)
    parser.add_argument("--greek-dictionary", default=DEFAULT_GREEK_DICTIONARY)
    parser.add_argument("--hebrew-dictionary", default=DEFAULT_HEBREW_DICTIONARY)
    parser.add_argument("--greek-bible-xml", type=pathlib.Path, default=ROOT / "resources/biblias/GRC_TR.xml")
    parser.add_argument("--hebrew-bible-xml", type=pathlib.Path, default=ROOT / "resources/biblias/HEB_OSHB.xml")
    parser.add_argument(
        "--spanish-translations",
        type=pathlib.Path,
        default=DEFAULT_SPANISH_TRANSLATIONS,
        help="JSONL file with Spanish Strong translations. Missing file is ignored.",
    )
    parser.add_argument(
        "--require-spanish-translations",
        action="store_true",
        help="Fail unless every Strong entry has a Spanish translation.",
    )
    parser.add_argument("--greek-version-id", default="grc_tr")
    parser.add_argument("--greek-version-code", default="GRC_TR")
    parser.add_argument("--greek-version-title", default="Greek NT — Textus Receptus")
    parser.add_argument("--hebrew-version-id", default="heb_oshb")
    parser.add_argument("--hebrew-version-code", default="HEB_OSHB")
    parser.add_argument("--hebrew-version-title", default="Open Scriptures Hebrew Bible")
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    greek_xml = args.greek_bible_xml.resolve()
    hebrew_xml = args.hebrew_bible_xml.resolve()
    if not greek_xml.is_file():
        print(f"Greek Bible XML not found: {greek_xml}", file=sys.stderr)
        return 1
    if not hebrew_xml.is_file():
        print(f"Hebrew Bible XML not found: {hebrew_xml}", file=sys.stderr)
        return 1

    greek_entries = load_js_dictionary(args.greek_dictionary, "greek")
    hebrew_entries = load_js_dictionary(args.hebrew_dictionary, "hebrew")
    entries = {**greek_entries, **hebrew_entries}
    known_strongs = set(entries)
    spanish_translations = load_spanish_translations(args.spanish_translations, known_strongs)
    if args.require_spanish_translations and len(spanish_translations) != len(known_strongs):
        missing_count = len(known_strongs) - len(spanish_translations)
        print(
            f"Spanish translations incomplete: missing {missing_count} of {len(known_strongs)} entries",
            file=sys.stderr,
        )
        return 1

    greek_verses, greek_segments, greek_segment_strongs = extract_bible_rows(
        greek_xml,
        args.greek_version_id,
        known_strongs,
    )
    hebrew_verses, hebrew_segments, hebrew_segment_strongs = extract_bible_rows(
        hebrew_xml,
        args.hebrew_version_id,
        known_strongs,
    )

    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", encoding="utf-8") as handle:
        handle.write("-- Generated by scripts/generate_strongs_seed.py\n")
        handle.write("-- Sources: OpenScriptures Strong dictionaries + tagged original-language XML.\n\n")
        handle.write(
            "DELETE FROM bible_verse_segment_strongs "
            f"WHERE version_id IN ({sql_str(args.greek_version_id)}, {sql_str(args.hebrew_version_id)});\n"
        )
        handle.write(
            "DELETE FROM bible_verse_segments "
            f"WHERE version_id IN ({sql_str(args.greek_version_id)}, {sql_str(args.hebrew_version_id)});\n\n"
        )

        write_batched(
            handle,
            "bible_versions",
            ["version_id", "code", "title", "language", "source_path"],
            [
                version_row(
                    args.greek_version_id,
                    args.greek_version_code,
                    args.greek_version_title,
                    "grc",
                    str(greek_xml.relative_to(ROOT) if greek_xml.is_relative_to(ROOT) else greek_xml),
                ),
                version_row(
                    args.hebrew_version_id,
                    args.hebrew_version_code,
                    args.hebrew_version_title,
                    "heb",
                    str(hebrew_xml.relative_to(ROOT) if hebrew_xml.is_relative_to(ROOT) else hebrew_xml),
                ),
            ],
            "ON CONFLICT (version_id) DO UPDATE SET\n"
            "  code = EXCLUDED.code,\n"
            "  title = EXCLUDED.title,\n"
            "  language = EXCLUDED.language,\n"
            "  source_path = EXCLUDED.source_path;",
        )

        write_batched(
            handle,
            "strong_entries",
            [
                "strong_number",
                "language",
                "lemma",
                "transliteration",
                "pronunciation",
                "definition",
                "derivation",
                "kjv_definition",
                "source",
            ],
            [strong_entry_row(entry) for entry in sorted(entries.values(), key=lambda item: item["strong_number"])],
            "ON CONFLICT (strong_number) DO UPDATE SET\n"
            "  language = EXCLUDED.language,\n"
            "  lemma = EXCLUDED.lemma,\n"
            "  transliteration = EXCLUDED.transliteration,\n"
            "  pronunciation = EXCLUDED.pronunciation,\n"
            "  definition = EXCLUDED.definition,\n"
            "  derivation = EXCLUDED.derivation,\n"
            "  kjv_definition = EXCLUDED.kjv_definition,\n"
            "  source = EXCLUDED.source;",
        )

        if spanish_translations:
            write_batched(
                handle,
                "strong_entry_translations",
                [
                    "strong_number",
                    "language_code",
                    "definition",
                    "derivation",
                    "kjv_definition",
                    "translation_status",
                    "source",
                ],
                [
                    strong_translation_row(entry)
                    for entry in sorted(
                        spanish_translations.values(),
                        key=lambda item: item["strong_number"],
                    )
                ],
                "ON CONFLICT (strong_number, language_code) DO UPDATE SET\n"
                "  definition = EXCLUDED.definition,\n"
                "  derivation = EXCLUDED.derivation,\n"
                "  kjv_definition = EXCLUDED.kjv_definition,\n"
                "  translation_status = EXCLUDED.translation_status,\n"
                "  source = EXCLUDED.source,\n"
                "  updated_at = now();",
            )

        write_batched(
            handle,
            "bible_verses",
            ["version_id", "ref", "book", "chapter", "verse", "text"],
            greek_verses + hebrew_verses,
            "ON CONFLICT (version_id, ref) DO UPDATE SET\n"
            "  book = EXCLUDED.book,\n"
            "  chapter = EXCLUDED.chapter,\n"
            "  verse = EXCLUDED.verse,\n"
            "  text = EXCLUDED.text;",
        )

        write_batched(
            handle,
            "bible_verse_segments",
            ["version_id", "ref", "position", "text"],
            greek_segments + hebrew_segments,
            "ON CONFLICT (version_id, ref, position) DO UPDATE SET\n"
            "  text = EXCLUDED.text;",
        )

        write_batched(
            handle,
            "bible_verse_segment_strongs",
            ["version_id", "ref", "position", "sequence", "strong_number", "strong_raw"],
            greek_segment_strongs + hebrew_segment_strongs,
            "ON CONFLICT (version_id, ref, position, sequence) DO UPDATE SET\n"
            "  strong_number = EXCLUDED.strong_number,\n"
            "  strong_raw = EXCLUDED.strong_raw;",
        )

    print(
        "Generated "
        f"{len(entries)} Strong entries, "
        f"{len(spanish_translations)} Spanish translations, "
        f"{len(greek_verses) + len(hebrew_verses)} verses, "
        f"{len(greek_segments) + len(hebrew_segments)} segments, "
        f"{len(greek_segment_strongs) + len(hebrew_segment_strongs)} Strong links → {args.output}",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
