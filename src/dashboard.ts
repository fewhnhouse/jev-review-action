import { escapeHtml, joinBounded, titleCase, truncatePath } from "./format.js";
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
  const workflow = report.workflow;

  const sections = [
    "## JEV review",
    "",
    renderStats([
      { value: String(report.reviewedFiles), label: "files" },
      { value: String(report.changedTests.length), label: "tests" },
      { value: String(report.followedSignals), label: "followed" },
      { value: String(report.findings.length), label: "findings" },
      { value: String(requestChanges), label: "request changes" },
    ]),
    "",
    renderWorkflow(workflow),
    "",
    renderProfiles(report),
    "",
    renderMatrix(report),
    "",
    renderFindings(report.findings),
  ];

  if (report.skippedFiles.length > 0) {
    sections.push(
      "",
      `Skipped over \`max-files\`: ${escapeHtml(joinBounded(report.skippedFiles))}`,
    );
  }
  if (report.truncatedFiles.length > 0) {
    sections.push("", `Truncated patches: ${escapeHtml(joinBounded(report.truncatedFiles))}`);
  }

  sections.push(
    "",
    "_JEV answers structured questions; this summary is rendered from those fields, not free-form model prose._",
    "",
    "<details>",
    "<summary>Review policy</summary>",
    "",
    `- Screening threshold: ${report.config.screenThreshold}`,
    `- Maximum follow-ups: ${report.config.maxFollowUps}`,
    `- Maximum profiles: ${report.config.maxProfiles}`,
    `- Base: \`${escapeHtml(report.baseSha)}\``,
    `- Head: \`${escapeHtml(report.headSha)}\``,
    "",
    "</details>",
    "",
  );

  return sections.join("\n");
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

function renderWorkflow(workflow: ReviewReport["workflow"]): string {
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
  return [
    `<p><strong>WORKFLOW</strong> · ${workflow.profiled} profiled</p>`,
    `<table><tr>${cells}</tr></table>`,
  ].join("\n");
}

function renderProfiles(report: ReviewReport): string {
  const heading = `<p><strong>FILE PROFILES</strong> · ${report.profiles.length}</p>`;
  if (report.profiles.length === 0) {
    return `${heading}\nNo files were profiled.`;
  }

  const rows = report.profiles
    .map((profile) => {
      const file = renderFile(profile.file);
      return `<tr><td>${file}</td><td>${escapeHtml(titleCase(profile.category))}</td><td align="right">${priorityMeter(profile.reviewPriority)}</td></tr>`;
    })
    .join("");
  return [
    heading,
    "<table>",
    "<tr><th align=\"left\">File</th><th align=\"left\">Change</th><th align=\"right\">Priority</th></tr>",
    rows,
    "</table>",
  ].join("\n");
}

function renderMatrix(report: ReviewReport): string {
  const heading = "<p><strong>NOUL MATRIX</strong></p>";
  if (report.matrix.length === 0) {
    return `${heading}\nNo files were screened.`;
  }

  const headers = dimensionOrder
    .map((dimension) => `<th align="center">${escapeHtml(dimensionLabels[dimension])}</th>`)
    .join("");
  const rows = report.matrix
    .map((entry) => {
      const cells = dimensionOrder
        .map((dimension) => noulCell(entry.probabilities[dimension]))
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

function noulCell(probability: number): string {
  const fill = noulFill(probability);
  const label = probability >= 0.7 ? probability.toFixed(2) : "&nbsp;";
  return `<td align="center" bgcolor="${fill.bgcolor}"><font color="${fill.color}">${label}</font></td>`;
}

function renderFindings(findings: Finding[]): string {
  if (findings.length === 0) {
    return "No concern survived evidence selection and impact scoring.";
  }

  const rows = findings
    .map((finding) => {
      const file = `${renderFile(finding.file)}:${finding.line}`;
      const concern = `${escapeHtml(finding.dimension)} / ${escapeHtml(titleCase(finding.mechanism).toLowerCase())}`;
      const owner = finding.owner ? escapeHtml(titleCase(finding.owner)) : "—";
      return `<tr><td>${file}</td><td>${concern}</td><td align="right">${finding.severity.toFixed(2)}</td><td>${owner}</td><td>${escapeHtml(finding.action)}</td></tr>`;
    })
    .join("");
  return [
    "<p><strong>FINDINGS</strong></p>",
    "<table>",
    "<tr><th align=\"left\">File</th><th align=\"left\">Concern</th><th align=\"right\">Severity</th><th align=\"left\">Owner</th><th align=\"left\">Action</th></tr>",
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
