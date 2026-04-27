import { apiFetch } from "./client.ts";
import type { SearchResponse } from "./types.ts";

export function fetchSearch(query: string, signal?: AbortSignal): Promise<SearchResponse> {
  return apiFetch<SearchResponse>("/api/search", { q: query }, signal);
}
