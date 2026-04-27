#!/usr/bin/env python3

import pathlib
import re
import sys


ROOT = pathlib.Path(__file__).resolve().parents[1]
SCHEMA_PATH = ROOT / "docs" / "contracts" / "insert-events.schema.json"
INSERT_PATTERN = re.compile(
    r"^INSERT\s+INTO\s+events\s*\(\s*order\s*,\s*year\s*,\s*event\s*,\s*description\s*\)\s+VALUES\s*(?P<body>.*);\s*$",
    re.IGNORECASE | re.DOTALL,
)
ROW_PATTERN = re.compile(
    r"\(\s*(\d+)\s*,\s*'((?:''|[^'])*)'\s*,\s*'((?:''|[^'])*)'\s*,\s*'((?:''|[^'])*)'\s*\)"
)


def fail(message: str) -> int:
    print(f"INVALID: {message}", file=sys.stderr)
    return 1


def validate_sql(sql: str) -> list[str]:
    errors: list[str] = []
    stripped = sql.strip()

    if not stripped:
        return ["SQL content is empty"]

    match = INSERT_PATTERN.fullmatch(stripped)
    if not match:
        return [
            "SQL must be a single INSERT INTO events (order, year, event, description) VALUES ... statement"
        ]

    body = match.group("body").strip()
    rows = list(ROW_PATTERN.finditer(body))
    if not rows:
        return ["VALUES must contain at least one row with the expected column order"]

    normalized = ",".join(row.group(0) for row in rows)
    body_without_whitespace = re.sub(r"\s+", "", body)
    normalized_without_whitespace = re.sub(r"\s+", "", normalized)
    if body_without_whitespace != normalized_without_whitespace:
        errors.append("VALUES contains malformed tuples or unsupported SQL fragments")

    previous_order = 0
    seen_orders: set[int] = set()
    for index, row in enumerate(rows, start=1):
        order = int(row.group(1))
        year = row.group(2).strip()
        event = row.group(3).strip()
        description = row.group(4).strip()

        if order < 1:
            errors.append(f"Row {index} uses order {order}; expected integer >= 1")
        if order in seen_orders:
            errors.append(f"Row {index} duplicates order {order}")
        if order <= previous_order:
            errors.append(
                f"Row {index} uses order {order}; expected ascending values after {previous_order}"
            )
        if not year:
            errors.append(f"Row {index} has empty year")
        if not event:
            errors.append(f"Row {index} has empty event")
        if not description:
            errors.append(f"Row {index} has empty description")

        seen_orders.add(order)
        previous_order = order

    return errors


def main() -> int:
    if len(sys.argv) != 2:
        return fail("Usage: python3 scripts/validate_sql.py <events.sql>")

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
        return fail("SQL does not satisfy the repository contract")

    print(f"VALID: {target}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
