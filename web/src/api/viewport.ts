import { apiFetch } from "./client.ts";
import type { ViewportRequest, ViewportResponse } from "./types.ts";

const DEFAULT_TIMELINE_ID = "bible-history-hierarchy-seed";

export function fetchViewport(
  req: ViewportRequest,
  timelineId = DEFAULT_TIMELINE_ID,
  signal?: AbortSignal,
): Promise<ViewportResponse> {
  return apiFetch<ViewportResponse>(
    `/api/timelines/${encodeURIComponent(timelineId)}/viewport`,
    {
      zoomFactor: req.zoomFactor,
      focusSequence: req.focusSequence,
      focusRef: req.focusRef,
      focusEventId: req.focusEventId,
      viewportEventBudget: req.viewportEventBudget,
      includeAncestors: req.includeAncestors,
    },
    signal,
  );
}
