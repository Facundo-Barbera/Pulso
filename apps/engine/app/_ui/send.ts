/**
 * A write to `/api/web/*` from a client component: JSON in, JSON out. A
 * failure throws with the engine's message, ready for an error line.
 */
export async function send<T = unknown>(url: string, method: "POST" | "PUT" | "PATCH" | "DELETE", body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await response.json().catch(() => null)) as { message?: string } | null;
  if (!response.ok) throw new Error(data?.message ?? `La Mac respondió ${response.status}.`);
  return data as T;
}
