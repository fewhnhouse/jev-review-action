export function humanize(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .toLowerCase();
}

export function titleCase(value: string): string {
  return humanize(value).replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

export function escapeMarkdown(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("|", "\\|").replaceAll("`", "\\`");
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function truncatePath(path: string, max = 44): { prefix: string; name: string } {
  const segments = path.split("/");
  const name = segments.pop() ?? path;
  const directory = segments.length > 0 ? `${segments.join("/")}/` : "";
  if (path.length <= max) return { prefix: directory, name };

  const budget = Math.max(8, max - name.length - 1);
  const prefix = directory.length <= budget ? directory : `${directory.slice(0, budget)}…`;
  return { prefix, name };
}

export function joinBounded(items: readonly string[], limit = 8): string {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error("limit must be an integer of at least 1");
  }
  if (items.length === 0) {
    return "";
  }
  if (items.length <= limit) {
    return items.join(", ");
  }

  const shown = items.slice(0, limit);
  const remaining = items.length - limit;
  return `${shown.join(", ")}, and ${remaining} more`;
}
