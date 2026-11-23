
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

export interface ToolTag {
  id: string;
  name: string;
  slug: string;
  kind: "DEPARTMENT" | "GENERAL";
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
  tags: ToolTag[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateToolInput {
  name: string;
  description?: string | null;
  websiteUrl?: string | null;
  accessType: AccessType;
  categoryId: string;
  tagIds?: string[];
}

export function filterTools(
  tools: Tool[],
  search: string,
  access: AccessFilter,
  categoryId: string,
  departmentIds: string[],
) {
  const term = search.trim().toLowerCase();
  const departments = new Set(departmentIds);
  return tools.filter(
    (tool) =>
      (!term ||
        tool.name.toLowerCase().includes(term) ||
        (tool.description ?? "").toLowerCase().includes(term)) &&
      (access === "ALL" || tool.accessType === access) &&
      (categoryId === "ALL" || tool.categoryId === categoryId) &&
      (departments.size === 0 || tool.tags.some(({ id }) => departments.has(id))),
  );
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
