// Zoom level thresholds and px/verse mapping from visibility-rules.md
//
// The thresholds align with the server's `timeline_zoom_levels` rows:
//   0.00 → 0.12 = Panorama (level 0)
//   0.12 → 0.28 = Eras     (level 1)
//   0.28 → 0.50 = Books    (level 2)
//   0.50 → 0.75 = Chapters (level 3)
//   0.75 → 1.00 = Verses   (level 4)
export const ZOOM_THRESHOLDS = [0.00, 0.12, 0.28, 0.50, 0.75, 1.00] as const;

// px/verse at each threshold boundary — piecewise-linear interpolation between
// them. Values picked so the minimum world width is comfortably wider than
// any reasonable viewport (31 102 × 0.10 ≈ 3 110 px at panorama), matching
// the design prototype's baseWidth=3600. That keeps the minimap indicator
// below "full width" at every zoom level and gives cards somewhere to spread
// when the packing algorithm fans them out at low zoom.
// Max verse value (280) exceeds cardWidth (260) + CARD_GAP (10), so at
// max zoom cards have a 20px natural gap — no cascade needed, no jump.
const ZOOM_PX = [0.10, 0.22, 0.60, 2.50, 20.0, 280.0] as const;

export function computePxPerVerse(zoomFactor: number): number {
  const z = Math.max(0, Math.min(1, zoomFactor));
  for (let i = 0; i < ZOOM_THRESHOLDS.length - 1; i++) {
    const lo = ZOOM_THRESHOLDS[i]!;
    const hi = ZOOM_THRESHOLDS[i + 1]!;
    if (z <= hi) {
      const t = (z - lo) / (hi - lo);
      return ZOOM_PX[i]! + t * (ZOOM_PX[i + 1]! - ZOOM_PX[i]!);
    }
  }
  return ZOOM_PX[ZOOM_PX.length - 1]!;
}

export function zoomFactorToLevel(z: number): number {
  for (let i = 0; i < ZOOM_THRESHOLDS.length - 1; i++) {
    if (z < ZOOM_THRESHOLDS[i + 1]!) return i;
  }
  return ZOOM_THRESHOLDS.length - 2;
}
