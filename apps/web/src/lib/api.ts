const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000/api/v1";
type ApiError = { message?: string | string[] };
export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, { ...init, credentials: "include", headers: { "Content-Type": "application/json", ...(init.headers ?? {}) } });
  const body = await response.json().catch(() => ({})) as T & ApiError;
  if (!response.ok) { const message = body.message; throw new Error(Array.isArray(message) ? message.join(", ") : message ?? "Request failed"); }
  return body;
}
