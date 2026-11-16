"use client";

import { useEffect, useState, type FormEvent } from "react";
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

interface Collection {
  id: string;
  name: string;
  description: string | null;
}

export default function CollectionsPage() {
  const router = useRouter();
  const {
    data: session,
    isPending,
    error: sessionError,
  } = authClient.useSession();
  const userId = session?.user.id;
  const [collections, setCollections] = useState<Collection[]>([]);
  const [tools, setTools] = useState<Tool[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [linked, setLinked] = useState<Tool[] | null>(null);
  const [toolId, setToolId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"create" | "edit" | "delete" | null>(
    null,
  );
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const selected = collections.find(
    (collection) => collection.id === selectedId,
  );
  const available = tools.filter(
    (tool) => !linked?.some((item) => item.id === tool.id),
  );

  useEffect(() => {
    if (!isPending && !userId && !sessionError) router.replace("/login");
  }, [isPending, userId, sessionError, router]);

  useEffect(() => {
    if (!userId) return;
    const controller = new AbortController();
    void Promise.all([
      apiRequest<Collection[]>("/api/v1/collections", {
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
  }, [userId, reload]);

  useEffect(() => {
    if (!userId || !selectedId) return;
    const controller = new AbortController();
    void Promise.all([
      apiRequest<Collection>(`/api/v1/collections/${selectedId}`, {
        signal: controller.signal,
      }),
      apiRequest<Tool[]>(`/api/v1/collections/${selectedId}/tools`, {
        signal: controller.signal,
      }),
    ])
      .then(([collection, items]) => {
        if (!controller.signal.aborted) {
          setCollections((current) =>
            current.map((item) =>
              item.id === collection.id ? collection : item,
            ),
          );
          setLinked(items);
        }
      })
      .catch((caught: unknown) => {
        if (!controller.signal.aborted)
          setError(
            caught instanceof Error
              ? caught.message
              : "Unable to load collection tools.",
          );
      });
    return () => controller.abort();
  }, [userId, selectedId, reload]);

  function select(id: string) {
    setSelectedId(id);
    setLinked(null);
    setToolId(null);
    setError(null);
  }

  function openForm(edit: boolean) {
    setName(edit ? (selected?.name ?? "") : "");
    setDescription(edit ? (selected?.description ?? "") : "");
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
          }),
        },
      );
      setCollections((current) =>
        dialog === "edit"
          ? current.map((item) =>
              item.id === collection.id ? collection : item,
            )
          : [collection, ...current],
      );
      if (dialog === "create") select(collection.id);
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
      setLinked((current) =>
        remove
          ? (current ?? []).filter((tool) => tool.id !== id)
          : [tools.find((tool) => tool.id === id)!, ...(current ?? [])],
      );
      setToolId(null);
    });
  }

  if (isPending || (!session && !sessionError))
    return (
      <p role="status" className="p-8">
        Checking authentication...
      </p>
    );
  if (sessionError)
    return (
      <p role="alert" className="p-8">
        Unable to verify your session. <Link href="/login">Sign in again</Link>.
      </p>
    );

  return (
    <main className="min-h-screen bg-slate-50">
      <header className="border-b bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between p-5">
          <Link href="/tools" className="text-xl font-bold text-indigo-600">
            ToolTrack
          </Link>
          <Link
            href="/tools"
            className="text-sm font-medium text-indigo-600 hover:underline"
          >
            My Tools
          </Link>
        </div>
      </header>
      <div className="mx-auto grid max-w-7xl gap-6 p-5 sm:p-8">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">Collections</h1>
            <p className="mt-2 text-sm text-slate-500">
              Organize your saved tools into personal collections.
            </p>
          </div>
          <Button disabled={busy || loading} onClick={() => openForm(false)}>
            Create collection
          </Button>
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
            <nav aria-label="Your collections" className="grid gap-2">
              {collections.length === 0 && (
                <p className="text-sm text-slate-500">
                  No collections yet. Create your first collection.
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
                  className="justify-start truncate"
                  onClick={() => {
                    if (selectedId !== collection.id) select(collection.id);
                  }}
                >
                  {collection.name}
                </Button>
              ))}
            </nav>
            {selected ? (
              <Card>
                <CardHeader>
                  <CardTitle className="break-words">{selected.name}</CardTitle>
                  <CardDescription className="whitespace-pre-wrap break-words">
                    {selected.description || "No description provided."}
                  </CardDescription>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() => openForm(true)}
                    >
                      Edit collection
                    </Button>
                    <Button
                      variant="destructive"
                      disabled={busy}
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
                                <p className="break-words font-medium">
                                  {tool.name}
                                </p>
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
                ? `Delete “${selected?.name}”? Its tools will remain saved.`
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
