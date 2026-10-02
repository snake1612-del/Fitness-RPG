export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(path, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      signal: controller.signal,
      ...(body === undefined
        ? {}
        : {
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }),
    });
    if (!response.ok) {
      const messages: Record<number, string> = {
        400: "Check the entered values.",
        401: "Please sign in again.",
        403: "This request is not allowed.",
        404: "This item is no longer available.",
        409: "The saved state has changed. Refresh to see the current result.",
        503: "The service is unavailable. Please try again.",
      };
      throw new ApiError(
        response.status,
        messages[response.status] ?? "Could not save this request.",
      );
    }
    return response.status === 204
      ? (undefined as T)
      : ((await response.json()) as T);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(
      0,
      "Connection interrupted. The request may have been saved. Refresh to check before retrying.",
    );
  } finally {
    clearTimeout(timeout);
  }
}
export type JsonDates<T> = T extends Date
  ? string
  : T extends (infer U)[]
    ? JsonDates<U>[]
    : T extends object
      ? { [K in keyof T]: JsonDates<T[K]> }
      : T;

// Persist the creation identity before sending. A reload or lost response reuses it.
export function draftIdentity(
  userId: string,
  sessionId: string,
  exerciseId: string,
): { key: string; id: string } {
  const key = `fitness-rpg:draft:${userId}:${sessionId}:${exerciseId}`;
  const previous = sessionStorage.getItem(key);
  const id = previous ?? crypto.randomUUID();
  sessionStorage.setItem(key, id);
  return { key, id };
}
