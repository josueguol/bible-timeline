// ── Types ─────────────────────────────────────────────────────────────────────

export type FloatType = "context" | "prophecy" | "xref" | "note" | "map" | "people";

export interface FloatCard {
  id: string;
  type: FloatType;
  sequence: number;
  lane: 0 | 1;
  titleEs: string;
  titleEn: string;
  bodyEs: string;
  bodyEn: string;
  linkedEventId:      string | null;
  fulfilledByEventId: string | null;
  published: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface FloatCardInput {
  type:               FloatType;
  sequence:           number;
  lane:               0 | 1;
  titleEs:            string;
  titleEn:            string;
  bodyEs:             string;
  bodyEn:             string;
  linkedEventId:      string | null;
  fulfilledByEventId: string | null;
  published:          boolean;
}

export interface UnfurlResult {
  url:         string;
  title:       string | null;
  description: string | null;
  imageUrl:    string | null;
  siteName:    string | null;
}

// ── Token storage ─────────────────────────────────────────────────────────────

const KEY_ACCESS  = "admin_access";
const KEY_REFRESH = "admin_refresh";

export function getAccessToken(): string | null  { return localStorage.getItem(KEY_ACCESS); }
export function getRefreshToken(): string | null { return localStorage.getItem(KEY_REFRESH); }

export function storeTokens(access: string, refresh: string): void {
  localStorage.setItem(KEY_ACCESS,  access);
  localStorage.setItem(KEY_REFRESH, refresh);
}

export function clearTokens(): void {
  localStorage.removeItem(KEY_ACCESS);
  localStorage.removeItem(KEY_REFRESH);
}

// ── Fetch helpers ─────────────────────────────────────────────────────────────

async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = getAccessToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(init.headers as Record<string, string> ?? {}),
  };
  return fetch(`/api${path}`, { ...init, headers });
}

async function apiJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await apiFetch(path, init);
  if (res.status === 401) { clearTokens(); window.location.reload(); }
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

// ── Auth ──────────────────────────────────────────────────────────────────────

export async function login(email: string, password: string): Promise<void> {
  const data = await apiJson<{ accessToken: string; refreshToken: string }>("/auth/login", {
    method: "POST",
    body:   JSON.stringify({ email, password }),
  });
  storeTokens(data.accessToken, data.refreshToken);
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  const res = await apiFetch("/auth/change-password", {
    method: "POST",
    body:   JSON.stringify({ currentPassword, newPassword }),
  });
  if (res.status === 401) { clearTokens(); window.location.reload(); }
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
}

export async function logout(): Promise<void> {
  const refresh = getRefreshToken();
  if (refresh) {
    try { await apiFetch("/auth/logout", { method: "POST", body: JSON.stringify({ refreshToken: refresh }) }); }
    catch { /* ignore */ }
  }
  clearTokens();
}

// ── Float cards ───────────────────────────────────────────────────────────────

export async function listFloats(): Promise<FloatCard[]> {
  const data = await apiJson<{ floats: FloatCard[] }>("/floats");
  return data.floats;
}

export async function getFloat(id: string): Promise<FloatCard> {
  return apiJson<FloatCard>(`/floats/${id}`);
}

export async function createFloat(inp: FloatCardInput): Promise<{ id: string }> {
  return apiJson<{ id: string }>("/floats", { method: "POST", body: JSON.stringify(inp) });
}

export async function updateFloat(id: string, inp: FloatCardInput): Promise<void> {
  await apiFetch(`/floats/${id}`, { method: "PUT", body: JSON.stringify(inp) });
}

export async function deleteFloat(id: string): Promise<void> {
  await apiFetch(`/floats/${id}`, { method: "DELETE" });
}

export async function publishFloat(id: string, pub: boolean): Promise<void> {
  await apiFetch(`/floats/${id}/${pub ? "publish" : "unpublish"}`, { method: "PATCH" });
}

// ── Unfurl ────────────────────────────────────────────────────────────────────

export async function unfurlUrl(url: string): Promise<UnfurlResult> {
  return apiJson<UnfurlResult>("/unfurl", { method: "POST", body: JSON.stringify({ url }) });
}
