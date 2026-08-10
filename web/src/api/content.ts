import type { FloatCard } from "../data/floats.ts";

interface FloatsResponse {
  floats: Array<{
    id: string;
    type: string;
    sequence: number;
    lane: number;
    titleEs: string;
    titleEn: string;
    bodyEs: string;
    bodyEn: string;
    linkedEventId: string | null;
    fulfilledByEventId: string | null;
  }>;
}

type RawCard = {
  id: string; type: string; sequence: number; lane: number;
  titleEs: string; titleEn: string; bodyEs: string; bodyEn: string;
  linkedEventId: string | null; fulfilledByEventId: string | null;
};

function mapCard(f: RawCard): FloatCard {
  const card: FloatCard = {
    id: f.id, type: f.type as FloatCard["type"],
    sequence: f.sequence, lane: (f.lane === 0 ? 0 : 1) as 0 | 1,
    titleEs: f.titleEs, titleEn: f.titleEn, bodyEs: f.bodyEs, bodyEn: f.bodyEn,
  };
  if (f.linkedEventId)      card.linkedEventId      = f.linkedEventId;
  if (f.fulfilledByEventId) card.fulfilledByEventId = f.fulfilledByEventId;
  return card;
}

const floatCache = new Map<string, FloatCard>();

export async function fetchFloat(id: string): Promise<FloatCard | null> {
  const cached = floatCache.get(id);
  if (cached) return cached;
  const res = await fetch(`/content-api/floats/${id}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`fetchFloat: ${res.status}`);
  const card = mapCard((await res.json()) as RawCard);
  floatCache.set(id, card);
  return card;
}

export async function fetchFloats(): Promise<FloatCard[]> {
  const res = await fetch("/content-api/floats");
  if (!res.ok) throw new Error(`fetchFloats: ${res.status}`);
  const data = (await res.json()) as FloatsResponse;
  return data.floats.map(mapCard);
}
