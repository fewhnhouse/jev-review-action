import type { Hunk } from "./types.js";

export const MAX_PATCH_CHARS = 24_000;

export function parseHunks(patch: string): Hunk[] {
  const hunks: Hunk[] = [];
  let current: string[] | undefined;
  let startLine = 1;

  const flush = (): void => {
    if (!current) return;
    hunks.push({
      id: `hunk_${hunks.length + 1}`,
      startLine,
      patch: current.join("\n"),
    });
  };

  for (const line of patch.split("\n")) {
    if (line.startsWith("@@ ")) {
      flush();
      const match = /\+(\d+)/.exec(line);
      startLine = match?.[1] ? Number(match[1]) : 1;
      current = [line];
    } else if (current) {
      current.push(line);
    }
  }

  flush();
  return hunks;
}

export function limitPatch(patch: string, maxChars = MAX_PATCH_CHARS): {
  patch: string;
  truncated: boolean;
} {
  if (patch.length <= maxChars) return { patch, truncated: false };

  const hunks = parseHunks(patch);
  const selected: string[] = [];
  let used = 0;

  for (const hunk of hunks) {
    if (selected.length > 0 && used + hunk.patch.length + 1 > maxChars) break;
    selected.push(hunk.patch.slice(0, Math.max(0, maxChars - used)));
    used += hunk.patch.length + 1;
    if (used >= maxChars) break;
  }

  const limited = selected.join("\n").slice(0, maxChars);
  return {
    patch: `${limited}\n... [patch truncated by jev-review-action]`,
    truncated: true,
  };
}
