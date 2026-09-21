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
