"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ToolTag } from "@/lib/tools";

export type DepartmentCatalog =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; departments: ToolTag[] };

export default function DepartmentPicker({
  label,
  catalog,
  onRetry,
  selectedIds,
  onChange,
  disabled,
}: {
  label: string;
  catalog: DepartmentCatalog;
  onRetry: () => void;
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
}) {
  const searchId = useId();
  const [search, setSearch] = useState("");
  const departments = catalog.status === "ready" ? catalog.departments : [];
  const options = departments.filter(({ name }) =>
    name.toLowerCase().includes(search.trim().toLowerCase()),
  );

  return (
    <details className="rounded-lg border border-slate-200">
      <summary className="cursor-pointer rounded-lg px-3 py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-indigo-600">
        {label}
        {selectedIds.length > 0 && (
          <span className="ml-2 text-xs text-slate-600">
            ({selectedIds.length} selected)
          </span>
        )}
      </summary>
      <fieldset disabled={disabled} className="grid gap-2 px-3 pb-3">
        <legend className="sr-only">{label}</legend>
        {catalog.status === "loading" ? (
          <p role="status" className="text-sm text-slate-600">
            Loading departments…
          </p>
        ) : catalog.status === "error" ? (
          <div className="flex flex-wrap items-center gap-2">
            <p role="alert" className="text-sm text-destructive">
              Unable to load departments.
            </p>
            <Button type="button" variant="outline" size="sm" onClick={onRetry}>
              Retry
            </Button>
          </div>
        ) : departments.length === 0 ? (
          <p className="text-sm text-slate-600">
            No departments are available.
          </p>
        ) : (
          <>
            <Label htmlFor={searchId} className="sr-only">
              Search departments
            </Label>
            <Input
              id={searchId}
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.preventDefault();
              }}
              placeholder="Search departments"
            />
            {options.length === 0 ? (
              <p role="status" className="text-sm text-slate-600">
                No matching departments.
              </p>
            ) : (
              <div className="grid max-h-44 gap-1 overflow-y-auto">
                {options.map(({ id, name }) => (
                  <label
                    key={id}
                    className="flex cursor-pointer items-start gap-2 rounded px-1 py-1 text-sm hover:bg-slate-50"
                  >
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(id)}
                      className="mt-0.5 size-4 shrink-0 accent-indigo-600"
                      onChange={(event) =>
                        onChange(
                          event.target.checked
                            ? [...selectedIds, id]
                            : selectedIds.filter((selected) => selected !== id),
                        )
                      }
                    />
                    {name}
                  </label>
                ))}
              </div>
            )}
          </>
        )}
        {selectedIds.length > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="w-fit"
            onClick={() => onChange([])}
          >
            Clear selection
          </Button>
        )}
      </fieldset>
    </details>
  );
}
