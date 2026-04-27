#!/usr/bin/env python3

import pathlib
import re
import sys


ROOT = pathlib.Path(__file__).resolve().parents[1]
SCHEMA_PATH = ROOT / "docs" / "contracts" / "insert-verse-timeline-bundle.schema.json"

VERSIONS_PATTERN = re.compile(
    r"INSERT\s+INTO\s+bible_versions\s*\(\s*version_id\s*,\s*code\s*,\s*title\s*,\s*language\s*,\s*source_path\s*\)\s+VALUES\s*(?P<body>.*)\s*$",
    re.IGNORECASE | re.DOTALL,
)
VERSION_ROW_PATTERN = re.compile(
    r"\(\s*'((?:''|[^'])*)'\s*,\s*'((?:''|[^'])*)'\s*,\s*'((?:''|[^'])*)'\s*,\s*'((?:''|[^'])*)'\s*,\s*'((?:''|[^'])*)'\s*\)",
    re.IGNORECASE,
)
VERSES_PATTERN = re.compile(
    r"INSERT\s+INTO\s+bible_verses\s*\(\s*version_id\s*,\s*ref\s*,\s*book\s*,\s*chapter\s*,\s*verse\s*,\s*text\s*\)\s+VALUES\s*(?P<body>.*)\s*$",
    re.IGNORECASE | re.DOTALL,
)
VERSE_ROW_PATTERN = re.compile(
    r"\(\s*'((?:''|[^'])*)'\s*,\s*'((?:''|[^'])*)'\s*,\s*'((?:''|[^'])*)'\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*'((?:''|[^'])*)'\s*\)",
    re.IGNORECASE,
)
MANIFESTS_PATTERN = re.compile(
    r"INSERT\s+INTO\s+timeline_manifests\s*\(\s*manifest_id\s*,\s*source_version_id\s*,\s*title\s*,\s*source_path\s*,\s*is_editable\s*\)\s+VALUES\s*(?P<body>.*)\s*$",
    re.IGNORECASE | re.DOTALL,
)
MANIFEST_ROW_PATTERN = re.compile(
    r"\(\s*'((?:''|[^'])*)'\s*,\s*'((?:''|[^'])*)'\s*,\s*'((?:''|[^'])*)'\s*,\s*'((?:''|[^'])*)'\s*,\s*(TRUE|FALSE)\s*\)",
    re.IGNORECASE,
)
CHAPTERS_PATTERN = re.compile(
    r"INSERT\s+INTO\s+timeline_chapter_entries\s*\(\s*manifest_id\s*,\s*entry_id\s*,\s*sequence\s*,\s*book\s*,\s*chapter\s*,\s*source_line\s*,\s*status\s*\)\s+VALUES\s*(?P<body>.*)\s*$",
    re.IGNORECASE | re.DOTALL,
)
CHAPTER_ROW_PATTERN = re.compile(
    r"\(\s*'((?:''|[^'])*)'\s*,\s*'((?:''|[^'])*)'\s*,\s*(\d+)\s*,\s*'((?:''|[^'])*)'\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*'((?:''|[^'])*)'\s*\)",
    re.IGNORECASE,
)
VERSE_ORDER_PATTERN = re.compile(
    r"INSERT\s+INTO\s+timeline_verse_order\s*\(\s*manifest_id\s*,\s*sequence\s*,\s*ref\s*,\s*book\s*,\s*chapter\s*,\s*verse\s*,\s*entry_id\s*,\s*status\s*\)\s+VALUES\s*(?P<body>.*)\s*$",
    re.IGNORECASE | re.DOTALL,
)
VERSE_ORDER_ROW_PATTERN = re.compile(
    r"\(\s*'((?:''|[^'])*)'\s*,\s*(\d+)\s*,\s*'((?:''|[^'])*)'\s*,\s*'((?:''|[^'])*)'\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*'((?:''|[^'])*)'\s*,\s*'((?:''|[^'])*)'\s*\)",
    re.IGNORECASE,
)
TIMELINE_PATTERN = re.compile(
    r"INSERT\s+INTO\s+timelines\s*\(\s*timeline_id\s*,\s*manifest_id\s*,\s*title\s*,\s*root_event_count\s*,\s*expansion_mode\s*\)\s+VALUES\s*(?P<body>.*)\s*$",
    re.IGNORECASE | re.DOTALL,
)
TIMELINE_ROW_PATTERN = re.compile(
    r"\(\s*'((?:''|[^'])*)'\s*,\s*'((?:''|[^'])*)'\s*,\s*'((?:''|[^'])*)'\s*,\s*(\d+)\s*,\s*'((?:''|[^'])*)'\s*\)",
    re.IGNORECASE,
)
ZOOM_LEVELS_PATTERN = re.compile(
    r"INSERT\s+INTO\s+timeline_zoom_levels\s*\(\s*timeline_id\s*,\s*level\s*,\s*label\s*,\s*min_zoom_factor\s*,\s*max_zoom_factor\s*,\s*target_visible_events\s*,\s*description\s*\)\s+VALUES\s*(?P<body>.*)\s*$",
    re.IGNORECASE | re.DOTALL,
)
ZOOM_LEVEL_ROW_PATTERN = re.compile(
    r"\(\s*'((?:''|[^'])*)'\s*,\s*(\d+)\s*,\s*'((?:''|[^'])*)'\s*,\s*([0-9]*\.?[0-9]+)\s*,\s*([0-9]*\.?[0-9]+)\s*,\s*(\d+)\s*,\s*'((?:''|[^'])*)'\s*\)",
    re.IGNORECASE,
)
EVENTS_PATTERN = re.compile(
    r"INSERT\s+INTO\s+timeline_events\s*\(\s*id\s*,\s*timeline_id\s*,\s*parent_id\s*,\s*zoom_level\s*,\s*sequence\s*,\s*title\s*,\s*start_label\s*,\s*end_label\s*,\s*start_ref\s*,\s*end_ref\s*,\s*start_sequence\s*,\s*end_sequence\s*,\s*summary\s*,\s*importance\s*,\s*canonical\s*\)\s+VALUES\s*(?P<body>.*)\s*$",
    re.IGNORECASE | re.DOTALL,
)
EVENT_ROW_PATTERN = re.compile(
    r"\(\s*'((?:''|[^'])*)'\s*,\s*'((?:''|[^'])*)'\s*,\s*(NULL|'(?:''|[^'])*')\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*'((?:''|[^'])*)'\s*,\s*'((?:''|[^'])*)'\s*,\s*'((?:''|[^'])*)'\s*,\s*'((?:''|[^'])*)'\s*,\s*'((?:''|[^'])*)'\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*'((?:''|[^'])*)'\s*,\s*(\d+)\s*,\s*(TRUE|FALSE)\s*\)",
    re.IGNORECASE,
)
SOURCES_PATTERN = re.compile(
    r"INSERT\s+INTO\s+timeline_event_sources\s*\(\s*event_id\s*,\s*source_ref\s*,\s*source_type\s*\)\s+VALUES\s*(?P<body>.*)\s*$",
    re.IGNORECASE | re.DOTALL,
)
SOURCE_ROW_PATTERN = re.compile(
    r"\(\s*'((?:''|[^'])*)'\s*,\s*'((?:''|[^'])*)'\s*,\s*'((?:''|[^'])*)'\s*\)",
    re.IGNORECASE,
)


def fail(message: str) -> int:
    print(f"INVALID: {message}", file=sys.stderr)
    return 1


def parse_rows(body: str, row_pattern: re.Pattern[str]) -> tuple[list[re.Match[str]], bool]:
    rows = list(row_pattern.finditer(body))
    if not rows:
        return [], False

    normalized = ",".join(row.group(0) for row in rows)
    body_without_whitespace = re.sub(r"\s+", "", body)
    normalized_without_whitespace = re.sub(r"\s+", "", normalized)
    return rows, body_without_whitespace == normalized_without_whitespace


def strip_sql_comments(sql: str) -> str:
    return "\n".join(line for line in sql.splitlines() if not line.lstrip().startswith("--"))


def split_sql_statements(sql: str) -> list[str]:
    statements: list[str] = []
    current: list[str] = []
    in_string = False
    index = 0
    while index < len(sql):
        char = sql[index]
        current.append(char)
        if char == "'":
            if in_string and index + 1 < len(sql) and sql[index + 1] == "'":
                current.append(sql[index + 1])
                index += 1
            else:
                in_string = not in_string
        elif char == ";" and not in_string:
            statement = "".join(current[:-1]).strip()
            if statement:
                statements.append(statement)
            current = []
        index += 1

    trailing = "".join(current).strip()
    if trailing:
        statements.append(trailing)
    return statements


def validate_sql(sql: str) -> list[str]:
    errors: list[str] = []
    stripped = strip_sql_comments(sql).strip()
    if not stripped:
        return ["SQL content is empty"]

    statements = split_sql_statements(stripped)
    statement_map: dict[str, str] = {}
    for statement in statements:
        table_match = re.match(r"INSERT\s+INTO\s+([a-z_]+)\b", statement, re.IGNORECASE)
        if table_match:
            statement_map[table_match.group(1).lower()] = statement

    matches = {
        "bible_versions": VERSIONS_PATTERN.fullmatch(statement_map.get("bible_versions", "")),
        "bible_verses": VERSES_PATTERN.fullmatch(statement_map.get("bible_verses", "")),
        "timeline_manifests": MANIFESTS_PATTERN.fullmatch(statement_map.get("timeline_manifests", "")),
        "timeline_chapter_entries": CHAPTERS_PATTERN.fullmatch(statement_map.get("timeline_chapter_entries", "")),
        "timeline_verse_order": VERSE_ORDER_PATTERN.fullmatch(statement_map.get("timeline_verse_order", "")),
        "timelines": TIMELINE_PATTERN.fullmatch(statement_map.get("timelines", "")),
        "timeline_zoom_levels": ZOOM_LEVELS_PATTERN.fullmatch(statement_map.get("timeline_zoom_levels", "")),
        "timeline_events": EVENTS_PATTERN.fullmatch(statement_map.get("timeline_events", "")),
        "timeline_event_sources": SOURCES_PATTERN.fullmatch(statement_map.get("timeline_event_sources", "")),
    }
    for table, match in matches.items():
        if not match:
            errors.append(f"Missing INSERT statement for {table}")
    if errors:
        return errors

    version_rows, clean_versions = parse_rows(matches["bible_versions"].group("body"), VERSION_ROW_PATTERN)
    verse_rows, clean_verses = parse_rows(matches["bible_verses"].group("body"), VERSE_ROW_PATTERN)
    manifest_rows, clean_manifests = parse_rows(matches["timeline_manifests"].group("body"), MANIFEST_ROW_PATTERN)
    chapter_rows, clean_chapters = parse_rows(matches["timeline_chapter_entries"].group("body"), CHAPTER_ROW_PATTERN)
    verse_order_rows, clean_verse_order = parse_rows(matches["timeline_verse_order"].group("body"), VERSE_ORDER_ROW_PATTERN)
    timeline_rows, clean_timelines = parse_rows(matches["timelines"].group("body"), TIMELINE_ROW_PATTERN)
    zoom_rows, clean_zoom = parse_rows(matches["timeline_zoom_levels"].group("body"), ZOOM_LEVEL_ROW_PATTERN)
    event_rows, clean_events = parse_rows(matches["timeline_events"].group("body"), EVENT_ROW_PATTERN)
    source_rows, clean_sources = parse_rows(matches["timeline_event_sources"].group("body"), SOURCE_ROW_PATTERN)

    parsed_sets = [
        ("bible_versions", version_rows, clean_versions),
        ("bible_verses", verse_rows, clean_verses),
        ("timeline_manifests", manifest_rows, clean_manifests),
        ("timeline_chapter_entries", chapter_rows, clean_chapters),
        ("timeline_verse_order", verse_order_rows, clean_verse_order),
        ("timelines", timeline_rows, clean_timelines),
        ("timeline_zoom_levels", zoom_rows, clean_zoom),
        ("timeline_events", event_rows, clean_events),
        ("timeline_event_sources", source_rows, clean_sources),
    ]
    for table, rows, clean in parsed_sets:
        if not rows:
            errors.append(f"{table} must contain at least one row")
        elif not clean:
            errors.append(f"{table} contains malformed tuples or unsupported SQL fragments")
    if errors:
        return errors

    version_ids: set[str] = set()
    manifest_ids: set[str] = set()
    chapter_entry_ids: set[str] = set()
    timeline_ids: set[str] = set()
    event_ids: set[str] = set()
    source_event_ids: set[str] = set()
    root_ids: set[str] = set()

    for index, row in enumerate(version_rows, start=1):
        version_id = row.group(1)
        if version_id in version_ids:
            errors.append(f"bible_versions row {index} duplicates version_id {version_id}")
        version_ids.add(version_id)

    verse_sequence_count = 0
    for index, row in enumerate(verse_rows, start=1):
        version_id = row.group(1)
        if version_id not in version_ids:
            errors.append(f"bible_verses row {index} references unknown version_id {version_id}")
        verse_sequence_count += 1

    for index, row in enumerate(manifest_rows, start=1):
        manifest_id = row.group(1)
        source_version_id = row.group(2)
        if source_version_id not in version_ids:
            errors.append(
                f"timeline_manifests row {index} references unknown source_version_id {source_version_id}"
            )
        if manifest_id in manifest_ids:
            errors.append(f"timeline_manifests row {index} duplicates manifest_id {manifest_id}")
        manifest_ids.add(manifest_id)

    chapter_sequences: dict[str, int] = {}
    for index, row in enumerate(chapter_rows, start=1):
        manifest_id = row.group(1)
        entry_id = row.group(2)
        sequence = int(row.group(3))
        if manifest_id not in manifest_ids:
            errors.append(f"timeline_chapter_entries row {index} references unknown manifest_id {manifest_id}")
        if entry_id in chapter_entry_ids:
            errors.append(f"timeline_chapter_entries row {index} duplicates entry_id {entry_id}")
        chapter_entry_ids.add(entry_id)

        previous_sequence = chapter_sequences.get(manifest_id, 0)
        if sequence <= previous_sequence:
            errors.append(
                f"timeline_chapter_entries row {index} sequence {sequence} must be greater than previous sequence {previous_sequence}"
            )
        chapter_sequences[manifest_id] = sequence

    verse_order_sequences: dict[str, int] = {}
    for index, row in enumerate(verse_order_rows, start=1):
        manifest_id = row.group(1)
        sequence = int(row.group(2))
        entry_id = row.group(7)
        if manifest_id not in manifest_ids:
            errors.append(f"timeline_verse_order row {index} references unknown manifest_id {manifest_id}")
        if entry_id not in chapter_entry_ids:
            errors.append(f"timeline_verse_order row {index} references unknown entry_id {entry_id}")

        previous_sequence = verse_order_sequences.get(manifest_id, 0)
        if sequence <= previous_sequence:
            errors.append(
                f"timeline_verse_order row {index} sequence {sequence} must be greater than previous sequence {previous_sequence}"
            )
        verse_order_sequences[manifest_id] = sequence

    root_event_count = None
    canonical_timeline_id = None
    canonical_manifest_id = None
    for index, row in enumerate(timeline_rows, start=1):
        timeline_id = row.group(1)
        manifest_id = row.group(2)
        row_root_event_count = int(row.group(4))
        expansion_mode = row.group(5).lower()

        if manifest_id not in manifest_ids:
            errors.append(f"timelines row {index} references unknown manifest_id {manifest_id}")
        if timeline_id in timeline_ids:
            errors.append(f"timelines row {index} duplicates timeline_id {timeline_id}")
        timeline_ids.add(timeline_id)

        if expansion_mode != "children":
            errors.append(f"timelines row {index} expansion_mode must be 'children'")
        if row_root_event_count < 1:
            errors.append(f"timelines row {index} root_event_count must be >= 1")

        if index == 1:
            canonical_timeline_id = timeline_id
            canonical_manifest_id = manifest_id
            root_event_count = row_root_event_count

    previous_level = -1
    previous_max_zoom = 0.0
    previous_target_visible = 0
    for index, row in enumerate(zoom_rows, start=1):
        timeline_id = row.group(1)
        level = int(row.group(2))
        min_zoom = float(row.group(4))
        max_zoom = float(row.group(5))
        target_visible = int(row.group(6))

        if timeline_id not in timeline_ids:
            errors.append(f"timeline_zoom_levels row {index} references unknown timeline_id {timeline_id}")
        if canonical_timeline_id is not None and timeline_id == canonical_timeline_id:
            if level != previous_level + 1:
                errors.append(
                    f"timeline_zoom_levels row {index} level {level} must follow previous level {previous_level}"
                )
            if min_zoom >= max_zoom:
                errors.append(f"timeline_zoom_levels row {index} min_zoom_factor must be < max_zoom_factor")
            if level == 0 and min_zoom != 0:
                errors.append("timeline_zoom_levels level 0 must start at 0")
            if min_zoom < previous_max_zoom:
                errors.append(
                    f"timeline_zoom_levels row {index} min_zoom_factor must be >= previous max_zoom_factor {previous_max_zoom}"
                )
            if target_visible <= previous_target_visible:
                errors.append(
                    f"timeline_zoom_levels row {index} target_visible_events must be greater than previous level"
                )
            previous_level = level
            previous_max_zoom = max_zoom
            previous_target_visible = target_visible

    if zoom_rows and previous_max_zoom != 1:
        errors.append("The last timeline_zoom_levels.max_zoom_factor must be 1")

    sibling_sequences: dict[tuple[str | None, int], int] = {}
    for index, row in enumerate(event_rows, start=1):
        event_id = row.group(1)
        timeline_id = row.group(2)
        parent_literal = row.group(3)
        zoom_level = int(row.group(4))
        sequence = int(row.group(5))
        start_sequence = int(row.group(11))
        end_sequence = int(row.group(12))
        importance = int(row.group(14))

        if timeline_id not in timeline_ids:
            errors.append(f"timeline_events row {index} references unknown timeline_id {timeline_id}")
        if event_id in event_ids:
            errors.append(f"timeline_events row {index} duplicates id {event_id}")
        event_ids.add(event_id)

        if start_sequence > end_sequence:
            errors.append(f"timeline_events row {index} start_sequence must be <= end_sequence")
        if importance < 1 or importance > 100:
            errors.append(f"timeline_events row {index} importance must be between 1 and 100")

        parent_id = None if parent_literal.upper() == "NULL" else parent_literal.strip("'")
        if parent_id is None:
            root_ids.add(event_id)
            if zoom_level != 0:
                errors.append(f"timeline_events row {index} root events must use zoom_level 0")
        elif zoom_level < 1:
            errors.append(f"timeline_events row {index} child events must use zoom_level >= 1")

        sibling_key = (parent_id, zoom_level)
        previous_sequence = sibling_sequences.get(sibling_key, 0)
        if sequence <= previous_sequence:
            errors.append(
                f"timeline_events row {index} sequence {sequence} must be greater than previous sibling sequence {previous_sequence}"
            )
        sibling_sequences[sibling_key] = sequence

    if root_event_count is not None and len(root_ids) != root_event_count:
        errors.append(
            f"timeline_events root count {len(root_ids)} does not match timelines.root_event_count {root_event_count}"
        )

    for index, row in enumerate(source_rows, start=1):
        event_id = row.group(1)
        source_ref = row.group(2).strip()
        source_type = row.group(3).strip().lower()
        source_event_ids.add(event_id)

        if event_id not in event_ids:
            errors.append(f"timeline_event_sources row {index} references unknown event_id {event_id}")
        if not source_ref:
            errors.append(f"timeline_event_sources row {index} source_ref must be non-empty")
        if source_type not in {"scripture", "historical-note"}:
            errors.append(
                f"timeline_event_sources row {index} source_type must be scripture or historical-note"
            )

    for event_id in sorted(event_ids):
        if event_id not in source_event_ids:
            errors.append(f"timeline_events id {event_id} is missing at least one source row")

    if canonical_manifest_id is not None:
        if canonical_manifest_id not in verse_order_sequences:
            errors.append("timeline_verse_order must include rows for the manifest used by timelines")
        if canonical_manifest_id not in chapter_sequences:
            errors.append("timeline_chapter_entries must include rows for the manifest used by timelines")

    if verse_sequence_count < 1:
        errors.append("bible_verses must contain at least one verse row")

    return errors


def main() -> int:
    if len(sys.argv) != 2:
        return fail("Usage: python3 scripts/validate_sql_timeline_bundle.py <bundle.sql>")

    target = pathlib.Path(sys.argv[1]).resolve()
    if not target.is_file():
        return fail(f"File not found: {target}")

    try:
        _ = SCHEMA_PATH.read_text(encoding="utf-8")
        sql = target.read_text(encoding="utf-8")
    except OSError as exc:
        return fail(str(exc))

    errors = validate_sql(sql)
    if errors:
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return fail("Verse timeline SQL bundle does not satisfy the repository contract")

    print(f"VALID: {target}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
