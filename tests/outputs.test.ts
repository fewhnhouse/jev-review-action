import { describe, expect, it, vi } from "vitest";
import { reviewOutputs, setReviewOutputs } from "../src/outputs.js";
import { finding, report } from "./fixtures.js";

const core = vi.hoisted(() => ({
  setOutput: vi.fn(),
}));

vi.mock("@actions/core", () => core);

describe("reviewOutputs", () => {
  it("emits string values that follow-up steps can branch on", () => {
    expect(
      reviewOutputs(
        report({
          reviewedFiles: 3,
          changedTests: ["a.test.ts"],
          followedSignals: 2,
          skippedFiles: ["skipped.ts"],
          findings: [finding, { ...finding, action: "comment", severity: 1.1, file: "src/b.ts" }],
          workflow: {
            cells: 15,
            signals: 2,
            inspected: 2,
            located: 2,
            routed: 1,
            profiled: 2,
          },
        }),
        "/work/jev-review-report.json",
        "https://github.com/fewhnhouse/jev-review-action/pull/4#issuecomment-1",
      ),
    ).toEqual({
      "findings-count": "2",
      "blocking-findings-count": "1",
      "request-changes-count": "1",
      "comment-findings-count": "1",
      "reviewed-files": "3",
      "changed-tests": "1",
      "followed-signals": "2",
      "located-findings": "2",
      "routed-findings": "1",
      "skipped-files-count": "1",
      "has-findings": "true",
      "has-blocking-findings": "true",
      conclusion: "request_changes",
      "check-passed": "true",
      "highest-severity": "2.10",
      "comment-url": "https://github.com/fewhnhouse/jev-review-action/pull/4#issuecomment-1",
      "report-path": "/work/jev-review-report.json",
    });
  });

  it("sets check-passed to false when a configured bar is crossed", () => {
    expect(
      reviewOutputs(
        report({
          findings: [finding],
          config: {
            ...report().config,
            failOnSeverity: 2,
          },
        }),
        "/tmp/report.json",
      )["check-passed"],
    ).toBe("false");
  });

  it("uses empty strings and false flags when the review is clean", () => {
    expect(reviewOutputs(report({ reviewedFiles: 0, workflow: {
      cells: 0,
      signals: 0,
      inspected: 0,
      located: 0,
      routed: 0,
      profiled: 0,
    } }), "/tmp/report.json")).toMatchObject({
      "findings-count": "0",
      "has-findings": "false",
      "has-blocking-findings": "false",
      conclusion: "success",
      "check-passed": "true",
      "highest-severity": "",
      "comment-url": "",
    });
  });
});

describe("setReviewOutputs", () => {
  it("writes every action.yml output through the toolkit", () => {
    setReviewOutputs(report({ findings: [finding] }), "/work/report.json", "");
    expect(core.setOutput).toHaveBeenCalledWith("conclusion", "request_changes");
    expect(core.setOutput).toHaveBeenCalledWith("has-findings", "true");
    expect(core.setOutput).toHaveBeenCalledWith("report-path", "/work/report.json");
  });
});
