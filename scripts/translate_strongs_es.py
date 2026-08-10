#!/usr/bin/env python3
"""
Generate resources/diccionarios/strongs.es.jsonl with Spanish Strong translations.

The script is resumable: existing Strong numbers in the output file are skipped.
It talks to any OpenAI-compatible Chat Completions endpoint. Defaults to
OpenAI; point OPENAI_BASE_URL at another provider (e.g. OpenRouter:
OPENAI_BASE_URL=https://openrouter.ai/api/v1 with an OpenRouter key and a
vendor-prefixed model like openai/gpt-4o-mini). Requires OPENAI_API_KEY and
OPENAI_MODEL.
"""

import argparse
import json
import os
import pathlib
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Iterable

from generate_strongs_seed import (
    DEFAULT_GREEK_DICTIONARY,
    DEFAULT_HEBREW_DICTIONARY,
    DEFAULT_SPANISH_TRANSLATIONS,
    load_js_dictionary,
    normalize_strong,
    normalize_text,
)


DEFAULT_BASE_URL = "https://api.openai.com/v1"

INSTRUCTIONS = """
Traduce al español campos de un diccionario Strong bíblico.
Reglas estrictas:
- No cambies strong_number.
- No traduzcas lemma, transliteration ni pronunciation.
- Traduce solamente definition, derivation y kjv_definition.
- Conserva referencias Strong como H7225 o G3056.
- Conserva griego/hebreo original cuando aparezca.
- Usa español claro, bíblico y técnico cuando sea necesario.
- No agregues explicaciones ni comentarios.
- Si un campo de origen está vacío, responde con cadena vacía.
"""


def chunks(values: list[dict[str, str]], size: int) -> Iterable[list[dict[str, str]]]:
    for index in range(0, len(values), size):
        yield values[index : index + size]


def load_existing(path: pathlib.Path) -> set[str]:
    if not path.is_file():
        return set()

    existing: set[str] = set()
    with path.open("r", encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, start=1):
            line = line.strip()
            if not line:
                continue
            try:
                payload = json.loads(line)
            except json.JSONDecodeError as exc:
                raise ValueError(f"{path}:{line_number}: invalid JSONL row: {exc}") from exc
            strong_number = normalize_strong(
                str(payload.get("strong_number") or payload.get("strongNumber") or "")
            )
            if strong_number is None:
                raise ValueError(f"{path}:{line_number}: invalid Strong number")
            existing.add(strong_number)
    return existing


def source_entry(entry: dict[str, str]) -> dict[str, str]:
    return {
        "strong_number": entry["strong_number"],
        "language": entry["language"],
        "lemma": entry["lemma"],
        "transliteration": entry["transliteration"],
        "pronunciation": entry["pronunciation"],
        "definition": entry["definition"],
        "derivation": entry["derivation"],
        "kjv_definition": entry["kjv_definition"],
    }


def response_schema() -> dict[str, object]:
    translation_item = {
        "type": "object",
        "additionalProperties": False,
        "required": ["strong_number", "definition", "derivation", "kjv_definition"],
        "properties": {
            "strong_number": {"type": "string", "pattern": "^[GH][0-9]+$"},
            "definition": {"type": "string"},
            "derivation": {"type": "string"},
            "kjv_definition": {"type": "string"},
        },
    }
    return {
        "type": "object",
        "additionalProperties": False,
        "required": ["translations"],
        "properties": {
            "translations": {
                "type": "array",
                "items": translation_item,
            }
        },
    }


def extract_response_text(payload: dict[str, object]) -> str:
    choices = payload.get("choices")
    if isinstance(choices, list) and choices and isinstance(choices[0], dict):
        message = choices[0].get("message")
        if isinstance(message, dict):
            content = message.get("content")
            if isinstance(content, str) and content.strip():
                return content.strip()
    raise RuntimeError("Chat completions response did not include message content")


def translate_batch(
    batch: list[dict[str, str]],
    api_key: str,
    model: str,
    timeout: int,
    base_url: str,
) -> list[dict[str, str]]:
    body: dict[str, object] = {
        "model": model,
        "messages": [
            {"role": "system", "content": INSTRUCTIONS},
            {
                "role": "user",
                "content": json.dumps(
                    {"entries": [source_entry(entry) for entry in batch]},
                    ensure_ascii=False,
                ),
            },
        ],
        "temperature": 0,
        "response_format": {
            "type": "json_schema",
            "json_schema": {
                "name": "strongs_es_batch",
                "strict": True,
                "schema": response_schema(),
            },
        },
    }
    if urllib.parse.urlparse(base_url).hostname == "openrouter.ai":
        # Route only to providers that honor response_format, so no provider
        # silently ignores the schema.
        body["provider"] = {"require_parameters": True}

    request = urllib.request.Request(
        f"{base_url.rstrip('/')}/chat/completions",
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            response_payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Translation request failed: HTTP {exc.code}: {detail}") from exc

    translated = json.loads(extract_response_text(response_payload))
    translations = translated.get("translations")
    if not isinstance(translations, list):
        raise RuntimeError("Response JSON must include translations array")
    return [item for item in translations if isinstance(item, dict)]


def normalize_translation(
    raw: dict[str, str],
    batch_by_strong: dict[str, dict[str, str]],
    source: str,
) -> dict[str, str]:
    strong_number = normalize_strong(str(raw.get("strong_number") or ""))
    if strong_number is None or strong_number not in batch_by_strong:
        raise ValueError(f"Unexpected translated Strong number: {raw.get('strong_number')}")

    definition = normalize_text(str(raw.get("definition") or ""))
    if not definition:
        raise ValueError(f"{strong_number}: translated definition is required")

    return {
        "strong_number": strong_number,
        "definition": definition,
        "derivation": normalize_text(str(raw.get("derivation") or "")),
        "kjv_definition": normalize_text(str(raw.get("kjv_definition") or "")),
        "translation_status": "machine",
        "source": source,
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Translate OpenScriptures Strong dictionaries to Spanish JSONL."
    )
    parser.add_argument("--output", type=pathlib.Path, default=DEFAULT_SPANISH_TRANSLATIONS)
    parser.add_argument("--greek-dictionary", default=DEFAULT_GREEK_DICTIONARY)
    parser.add_argument("--hebrew-dictionary", default=DEFAULT_HEBREW_DICTIONARY)
    parser.add_argument("--batch-size", type=int, default=25)
    parser.add_argument("--limit", type=int)
    parser.add_argument("--sleep", type=float, default=0.5)
    parser.add_argument("--timeout", type=int, default=120)
    parser.add_argument("--model", default=os.environ.get("OPENAI_MODEL"))
    parser.add_argument(
        "--base-url",
        default=os.environ.get("OPENAI_BASE_URL", DEFAULT_BASE_URL),
        help="OpenAI-compatible API base URL (e.g. https://openrouter.ai/api/v1)",
    )
    parser.add_argument("--dry-run", action="store_true")
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    if args.batch_size < 1 or args.batch_size > 100:
        print("--batch-size must be in 1..100", file=sys.stderr)
        return 1

    greek_entries = load_js_dictionary(args.greek_dictionary, "greek")
    hebrew_entries = load_js_dictionary(args.hebrew_dictionary, "hebrew")
    entries = sorted(
        {**greek_entries, **hebrew_entries}.values(),
        key=lambda item: item["strong_number"],
    )

    existing = load_existing(args.output)
    pending = [entry for entry in entries if entry["strong_number"] not in existing]
    if args.limit is not None:
        pending = pending[: args.limit]

    print(f"Total entries: {len(entries)}")
    print(f"Already translated: {len(existing)}")
    print(f"Pending this run: {len(pending)}")

    if args.dry_run:
        for entry in pending[: args.batch_size]:
            print(json.dumps(source_entry(entry), ensure_ascii=False))
        return 0

    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        print("OPENAI_API_KEY is required", file=sys.stderr)
        return 1
    if not args.model:
        print("OPENAI_MODEL or --model is required", file=sys.stderr)
        return 1

    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("a", encoding="utf-8") as handle:
        for batch in chunks(pending, args.batch_size):
            batch_by_strong = {entry["strong_number"]: entry for entry in batch}
            translated = translate_batch(batch, api_key, args.model, args.timeout, args.base_url)
            if len(translated) != len(batch):
                raise RuntimeError(
                    f"Expected {len(batch)} translations, got {len(translated)}"
                )

            host = urllib.parse.urlparse(args.base_url).hostname or "openai"
            source = f"{host}:{args.model}"
            for raw in translated:
                row = normalize_translation(raw, batch_by_strong, source)
                handle.write(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n")
            handle.flush()
            print(f"Wrote through {batch[-1]['strong_number']}")
            time.sleep(args.sleep)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
