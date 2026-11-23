"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Globe, Lock } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { apiRequest, type Tool } from "@/lib/tools";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";

const visibilityLabels = { PRIVATE: "Private", PUBLIC: "Public" } as const;
const visibilityDescriptions = {
  PRIVATE: "Only you can access this collection.",
  PUBLIC:
    "Every signed-in ToolTrack user can view, edit, add or remove tools, and delete this collection.",
} as const;
type Visibility = keyof typeof visibilityLabels;
type LinkedTool = Pick<Tool, "id" | "name" | "websiteUrl" | "accessType"> & {
  category: Pick<Tool["category"], "name">;
};

interface Collection {
  id: string;
  name: string;
  description: string | null;
  visibility: Visibility;
  isOwner: boolean;
  toolCount?: number;
}

function VisibilityIndicator({ visibility }: { visibility: Visibility }) {
  const Icon = visibility === "PUBLIC" ? Globe : Lock;
  return (
    <span className="inline-flex shrink-0 items-center gap-1 text-xs text-slate-600">
      <Icon aria-hidden="true" className="size-4" />
      {visibilityLabels[visibility]}
    </span>
  );
}

export function CollectionsView({ explore = false }: { explore?: boolean }) {
  const router = useRouter();
  const {
    data: session,
    isPending,
    error: sessionError,
  } = authClient.useSession();
  const userId = session?.user.id;

  useEffect(() => {
    if (!isPending && !userId && !sessionError) router.replace("/login");
  }, [isPending, userId, sessionError, router]);

  if (sessionError)
    return (
      <p role="alert" className="p-8">
        Unable to verify your session. <Link href="/login">Sign in again</Link>.
      </p>
    );
  if (isPending || !userId)
    return (
      <p role="status" className="p-8">
        Checking authentication...
      </p>
    );

  return <CollectionWorkspace key={userId} explore={explore} />;
}

function CollectionWorkspace({ explore }: { explore: boolean }) {
  const listPath = explore
    ? "/api/v1/public-collections"
    : "/api/v1/collections";
  const [collections, setCollections] = useState<Collection[]>([]);
  const [tools, setTools] = useState<Tool[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [linked, setLinked] = useState<LinkedTool[] | null>(null);
  const [toolId, setToolId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"create" | "edit" | "delete" | null>(
    null,
  );
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<Visibility>("PRIVATE");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const selected = collections.find(
    (collection) => collection.id === selectedId,
  );
  const canSetVisibility = dialog === "create" || selected?.isOwner === true;
  const available = tools.filter(
    (tool) => !linked?.some((item) => item.id === tool.id),
  );

  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([
      apiRequest<Collection[]>(listPath, {
        signal: controller.signal,
      }),
      apiRequest<Tool[]>("/api/v1/tools", { signal: controller.signal }),
    ])
      .then(([items, savedTools]) => {
        if (!controller.signal.aborted) {
          setCollections(items);
          setTools(savedTools);
        }
      })
      .catch((caught: unknown) => {
        if (!controller.signal.aborted)
          setError(
            caught instanceof Error
              ? caught.message
              : "Unable to load collections.",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [listPath, reload]);

  useEffect(() => {
    if (!selectedId) return;
    const controller = new AbortController();
    void Promise.all([
      apiRequest<Collection>(listPath + "/" + selectedId, {
        signal: controller.signal,
      }),
      apiRequest<LinkedTool[]>(listPath + "/" + selectedId + "/tools", {
        signal: controller.signal,
      }),
    ])
      .then(([collection, items]) => {
        if (!controller.signal.aborted) {
          setCollections((current) =>
            current.map((item) =>
              item.id === collection.id
                ? {
                    ...collection,
                    toolCount: explore ? items.length : undefined,
                  }
                : item,
            ),
          );
          setLinked(items);
        }
      })
      .catch((caught: unknown) => {
        if (!controller.signal.aborted) {
          setSelectedId(null);
          setLinked(null);
          setToolId(null);
          setError(
            caught instanceof Error
              ? caught.message
              : "Unable to load collection tools.",
          );
        }
      });
    return () => controller.abort();
  }, [listPath, explore, selectedId, reload]);

  function select(id: string) {
    setSelectedId(id);
    setLinked(null);
    setToolId(null);
    setError(null);
  }

  function openForm(edit: boolean) {
    setName(edit ? (selected?.name ?? "") : "");
    setDescription(edit ? (selected?.description ?? "") : "");
    setVisibility(edit ? (selected?.visibility ?? "PRIVATE") : "PRIVATE");
    setError(null);
    setDialog(edit ? "edit" : "create");
  }

  async function act(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Unable to save changes.",
      );
    } finally {
      setBusy(false);
    }
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const sendVisibility =
      dialog === "create" ||
      (canSetVisibility && visibility !== selected?.visibility);
    void act(async () => {
      const collection = await apiRequest<Collection>(
        dialog === "edit"
          ? `/api/v1/collections/${selectedId}`
          : "/api/v1/collections",
        {
          method: dialog === "edit" ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name,
            description: description.trim() || null,
            ...(sendVisibility ? { visibility } : {}),
          }),
        },
      );
      if (explore && collection.visibility === "PRIVATE") {
        setCollections((current) =>
          current.filter((item) => item.id !== collection.id),
        );
        setSelectedId(null);
        setLinked(null);
        setToolId(null);
      } else if (dialog === "create") {
        setCollections((current) => [collection, ...current]);
        select(collection.id);
      } else {
        setCollections((current) =>
          current.map((item) =>
            item.id === collection.id ? { ...item, ...collection } : item,
          ),
        );
        if (collection.visibility !== selected?.visibility) setLinked(null);
      }
      if (dialog === "edit") setReload((current) => current + 1);
      setDialog(null);
    });
  }

  function deleteCollection() {
    if (!selected) return;
    void act(async () => {
      await apiRequest<void>(`/api/v1/collections/${selected.id}`, {
        method: "DELETE",
      });
      setCollections((current) =>
        current.filter((item) => item.id !== selected.id),
      );
      setSelectedId(null);
      setLinked(null);
      setToolId(null);
      setDialog(null);
    });
  }

  function changeLink(id: string, remove: boolean) {
    if (!selected || !linked) return;
    void act(async () => {
      await apiRequest(
        `/api/v1/collections/${selected.id}/tools${remove ? `/${id}` : ""}`,
        {
          method: remove ? "DELETE" : "POST",
          headers: { "Content-Type": "application/json" },
          body: remove ? undefined : JSON.stringify({ toolId: id }),
        },
      );
      setLinked(null);
      setReload((current) => current + 1);
      setToolId(null);
    });
  }

  return (
    <main className="min-h-screen bg-slate-50">
      <header className="border-b bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 p-5">
          <Link href="/tools" className="text-xl font-bold text-indigo-600">
            ToolTrack
          </Link>
          <nav
            aria-label="Main navigation"
            className="flex flex-wrap gap-4 text-sm font-medium text-indigo-600"
          >
            <Link href="/tools" className="hover:underline">
              My Tools
            </Link>
            <Link
              href="/collections"
              aria-current={explore ? undefined : "page"}
              className="hover:underline aria-[current=page]:underline"
            >
              My Collections
            </Link>
            <Link
              href="/explore/collections"
              aria-current={explore ? "page" : undefined}
              className="hover:underline aria-[current=page]:underline"
            >
              Explore Collections
            </Link>
          </nav>
        </div>
      </header>
      <div className="mx-auto grid max-w-7xl gap-6 p-5 sm:p-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">
              {explore ? "Explore Public Collections" : "My Collections"}
            </h1>
            <p className="mt-2 text-sm text-slate-500">
              {explore
                ? "Browse and contribute to collections shared by ToolTrack users."
                : "Organize your saved tools into private or public collections."}
            </p>
          </div>
          {!explore && (
            <Button disabled={busy || loading} onClick={() => openForm(false)}>
              Create collection
            </Button>
          )}
        </div>
        {error && !dialog && (
          <div role="alert" className="text-destructive">
            {error}{" "}
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                setError(null);
                setLoading(true);
                setLinked(null);
                setReload((current) => current + 1);
              }}
            >
              Retry
            </Button>
          </div>
        )}
        {loading ? (
          <p role="status">Loading collections...</p>
        ) : (
          <div className="grid items-start gap-6 md:grid-cols-[16rem_1fr]">
            <nav
              aria-label={explore ? "Public collections" : "Your collections"}
              className="grid gap-2"
            >
              {collections.length === 0 && (
                <p className="text-sm text-slate-500">
                  {explore
                    ? "No public collections yet."
                    : "No collections yet. Create your first collection."}
                </p>
              )}
              {collections.map((collection) => (
                <Button
                  key={collection.id}
                  variant={
                    selectedId === collection.id ? "secondary" : "outline"
                  }
                  disabled={busy}
                  aria-pressed={selectedId === collection.id}
                  className="h-auto min-w-0 justify-between py-2 text-left whitespace-normal"
                  onClick={() => {
                    if (selectedId !== collection.id) select(collection.id);
                  }}
                >
                  <span className="min-w-0 space-y-1">
                    <span className="block break-words">{collection.name}</span>
                    {explore && collection.description && (
                      <span className="line-clamp-2 break-words text-xs font-normal text-slate-600">
                        {collection.description}
                      </span>
                    )}
                    {collection.toolCount !== undefined && (
                      <span className="block text-xs font-normal text-slate-600">
                        {collection.toolCount}{" "}
                        {collection.toolCount === 1 ? "tool" : "tools"}
                      </span>
                    )}
                  </span>
                  <VisibilityIndicator visibility={collection.visibility} />
                </Button>
              ))}
            </nav>
            {selected ? (
              <Card>
                <CardHeader>
                  <CardTitle className="break-words">{selected.name}</CardTitle>
                  <VisibilityIndicator visibility={selected.visibility} />
                  <CardDescription className="whitespace-pre-wrap break-words">
                    {selected.description || "No description provided."}
                  </CardDescription>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      disabled={busy || linked === null}
                      onClick={() => openForm(true)}
                    >
                      Edit collection
                    </Button>
                    <Button
                      variant="destructive"
                      disabled={busy || linked === null}
                      onClick={() => {
                        setError(null);
                        setDialog("delete");
                      }}
                    >
                      Delete collection
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="grid gap-4">
                  {linked === null ? (
                    <p role="status">Loading collection tools...</p>
                  ) : (
                    <>
                      <div className="grid gap-2">
                        <Label htmlFor="collection-tool">
                          Add an existing tool
                        </Label>
                        <div className="flex gap-2">
                          <Select
                            items={available.map((tool) => ({
                              value: tool.id,
                              label: tool.name,
                            }))}
                            value={toolId}
                            onValueChange={setToolId}
                            disabled={busy || available.length === 0}
                          >
                            <SelectTrigger
                              id="collection-tool"
                              className="min-w-0 flex-1"
                            >
                              <SelectValue placeholder="Choose a saved tool" />
                            </SelectTrigger>
                            <SelectContent>
                              {available.map((tool) => (
                                <SelectItem key={tool.id} value={tool.id}>
                                  {tool.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Button
                            disabled={busy || !toolId}
                            onClick={() => {
                              if (toolId) changeLink(toolId, false);
                            }}
                          >
                            Add tool
                          </Button>
                        </div>
                        {available.length === 0 && (
                          <p className="text-sm text-slate-500">
                            All loaded tools are already included, or you have
                            no saved tools.{" "}
                            <Link href="/tools" className="underline">
                              Manage your tools
                            </Link>
                            .
                          </p>
                        )}
                      </div>
                      {linked.length === 0 ? (
                        <p className="text-sm text-slate-500">
                          No tools in this collection yet.
                        </p>
                      ) : (
                        <ul className="grid gap-3">
                          {linked.map((tool) => (
                            <li
                              key={tool.id}
                              className="flex items-center justify-between gap-3 rounded-lg border p-3"
                            >
                              <div className="min-w-0">
                                {tool.websiteUrl &&
                                /^https?:\/\//i.test(tool.websiteUrl) ? (
                                  <a
                                    href={tool.websiteUrl}
                                    className="break-words font-medium text-indigo-600 hover:underline"
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    {tool.name}
                                  </a>
                                ) : (
                                  <p className="break-words font-medium">
                                    {tool.name}
                                  </p>
                                )}
                                <p className="text-sm text-slate-500">
                                  {tool.category.name} ·{" "}
                                  {tool.accessType === "FREE"
                                    ? "Free"
                                    : tool.accessType === "LICENSED"
                                      ? "Licensed"
                                      : "Subscription"}
                                </p>
                              </div>
                              <Button
                                variant="outline"
                                disabled={busy}
                                aria-label={`Remove ${tool.name} from collection`}
                                onClick={() => changeLink(tool.id, true)}
                              >
                                Remove
                              </Button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </>
                  )}
                </CardContent>
              </Card>
            ) : (
              <p className="text-sm text-slate-500">
                Select a collection to view its tools.
              </p>
            )}
          </div>
        )}
      </div>
      <Dialog
        open={dialog !== null}
        onOpenChange={(open) => {
          if (!open && !busy) {
            setDialog(null);
            setError(null);
          }
        }}
      >
        <DialogContent showCloseButton={!busy}>
          <DialogHeader>
            <DialogTitle>
              {dialog === "delete"
                ? "Delete collection?"
                : dialog === "edit"
                  ? "Edit collection"
                  : "Create collection"}
            </DialogTitle>
            <DialogDescription>
              {dialog === "delete"
                ? `Delete “${selected?.name}” and all its tool links? Contributors’ original saved tools will remain in My Tools.`
                : "Give your collection a name and optional description."}
            </DialogDescription>
          </DialogHeader>
          {error && (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          )}
          {dialog === "delete" ? (
            <DialogFooter>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => setDialog(null)}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                disabled={busy}
                onClick={deleteCollection}
              >
                {busy ? "Deleting..." : "Delete"}
              </Button>
            </DialogFooter>
          ) : (
            <form onSubmit={save} className="grid gap-4">
              {canSetVisibility ? (
                <div className="grid gap-2">
                  <Label htmlFor="collection-visibility">Visibility</Label>
                  <Select
                    items={visibilityLabels}
                    value={visibility}
                    onValueChange={(value) => {
                      if (value) setVisibility(value);
                    }}
                    disabled={busy}
                  >
                    <SelectTrigger
                      id="collection-visibility"
                      aria-describedby="collection-visibility-description"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="PRIVATE">Private</SelectItem>
                      <SelectItem value="PUBLIC">Public</SelectItem>
                    </SelectContent>
                  </Select>
                  <p
                    id="collection-visibility-description"
                    className="text-sm text-slate-600"
                  >
                    {visibilityDescriptions[visibility]}
                  </p>
                </div>
              ) : (
                selected && (
                  <VisibilityIndicator visibility={selected.visibility} />
                )
              )}
              <div className="grid gap-2">
                <Label htmlFor="collection-name">Collection name</Label>
                <Input
                  id="collection-name"
                  required
                  maxLength={120}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  disabled={busy}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="collection-description">
                  Description (optional)
                </Label>
                <Textarea
                  id="collection-description"
                  maxLength={1500}
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  disabled={busy}
                />
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => setDialog(null)}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={busy}>
                  {busy ? "Saving..." : "Save collection"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </main>
  );
}
