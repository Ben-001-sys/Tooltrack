
export type AccessType =
  | "FREE"
  | "SUBSCRIPTION"
  | "LICENSED";

export type AccessFilter =
  | "ALL"
  | AccessType;

export interface ToolCategory {
  id: string;
  name: string;
  slug: string;
}

export interface Tool {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  websiteUrl: string | null;
  accessType: AccessType;
  categoryId: string;
  category: ToolCategory;
  createdAt: string;
  updatedAt: string;
}

export interface CreateToolInput {
  name: string;
  description?: string | null;
  websiteUrl?: string | null;
  accessType: AccessType;
  categoryId: string;
}

export async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers);

  headers.set("Accept", "application/json");

  const response = await fetch(path, {
    ...options,
    headers,
    credentials: "same-origin",
    cache: "no-store",
  });

  if (!response.ok) {
    let message = `Request failed (HTTP ${response.status}).`;

    try {
      const body: unknown = await response.json();

      if (body && typeof body === "object") {
        const result = body as {
          message?: unknown;
          error?: unknown;
        };

        if (typeof result.message === "string") {
          message = result.message;
        } else if (Array.isArray(result.message)) {
          message = result.message.join(", ");
        } else if (typeof result.error === "string") {
          message = result.error;
        }
      }
    } catch {
      // Keep the default HTTP error message.
    }

    throw new Error(message);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}
