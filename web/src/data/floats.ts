// Static float-card data. Each float is pinned to a verse sequence and lives
// below the axis in one of two lanes. When a float is linked to an event or
// verse (linkedTo / fulfilledBy), the UI can draw a discreet arrow between
// them.
//
// This is intentionally a client-side module for now. When the catalog grows
// past ~50 items it should move to a backend table + endpoint (the contract
// is already prefigured here).

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

// Sequence numbers below align to the rv60 manifest commit.
export const FLOATS: FloatCard[] = [
  {
    id: "ctx-creation",
    type: "context",
    sequence: 1,
    lane: 0,
    titleEs: "Contexto · Relato cosmogónico",
    titleEn: "Context · Cosmogonic Account",
    bodyEs: "Narración hebrea del origen del mundo en siete días. Estructura poética con paralelismos (días 1–3 formación, días 4–6 llenado).",
    bodyEn: "Hebrew account of the origin of the world across seven days. Poetic parallel structure (days 1–3 forming, days 4–6 filling).",
  },
  {
    id: "prof-gen315",
    type: "prophecy",
    sequence: 68,
    lane: 1,
    titleEs: "Profecía · Protoevangelio",
    titleEn: "Prophecy · Protoevangelium",
    bodyEs: "Primera mención mesiánica. Se cumplirá en la encarnación de Cristo (Mt 1:23, Gl 4:4).",
    bodyEn: "First messianic mention. Fulfilled in the incarnation of Christ (Mt 1:23, Gal 4:4).",
  },
  {
    id: "ppl-abraham",
    type: "people",
    sequence: 1400,
    lane: 0,
    titleEs: "Personaje · Abraham",
    titleEn: "People · Abraham",
    bodyEs: "Padre de la fe. Origen: Ur de los caldeos. Pacto eterno con descendencia innumerable.",
    bodyEn: "Father of faith. Origin: Ur of the Chaldees. Eternal covenant with countless descendants.",
  },
  {
    id: "map-exodus",
    type: "map",
    sequence: 2800,
    lane: 1,
    titleEs: "Mapa · Ruta del Éxodo",
    titleEn: "Map · Exodus Route",
    bodyEs: "De Ramsés en Egipto hacia el Monte Sinaí. ~40 años en el desierto antes de entrar en Canaán.",
    bodyEn: "From Rameses in Egypt toward Mount Sinai. ~40 years in the wilderness before entering Canaan.",
  },
  {
    id: "xref-law",
    type: "xref",
    sequence: 5800,
    lane: 0,
    titleEs: "Referencia cruzada · Ley y Sermón",
    titleEn: "Cross-ref · Law & Sermon",
    bodyEs: "La Ley del Sinaí y el Sermón del Monte: Jesús interpreta los mandamientos desde el corazón.",
    bodyEn: "The Law of Sinai and the Sermon on the Mount: Jesus interprets the commandments from the heart.",
  },
  {
    id: "note-psalms",
    type: "note",
    sequence: 14200,
    lane: 1,
    titleEs: "Nota · Poesía hebrea",
    titleEn: "Note · Hebrew Poetry",
    bodyEs: "Los Salmos usan paralelismo (sinonímico, antitético, sintético). Salmo 23 es pastoril; Dios como pastor.",
    bodyEn: "Psalms use parallelism (synonymous, antithetic, synthetic). Psalm 23 is pastoral; God as shepherd.",
  },
  {
    id: "prof-isa714",
    type: "prophecy",
    sequence: 17900,
    lane: 0,
    titleEs: "Profecía · Emanuel",
    titleEn: "Prophecy · Immanuel",
    bodyEs: "Anuncio del nacimiento virginal. Cumplimiento explícito 700 años después en Mateo 1:23.",
    bodyEn: "Announcement of the virgin birth. Explicit fulfillment 700 years later in Matthew 1:23.",
  },
  {
    id: "ctx-exile",
    type: "context",
    sequence: 19800,
    lane: 0,
    titleEs: "Contexto · Cautividad babilónica",
    titleEn: "Context · Babylonian Captivity",
    bodyEs: "Destrucción del templo en 586 a.C. por Nabucodonosor. 70 años en el exilio, profetizados por Jeremías.",
    bodyEn: "Destruction of the temple in 586 BCE by Nebuchadnezzar. 70 years of exile, prophesied by Jeremiah.",
  },
  {
    id: "ctx-silence",
    type: "context",
    sequence: 23200,
    lane: 1,
    titleEs: "Contexto · 400 años de silencio",
    titleEn: "Context · 400 Years of Silence",
    bodyEs: "Entre Malaquías y Mateo: ascenso de Grecia y Roma, helenización, surgimiento de fariseos y saduceos.",
    bodyEn: "Between Malachi and Matthew: rise of Greece and Rome, Hellenization, emergence of Pharisees and Sadducees.",
  },
  {
    id: "ppl-jesus",
    type: "people",
    sequence: 24200,
    lane: 0,
    titleEs: "Personaje · Jesús de Nazaret",
    titleEn: "People · Jesus of Nazareth",
    bodyEs: "Mesías anunciado. Ministerio público ~3 años en Galilea y Judea.",
    bodyEn: "Announced Messiah. Public ministry ~3 years in Galilee and Judea.",
  },
  {
    id: "map-journeys",
    type: "map",
    sequence: 27800,
    lane: 1,
    titleEs: "Mapa · Viajes de Pablo",
    titleEn: "Map · Paul's Journeys",
    bodyEs: "Tres viajes misioneros + viaje a Roma. Antioquía, Éfeso, Corinto, Tesalónica, Filipos.",
    bodyEn: "Three missionary journeys + voyage to Rome. Antioch, Ephesus, Corinth, Thessalonica, Philippi.",
  },
  {
    id: "note-apoc",
    type: "note",
    sequence: 30800,
    lane: 1,
    titleEs: "Nota · Género apocalíptico",
    titleEn: "Note · Apocalyptic Genre",
    bodyEs: "Visiones simbólicas, números con valor teológico (7, 12, 1000). Esperanza de la nueva creación.",
    bodyEn: "Symbolic visions, numbers with theological value (7, 12, 1000). Hope of a new creation.",
  },
];

export const FLOAT_STYLE: Record<FloatType, { labelEs: string; labelEn: string; glyph: string }> = {
  context:  { labelEs: "CONTEXTO",    labelEn: "CONTEXT",   glyph: "§" },
  prophecy: { labelEs: "PROFECÍA",    labelEn: "PROPHECY",  glyph: "✦" },
  xref:     { labelEs: "REF. CRUZ.",  labelEn: "CROSS-REF", glyph: "↯" },
  note:     { labelEs: "NOTA",        labelEn: "NOTE",      glyph: "¶" },
  map:      { labelEs: "MAPA",        labelEn: "MAP",       glyph: "◰" },
  people:   { labelEs: "PERSONAJE",   labelEn: "PEOPLE",    glyph: "☉" },
};
