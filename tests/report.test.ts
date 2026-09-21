import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { finding, report } from "./fixtures.js";

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
    info: vi.fn(),
    setFailed: vi.fn(),
    summary,
  };
});

vi.mock("@actions/core", () => core);

import { publishResults, writeReport } from "../src/report.js";

function sample() {
  return report({
    generatedAt: "2026-09-20T12:00:00.000Z",
    findings: [finding],
  });
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("writeReport", () => {
  it("writes private, formatted JSON and creates parent directories", () => {
    const root = mkdtempSync(join(tmpdir(), "jev-report-"));
    const path = join(root, "nested", "report.json");

    try {
      writeReport(path, sample());
      expect(JSON.parse(readFileSync(path, "utf8"))).toMatchObject({
        version: 1,
        reviewedFiles: 1,
        workflow: expect.objectContaining({ cells: 5 }),
      });
      expect(statSync(path).mode & 0o777).toBe(0o600);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("publishResults", () => {
  it("creates annotations, writes the dashboard summary, and enforces the threshold", async () => {
    await publishResults(sample(), "/work/report.json", 2);

    expect(core.setOutput).not.toHaveBeenCalled();
    expect(core.warning).toHaveBeenCalledWith(
      expect.stringContaining("[security]"),
      expect.objectContaining({ file: "src/a.ts", startLine: 4 }),
    );
    expect(core.summary.addRaw).toHaveBeenCalledWith(expect.stringContaining("JEV review"), true);
    expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining("severity 2"));
    expect(core.summary.write).toHaveBeenCalledOnce();
    expect(core.info).toHaveBeenCalledWith("JSON report: /work/report.json");
  });

  it("does not fail when fail-on-severity is none", async () => {
    await publishResults(sample(), "/work/report.json", null);

    expect(core.setFailed).not.toHaveBeenCalled();
  });
});
