import { describe, expect, it } from "vitest";
import { escapeHtml, joinBounded, titleCase, truncatePath } from "../src/format.js";

describe("joinBounded", () => {
  it("returns an empty string for no items", () => {
    expect(joinBounded([])).toBe("");
  });

  it("joins every item when the list is within the limit", () => {
    expect(joinBounded(["a.ts", "b.ts"], 8)).toBe("a.ts, b.ts");
  });

  it("caps long lists and reports how many were omitted", () => {
    expect(joinBounded(["a.ts", "b.ts", "c.ts", "d.ts"], 2)).toBe(
      "a.ts, b.ts, and 2 more",
    );
  });

  it("rejects a non-positive limit", () => {
    expect(() => joinBounded(["a.ts"], 0)).toThrow(/at least 1/);
  });
});

describe("formatting helpers", () => {
  it("title-cases labels, escapes HTML, and keeps the filename visible", () => {
    expect(titleCase("unsafeDefault")).toBe("Unsafe Default");
    expect(escapeHtml(`<script>"&'</script>`)).toBe(
      "&lt;script&gt;&quot;&amp;&#39;&lt;/script&gt;",
    );
    expect(truncatePath("src/a.ts")).toEqual({ prefix: "src/", name: "a.ts" });
    const truncated = truncatePath(
      "packages/orchestration/src/host/dashboard/server.ts",
      24,
    );
    expect(truncated.name).toBe("server.ts");
    expect(truncated.prefix.endsWith("…")).toBe(true);
    expect(truncated.prefix.length).toBeLessThan(
      "packages/orchestration/src/host/dashboard/".length,
    );
  });
});
