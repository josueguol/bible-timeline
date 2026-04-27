#!/usr/bin/env python3

import re
from pathlib import Path


INPUT_PATH = Path("resources/cronologia/Lectura.md")
OUTPUT_PATH = Path("resources/cronologia/Lectura_Expandida.md")

ENTRY_PATTERN = re.compile(
    r"(?:(?P<book>[1-3]?[ ]?[A-Za-zÁÉÍÓÚáéíóúÑñÜü]+(?: [A-Za-zÁÉÍÓÚáéíóúÑñÜü]+)*)\s+)?(?P<start>\d+)(?:[–-](?P<end>\d+))?$"
)


def parse_chapter_ref(ref: str) -> list[str]:
    parts: list[str] = []
    current_book: str | None = None

    for entry in ref.split(","):
        entry = entry.strip()
        match = ENTRY_PATTERN.match(entry)
        if not match:
            continue

        book = match.group("book") or current_book
        if not book:
            continue

        current_book = book
        start = int(match.group("start"))
        end = int(match.group("end") or start)

        for chapter in range(start, end + 1):
            parts.append(f"{book} {chapter}")

    return parts


def expand_line(line: str) -> list[str]:
    result: list[str] = []
    for part in line.split(";"):
        result.extend(parse_chapter_ref(part.strip()))
    return result


def main() -> int:
    lines = [line.strip() for line in INPUT_PATH.read_text(encoding="utf-8").splitlines() if line.strip()]

    output_lines: list[str] = []
    for line in lines:
        output_lines.extend(expand_line(line))

    OUTPUT_PATH.write_text("\n".join(output_lines) + "\n", encoding="utf-8")
    print(f"Expanding {len(lines)} lines to {len(output_lines)} individual chapters")
    print(f"Saved to: {OUTPUT_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
