"use client";

import { useEffect, useState } from "react";
import AddToolModal from "./add-tool-modal";
import type { DepartmentCatalog } from "./department-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { apiRequest, type AccessType, type Tool, type ToolCategory } from "@/lib/tools";

interface ToolCardProps {
  tool: Tool;
  categories: ToolCategory[];
  departmentCatalog: DepartmentCatalog;
  onRetryDepartments: () => void;
  onUpdated: (tool: Tool) => void;
  onDeleted: (id: string) => void;
}

const typeLabels: Record<AccessType, string> = {
  FREE: "Free",
  SUBSCRIPTION: "Subscription",
  LICENSED: "Licensed",
};

const typeStyles: Record<AccessType, string> = {
  FREE: "bg-emerald-50 text-emerald-700",
  SUBSCRIPTION: "bg-blue-50 text-blue-700",
  LICENSED: "bg-amber-50 text-amber-700",
};

function getSafeWebsiteUrl(value: string | null): string | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = new URL(value);

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }

    return parsed.toString();
  } catch {
    return null;
  }
}

export default function ToolCard({
  tool,
  categories,
  departmentCatalog,
  onRetryDepartments,
  onUpdated,
  onDeleted,
}: ToolCardProps) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [details, setDetails] = useState<Tool | null>(null);
  const [editing, setEditing] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!detailsOpen) return;
    const controller = new AbortController();
    void apiRequest<Tool>(`/api/v1/tools/${tool.id}`, {
      signal: controller.signal,
    })
      .then((value) => {
        if (!controller.signal.aborted) setDetails(value);
      })
      .catch((caught: unknown) => {
        if (!controller.signal.aborted)
          setError(
            caught instanceof Error
              ? caught.message
              : "Unable to load this tool.",
          );
      });
    return () => controller.abort();
  }, [detailsOpen, tool.id]);

  async function removeTool() {
    if (deleting || !details) return;
    setDeleting(true);
    setError(null);
    try {
      await apiRequest<void>(`/api/v1/tools/${details.id}`, {
        method: "DELETE",
      });
      setDeleteOpen(false);
      onDeleted(details.id);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Unable to delete this tool.",
      );
    } finally {
      setDeleting(false);
    }
  }

  const websiteUrl = getSafeWebsiteUrl(tool.websiteUrl);
  const detailsWebsite = getSafeWebsiteUrl(details?.websiteUrl ?? null);

  return (
    <>
      <article className="flex h-full flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-lg font-bold text-indigo-600">
              {tool.name.charAt(0).toUpperCase()}
            </div>

            <div className="min-w-0">
              <h2 className="truncate text-base font-semibold text-slate-900">
                {tool.name}
              </h2>

              <p className="mt-1 text-xs text-slate-500">
                {tool.category?.name ?? "Uncategorized"}
              </p>
            </div>
          </div>

          <span
            className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${typeStyles[tool.accessType]}`}
          >
            {typeLabels[tool.accessType]}
          </span>
        </div>

        {tool.tags.length > 0 && (
          <ul aria-label="Tags" className="mt-3 flex flex-wrap gap-1.5">
            {tool.tags.slice(0, 2).map(({ id, name }) => (
              <li key={id} className="min-w-0 max-w-full">
                <Badge variant="secondary" title={name} className="max-w-full">
                  <span className="truncate">{name}</span>
                </Badge>
              </li>
            ))}
            {tool.tags.length > 2 && (
              <li><Badge variant="outline">+{tool.tags.length - 2} more</Badge></li>
            )}
          </ul>
        )}

        <p className="mt-5 min-h-12 flex-1 text-sm leading-6 text-slate-600">
          {tool.description || "No description provided."}
        </p>

        <div className="mt-5 flex items-center justify-between gap-2 border-t border-slate-100 pt-4">
          {websiteUrl ? (
            <a
              href={websiteUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-sm font-medium text-indigo-600 hover:text-indigo-700 hover:underline"
            >
              Visit website
              <span aria-hidden="true">↗</span>
            </a>
          ) : (
            <span className="text-sm text-slate-400">No website added</span>
          )}
          <Button
            variant="outline"
            onClick={() => {
              setDetails(null);
              setError(null);
              setDetailsOpen(true);
            }}
          >
            Details
          </Button>
        </div>
      </article>

      <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{details?.name ?? "Tool details"}</DialogTitle>
            <DialogDescription>
              {details
                ? `${details.category.name} · ${typeLabels[details.accessType]}`
                : "View your saved tool."}
            </DialogDescription>
          </DialogHeader>
          {error ? (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          ) : !details ? (
            <p role="status">Loading tool...</p>
          ) : (
            <>
              <p className="whitespace-pre-wrap break-words">
                {details.description || "No description provided."}
              </p>
              {details.tags.length > 0 && (
                <div className="grid gap-2">
                  <h3 className="text-sm font-medium">Tags</h3>
                  <ul className="flex flex-wrap gap-1.5">
                    {details.tags.map(({ id, name }) => (
                      <li key={id} className="max-w-full">
                        <Badge variant="secondary" className="h-auto max-w-full whitespace-normal">
                          {name}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {detailsWebsite ? (
                <a
                  href={detailsWebsite}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="break-all text-indigo-600 underline"
                >
                  {detailsWebsite}
                </a>
              ) : (
                <p>No website added</p>
              )}
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => {
                    setDetailsOpen(false);
                    setEditing(true);
                  }}
                >
                  Edit
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => {
                    setDetailsOpen(false);
                    setError(null);
                    setDeleteOpen(true);
                  }}
                >
                  Delete
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {editing && details && (
        <AddToolModal
          categories={categories}
          departmentCatalog={departmentCatalog}
          onRetryDepartments={onRetryDepartments}
          tool={details}
          onClose={() => setEditing(false)}
          onSaved={(updated) => {
            setEditing(false);
            onUpdated(updated);
          }}
        />
      )}

      <Dialog
        open={deleteOpen}
        onOpenChange={(open) => {
          if (!deleting) setDeleteOpen(open);
        }}
      >
        <DialogContent showCloseButton={!deleting}>
          <DialogHeader>
            <DialogTitle>Delete tool?</DialogTitle>
            <DialogDescription>
              Delete “{details?.name}”? This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          {error && (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={deleting}
              onClick={() => setDeleteOpen(false)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deleting}
              onClick={removeTool}
            >
              {deleting ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
