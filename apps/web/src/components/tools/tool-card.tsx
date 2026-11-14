
import type {
  AccessType,
  Tool,
} from "@/lib/tools";

interface ToolCardProps {
  tool: Tool;
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

function getSafeWebsiteUrl(
  value: string | null,
): string | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = new URL(value);

    if (
      parsed.protocol !== "http:" &&
      parsed.protocol !== "https:"
    ) {
      return null;
    }

    return parsed.toString();
  } catch {
    return null;
  }
}

export default function ToolCard({
  tool,
}: ToolCardProps) {
  const websiteUrl = getSafeWebsiteUrl(
    tool.websiteUrl,
  );

  return (
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

      <p className="mt-5 min-h-12 flex-1 text-sm leading-6 text-slate-600">
        {tool.description ||
          "No description provided."}
      </p>

      <div className="mt-5 border-t border-slate-100 pt-4">
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
          <span className="text-sm text-slate-400">
            No website added
          </span>
        )}
      </div>
    </article>
  );
}
