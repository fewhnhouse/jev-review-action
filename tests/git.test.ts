import { describe, expect, it, vi } from "vitest";
import { collectChangedFiles, type GitRunner } from "../src/git.js";

const BASE = "a".repeat(40);
const HEAD = "b".repeat(40);

describe("collectChangedFiles", () => {
  it("separates tests, applies file limits, and loads patches", () => {
    const git = vi.fn<GitRunner>((args) => {
      if (args[0] === "rev-parse") return `${args[2]}\n`;
      if (args.includes("--name-only")) {
        return "src/a.ts\0src/a.test.ts\0README.md\0src/b.js\0";
      }
      const path = args.at(-1);
      return `diff --git a/${path} b/${path}\n@@ -1 +1 @@\n-old\n+new\n`;
    });

    const result = collectChangedFiles({
      git,
      baseSha: BASE,
      headSha: HEAD,
      paths: ["src"],
      maxFiles: 1,
    });

    expect(result.sourceFiles.map(({ path }) => path)).toEqual(["src/a.ts"]);
    expect(result.testFiles.map(({ path }) => path)).toEqual(["src/a.test.ts"]);
    expect(result.skippedFiles).toEqual(["src/b.js"]);
    expect(result.sourceFiles[0]?.patch).toContain("@@ -1 +1 @@");
  });

  it("rejects option-like pathspecs before invoking diff", () => {
    const git = vi.fn<GitRunner>(() => "");

    expect(() =>
      collectChangedFiles({
        git,
        baseSha: BASE,
        headSha: HEAD,
        paths: ["--output=/tmp/file"],
        maxFiles: 1,
      }),
    ).toThrow("Unsafe or invalid pathspec");
    expect(git).not.toHaveBeenCalled();
  });

  it("explains when a revision was not fetched", () => {
    const git = vi.fn<GitRunner>(() => {
      throw new Error("unknown revision");
    });

    expect(() =>
      collectChangedFiles({
        git,
        baseSha: BASE,
        headSha: HEAD,
        paths: ["."],
        maxFiles: 1,
      }),
    ).toThrow("fetch-depth: 0");
  });

  it("rejects unsafe revision syntax", () => {
    expect(() =>
      collectChangedFiles({
        git: vi.fn<GitRunner>(),
        baseSha: "--upload-pack=evil",
        headSha: HEAD,
        paths: ["."],
        maxFiles: 1,
      }),
    ).toThrow("base-sha is not a safe Git revision");
  });
});
