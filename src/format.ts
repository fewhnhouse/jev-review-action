export function humanize(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .toLowerCase();
}

export function escapeMarkdown(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("|", "\\|").replaceAll("`", "\\`");
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
