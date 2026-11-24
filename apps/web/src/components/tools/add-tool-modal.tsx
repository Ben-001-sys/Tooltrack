
"use client";

import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import DepartmentPicker, { type DepartmentCatalog } from "./department-picker";

import {
  apiRequest,
  type AccessType,
  type CreateToolInput,
  type Tool,
  type ToolCategory,
} from "@/lib/tools";

interface AddToolModalProps {
  categories: ToolCategory[];
  departmentCatalog: DepartmentCatalog;
  onRetryDepartments: () => void;
  tool?: Tool;
  collectionId?: string;
  onClose: () => void;
  onSaved: (tool: Tool) => void;
}

const accessOptions: {
  value: AccessType;
  title: string;
  description: string;
}[] = [
  {
    value: "FREE",
    title: "Free Tool",
    description: "Software available without payment.",
  },
  {
    value: "SUBSCRIPTION",
    title: "Subscription",
    description: "Software with recurring payments.",
  },
  {
    value: "LICENSED",
    title: "Licensed Tool",
    description: "Software with a purchased license.",
  },
];

export default function AddToolModal({
  categories,
  departmentCatalog,
  onRetryDepartments,
  tool,
  collectionId,
  onClose,
  onSaved,
}: AddToolModalProps) {
  const [step, setStep] = useState<1 | 2>(tool ? 2 : 1);
  const [accessType, setAccessType] =
    useState<AccessType | null>(tool?.accessType ?? null);

  const [name, setName] = useState(tool?.name ?? "");
  const [categoryId, setCategoryId] = useState(tool?.categoryId ?? "");
  const savedDepartments =
    tool?.tags.filter(({ kind }) => kind === "DEPARTMENT") ?? [];
  const [departmentIds, setDepartmentIds] = useState(() =>
    savedDepartments.map(({ id }) => id),
  );
  const [websiteUrl, setWebsiteUrl] = useState(tool?.websiteUrl ?? "");
  const [description, setDescription] = useState(tool?.description ?? "");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const categoryOptions = categories.map((category) => ({
    value: category.id,
    label: category.name,
  }));

  function chooseType(type: AccessType) {
    setAccessType(type);
    setError(null);
    setStep(2);
  }

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    if (saving) return;

    const trimmedName = name.trim();
    const trimmedWebsite = websiteUrl.trim();
    const trimmedDescription = description.trim();

    if (!accessType) {
      setError("Select an access type.");
      return;
    }

    if (!trimmedName) {
      setError("Enter a tool name.");
      return;
    }

    if (!categoryId) {
      setError("Select a category.");
      return;
    }

    if (trimmedWebsite) {
      try {
        const url = new URL(trimmedWebsite);

        if (
          url.protocol !== "http:" &&
          url.protocol !== "https:"
        ) {
          throw new Error("Invalid protocol.");
        }
      } catch {
        setError("Enter a valid HTTP or HTTPS website URL.");
        return;
      }
    }

    const payload: CreateToolInput = {
      name: trimmedName,
      accessType,
      categoryId,
    };

    if (
      departmentIds.length !== savedDepartments.length ||
      savedDepartments.some(({ id }) => !departmentIds.includes(id))
    ) {
      const otherTags =
        tool?.tags.filter(({ kind }) => kind !== "DEPARTMENT") ?? [];
      payload.tagIds = [...departmentIds, ...otherTags.map(({ id }) => id)];
    }

    if (trimmedDescription || tool) {
      payload.description = trimmedDescription || null;
    }

    if (trimmedWebsite || tool) {
      payload.websiteUrl = trimmedWebsite || null;
    }

    setSaving(true);
    setError(null);

    try {
      const saved = await apiRequest<Tool>(
        collectionId
          ? `/api/v1/collections/${collectionId}/owned-tools${tool ? `/${tool.id}` : ""}`
          : tool ? `/api/v1/tools/${tool.id}` : "/api/v1/tools",
        {
          method: tool ? "PATCH" : "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        },
      );

      if (!saved.id) {
        throw new Error(
          "The server did not return a tool ID.",
        );
      }

      onSaved(saved);
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
    <Dialog
      open={true}
      onOpenChange={(open) => {
        if (!open && !saving) {
          onClose();
        }
      }}
    >
      <DialogContent
        showCloseButton={!saving}
        className="max-h-[90vh] overflow-y-auto sm:max-w-lg"
      >
        <DialogHeader>
          {!tool && (
            <p className="text-xs text-muted-foreground">Step {step} of 2</p>
          )}

          <DialogTitle>
            {tool ? "Edit tool" : step === 1 ? "What type of tool?" : "Add tool details"}
          </DialogTitle>

          <DialogDescription>
            {step === 1
              ? "Choose how you access this software."
              : collectionId ? "This tool belongs to the collection and follows its permissions." : "Enter the information about your tool."}
          </DialogDescription>
        </DialogHeader>

        {step === 1 ? (
          <div className="grid gap-3">
            {accessOptions.map((option) => (
              <Button
                key={option.value}
                type="button"
                variant="outline"
                className="h-auto w-full flex-col items-start gap-1 whitespace-normal p-4 text-left"
                onClick={() => chooseType(option.value)}
              >
                <span className="font-semibold">
                  {option.title}
                </span>

                <span className="text-xs font-normal text-muted-foreground">
                  {option.description}
                </span>
              </Button>
            ))}

            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={onClose}
              >
                Cancel
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form
            onSubmit={handleSubmit}
            className="grid gap-4"
          >
            {tool && (
              <div className="grid gap-2">
                <Label htmlFor="tool-access">Access type</Label>
                <Select
                  items={accessOptions.map((option) => ({
                    value: option.value,
                    label: option.title,
                  }))}
                  value={accessType}
                  onValueChange={setAccessType}
                  disabled={saving}
                >
                  <SelectTrigger id="tool-access" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {accessOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="grid gap-2">
              <Label htmlFor="tool-name">
                Tool name
              </Label>

              <Input
                id="tool-name"
                disabled={saving}
                required
                maxLength={120}
                value={name}
                onChange={(event) =>
                  setName(event.target.value)
                }
                placeholder="e.g. Figma"
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="tool-category">
                Category
              </Label>

              <Select
                items={categoryOptions}
                value={categoryId || null}
                onValueChange={(value) =>
                  setCategoryId(value ?? "")
                }
                disabled={saving}
              >
                <SelectTrigger
                  id="tool-category"
                  className="w-full"
                  aria-required="true"
                >
                  <SelectValue placeholder="Select a category" />
                </SelectTrigger>

                <SelectContent>
                  {categoryOptions.map((category) => (
                    <SelectItem
                      key={category.value}
                      value={category.value}
                    >
                      {category.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <DepartmentPicker
              label="Department Tags (optional)"
              catalog={departmentCatalog}
              onRetry={onRetryDepartments}
              selectedIds={departmentIds}
              onChange={setDepartmentIds}
              disabled={saving}
            />

            <div className="grid gap-2">
              <Label htmlFor="tool-website">
                Website URL (optional)
              </Label>

              <Input
                id="tool-website"
                disabled={saving}
                type="url"
                maxLength={2048}
                value={websiteUrl}
                onChange={(event) =>
                  setWebsiteUrl(event.target.value)
                }
                placeholder="https://example.com"
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="tool-description">
                Description (optional)
              </Label>

              <Textarea
                id="tool-description"
                disabled={saving}
                rows={3}
                maxLength={1500}
                value={description}
                onChange={(event) =>
                  setDescription(event.target.value)
                }
                placeholder="What do you use this tool for?"
              />
            </div>

            {error && (
              <p
                role="alert"
                className="text-sm text-destructive"
              >
                {error}
              </p>
            )}

            <DialogFooter className="gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={saving}
                onClick={tool ? onClose : () => setStep(1)}
              >
                {tool ? "Cancel" : "Back"}
              </Button>

              <Button type="submit" disabled={saving}>
                {saving ? "Saving..." : tool ? "Save changes" : "Save Tool"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
