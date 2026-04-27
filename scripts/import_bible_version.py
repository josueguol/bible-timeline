#!/usr/bin/env python3
"""
Import a Zefania XML Bible version into the database.

Generates SQL INSERT statements for:
  - bible_versions (one row)
  - bible_verses   (one row per verse)

The ref format matches existing timeline data: "<SpanishBookName> <ch>:<v>".
Books whose bnumber is not in the canon mapping are imported with their English
name so the data is not lost, though they won't have matching sequence rows in
timeline_verse_order for Protestant-canon timelines.

Usage:
  python3 scripts/import_bible_version.py \\
      resources/biblias/LXX.xml \\
      --version-id lxx \\
      --version-code LXX \\
      --version-title "Septuaginta LXX" \\
      --language grc \\
      --output resources/sql/bible_lxx.seed.sql
"""

import argparse
import pathlib
import sys
import xml.etree.ElementTree as ET


def escape_sql(value: str) -> str:
    return value.replace("'", "''")


def sql_str(v: str) -> str:
    return f"'{escape_sql(v)}'"


# Book number → Spanish canonical name (matches refs in timeline_verse_order).
# Numbers 1-66 = Protestant canon; 67-81 = LXX deuterocanonical extras.
BOOK_NAMES_ES: dict[int, str] = {
    1:  "Génesis",          2:  "Éxodo",            3:  "Levítico",
    4:  "Números",          5:  "Deuteronomio",      6:  "Josué",
    7:  "Jueces",           8:  "Rut",               9:  "1 Samuel",
    10: "2 Samuel",         11: "1 Reyes",           12: "2 Reyes",
    13: "1 Crónicas",       14: "2 Crónicas",        15: "Esdras",
    16: "Nehemías",         17: "Ester",             18: "Job",
    19: "Salmos",           20: "Proverbios",        21: "Eclesiastés",
    22: "Cantares",         23: "Isaías",            24: "Jeremías",
    25: "Lamentaciones",    26: "Ezequiel",          27: "Daniel",
    28: "Oseas",            29: "Joel",              30: "Amós",
    31: "Abdías",           32: "Jonás",             33: "Miqueas",
    34: "Nahúm",            35: "Habacuc",           36: "Sofonías",
    37: "Hageo",            38: "Zacarías",          39: "Malaquías",
    40: "Mateo",            41: "Marcos",            42: "Lucas",
    43: "Juan",             44: "Hechos",            45: "Romanos",
    46: "1 Corintios",      47: "2 Corintios",       48: "Gálatas",
    49: "Efesios",          50: "Filipenses",        51: "Colosenses",
    52: "1 Tesalonicenses", 53: "2 Tesalonicenses",  54: "1 Timoteo",
    55: "2 Timoteo",        56: "Tito",              57: "Filemón",
    58: "Hebreos",          59: "Santiago",          60: "1 Pedro",
    61: "2 Pedro",          62: "1 Juan",            63: "2 Juan",
    64: "3 Juan",           65: "Judas",             66: "Apocalipsis",
    # LXX deuterocanonical
    67: "Judit",            68: "Sabiduría",         69: "Tobías",
    70: "Sirácida",         71: "Baruc",             72: "1 Macabeos",
    73: "2 Macabeos",       74: "Adiciones a Daniel",75: "Adiciones a Ester",
    76: "Oración de Manasés",77: "3 Macabeos",       78: "4 Macabeos",
    79: "Carta de Jeremías",80: "1 Esdras",          81: "2 Esdras",
}


def main() -> int:
    p = argparse.ArgumentParser(description="Import Zefania XML Bible → SQL seed")
    p.add_argument("xml_file",         type=pathlib.Path, help="Path to Zefania XML file")
    p.add_argument("--version-id",     required=True,     help="Lowercase DB identifier, e.g. lxx")
    p.add_argument("--version-code",   required=True,     help="Uppercase display code, e.g. LXX")
    p.add_argument("--version-title",  required=True,     help="Full title, e.g. 'Septuaginta LXX'")
    p.add_argument("--language",       required=True,     help="ISO 639 language code, e.g. grc")
    p.add_argument("--output",         type=pathlib.Path, required=True)
    args = p.parse_args()

    if not args.xml_file.exists():
        print(f"File not found: {args.xml_file}", file=sys.stderr)
        return 1

    tree = ET.parse(str(args.xml_file))
    root = tree.getroot()

    verse_rows: list[str] = []
    unmapped: set[int] = set()

    for book_el in root.iter("BIBLEBOOK"):
        bnumber = int(book_el.get("bnumber", "0"))
        bname_en = book_el.get("bname", f"Book{bnumber}")
        book_name = BOOK_NAMES_ES.get(bnumber)
        if book_name is None:
            unmapped.add(bnumber)
            continue
        for chap_el in book_el:
            cnumber = int(chap_el.get("cnumber", "0"))
            for vers_el in chap_el:
                vnumber = int(vers_el.get("vnumber", "0"))
                text = (vers_el.text or "").strip()
                if not text:
                    continue
                ref = f"{book_name} {cnumber}:{vnumber}"
                verse_rows.append(
                    "("
                    + ", ".join([
                        sql_str(args.version_id),
                        sql_str(ref),
                        sql_str(book_name),
                        str(cnumber),
                        str(vnumber),
                        sql_str(text),
                    ])
                    + ")"
                )

    if unmapped:
        print(
            f"Warning: {len(unmapped)} book number(s) not in mapping and were skipped: "
            f"{sorted(unmapped)}",
            file=sys.stderr,
        )

    lines: list[str] = [
        "-- Auto-generated by scripts/import_bible_version.py",
        f"-- Version: {args.version_code} — {args.version_title}",
        f"-- Verses: {len(verse_rows)}",
        "",
        "INSERT INTO bible_versions (version_id, code, title, language, source_path) VALUES",
        "("
        + ", ".join([
            sql_str(args.version_id),
            sql_str(args.version_code),
            sql_str(args.version_title),
            sql_str(args.language),
            sql_str(str(args.xml_file)),
        ])
        + ")",
        "ON CONFLICT (version_id) DO UPDATE SET",
        "    code         = EXCLUDED.code,",
        "    title        = EXCLUDED.title,",
        "    language     = EXCLUDED.language,",
        "    source_path  = EXCLUDED.source_path;",
        "",
    ]

    BATCH = 2000
    for i in range(0, len(verse_rows), BATCH):
        batch = verse_rows[i : i + BATCH]
        lines.append(
            "INSERT INTO bible_verses (version_id, ref, book, chapter, verse, text) VALUES"
        )
        lines.append(",\n".join(batch))
        lines.append("ON CONFLICT (version_id, ref) DO UPDATE SET text = EXCLUDED.text;")
        lines.append("")

    with args.output.open("w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")

    print(
        f"Done. {len(verse_rows)} verse rows → {args.output}",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
