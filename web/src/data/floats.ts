// Cards are served by content-api (port 5082) — see src/api/content.ts.
// Types and style map live here so both float-cards.ts and content.ts share them.

export type FloatType =
  | "context"
  | "prophecy"
  | "xref"
  | "note"
  | "map"
  | "people";

export interface FloatCard {
  id: string;
  type: FloatType;
  /** Verse sequence (1..31102) where this float is anchored. */
  sequence: number;
  /** 0 or 1 — which horizontal lane under the axis. */
  lane: 0 | 1;
  titleEs: string;
  titleEn: string;
  bodyEs: string;
  bodyEn: string;
  linkedEventId?: string;
  fulfilledByEventId?: string;
}

export const FLOAT_STYLE: Record<FloatType, { labelEs: string; labelEn: string; glyph: string }> = {
  context:  { labelEs: "CONTEXTO",   labelEn: "CONTEXT",   glyph: "§" },
  prophecy: { labelEs: "PROFECÍA",   labelEn: "PROPHECY",  glyph: "✦" },
  xref:     { labelEs: "REF. CRUZ.", labelEn: "CROSS-REF", glyph: "↯" },
  note:     { labelEs: "NOTA",       labelEn: "NOTE",      glyph: "¶" },
  map:      { labelEs: "MAPA",       labelEn: "MAP",       glyph: "◰" },
  people:   { labelEs: "PERSONAJE",  labelEn: "PEOPLE",    glyph: "☉" },
};
