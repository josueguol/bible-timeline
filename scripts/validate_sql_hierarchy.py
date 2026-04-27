#!/usr/bin/env python3

import pathlib
import re
import sys


ROOT = pathlib.Path(__file__).resolve().parents[1]
SCHEMA_PATH = ROOT / "docs" / "contracts" / "insert-hierarchical-events.schema.json"
TIMELINE_PATTERN = re.compile(
    r"INSERT\s+INTO\s+timelines\s*\(\s*timeline_id\s*,\s*title\s*,\s*root_event_count\s*,\s*expansion_mode\s*\)\s+VALUES\s*\(\s*'((?:''|[^'])*)'\s*,\s*'((?:''|[^'])*)'\s*,\s*(\d+)\s*,\s*'((?:''|[^'])*)'\s*\)\s*;",
    re.IGNORECASE | re.DOTALL,
)
EVENTS_PATTERN = re.compile(
    r"INSERT\s+INTO\s+timeline_events\s*\(\s*id\s*,\s*timeline_id\s*,\s*parent_id\s*,\s*zoom_level\s*,\s*sequence\s*,\s*title\s*,\s*start_label\s*,\s*end_label\s*,\s*summary\s*,\s*importance\s*,\s*canonical\s*\)\s+VALUES\s*(?P<body>.*?)\s*;",
    re.IGNORECASE | re.DOTALL,
)
EVENT_ROW_PATTERN = re.compile(
    r"\(\s*'((?:''|[^'])*)'\s*,\s*'((?:''|[^'])*)'\s*,\s*(NULL|'(?:''|[^'])*')\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*'((?:''|[^'])*)'\s*,\s*'((?:''|[^'])*)'\s*,\s*'((?:''|[^'])*)'\s*,\s*'((?:''|[^'])*)'\s*,\s*(\d+)\s*,\s*(TRUE|FALSE)\s*\)",
    re.IGNORECASE,
)
SOURCES_PATTERN = re.compile(
    r"INSERT\s+INTO\s+timeline_event_sources\s*\(\s*event_id\s*,\s*source_ref\s*,\s*source_type\s*\)\s+VALUES\s*(?P<body>.*?)\s*;",
    re.IGNORECASE | re.DOTALL,
)
SOURCE_ROW_PATTERN = re.compile(
    r"\(\s*'((?:''|[^'])*)'\s*,\s*'((?:''|[^'])*)'\s*,\s*'((?:''|[^'])*)'\s*\)"
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


def validate_sql(sql: str) -> list[str]:
    errors: list[str] = []
    stripped = sql.strip()

    if not stripped:
        return ["SQL content is empty"]

    timeline_match = TIMELINE_PATTERN.search(stripped)
    events_match = EVENTS_PATTERN.search(stripped)
    sources_match = SOURCES_PATTERN.search(stripped)

    if not timeline_match:
        errors.append(
            "Missing timelines insert with columns (timeline_id, title, root_event_count, expansion_mode)"
        )
    if not events_match:
        errors.append(
            "Missing timeline_events insert with the required relational columns"
        )
    if not sources_match:
        errors.append(
            "Missing timeline_event_sources insert with columns (event_id, source_ref, source_type)"
        )
    if errors:
        return errors

    timeline_id = timeline_match.group(1)
    root_event_count = int(timeline_match.group(3))
    expansion_mode = timeline_match.group(4)

    if root_event_count < 1:
        errors.append("timelines.root_event_count must be >= 1")
    if expansion_mode.lower() != "children":
        errors.append("timelines.expansion_mode must be 'children'")

    event_rows, clean_events = parse_rows(events_match.group("body"), EVENT_ROW_PATTERN)
    if not event_rows:
        errors.append("timeline_events must contain at least one row")
        return errors
    if not clean_events:
        errors.append("timeline_events contains malformed tuples or unsupported SQL fragments")

    source_rows, clean_sources = parse_rows(sources_match.group("body"), SOURCE_ROW_PATTERN)
    if not source_rows:
        errors.append("timeline_event_sources must contain at least one row")
        return errors
    if not clean_sources:
        errors.append("timeline_event_sources contains malformed tuples or unsupported SQL fragments")

    event_ids: set[str] = set()
    root_ids: set[str] = set()
    source_event_ids: set[str] = set()
    sibling_sequences: dict[tuple[str | None, int], int] = {}

    for index, row in enumerate(event_rows, start=1):
        event_id = row.group(1)
        row_timeline_id = row.group(2)
        parent_literal = row.group(3)
        zoom_level = int(row.group(4))
        sequence = int(row.group(5))
        importance = int(row.group(10))

        if row_timeline_id != timeline_id:
            errors.append(
                f"timeline_events row {index} uses timeline_id {row_timeline_id}, expected {timeline_id}"
            )
        if event_id in event_ids:
            errors.append(f"timeline_events row {index} duplicates id {event_id}")
        event_ids.add(event_id)

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

        if not 1 <= importance <= 100:
            errors.append(f"timeline_events row {index} importance must be between 1 and 100")

    if len(root_ids) != root_event_count:
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

    return errors


def main() -> int:
    if len(sys.argv) != 2:
        return fail("Usage: python3 scripts/validate_sql_hierarchy.py <events.sql>")

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
        return fail("Hierarchical SQL does not satisfy the repository contract")

    print(f"VALID: {target}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
