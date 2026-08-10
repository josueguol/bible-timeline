import { apiFetch } from "./client.ts";
import type { VersesRangeRequest, VersesRangeResponse, VersionsListResponse } from "./types.ts";

export function fetchVersions(signal?: AbortSignal): Promise<VersionsListResponse> {
  return apiFetch<VersionsListResponse>("/api/bible/versions", undefined, signal);
}

export function fetchVerses(
  req: VersesRangeRequest,
  signal?: AbortSignal,
): Promise<VersesRangeResponse> {
  return apiFetch<VersesRangeResponse>(
    "/api/bible/verses",
    {
      versions:       req.versions,
      fromRef:        req.fromRef,
      toRef:          req.toRef,
      fromSequence:   req.fromSequence,
      toSequence:     req.toSequence,
      manifestId:     req.manifestId,
      limit:          req.limit,
      includeStrong:  req.includeStrong,
      strongLang:     req.strongLang,
    },
    signal,
  );
}
