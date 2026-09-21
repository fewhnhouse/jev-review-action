import * as core from "@actions/core";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { renderReviewDashboard } from "./dashboard.js";
import { humanize, joinBounded } from "./format.js";
import { evaluateCheck } from "./policy.js";
import type { ReviewReport } from "./types.js";

export function writeReport(reportPath: string, report: ReviewReport): void {
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

export async function publishResults(report: ReviewReport, reportPath: string): Promise<void> {
  if (report.skippedFiles.length > 0) {
    core.warning(
      `${report.skippedFiles.length} source file(s) exceeded max-files and were not reviewed: ${joinBounded(report.skippedFiles)}`,
    );
  }
  if (report.truncatedFiles.length > 0) {
    core.warning(
      `Large patches were truncated before review: ${joinBounded(report.truncatedFiles)}`,
    );
  }

  for (const finding of report.findings) {
    const owner = finding.owner ? ` Suggested owner: ${finding.owner}.` : "";
    core.warning(
      `[${finding.dimension}] ${humanize(finding.mechanism)} (severity ${finding.severity.toFixed(2)}).${owner}`,
      {
        title: `JEV ${finding.action === "request_changes" ? "blocking" : "review"} finding`,
        file: finding.file,
        startLine: finding.line,
        endLine: finding.line,
      },
    );
  }

  await core.summary.addRaw(renderReviewDashboard(report), true).write();
  core.info(`JSON report: ${reportPath}`);

  const check = evaluateCheck(report);
  if (!check.passed) {
    core.setFailed(check.reasons.join(" "));
  }
}
