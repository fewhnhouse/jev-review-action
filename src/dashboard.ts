import { escapeHtml, joinBounded, titleCase, truncatePath } from "./format.js";
import {
  dimensionLabels,
  dimensionOrder,
  dimensions,
  type Finding,
  type ReviewReport,
} from "./types.js";

export const changeTypeHelp: Record<string, string> = {
  behavior: "Adds or changes runtime behavior",
  interface: "Changes an exported API, type, protocol, or data shape",
  infrastructure: "Changes execution, scheduling, build, or operational plumbing",
  observability: "Changes events, logging, monitoring, or diagnostics",
  refactor: "Restructures implementation without intending behavior changes",
  routine: "A small routine change that fits none of the other categories",
};

const priorityHelp = [
  "Routine skim is enough",
  "A focused look at the changed behavior is useful",
  "Careful review before merge",
  "Specialist or immediate review",
] as const;

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
    "This is a **structured risk screen** of the JavaScript/TypeScript diff, not a written code review. JEV answers yes/no and scoring questions; the tables below are those answers.",
    "",
    renderStats([
      { value: String(report.reviewedFiles), label: "files" },
      { value: String(report.changedTests.length), label: "tests" },
      { value: String(report.followedSignals), label: "followed" },
      { value: String(report.findings.length), label: "findings" },
      { value: String(requestChanges), label: "request changes" },
    ]),
    "",
    "Files were screened. Changed tests were context for coverage. Followed signals were inspected in depth. Findings had a concrete hunk and a non-trivial impact score. Request changes means severity 2 or higher.",
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
    sections.push(
      "",
      `Skipped over \`max-files\`: ${escapeHtml(joinBounded(report.skippedFiles))}`,
    );
  }
  if (report.truncatedFiles.length > 0) {
    sections.push("", `Truncated patches: ${escapeHtml(joinBounded(report.truncatedFiles))}`);
  }

  sections.push("", renderGlossary(report), "");
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

function renderWorkflow(report: ReviewReport): string {
  const workflow = report.workflow;
  const stages = [
    { value: workflow.cells, label: "cells", meaning: "one judgment per file per risk" },
    { value: workflow.signals, label: "signals", meaning: `probability ≥ ${report.config.screenThreshold}` },
    { value: workflow.inspected, label: "inspected", meaning: `followed, cap ${report.config.maxFollowUps}` },
    { value: workflow.located, label: "located", meaning: "a concrete diff hunk was selected" },
    { value: workflow.routed, label: "routed", meaning: "impact high enough to suggest an owner" },
  ];
  const cells = stages
    .map(({ value, label }, index) => {
      const arrow = index === 0 ? "" : "<td align=\"center\">→</td>";
      return `${arrow}<td align="center"><strong>${value}</strong><br><sub>${escapeHtml(label)}</sub></td>`;
    })
    .join("");
  const legend = stages
    .map(({ label, meaning }) => `- **${escapeHtml(label)}**: ${escapeHtml(meaning)}`)
    .join("\n");
  return [
    `<p><strong>WORKFLOW</strong> · ${workflow.profiled} file(s) also profiled for change type and review priority</p>`,
    `<table><tr>${cells}</tr></table>`,
    "",
    legend,
  ].join("\n");
}

function renderProfiles(report: ReviewReport): string {
  const heading = `<p><strong>FILE PROFILES</strong> · ${report.profiles.length}</p>`;
  const intro =
    "Triage of the highest-signal files: **what kind of change** this is, and **how closely a human should look** (0 = skim, 3 = specialist). This is not a bug list.";
  if (report.profiles.length === 0) {
    return `${heading}\n${intro}\n\nNo files were profiled.`;
  }

  const rows = report.profiles
    .map((profile) => {
      const file = renderFile(profile.file);
      const category = titleCase(profile.category);
      const help = changeTypeHelp[profile.category] ?? "";
      const change = help ? `${escapeHtml(category)} — ${escapeHtml(help)}` : escapeHtml(category);
      const level = Math.min(3, Math.max(0, Math.round(profile.reviewPriority)));
      const priority = `${priorityMeter(profile.reviewPriority)} · ${escapeHtml(priorityHelp[level] ?? "")}`;
      return `<tr><td>${file}</td><td>${change}</td><td>${priority}</td></tr>`;
    })
    .join("");
  return [
    heading,
    intro,
    "<table>",
    "<tr><th align=\"left\">File</th><th align=\"left\">What changed</th><th align=\"left\">Review priority</th></tr>",
    rows,
    "</table>",
  ].join("\n");
}

function renderMatrix(report: ReviewReport, threshold: number): string {
  const heading = "<p><strong>RISK MATRIX</strong></p>";
  const intro = `Probability (0–1) that this patch introduces each problem. Every cell has a value; **bold** means ≥ ${threshold} and was inspected in depth.`;
  if (report.matrix.length === 0) {
    return `${heading}\n${intro}\n\nNo files were screened.`;
  }

  const headers = dimensionOrder
    .map((dimension) => `<th align="center">${escapeHtml(dimensionLabels[dimension])}</th>`)
    .join("");
  const rows = report.matrix
    .map((entry) => {
      const cells = dimensionOrder
        .map((dimension) => noulCell(entry.probabilities[dimension], threshold))
        .join("");
      return `<tr><td>${renderFile(entry.file)}</td>${cells}</tr>`;
    })
    .join("");
  const risks = dimensionOrder
    .map((dimension) => `- **${dimensionLabels[dimension]}**: ${dimensions[dimension]}`)
    .join("\n");
  return [
    heading,
    intro,
    "<table>",
    `<tr><th align="left">File</th>${headers}</tr>`,
    rows,
    "</table>",
    "",
    risks,
  ].join("\n");
}

function noulCell(probability: number, threshold: number): string {
  const fill = noulFill(probability);
  const value = probability.toFixed(2);
  const label = probability >= threshold ? `<strong>${value}</strong>` : value;
  return `<td align="center" bgcolor="${fill.bgcolor}"><font color="${fill.color}">${label}</font></td>`;
}

function renderFindings(findings: Finding[]): string {
  if (findings.length === 0) {
    return [
      "<p><strong>FINDINGS</strong></p>",
      "No concern survived evidence selection and impact scoring. High matrix values can still be worth a glance; they did not pin to a hunk with enough impact.",
    ].join("\n");
  }

  const rows = findings
    .map((finding) => {
      const file = `${renderFile(finding.file)}:${finding.line}`;
      const concern = `${escapeHtml(dimensionLabels[finding.dimension])} — ${escapeHtml(titleCase(finding.mechanism).toLowerCase())}`;
      const owner = finding.owner ? escapeHtml(titleCase(finding.owner)) : "—";
      const action = finding.action === "request_changes" ? "request changes" : "comment";
      return `<tr><td>${file}</td><td>${concern}</td><td align="right">${finding.severity.toFixed(2)} / 3</td><td>${owner}</td><td>${escapeHtml(action)}</td></tr>`;
    })
    .join("");
  return [
    "<p><strong>FINDINGS</strong></p>",
    "These had a selected diff hunk and a non-trivial impact score. Severity is 0–3. **comment** is a note; **request changes** is severity 2 or higher.",
    "<table>",
    "<tr><th align=\"left\">File</th><th align=\"left\">Concern</th><th align=\"right\">Severity</th><th align=\"left\">Suggested owner</th><th align=\"left\">Action</th></tr>",
    rows,
    "</table>",
  ].join("\n");
}

function renderFile(path: string): string {
  const { prefix, name } = truncatePath(path);
  return `<code>${escapeHtml(prefix)}<strong>${escapeHtml(name)}</strong></code>`;
}

function renderGlossary(report: ReviewReport): string {
  return [
    "<details>",
    "<summary>How to read this comment</summary>",
    "",
    "- JEV never writes a paragraph of review prose. Every cell is a structured answer (probability, category, or score).",
    "- The risk matrix is complete: a light or unlabeled-looking cell still has a probability, just below the follow-up threshold.",
    `- File profiles are triage, not defects. Priority 0 = ${priorityHelp[0]}; 3 = ${priorityHelp[3]}.`,
    "- Screening threshold: " + String(report.config.screenThreshold),
    "- Maximum follow-ups: " + String(report.config.maxFollowUps),
    "- Maximum profiles: " + String(report.config.maxProfiles),
    `- Base: \`${escapeHtml(report.baseSha)}\``,
    `- Head: \`${escapeHtml(report.headSha)}\``,
    "",
    "</details>",
  ].join("\n");
}

export function countByAction(report: ReviewReport, action: Finding["action"]): number {
  return report.findings.filter((finding) => finding.action === action).length;
}

export function highestSeverity(report: ReviewReport): string {
  if (report.findings.length === 0) return "";
  return Math.max(...report.findings.map((finding) => finding.severity)).toFixed(2);
}
