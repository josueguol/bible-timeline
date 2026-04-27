#!/usr/bin/env python3

import argparse
import json
import pathlib
import sys


def load_json(path: pathlib.Path) -> object:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Resolve visible timeline events for a given zoom factor and focus."
    )
    parser.add_argument("hierarchy", type=pathlib.Path, help="Path to hierarchical timeline JSON")
    parser.add_argument("request", type=pathlib.Path, help="Path to viewport request JSON")
    parser.add_argument("--verse-order", type=pathlib.Path, help="Optional verse-order JSON")
    parser.add_argument("--output", type=pathlib.Path, help="Optional output JSON")
    return parser


def build_indexes(events: list[dict]) -> tuple[dict[str, dict], dict[str, str | None]]:
    by_id: dict[str, dict] = {}
    parents: dict[str, str | None] = {}

    def visit(event: dict) -> None:
        by_id[event["id"]] = event
        parents[event["id"]] = event["parentId"]
        for child in event.get("children", []):
            visit(child)

    for event in events:
        visit(event)
    return by_id, parents


def build_ref_indexes(verse_order: dict | None) -> tuple[dict[str, int], dict[int, str]]:
    if not isinstance(verse_order, dict):
        return {}, {}
    ref_to_sequence: dict[str, int] = {}
    sequence_to_ref: dict[int, str] = {}
    for verse in verse_order.get("verses", []):
        ref_to_sequence[verse["ref"]] = verse["sequence"]
        sequence_to_ref[verse["sequence"]] = verse["ref"]
    return ref_to_sequence, sequence_to_ref


def resolve_zoom_level(zoom_levels: list[dict], zoom_factor: float) -> dict:
    for zoom_level in zoom_levels:
        minimum = float(zoom_level["minZoomFactor"])
        maximum = float(zoom_level["maxZoomFactor"])
        if minimum <= zoom_factor < maximum:
            return zoom_level
    return zoom_levels[-1]


def resolve_focus_sequence(request: dict, by_id: dict[str, dict], ref_to_sequence: dict[str, int]) -> int:
    focus_sequence = request.get("focusSequence")
    focus_ref = request.get("focusRef")
    focus_event_id = request.get("focusEventId")

    if isinstance(focus_sequence, int):
        return focus_sequence
    if isinstance(focus_ref, str):
        if focus_ref not in ref_to_sequence:
            raise ValueError(f"focusRef not found in verse order: {focus_ref}")
        return ref_to_sequence[focus_ref]
    if isinstance(focus_event_id, str):
        if focus_event_id not in by_id:
            raise ValueError(f"focusEventId not found in hierarchy: {focus_event_id}")
        event = by_id[focus_event_id]
        return (event["startSequence"] + event["endSequence"]) // 2
    roots = [event for event in by_id.values() if event["parentId"] is None]
    first_root = min(roots, key=lambda item: item["sequence"])
    return first_root["startSequence"]


def find_focus_path(events: list[dict], focus_sequence: int, max_zoom_level: int) -> list[dict]:
    path: list[dict] = []
    current_events = sorted(events, key=lambda item: item["sequence"])

    while current_events:
        containing = [
            event
            for event in current_events
            if event["startSequence"] <= focus_sequence <= event["endSequence"]
        ]
        if containing:
            current = min(containing, key=lambda item: item["zoomLevel"])
        else:
            current = min(
                current_events,
                key=lambda item: abs(((item["startSequence"] + item["endSequence"]) // 2) - focus_sequence),
            )
        path.append(current)

        next_children = sorted(current.get("children", []), key=lambda item: item["sequence"])
        if not next_children:
            break
        next_zoom = next_children[0]["zoomLevel"]
        if next_zoom > max_zoom_level:
            break
        current_events = next_children

    return path


def build_visible_events(
    events: list[dict],
    focus_path_ids: set[str],
    focused_event_id: str,
    active_zoom_level: int,
    include_ancestors: bool,
) -> list[dict]:
    visible: list[dict] = []

    def visit(event: dict, path: list[str]) -> None:
        current_path = path + [event["id"]]
        on_focus_path = event["id"] in focus_path_ids
        expanded = on_focus_path and event["zoomLevel"] < active_zoom_level and bool(event.get("children"))
        if include_ancestors or not (event["id"] in focus_path_ids and event["id"] != focused_event_id and event["zoomLevel"] < active_zoom_level):
            visible.append(
                {
                    "id": event["id"],
                    "parentId": event["parentId"],
                    "zoomLevel": event["zoomLevel"],
                    "sequence": event["sequence"],
                    "title": event["title"],
                    "summary": event["summary"],
                    "startRef": event["startRef"],
                    "endRef": event["endRef"],
                    "startSequence": event["startSequence"],
                    "endSequence": event["endSequence"],
                    "importance": event["importance"],
                    "canonical": event["canonical"],
                    "state": "expanded" if expanded else "collapsed",
                    "isFocused": event["id"] == focused_event_id,
                    "isFocusAncestor": event["id"] in focus_path_ids and event["id"] != focused_event_id,
                    "path": current_path,
                }
            )
        if expanded:
            for child in sorted(event.get("children", []), key=lambda item: item["sequence"]):
                visit(child, current_path)

    for event in sorted(events, key=lambda item: item["sequence"]):
        visit(event, [])

    for index, event in enumerate(visible, start=1):
        event["displayOrder"] = index
    return visible


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    try:
        hierarchy = load_json(args.hierarchy)
        request = load_json(args.request)
        verse_order = load_json(args.verse_order) if args.verse_order else None
    except json.JSONDecodeError as exc:
        print(f"Invalid JSON: {exc}", file=sys.stderr)
        return 1
    except OSError as exc:
        print(str(exc), file=sys.stderr)
        return 1

    if not isinstance(hierarchy, dict) or not isinstance(request, dict):
        print("Hierarchy and request must be JSON objects", file=sys.stderr)
        return 1

    timeline_id = hierarchy["timelineId"]
    if request["timelineId"] != timeline_id:
        print(
            f"Request timelineId {request['timelineId']} does not match hierarchy timelineId {timeline_id}",
            file=sys.stderr,
        )
        return 1

    events = hierarchy["events"]
    by_id, _ = build_indexes(events)
    ref_to_sequence, sequence_to_ref = build_ref_indexes(verse_order if isinstance(verse_order, dict) else None)

    try:
        focus_sequence = resolve_focus_sequence(request, by_id, ref_to_sequence)
    except ValueError as exc:
        print(str(exc), file=sys.stderr)
        return 1

    zoom_level = resolve_zoom_level(hierarchy["navigation"]["zoomLevels"], float(request["zoomFactor"]))
    focus_path = find_focus_path(events, focus_sequence, zoom_level["level"])
    focus_path_ids = [event["id"] for event in focus_path]
    focused_event = focus_path[-1]

    viewport_event_budget = request.get("viewportEventBudget") or zoom_level["targetVisibleEvents"]
    include_ancestors = request.get("includeAncestors", True)
    visible_events = build_visible_events(
        events,
        set(focus_path_ids),
        focused_event["id"],
        zoom_level["level"],
        include_ancestors,
    )

    response = {
        "timelineId": timeline_id,
        "zoomLevel": zoom_level,
        "focus": {
            "requestedFocusSequence": request.get("focusSequence"),
            "requestedFocusRef": request.get("focusRef"),
            "requestedFocusEventId": request.get("focusEventId"),
            "resolvedFocusSequence": focus_sequence,
            "resolvedFocusRef": sequence_to_ref.get(focus_sequence),
            "focusedEventId": focused_event["id"],
            "focusPath": focus_path_ids,
        },
        "visibleEvents": visible_events,
        "stats": {
            "visibleCount": len(visible_events),
            "targetVisibleEvents": zoom_level["targetVisibleEvents"],
            "viewportEventBudget": viewport_event_budget,
        },
    }

    output = json.dumps(response, ensure_ascii=False, indent=2) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(output, encoding="utf-8")
    else:
        sys.stdout.write(output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
