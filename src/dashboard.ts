import { escapeHtml, joinBounded, titleCase, truncatePath } from "./format.js";
import { confidenceBar, evaluateCheck, findingConfidence, peakScores, screeningConfidence } from "./policy.js";
import {
  dimensionLabels,
  dimensionOrder,
  type Finding,
  type ReviewReport,
} from "./types.js";

export function noulFill(probability: number): { bgcolor: string; color: string } {
  const t = Math.min(1, Math.max(0, probability));
  const light = [237, 242, 247];
  const dark = [30, 64, 175];
  const channel = (index: number) =>
    Math.round(light[index]! + (dark[index]! - light[index]!) * t)
      .toString(16)
      .padStart(2, "0");
  return {
    bgcolor: `#${channel(0)}${channel(1)}${channel(2)}`,
    color: t >= 0.55 ? "#ffffff" : "#1e3a8a",
  };
}

export function priorityMeter(score: number): string {
  const max = 4;
  const filled = Math.max(0, Math.min(max, Math.round((score / 3) * max)));
  return `${"■".repeat(filled)}${"□".repeat(max - filled)} ${score.toFixed(1)}`;
}

export function reviewConclusion(report: ReviewReport): "success" | "comment" | "request_changes" {
  if (report.findings.some((finding) => finding.action === "request_changes")) {
    return "request_changes";
  }
  if (report.findings.length > 0) return "comment";
  return "success";
}

export function renderReviewDashboard(report: ReviewReport): string {
  const requestChanges = report.findings.filter(
    (finding) => finding.action === "request_changes",
  ).length;
  const threshold = report.config.screenThreshold;
  const sections = [
    "## JEV review",
    "",
    renderVerdict(report),
    "",
    renderStats([
      { value: String(report.reviewedFiles), label: "files" },
      { value: String(report.changedTests.length), label: "tests" },
      { value: String(report.followedSignals), label: "followed" },
      { value: String(report.findings.length), label: "findings" },
      { value: String(requestChanges), label: "request changes" },
    ]),
    "",
    renderWorkflow(report),
    "",
    renderProfiles(report),
    "",
    renderMatrix(report, threshold),
    "",
    renderFindings(report.findings),
  ];

  if (report.skippedFiles.length > 0) {
    sections.push("", `Skipped \`max-files\`: ${escapeHtml(joinBounded(report.skippedFiles))}`);
  }
  if (report.truncatedFiles.length > 0) {
    sections.push("", `Truncated: ${escapeHtml(joinBounded(report.truncatedFiles))}`);
  }

  sections.push(
    "",
    `<sub><code>${escapeHtml(report.baseSha)}</code> → <code>${escapeHtml(report.headSha)}</code></sub>`,
    "",
  );
  return sections.join("\n");
}

function renderVerdict(report: ReviewReport): string {
  const check = evaluateCheck(report);
  const headline = check.passed ? "**Check passed.**" : "**Check failed.**";
  const reasons = check.passed
    ? ""
    : `${check.reasons.map((reason) => `- ${escapeHtml(reason)}`).join("\n")}\n`;
  const peaks = peakScores(report);
  const peakRows =
    report.matrix.length === 0
      ? "<tr><td colspan=\"5\">No files screened.</td></tr>"
      : peaks
          .map((peak) => {
            const failBar = report.config.failOnNoul[peak.dimension];
            const confBar = confidenceBar(report, peak.dimension);
            return `<tr><td>${escapeHtml(dimensionLabels[peak.dimension])}</td><td align="right">${peak.probability.toFixed(2)}</td><td align="right">${peak.confidence.toFixed(2)}</td><td>${renderFile(peak.file)}</td><td>${formatBar(failBar)} / ${formatBar(confBar)}</td></tr>`;
          })
          .join("");
  const highest = report.findings.length
    ? Math.max(...report.findings.map((finding) => finding.severity)).toFixed(2)
    : "none";
  return [
    headline,
    reasons,
    "<table>",
    "<tr><th align=\"left\">Category</th><th align=\"right\">Peak</th><th align=\"right\">Conf</th><th align=\"left\">File</th><th align=\"left\">Fail / conf bar</th></tr>",
    peakRows,
    "</table>",
    "",
    `Highest finding severity **${escapeHtml(highest)} / 3** · fail bar **${formatBar(report.config.failOnSeverity)}**.`,
  ].join("\n");
}

function formatBar(bar: number | null): string {
  return bar === null ? "—" : bar.toFixed(2).replace(/\.00$/, "");
}

function renderStats(stats: Array<{ value: string; label: string }>): string {
  const cells = stats
    .map(
      ({ value, label }) =>
        `<td align="center"><h2>${escapeHtml(value)}</h2><sub>${escapeHtml(label)}</sub></td>`,
    )
    .join("");
  return `<table><tr>${cells}</tr></table>`;
}

function renderWorkflow(report: ReviewReport): string {
  const workflow = report.workflow;
  const stages = [
    { value: workflow.cells, label: "cells" },
    { value: workflow.signals, label: "signals" },
    { value: workflow.inspected, label: "inspected" },
    { value: workflow.located, label: "located" },
    { value: workflow.routed, label: "routed" },
  ];
  const cells = stages
    .map(({ value, label }, index) => {
      const arrow = index === 0 ? "" : "<td align=\"center\">→</td>";
      return `${arrow}<td align="center"><strong>${value}</strong><br><sub>${escapeHtml(label)}</sub></td>`;
    })
    .join("");
  return `<p><strong>Workflow</strong> · ${workflow.profiled} profiled</p>\n<table><tr>${cells}</tr></table>`;
}

function renderProfiles(report: ReviewReport): string {
  const heading = `<p><strong>Profiles</strong> · ${report.profiles.length}</p>`;
  if (report.profiles.length === 0) {
    return `${heading}\nNone.`;
  }

  const rows = report.profiles
    .map((profile) => {
      return `<tr><td>${renderFile(profile.file)}</td><td>${escapeHtml(titleCase(profile.category))}</td><td>${priorityMeter(profile.reviewPriority)}</td><td align="right">${profile.categoryConfidence.toFixed(2)}</td></tr>`;
    })
    .join("");
  return [
    heading,
    "<table>",
    "<tr><th align=\"left\">File</th><th align=\"left\">Type</th><th align=\"left\">Priority</th><th align=\"right\">Conf</th></tr>",
    rows,
    "</table>",
  ].join("\n");
}

function renderMatrix(report: ReviewReport, threshold: number): string {
  const heading = "<p><strong>Matrix</strong></p>";
  if (report.matrix.length === 0) {
    return `${heading}\nNone.`;
  }

  const headers = dimensionOrder
    .map((dimension) => `<th align="center">${escapeHtml(dimensionLabels[dimension])}</th>`)
    .join("");
  const rows = report.matrix
    .map((entry) => {
      const cells = dimensionOrder
        .map((dimension) =>
          noulCell(
            entry.probabilities[dimension],
            screeningConfidence(entry.probabilities[dimension], entry.confidences?.[dimension]),
            threshold,
          ),
        )
        .join("");
      return `<tr><td>${renderFile(entry.file)}</td>${cells}</tr>`;
    })
    .join("");
  return [
    heading,
    "<table>",
    `<tr><th align="left">File</th>${headers}</tr>`,
    rows,
    "</table>",
  ].join("\n");
}

function noulCell(probability: number, confidence: number, threshold: number): string {
  const fill = noulFill(probability);
  const value = probability.toFixed(2);
  const label = probability >= threshold ? `<strong>${value}</strong>` : value;
  return `<td align="center" bgcolor="${fill.bgcolor}"><font color="${fill.color}">${label}<br><sub>${confidence.toFixed(2)}</sub></font></td>`;
}

function renderFindings(findings: Finding[]): string {
  if (findings.length === 0) {
    return "<p><strong>Findings</strong></p>\nNone.";
  }

  const rows = findings
    .map((finding) => {
      const file = `${renderFile(finding.file)}:${finding.line}`;
      const concern = `${escapeHtml(dimensionLabels[finding.dimension])} · ${escapeHtml(titleCase(finding.mechanism).toLowerCase())}`;
      const owner = finding.owner ? escapeHtml(titleCase(finding.owner)) : "—";
      const action = finding.action === "request_changes" ? "request changes" : "comment";
      const confidence = findingConfidence(finding).toFixed(2);
      return `<tr><td>${file}</td><td>${concern}</td><td align="right">${finding.severity.toFixed(2)}</td><td align="right">${confidence}</td><td>${owner}</td><td>${escapeHtml(action)}</td></tr>`;
    })
    .join("");
  return [
    "<p><strong>Findings</strong></p>",
    "<table>",
    "<tr><th align=\"left\">File</th><th align=\"left\">Concern</th><th align=\"right\">Sev</th><th align=\"right\">Conf</th><th align=\"left\">Owner</th><th align=\"left\">Action</th></tr>",
    rows,
    "</table>",
  ].join("\n");
}

function renderFile(path: string): string {
  const { prefix, name } = truncatePath(path);
  return `<code>${escapeHtml(prefix)}<strong>${escapeHtml(name)}</strong></code>`;
}

export function countByAction(report: ReviewReport, action: Finding["action"]): number {
  return report.findings.filter((finding) => finding.action === action).length;
}

export function highestSeverity(report: ReviewReport): string {
  if (report.findings.length === 0) return "";
  return Math.max(...report.findings.map((finding) => finding.severity)).toFixed(2);
}
