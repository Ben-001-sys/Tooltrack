
"use client";

import {
  useState,
  type FormEvent,
} from "react";

import {
  apiRequest,
  type AccessType,
  type CreateToolInput,
  type Tool,
  type ToolCategory,
} from "@/lib/tools";

interface AddToolModalProps {
  categories: ToolCategory[];
  onClose: () => void;
  onCreated: (tool: Tool) => void;
}

const accessOptions: {
  value: AccessType;
  title: string;
  description: string;
}[] = [
  {
    value: "FREE",
    title: "Free Tool",
    description:
      "A tool you use without paying for access.",
  },
  {
    value: "SUBSCRIPTION",
    title: "Subscription",
    description:
      "A tool accessed through a recurring subscription.",
  },
  {
    value: "LICENSED",
    title: "Licensed Tool",
    description:
      "A tool accessed through a purchased license.",
  },
];

export default function AddToolModal({
  categories,
  onClose,
  onCreated,
}: AddToolModalProps) {
  const [step, setStep] = useState<1 | 2>(1);

  const [accessType, setAccessType] =
    useState<AccessType | null>(null);

  const [name, setName] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [description, setDescription] = useState("");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(
    null,
  );

  function selectAccessType(value: AccessType) {
    setAccessType(value);
    setStep(2);
    setError(null);
  }

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    if (saving) {
      return;
    }

    if (!accessType) {
      setError("Select a tool access type.");
      return;
    }

    const trimmedName = name.trim();
    const trimmedWebsite = websiteUrl.trim();
    const trimmedDescription = description.trim();

    if (!trimmedName) {
      setError("Enter the tool name.");
      return;
    }

    if (!categoryId) {
      setError("Select a category.");
      return;
    }

    if (trimmedWebsite) {
      try {
        const parsedUrl = new URL(trimmedWebsite);

        if (
          parsedUrl.protocol !== "http:" &&
          parsedUrl.protocol !== "https:"
        ) {
          throw new Error("Unsupported protocol.");
        }
      } catch {
        setError(
          "Enter a valid HTTP or HTTPS website URL.",
        );
        return;
      }
    }

    const payload: CreateToolInput = {
      name: trimmedName,
      categoryId,
      accessType,
    };

    if (trimmedDescription) {
      payload.description = trimmedDescription;
    }

    if (trimmedWebsite) {
      payload.websiteUrl = trimmedWebsite;
    }

    setSaving(true);
    setError(null);

    try {
      const createdTool = await apiRequest<Tool>(
        "/api/v1/tools",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        },
      );

      if (!createdTool.id) {
        throw new Error(
          "The API did not return the created tool ID.",
        );
      }

      onCreated(createdTool);
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to save the tool.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 px-4 py-8">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-tool-title"
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-xl sm:p-8"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-indigo-600">
              Step {step} of 2
            </p>

            <h2
              id="add-tool-title"
              className="mt-2 text-xl font-semibold text-slate-900"
            >
              {step === 1
                ? "What type of tool?"
                : "Add tool details"}
            </h2>

            <p className="mt-2 text-sm text-slate-500">
              {step === 1
                ? "Select how you access this software."
                : "Enter the information you want to track."}
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            aria-label="Close add tool dialog"
            className="rounded-lg px-2 text-2xl text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50"
          >
            ×
          </button>
        </div>

        {step === 1 ? (
          <div className="mt-7 space-y-3">
            {accessOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() =>
                  selectAccessType(option.value)
                }
                className="w-full rounded-xl border border-slate-200 p-4 text-left transition-colors hover:border-indigo-400 hover:bg-indigo-50"
              >
                <span className="block font-semibold text-slate-900">
                  {option.title}
                </span>

                <span className="mt-1 block text-sm leading-6 text-slate-500">
                  {option.description}
                </span>
              </button>
            ))}

            <button
              type="button"
              onClick={onClose}
              className="mt-2 w-full rounded-lg border border-slate-200 px-4 py-3 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              Cancel
            </button>
          </div>
        ) : (
          <form
            onSubmit={handleSubmit}
            className="mt-7 space-y-5"
          >
            <div>
              <label
                htmlFor="tool-name"
                className="mb-2 block text-sm font-medium text-slate-700"
              >
                Tool name
              </label>

              <input
                id="tool-name"
                required
                maxLength={120}
                value={name}
                onChange={(event) =>
                  setName(event.target.value)
                }
                placeholder="e.g. Figma"
                className="w-full rounded-lg border border-slate-300 px-3 py-3 text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
              />
            </div>

            <div>
              <label
                htmlFor="tool-category"
                className="mb-2 block text-sm font-medium text-slate-700"
              >
                Category
              </label>

              <select
                id="tool-category"
                required
                value={categoryId}
                onChange={(event) =>
                  setCategoryId(event.target.value)
                }
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-3 text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
              >
                <option value="">
                  Select a category
                </option>

                {categories.map((category) => (
                  <option
                    key={category.id}
                    value={category.id}
                  >
                    {category.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="tool-website"
                className="mb-2 block text-sm font-medium text-slate-700"
              >
                Website URL
                <span className="ml-2 font-normal text-slate-400">
                  Optional
                </span>
              </label>

              <input
                id="tool-website"
                type="url"
                maxLength={2048}
                value={websiteUrl}
                onChange={(event) =>
                  setWebsiteUrl(event.target.value)
                }
                placeholder="https://example.com"
                className="w-full rounded-lg border border-slate-300 px-3 py-3 text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
              />
            </div>

            <div>
              <label
                htmlFor="tool-description"
                className="mb-2 block text-sm font-medium text-slate-700"
              >
                Description
                <span className="ml-2 font-normal text-slate-400">
                  Optional
                </span>
              </label>

              <textarea
                id="tool-description"
                rows={3}
                maxLength={1500}
                value={description}
                onChange={(event) =>
                  setDescription(event.target.value)
                }
                placeholder="What do you use this tool for?"
                className="w-full resize-y rounded-lg border border-slate-300 px-3 py-3 text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
              />
            </div>

            {error && (
              <p
                role="alert"
                className="rounded-lg bg-red-50 p-3 text-sm text-red-700"
              >
                {error}
              </p>
            )}

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => setStep(1)}
                disabled={saving}
                className="flex-1 rounded-lg border border-slate-300 px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Back
              </button>

              <button
                type="submit"
                disabled={saving}
                className="flex-1 rounded-lg bg-indigo-600 px-4 py-3 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
              >
                {saving ? "Saving..." : "Save Tool"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}