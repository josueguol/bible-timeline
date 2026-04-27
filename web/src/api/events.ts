import { apiFetch } from "./client.ts";
import type { EventDetailResponse } from "./types.ts";

const DEFAULT_TIMELINE_ID = "bible-history-hierarchy-seed";

export function fetchEventDetail(
  eventId: string,
  timelineId = DEFAULT_TIMELINE_ID,
  signal?: AbortSignal,
): Promise<EventDetailResponse> {
  return apiFetch<EventDetailResponse>(
    `/api/timelines/${encodeURIComponent(timelineId)}/events/${encodeURIComponent(eventId)}`,
    undefined,
    signal,
  );
}
