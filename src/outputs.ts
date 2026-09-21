import * as core from "@actions/core";
import { countByAction, highestSeverity, reviewConclusion } from "./dashboard.js";
import type { ReviewReport } from "./types.js";

export type ReviewOutputs = {
  "findings-count": string;
  "blocking-findings-count": string;
  "request-changes-count": string;
  "comment-findings-count": string;
  "reviewed-files": string;
  "changed-tests": string;
  "followed-signals": string;
  "located-findings": string;
  "routed-findings": string;
  "skipped-files-count": string;
  "has-findings": string;
  "has-blocking-findings": string;
  conclusion: string;
  "highest-severity": string;
  "comment-url": string;
  "report-path": string;
};

export function reviewOutputs(
  report: ReviewReport,
  reportPath: string,
  commentUrl = "",
): ReviewOutputs {
  const blocking = report.findings.filter(({ severity }) => severity >= 2).length;
  const requestChanges = countByAction(report, "request_changes");
  return {
    "findings-count": String(report.findings.length),
    "blocking-findings-count": String(blocking),
    "request-changes-count": String(requestChanges),
    "comment-findings-count": String(countByAction(report, "comment")),
    "reviewed-files": String(report.reviewedFiles),
    "changed-tests": String(report.changedTests.length),
    "followed-signals": String(report.followedSignals),
    "located-findings": String(report.workflow.located),
    "routed-findings": String(report.workflow.routed),
    "skipped-files-count": String(report.skippedFiles.length),
    "has-findings": report.findings.length > 0 ? "true" : "false",
    "has-blocking-findings": blocking > 0 ? "true" : "false",
    conclusion: reviewConclusion(report),
    "highest-severity": highestSeverity(report),
    "comment-url": commentUrl,
    "report-path": reportPath,
  };
}

export function setReviewOutputs(
  report: ReviewReport,
  reportPath: string,
  commentUrl = "",
): ReviewOutputs {
  const outputs = reviewOutputs(report, reportPath, commentUrl);
  for (const [name, value] of Object.entries(outputs)) {
    core.setOutput(name, value);
  }
  return outputs;
}
