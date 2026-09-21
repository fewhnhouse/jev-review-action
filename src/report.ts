import * as core from "@actions/core";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { escapeMarkdown, humanize, joinBounded } from "./format.js";
import type { ReviewReport } from "./types.js";

export function writeReport(reportPath: string, report: ReviewReport): void {
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

export async function publishResults(
  report: ReviewReport,
  reportPath: string,
  failOnSeverity: number | null,
): Promise<void> {
  const blocking = report.findings.filter(({ severity }) => severity >= 2);
  core.setOutput("findings-count", report.findings.length);
  core.setOutput("blocking-findings-count", blocking.length);
  core.setOutput("reviewed-files", report.reviewedFiles);
  core.setOutput("report-path", reportPath);

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

  core.summary
    .addHeading("JEV Review", 2)
    .addRaw(
      `Screened **${report.reviewedFiles}** source file(s) and found **${report.findings.length}** supported concern(s).`,
    )
    .addEOL();

  if (report.findings.length > 0) {
    core.summary.addTable([
      [
        { data: "File", header: true },
        { data: "Concern", header: true },
        { data: "Severity", header: true },
        { data: "Action", header: true },
      ],
      ...report.findings.map((finding) => [
        `${escapeMarkdown(finding.file)}:${finding.line}`,
        `${escapeMarkdown(finding.dimension)} / ${escapeMarkdown(humanize(finding.mechanism))}`,
        finding.severity.toFixed(2),
        finding.action,
      ]),
    ]);
  } else {
    core.summary.addRaw("No concern survived evidence selection and impact scoring.").addEOL();
  }

  core.summary
    .addDetails(
      "Review policy",
      [
        `Screening threshold: ${report.config.screenThreshold}`,
        `Maximum follow-ups: ${report.config.maxFollowUps}`,
        `Base: \`${escapeMarkdown(report.baseSha)}\``,
        `Head: \`${escapeMarkdown(report.headSha)}\``,
        `JSON report: \`${escapeMarkdown(reportPath)}\``,
      ].join("<br>"),
    )
    .write();

  if (
    failOnSeverity !== null &&
    report.findings.some(({ severity }) => severity >= failOnSeverity)
  ) {
    core.setFailed(`JEV found at least one concern at severity ${failOnSeverity} or higher.`);
  }
}
