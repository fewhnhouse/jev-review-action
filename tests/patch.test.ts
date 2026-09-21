import { describe, expect, it } from "vitest";
import { limitPatch, parseHunks } from "../src/patch.js";

describe("parseHunks", () => {
  it("extracts changed-file line numbers", () => {
    const hunks = parseHunks(
      [
        "diff --git a/src/a.ts b/src/a.ts",
        "@@ -2,2 +4,3 @@",
        " context",
        "+added",
        "@@ -20 +30,2 @@",
        "-old",
        "+new",
      ].join("\n"),
    );

    expect(hunks).toEqual([
      {
        id: "hunk_1",
        startLine: 4,
        patch: "@@ -2,2 +4,3 @@\n context\n+added",
      },
      {
        id: "hunk_2",
        startLine: 30,
        patch: "@@ -20 +30,2 @@\n-old\n+new",
      },
    ]);
  });

  it("returns no hunks for content without unified-diff headers", () => {
    expect(parseHunks("plain text")).toEqual([]);
  });
});

describe("limitPatch", () => {
  it("keeps small patches unchanged", () => {
    expect(limitPatch("@@ -1 +1 @@\n+safe", 100)).toEqual({
      patch: "@@ -1 +1 @@\n+safe",
      truncated: false,
    });
  });

  it("truncates large patches at a bounded size", () => {
    const result = limitPatch(`@@ -1 +1,200 @@\n+${"x".repeat(300)}`, 80);

    expect(result.truncated).toBe(true);
    expect(result.patch).toContain("[patch truncated by jev-review-action]");
    expect(result.patch.length).toBeLessThan(140);
  });
});
