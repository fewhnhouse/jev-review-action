import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReviewReport } from "../src/types.js";

const core = vi.hoisted(() => {
  const summary = {
    addHeading: vi.fn(),
    addRaw: vi.fn(),
    addEOL: vi.fn(),
    addTable: vi.fn(),
    addDetails: vi.fn(),
    write: vi.fn().mockResolvedValue(undefined),
  };
  for (const method of [
    summary.addHeading,
    summary.addRaw,
    summary.addEOL,
    summary.addTable,
    summary.addDetails,
  ]) {
    method.mockReturnValue(summary);
  }
  return {
    setOutput: vi.fn(),
    warning: vi.fn(),
    setFailed: vi.fn(),
    summary,
  };
});

vi.mock("@actions/core", () => core);

import { publishResults, writeReport } from "../src/report.js";

function report(): ReviewReport {
  return {
    version: 1,
    baseSha: "base",
    headSha: "head",
    generatedAt: "2026-09-20T12:00:00.000Z",
    config: { screenThreshold: 0.7, maxFollowUps: 8, maxFiles: 25 },
    reviewedFiles: 1,
    skippedFiles: [],
    changedTests: [],
    truncatedFiles: [],
    matrix: [],
    findings: [
      {
        file: "src/a.ts",
        line: 4,
        dimension: "security",
        screeningProbability: 0.9,
        locationConfidence: 0.8,
        mechanism: "unsafeDefault",
        mechanismConfidence: 0.85,
        severity: 2.1,
        severityConfidence: 0.75,
        owner: "security",
        ownerConfidence: 0.7,
        action: "request_changes",
      },
    ],
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("writeReport", () => {
  it("writes private, formatted JSON and creates parent directories", () => {
    const root = mkdtempSync(join(tmpdir(), "jev-report-"));
    const path = join(root, "nested", "report.json");

    try {
      writeReport(path, report());
      expect(JSON.parse(readFileSync(path, "utf8"))).toMatchObject({
        version: 1,
        reviewedFiles: 1,
      });
      expect(statSync(path).mode & 0o777).toBe(0o600);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("publishResults", () => {
  it("sets outputs, creates annotations, and enforces the configured threshold", async () => {
    await publishResults(report(), "/work/report.json", 2);

    expect(core.setOutput).toHaveBeenCalledWith("findings-count", 1);
    expect(core.setOutput).toHaveBeenCalledWith("blocking-findings-count", 1);
    expect(core.warning).toHaveBeenCalledWith(
      expect.stringContaining("[security]"),
      expect.objectContaining({ file: "src/a.ts", startLine: 4 }),
    );
    expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining("severity 2"));
    expect(core.summary.write).toHaveBeenCalledOnce();
  });

  it("does not fail when fail-on-severity is none", async () => {
    await publishResults(report(), "/work/report.json", null);

    expect(core.setFailed).not.toHaveBeenCalled();
  });
});
