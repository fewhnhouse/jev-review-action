import { escapeMarkdown, humanize, joinBounded } from "./format.js";
import type { ReviewReport } from "./types.js";

export const COMMENT_MARKER = "<!-- jev-review-action -->";

export type CommentRecord = {
  id: number;
  body?: string | null;
};

export type CommentApi = {
  listComments: (page: number) => Promise<CommentRecord[]>;
  createComment: (body: string) => Promise<void>;
  updateComment: (id: number, body: string) => Promise<void>;
};

export type CommentLogger = {
  info: (message: string) => void;
  warning: (message: string) => void;
};

type FetchLike = (
  input: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{
  ok: boolean;
  status: number;
  statusText: string;
  text(): Promise<string>;
}>;

export function renderStickyComment(report: ReviewReport): string {
  const lines = [
    COMMENT_MARKER,
    "## JEV Review",
    "",
    `Screened **${report.reviewedFiles}** source file(s) and found **${report.findings.length}** supported concern(s).`,
    "",
  ];

  if (report.findings.length > 0) {
    lines.push("| File | Concern | Severity | Action |");
    lines.push("| --- | --- | --- | --- |");
    for (const finding of report.findings) {
      const file = `${escapeMarkdown(finding.file)}:${finding.line}`;
      const concern = `${escapeMarkdown(finding.dimension)} / ${escapeMarkdown(humanize(finding.mechanism))}`;
      lines.push(
        `| ${file} | ${concern} | ${finding.severity.toFixed(2)} | ${finding.action} |`,
      );
    }
    lines.push("");
  } else {
    lines.push("No concern survived evidence selection and impact scoring.");
    lines.push("");
  }

  if (report.skippedFiles.length > 0) {
    lines.push(
      `Skipped over \`max-files\`: ${escapeMarkdown(joinBounded(report.skippedFiles))}`,
    );
    lines.push("");
  }
  if (report.truncatedFiles.length > 0) {
    lines.push(
      `Truncated patches: ${escapeMarkdown(joinBounded(report.truncatedFiles))}`,
    );
    lines.push("");
  }

  lines.push(
    "_JEV answers structured questions; this summary is rendered from those fields, not free-form model prose._",
  );
  lines.push("");
  lines.push("<details>");
  lines.push("<summary>Review policy</summary>");
  lines.push("");
  lines.push(`- Screening threshold: ${report.config.screenThreshold}`);
  lines.push(`- Maximum follow-ups: ${report.config.maxFollowUps}`);
  lines.push(`- Base: \`${escapeMarkdown(report.baseSha)}\``);
  lines.push(`- Head: \`${escapeMarkdown(report.headSha)}\``);
  lines.push("");
  lines.push("</details>");
  lines.push("");
  return lines.join("\n");
}
