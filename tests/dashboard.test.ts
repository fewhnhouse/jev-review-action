import { describe, expect, it } from "vitest";
import {
  countByAction,
  highestSeverity,
  noulFill,
  priorityMeter,
  renderReviewDashboard,
  reviewConclusion,
} from "../src/dashboard.js";
import { finding, report } from "./fixtures.js";

const matrix = [
  {
    file: "src/a.ts",
    probabilities: {
      correctness: 0.1,
      security: 0.83,
      reliability: 0.2,
      compatibility: 0.12,
      testGap: 0.05,
    },
  },
];

describe("reviewConclusion", () => {
  it("maps findings to a follow-up-friendly conclusion", () => {
    expect(reviewConclusion(report())).toBe("success");
    expect(reviewConclusion(report({ findings: [{ ...finding, action: "comment", severity: 1.2 }] }))).toBe(
      "comment",
    );
    expect(reviewConclusion(report({ findings: [finding] }))).toBe("request_changes");
  });
});

describe("dashboard helpers", () => {
  it("darkens high-probability NOUL cells and meters priority", () => {
    expect(noulFill(0).bgcolor).toBe("#edf2f7");
    expect(noulFill(1).color).toBe("#ffffff");
    expect(priorityMeter(2.2)).toContain("2.2");
    expect(priorityMeter(2.2)).toMatch(/■/);
    expect(countByAction(report({ findings: [finding] }), "request_changes")).toBe(1);
    expect(highestSeverity(report())).toBe("");
    expect(highestSeverity(report({ findings: [finding] }))).toBe("2.10");
  });
});

describe("renderReviewDashboard", () => {
  it("renders a compact dashboard for reviewers", () => {
    const body = renderReviewDashboard(
      report({
        reviewedFiles: 2,
        changedTests: ["tests/a.test.ts"],
        followedSignals: 1,
        findings: [finding],
        profiles: [
          {
            file: "packages/orchestration/src/host/dashboard/server.ts",
            category: "behavior",
            categoryConfidence: 0.9,
            reviewPriority: 2.2,
            reviewPriorityConfidence: 0.8,
          },
        ],
        matrix,
        workflow: {
          cells: 10,
          signals: 1,
          inspected: 1,
          located: 1,
          routed: 1,
          profiled: 1,
        },
      }),
    );

    expect(body).toContain("JEV review");
    expect(body).toContain("Check passed");
    expect(body).not.toContain("structured risk screen");
    expect(body).not.toContain("How to read this comment");
    expect(body).not.toContain("does not fail the job");
    expect(body).toContain("<h2>2</h2>");
    expect(body).toContain("Workflow");
    expect(body).toContain("10");
    expect(body).toContain("Profiles");
    expect(body).toContain("Behavior");
    expect(body).toContain("Matrix");
    expect(body).toContain("0.83");
    expect(body).toContain("0.10");
    expect(body).toContain("<strong>0.83</strong>");
    expect(body).toContain("Findings");
    expect(body).toContain("request changes");
    expect(body).not.toMatch(/lorem/i);
  });

  it("keeps empty sections short", () => {
    const body = renderReviewDashboard(
      report({
        reviewedFiles: 0,
        workflow: {
          cells: 0,
          signals: 0,
          inspected: 0,
          located: 0,
          routed: 0,
          profiled: 0,
        },
      }),
    );
    expect(body).toContain("Check passed");
    expect(body).toContain("None.");
    expect(body).not.toContain("There is no combined overall score");
  });

  it("shows fail reasons when a category bar is crossed", () => {
    const body = renderReviewDashboard(
      report({
        matrix,
        config: {
          ...report().config,
          failOnNoul: {
            correctness: null,
            security: 0.7,
            reliability: null,
            compatibility: null,
            testGap: null,
          },
        },
      }),
    );
    expect(body).toContain("Check failed");
    expect(body).toContain("Security peaked at 0.83");
    expect(body).toContain("0.70");
  });
});
