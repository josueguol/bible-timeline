import { authStore } from "@store/auth-store.ts";

const NOTES_BASE = "/notes-api";

export class NotesApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "NotesApiError";
  }
}

export interface NoteDto {
  id: string;
  verseRef: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  sequence?: number;
}

export interface NoteListResponse {
  notes: NoteDto[];
}

export interface AuthTokenResponse {
  accessToken: string;
  refreshToken: string;
  user: { id: string; email: string; displayName: string };
}

// ── Auth API ──────────────────────────────────────────────────────────────────

export async function apiRegister(email: string, password: string): Promise<AuthTokenResponse> {
  return notesRequest<AuthTokenResponse>("/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, password }),
    skipAuth: true,
  });
}

export async function apiLogin(email: string, password: string): Promise<AuthTokenResponse> {
  return notesRequest<AuthTokenResponse>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
    skipAuth: true,
  });
}

export async function apiLoginGoogle(idToken: string): Promise<AuthTokenResponse> {
  return notesRequest<AuthTokenResponse>("/auth/google", {
    method: "POST",
    body: JSON.stringify({ idToken }),
    skipAuth: true,
  });
}

export async function apiLoginFacebook(accessToken: string): Promise<AuthTokenResponse> {
  return notesRequest<AuthTokenResponse>("/auth/facebook", {
    method: "POST",
    body: JSON.stringify({ accessToken }),
    skipAuth: true,
  });
}

export async function apiRefresh(refreshToken: string): Promise<AuthTokenResponse> {
  return notesRequest<AuthTokenResponse>("/auth/refresh", {
    method: "POST",
    body: JSON.stringify({ refreshToken }),
    skipAuth: true,
  });
}

export async function apiLogout(refreshToken: string): Promise<void> {
  await notesRequest<void>("/auth/logout", {
    method: "POST",
    body: JSON.stringify({ refreshToken }),
    skipAuth: true,
    expectEmpty: true,
  });
}

// ── Notes API ─────────────────────────────────────────────────────────────────

export async function fetchAllNotes(signal?: AbortSignal): Promise<NoteListResponse> {
  const opts: RequestOptions = {};
  if (signal) opts.signal = signal;
  return notesRequest<NoteListResponse>("/notes/all", opts);
}

export async function fetchNotes(verseRef: string, signal?: AbortSignal): Promise<NoteListResponse> {
  const encoded = encodeURIComponent(verseRef);
  const opts: RequestOptions = {};
  if (signal) opts.signal = signal;
  return notesRequest<NoteListResponse>(`/notes?verse_ref=${encoded}`, opts);
}

export async function createNote(verseRef: string, content: string): Promise<NoteDto> {
  return notesRequest<NoteDto>("/notes", {
    method: "POST",
    body: JSON.stringify({ verseRef, content }),
  });
}

export async function updateNote(id: string, content: string): Promise<NoteDto> {
  return notesRequest<NoteDto>(`/notes/${id}`, {
    method: "PUT",
    body: JSON.stringify({ content }),
  });
}

export async function deleteNote(id: string): Promise<void> {
  await notesRequest<void>(`/notes/${id}`, {
    method: "DELETE",
    expectEmpty: true,
  });
}

// ── Internal fetch with token refresh ────────────────────────────────────────

interface RequestOptions {
  method?: string;
  body?: string;
  signal?: AbortSignal;
  skipAuth?: boolean;
  expectEmpty?: boolean;
}

async function notesRequest<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, signal, skipAuth = false, expectEmpty = false } = opts;

  const headers: Record<string, string> = { "Content-Type": "application/json" };

  if (!skipAuth) {
    const token = await getValidAccessToken();
    if (!token) throw new NotesApiError(401, "not authenticated");
    headers["Authorization"] = `Bearer ${token}`;
  }

  const fetchInit: RequestInit = { method, headers };
  if (body !== undefined) fetchInit.body = body;
  if (signal !== undefined) fetchInit.signal = signal;

  const res = await fetch(`${NOTES_BASE}${path}`, fetchInit);

  if (!res.ok) {
    let message = `${res.status} ${path}`;
    try { const j = await res.json(); message = (j as { error?: string }).error ?? message; } catch { /* noop */ }
    throw new NotesApiError(res.status, message);
  }

  if (expectEmpty || res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export async function restoreAuthSession(): Promise<void> {
  if (authStore.isAuthenticated()) return;
  const stored = localStorage.getItem("notes_refresh_token");
  if (!stored) return;
  try {
    const resp = await apiRefresh(stored);
    localStorage.setItem("notes_refresh_token", resp.refreshToken);
    authStore.setTokens(resp.accessToken, resp.user);
  } catch {
    localStorage.removeItem("notes_refresh_token");
    authStore.clear();
  }
}

async function getValidAccessToken(): Promise<string | null> {
  const state = authStore.getState();
  if (state.accessToken) return state.accessToken;

  const stored = localStorage.getItem("notes_refresh_token");
  if (!stored) return null;

  try {
    const resp = await apiRefresh(stored);
    localStorage.setItem("notes_refresh_token", resp.refreshToken);
    authStore.setTokens(resp.accessToken, resp.user);
    return resp.accessToken;
  } catch {
    localStorage.removeItem("notes_refresh_token");
    authStore.clear();
    return null;
  }
}
