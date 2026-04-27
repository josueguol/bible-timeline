#!/usr/bin/env python3

import argparse
import json
import pathlib
import sys


def load_json(path: pathlib.Path) -> object:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def escape_sql(value: str) -> str:
    return value.replace("'", "''")


def sql_string(value: str) -> str:
    return f"'{escape_sql(value)}'"


def sql_bool(value: bool) -> str:
    return "TRUE" if value else "FALSE"


def format_insert(table: str, columns: list[str], rows: list[str]) -> str:
    return (
        f"INSERT INTO {table} ({', '.join(columns)}) VALUES\n"
        + ",\n".join(rows)
        + ";\n"
    )


def flatten_events(events: list[dict]) -> list[dict]:
    flattened: list[dict] = []

    def visit(event: dict) -> None:
        flattened.append(event)
        for child in sorted(event.get("children", []), key=lambda item: item["sequence"]):
            visit(child)

    for event in sorted(events, key=lambda item: item["sequence"]):
        visit(event)
    return flattened


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Generate a SQL bundle for Bible versions, verse order, and hierarchical timeline data."
    )
    parser.add_argument("manifest", type=pathlib.Path, help="Path to chapter-order manifest JSON")
    parser.add_argument("verse_order", type=pathlib.Path, help="Path to verse-order JSON")
    parser.add_argument("hierarchy", type=pathlib.Path, help="Path to hierarchical timeline JSON")
    parser.add_argument("--output", type=pathlib.Path, required=True, help="Path to output SQL file")
    parser.add_argument("--version-id", default="rv60")
    parser.add_argument("--version-code", default="RV60")
    parser.add_argument("--version-title", default="Reina-Valera 1960")
    parser.add_argument("--language", default="es")
    parser.add_argument("--source-path", default="resources/biblias/RV60.xml")
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    manifest = load_json(args.manifest)
    verse_order = load_json(args.verse_order)
    hierarchy = load_json(args.hierarchy)

    if not isinstance(manifest, dict) or not isinstance(verse_order, dict) or not isinstance(hierarchy, dict):
        print("Input files must be JSON objects", file=sys.stderr)
        return 1

    manifest_id = manifest["manifestId"]
    timeline_id = hierarchy["timelineId"]
    timeline_title = hierarchy["title"]
    root_event_count = hierarchy["navigation"]["rootEventCount"]
    expansion_mode = hierarchy["navigation"]["expansionMode"]
    zoom_levels = hierarchy["navigation"]["zoomLevels"]
    flattened_events = flatten_events(hierarchy["events"])
    manifest_source = manifest.get("source", "")
    if isinstance(manifest_source, dict):
        manifest_source_path = str(manifest_source.get("readingFile") or manifest_source.get("bibleXmlFile") or "")
    else:
        manifest_source_path = str(manifest_source)

    version_rows = [
        "("
        + ", ".join(
            [
                sql_string(args.version_id),
                sql_string(args.version_code),
                sql_string(args.version_title),
                sql_string(args.language),
                sql_string(args.source_path),
            ]
        )
        + ")"
    ]

    verse_rows: list[str] = []
    for verse in verse_order["verses"]:
        verse_rows.append(
            "("
            + ", ".join(
                [
                    sql_string(args.version_id),
                    sql_string(verse["ref"]),
                    sql_string(verse["book"]),
                    str(verse["chapter"]),
                    str(verse["verse"]),
                    sql_string(verse["text"]),
                ]
            )
            + ")"
        )

    manifest_rows = [
        "("
        + ", ".join(
            [
                sql_string(manifest_id),
                sql_string(args.version_id),
                sql_string(manifest["title"]),
                sql_string(manifest_source_path),
                sql_bool(True),
            ]
        )
        + ")"
    ]

    chapter_rows: list[str] = []
    for entry in manifest["entries"]:
        chapter_rows.append(
            "("
            + ", ".join(
                [
                    sql_string(manifest_id),
                    sql_string(entry["id"]),
                    str(entry["sequence"]),
                    sql_string(entry["bookCanonical"]),
                    str(entry["chapter"]),
                    str(entry["sequence"]),
                    sql_string(entry["status"]),
                ]
            )
            + ")"
        )

    verse_order_rows: list[str] = []
    for verse in verse_order["verses"]:
        verse_order_rows.append(
            "("
            + ", ".join(
                [
                    sql_string(manifest_id),
                    str(verse["sequence"]),
                    sql_string(verse["ref"]),
                    sql_string(verse["book"]),
                    str(verse["chapter"]),
                    str(verse["verse"]),
                    sql_string(verse["entryId"]),
                    sql_string(verse["status"]),
                ]
            )
            + ")"
        )

    timeline_rows = [
        "("
        + ", ".join(
            [
                sql_string(timeline_id),
                sql_string(manifest_id),
                sql_string(timeline_title),
                str(root_event_count),
                sql_string(expansion_mode),
            ]
        )
        + ")"
    ]

    zoom_level_rows: list[str] = []
    for level in zoom_levels:
        zoom_level_rows.append(
            "("
            + ", ".join(
                [
                    sql_string(timeline_id),
                    str(level["level"]),
                    sql_string(level["label"]),
                    str(level["minZoomFactor"]),
                    str(level["maxZoomFactor"]),
                    str(level["targetVisibleEvents"]),
                    sql_string(level["description"]),
                ]
            )
            + ")"
        )

    event_rows: list[str] = []
    source_rows: list[str] = []
    for event in flattened_events:
        parent_id = "NULL" if event["parentId"] is None else sql_string(event["parentId"])
        event_rows.append(
            "("
            + ", ".join(
                [
                    sql_string(event["id"]),
                    sql_string(timeline_id),
                    parent_id,
                    str(event["zoomLevel"]),
                    str(event["sequence"]),
                    sql_string(event["title"]),
                    sql_string(event["startLabel"]),
                    sql_string(event["endLabel"]),
                    sql_string(event["startRef"]),
                    sql_string(event["endRef"]),
                    str(event["startSequence"]),
                    str(event["endSequence"]),
                    sql_string(event["summary"]),
                    str(event["importance"]),
                    sql_bool(bool(event["canonical"])),
                ]
            )
            + ")"
        )
        for source_ref in event["scriptureRefs"]:
            source_rows.append(
                "("
                + ", ".join(
                    [
                        sql_string(event["id"]),
                        sql_string(source_ref),
                        sql_string("scripture"),
                    ]
                )
                + ")"
            )

    sql_parts = [
        "-- Generated by scripts/generate_sql_timeline_bundle.py\n",
        format_insert(
            "bible_versions",
            ["version_id", "code", "title", "language", "source_path"],
            version_rows,
        ),
        format_insert(
            "bible_verses",
            ["version_id", "ref", "book", "chapter", "verse", "text"],
            verse_rows,
        ),
        format_insert(
            "timeline_manifests",
            ["manifest_id", "source_version_id", "title", "source_path", "is_editable"],
            manifest_rows,
        ),
        format_insert(
            "timeline_chapter_entries",
            ["manifest_id", "entry_id", "sequence", "book", "chapter", "source_line", "status"],
            chapter_rows,
        ),
        format_insert(
            "timeline_verse_order",
            ["manifest_id", "sequence", "ref", "book", "chapter", "verse", "entry_id", "status"],
            verse_order_rows,
        ),
        format_insert(
            "timelines",
            ["timeline_id", "manifest_id", "title", "root_event_count", "expansion_mode"],
            timeline_rows,
        ),
        format_insert(
            "timeline_zoom_levels",
            [
                "timeline_id",
                "level",
                "label",
                "min_zoom_factor",
                "max_zoom_factor",
                "target_visible_events",
                "description",
            ],
            zoom_level_rows,
        ),
        format_insert(
            "timeline_events",
            [
                "id",
                "timeline_id",
                "parent_id",
                "zoom_level",
                "sequence",
                "title",
                "start_label",
                "end_label",
                "start_ref",
                "end_ref",
                "start_sequence",
                "end_sequence",
                "summary",
                "importance",
                "canonical",
            ],
            event_rows,
        ),
        format_insert(
            "timeline_event_sources",
            ["event_id", "source_ref", "source_type"],
            source_rows,
        ),
    ]

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text("\n".join(sql_parts), encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
