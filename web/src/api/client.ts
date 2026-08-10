const BASE_URL = (import.meta.env["VITE_API_BASE"] as string | undefined) ?? window.location.origin;

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function apiFetch<T>(
  path: string,
  params?: Record<string, string | number | boolean | undefined>,
  signal?: AbortSignal,
): Promise<T> {
  const url = new URL(path, BASE_URL);

  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }
  }

  const res = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
    signal: signal ?? null,
  });

  if (!res.ok) {
    throw new ApiError(res.status, `${res.status} ${res.statusText} — ${path}`);
  }

  return res.json() as Promise<T>;
}
