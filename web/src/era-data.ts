export interface EraData {
  id: string;
  nameEs: string;
  nameEn: string;
  start: number;  // normalized [0,1] within total Bible sequence
  end: number;
  color: string;  // oklch
  approxDate: string;
}

// Proportional positions based on RV60 verse distribution (~31102 verses)
export const ERAS: EraData[] = [
  {
    id: "creation",
    nameEs: "Creación y Patriarcas",
    nameEn: "Creation & Patriarchs",
    start: 0,
    end: 0.188,
    color: "oklch(0.72 0.16 145)",
    approxDate: "~4000-1800 a.C.",
  },
  {
    id: "exodus",
    nameEs: "Éxodo y Ley",
    nameEn: "Exodus & Law",
    start: 0.188,
    end: 0.270,
    color: "oklch(0.72 0.18 60)",
    approxDate: "~1800-1200 a.C.",
  },
  {
    id: "conquest",
    nameEs: "Conquista y Jueces",
    nameEn: "Conquest & Judges",
    start: 0.270,
    end: 0.350,
    color: "oklch(0.72 0.15 200)",
    approxDate: "~1200-1050 a.C.",
  },
  {
    id: "monarchy",
    nameEs: "Monarquía",
    nameEn: "Monarchy",
    start: 0.350,
    end: 0.510,
    color: "oklch(0.72 0.18 285)",
    approxDate: "~1050-586 a.C.",
  },
  {
    id: "wisdom",
    nameEs: "Sabiduría y Profetas",
    nameEn: "Wisdom & Prophets",
    start: 0.510,
    end: 0.745,
    color: "oklch(0.72 0.16 320)",
    approxDate: "~1000-400 a.C.",
  },
  {
    id: "gospels",
    nameEs: "Evangelios",
    nameEn: "Gospels",
    start: 0.745,
    end: 0.867,
    color: "oklch(0.72 0.18 85)",
    approxDate: "~4 a.C.-30 d.C.",
  },
  {
    id: "church",
    nameEs: "Iglesia Primitiva",
    nameEn: "Early Church",
    start: 0.867,
    end: 0.987,
    color: "oklch(0.72 0.16 195)",
    approxDate: "~30-70 d.C.",
  },
  {
    id: "revelation",
    nameEs: "Apocalipsis",
    nameEn: "Revelation",
    start: 0.987,
    end: 1.0,
    color: "oklch(0.72 0.18 10)",
    approxDate: "~95 d.C.",
  },
];

export function eraForSeq(seq: number, total: number): EraData {
  const pos = (seq - 1) / total;
  return ERAS.find((e) => pos >= e.start && pos < e.end) ?? ERAS[0]!;
}
