/**
 * Vertical de-collision for overlapping float cards.
 *
 * Cards are anchored to a verse `sequence` and split into two lanes, but their
 * screen X collapses together when zoomed out, so distinct-type cards land on
 * the same pixel and hide each other. This spreads any set of horizontally
 * overlapping cards (same lane) into a downward cascade so every header peeks.
 */

export interface CascadeItem {
  lane: 0 | 1;
  screenX: number;
}

/** Vertical pixels each stacked card is pushed down (header peek height). */
export const CASCADE_PEEK = 34;

/**
 * Returns a stack depth per item (0 = front of its group), parallel to `items`.
 *
 * Items whose screen rects overlap horizontally within the same lane form a
 * group; each successive card in a group is one level deeper. A gap wider than
 * `cardW` starts a fresh group. Callers derive both the vertical offset
 * (`depth * CASCADE_PEEK`) and the paint order (deeper = higher z-index, so
 * every card above it in the stack still shows its header). O(n²) over the
 * (<=30) displayed cards.
 */
export function cascadeDepths(items: CascadeItem[], cardW: number): number[] {
  const order = items.map((_, i) => i);
  order.sort((a, b) =>
    items[a]!.lane - items[b]!.lane || items[a]!.screenX - items[b]!.screenX,
  );

  const depths = new Array<number>(items.length).fill(0);
  let groupLane: 0 | 1 | null = null;
  let groupRight = -Infinity;
  let depth = 0;

  for (const i of order) {
    const it = items[i]!;
    const overlaps = it.lane === groupLane && it.screenX < groupRight;
    depth = overlaps ? depth + 1 : 0;
    depths[i] = depth;
    groupLane = it.lane;
    // Cards are centered on screenX (translateX(-50%)); the group extends while
    // the next card's center falls within one card-width of the previous.
    groupRight = it.screenX + cardW;
  }

  return depths;
}
