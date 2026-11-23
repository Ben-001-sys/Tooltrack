"use client";

import { useEffect, useState } from "react";

import { useRouter } from "next/navigation";
import Link from "next/link";

import AddToolModal from "@/components/tools/add-tool-modal";
import DepartmentPicker, {
  type DepartmentCatalog,
} from "@/components/tools/department-picker";
import ToolCard from "@/components/tools/tool-card";
import { authClient } from "@/lib/auth-client";

import {
  apiRequest,
  filterTools,
  type AccessFilter,
  type Tool,
  type ToolCategory,
  type ToolTag,
} from "@/lib/tools";

const accessFilters: {
  label: string;
  value: AccessFilter;
}[] = [
  {
    label: "All Tools",
    value: "ALL",
  },
  {
    label: "Free Tools",
    value: "FREE",
  },
  {
    label: "Subscriptions",
    value: "SUBSCRIPTION",
  },
  {
    label: "Licensed Tools",
    value: "LICENSED",
  },
];

export default function ToolsPage() {
  const router = useRouter();

  const {
    data: session,
    isPending: sessionPending,
    error: sessionError,
    refetch,
  } = authClient.useSession();

  const userId = session?.user.id;

  const [tools, setTools] = useState<Tool[]>([]);
  const [categories, setCategories] = useState<ToolCategory[]>([]);
  const [departmentCatalog, setDepartmentCatalog] = useState<DepartmentCatalog>({
    status: "loading",
  });
  const [departmentReload, setDepartmentReload] = useState(0);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [actionError, setActionError] = useState<string | null>(null);

  const [signingOut, setSigningOut] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);

  const [search, setSearch] = useState("");
  const [accessFilter, setAccessFilter] = useState<AccessFilter>("ALL");

  const [categoryFilter, setCategoryFilter] = useState("ALL");
  const [departmentFilter, setDepartmentFilter] = useState<string[]>([]);

  const [reloadKey, setReloadKey] = useState(0);

  function refreshTools() {
    setLoading(true);
    setLoadError(null);
    setReloadKey((current) => current + 1);
  }

  function retryDepartments() {
    setDepartmentCatalog({ status: "loading" });
    setDepartmentReload((current) => current + 1);
  }

  useEffect(() => {
    if (!sessionPending && !userId && !sessionError) {
      router.replace("/login");
    }
  }, [sessionPending, userId, sessionError, router]);

  useEffect(() => {
    if (!userId) {
      return;
    }

    const controller = new AbortController();

    void Promise.all([
      apiRequest<ToolCategory[]>("/api/v1/categories", {
        signal: controller.signal,
      }),
      apiRequest<Tool[]>("/api/v1/tools", {
        signal: controller.signal,
      }),
    ])
      .then(([loadedCategories, loadedTools]) => {
        if (controller.signal.aborted) {
          return;
        }

        if (!Array.isArray(loadedCategories) || !Array.isArray(loadedTools)) {
          throw new Error("The API returned an unexpected response.");
        }

        setCategories(loadedCategories);
        setTools(loadedTools);
        setLoadError(null);
      })
      .catch((caughtError: unknown) => {
        if (controller.signal.aborted) {
          return;
        }

        setLoadError(
          caughtError instanceof Error
            ? caughtError.message
            : "Unable to load your tools.",
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });

    return () => {
      controller.abort();
    };
  }, [userId, reloadKey]);

  useEffect(() => {
    if (!userId) return;
    const controller = new AbortController();
    void apiRequest<ToolTag[]>("/api/v1/tags", { signal: controller.signal })
      .then((tags) => {
        if (!controller.signal.aborted) {
          setDepartmentCatalog({
            status: "ready",
            departments: tags.filter(({ kind }) => kind === "DEPARTMENT"),
          });
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setDepartmentCatalog({ status: "error" });
      });
    return () => controller.abort();
  }, [userId, departmentReload]);

  async function handleSignOut() {
    setSigningOut(true);
    setActionError(null);

    try {
      const result = await authClient.signOut();

      if (result.error) {
        throw new Error(result.error.message ?? "Unable to sign out.");
      }

      setTools([]);
      setCategories([]);

      router.replace("/login");
      router.refresh();
    } catch (caughtError) {
      setActionError(
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to sign out.",
      );

      setSigningOut(false);
    }
  }

  function handleCreated(tool: Tool) {
    setTools((current) => [
      tool,
      ...current.filter((existing) => existing.id !== tool.id),
    ]);

    setShowAddModal(false);
  }

  const filteredTools = filterTools(
    tools,
    search,
    accessFilter,
    categoryFilter,
    departmentFilter,
  );

  if (sessionPending) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50">
        <p role="status" className="text-sm text-slate-600">
          Checking authentication...
        </p>
      </main>
    );
  }

  if (sessionError) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8">
          <h1 className="text-xl font-semibold text-slate-900">
            Unable to verify your session
          </h1>

          <p role="alert" className="mt-3 text-sm text-red-600">
            {sessionError.message}
          </p>

          <button
            type="button"
            onClick={() => {
              void refetch();
            }}
            className="mt-5 rounded-lg bg-indigo-600 px-4 py-3 text-white hover:bg-indigo-700"
          >
            Try again
          </button>
        </section>
      </main>
    );
  }

  if (!session) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50">
        <p role="status" className="text-sm text-slate-600">
          Redirecting to login...
        </p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-5 sm:px-6 lg:px-8">
          <div>
            <p className="text-xl font-bold tracking-tight text-indigo-600">
              ToolTrack
            </p>

            <p className="text-xs text-slate-500">Software Tool Manager</p>
          </div>

          <div className="flex items-center gap-3">
            <Link href="/collections" className="text-sm font-medium text-indigo-600 hover:underline">Collections</Link>
            <span className="hidden max-w-48 truncate text-sm text-slate-600 sm:block">
              {session.user.name}
            </span>

            <button
              type="button"
              onClick={handleSignOut}
              disabled={signingOut}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              {signingOut ? "Signing out..." : "Sign out"}
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-center">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-slate-900">
              My Tools
            </h1>

            <p className="mt-2 text-sm text-slate-500">
              Organize and manage your software tools in one place.
            </p>
          </div>

          <button
            type="button"
            onClick={() => setShowAddModal(true)}
            disabled={loading || categories.length === 0}
            className="rounded-lg bg-indigo-600 px-5 py-3 text-sm font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            + Add Tool
          </button>
        </div>

        {actionError && (
          <p
            role="alert"
            className="mt-6 rounded-lg bg-red-50 p-4 text-sm text-red-700"
          >
            {actionError}
          </p>
        )}

        <section
          aria-label="Tool filters"
          className="mt-8 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
        >
          <div className="flex flex-wrap gap-2">
            {accessFilters.map((filter) => (
              <button
                key={filter.value}
                type="button"
                onClick={() => setAccessFilter(filter.value)}
                aria-pressed={accessFilter === filter.value}
                className={
                  accessFilter === filter.value
                    ? "rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white"
                    : "rounded-lg bg-slate-100 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-200"
                }
              >
                {filter.label}
              </button>
            ))}
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-[1fr_240px]">
            <div>
              <label htmlFor="tool-search" className="sr-only">
                Search tools
              </label>

              <input
                id="tool-search"
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search tools..."
                className="w-full rounded-lg border border-slate-300 px-4 py-3 text-sm text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
              />
            </div>

            <div>
              <label htmlFor="category-filter" className="sr-only">
                Filter by category
              </label>

              <select
                id="category-filter"
                value={categoryFilter}
                onChange={(event) => setCategoryFilter(event.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
              >
                <option value="ALL">All Categories</option>

                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="mt-3">
            <DepartmentPicker
              label="Filter by department"
              catalog={departmentCatalog}
              onRetry={retryDepartments}
              selectedIds={departmentFilter}
              onChange={setDepartmentFilter}
            />
          </div>
        </section>

        <section aria-label="Saved software tools" className="mt-8">
          {loading ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-12 text-center">
              <p role="status" className="text-sm text-slate-500">
                Loading your tools...
              </p>
            </div>
          ) : loadError ? (
            <div className="rounded-2xl border border-red-200 bg-white p-10 text-center">
              <h2 className="font-semibold text-slate-900">
                Unable to load tools
              </h2>

              <p role="alert" className="mt-2 text-sm text-red-600">
                {loadError}
              </p>

              <button
                type="button"
                onClick={refreshTools}
                className="mt-5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
              >
                Try again
              </button>
            </div>
          ) : (
            <>
              <div className="mb-5 flex items-center justify-between gap-3">
                <p className="text-sm text-slate-600">
                  Showing <strong>{filteredTools.length}</strong> of{" "}
                  <strong>{tools.length}</strong> loaded tools
                </p>

                <button
                  type="button"
                  onClick={refreshTools}
                  className="text-sm font-medium text-indigo-600 hover:underline"
                >
                  Refresh
                </button>
              </div>

              {filteredTools.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-5 py-16 text-center">
                  <h2 className="text-lg font-semibold text-slate-900">
                    {tools.length === 0 ? "No tools yet" : "No matching tools"}
                  </h2>

                  <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">
                    {tools.length === 0
                      ? "Add your first software tool to start building your collection."
                      : "Try changing your search or filters."}
                  </p>

                  {tools.length === 0 && (
                    <button
                      type="button"
                      onClick={() => setShowAddModal(true)}
                      disabled={categories.length === 0}
                      className="mt-6 rounded-lg bg-indigo-600 px-5 py-3 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                    >
                      Add your first tool
                    </button>
                  )}
                </div>
              ) : (
                <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
                  {filteredTools.map((tool) => (
                    <ToolCard
                      key={tool.id}
                      tool={tool}
                      categories={categories}
                      departmentCatalog={departmentCatalog}
                      onRetryDepartments={retryDepartments}
                      onUpdated={(updated) => setTools((current) =>
                        current.map((item) => item.id === updated.id ? updated : item)
                      )}
                      onDeleted={(id) => setTools((current) =>
                        current.filter((item) => item.id !== id)
                      )}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </section>
      </div>

      {showAddModal && (
        <AddToolModal
          categories={categories}
          departmentCatalog={departmentCatalog}
          onRetryDepartments={retryDepartments}
          onClose={() => setShowAddModal(false)}
          onSaved={handleCreated}
        />
      )}
    </main>
  );
}
