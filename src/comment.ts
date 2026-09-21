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

export function createCommentApi(options: {
  token: string;
  owner: string;
  repo: string;
  issueNumber: number;
  apiUrl?: string;
  fetch?: FetchLike;
}): CommentApi {
  const apiUrl = (options.apiUrl ?? "https://api.github.com").replace(/\/$/, "");
  const fetchImpl = options.fetch ?? fetch;
  const base = `${apiUrl}/repos/${options.owner}/${options.repo}`;
  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${options.token}`,
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "jev-review-action",
  };

  async function request(path: string, init: { method?: string; body?: string } = {}) {
    const response = await fetchImpl(`${base}${path}`, {
      method: init.method ?? "GET",
      headers: {
        ...headers,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
      },
      ...(init.body ? { body: init.body } : {}),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`GitHub comment API ${response.status} ${response.statusText}: ${text}`.trim());
    }
    return text;
  }

  return {
    async listComments(page: number) {
      const text = await request(
        `/issues/${options.issueNumber}/comments?per_page=100&page=${page}`,
      );
      const value: unknown = JSON.parse(text);
      if (!Array.isArray(value)) throw new Error("GitHub comment list was not an array");
      return value as CommentRecord[];
    },
    async createComment(body: string) {
      await request(`/issues/${options.issueNumber}/comments`, {
        method: "POST",
        body: JSON.stringify({ body }),
      });
    },
    async updateComment(id: number, body: string) {
      await request(`/issues/comments/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ body }),
      });
    },
  };
}

export async function upsertStickyComment(
  api: CommentApi,
  body: string,
): Promise<"created" | "updated"> {
  let page = 1;
  while (true) {
    const comments = await api.listComments(page);
    const existing = comments.find((comment) => comment.body?.includes(COMMENT_MARKER));
    if (existing) {
      await api.updateComment(existing.id, body);
      return "updated";
    }
    if (comments.length < 100) break;
    page += 1;
  }
  await api.createComment(body);
  return "created";
}

export async function postStickySummary(options: {
  report: ReviewReport;
  enabled: boolean;
  token: string;
  repository: string | undefined;
  pullRequestNumber: number | null;
  apiUrl?: string;
  api?: CommentApi;
  log: CommentLogger;
}): Promise<void> {
  if (!options.enabled) {
    options.log.info("Sticky pull request comment is disabled.");
    return;
  }
  if (options.pullRequestNumber === null) {
    options.log.info("Skipping sticky comment because this event is not a pull request.");
    return;
  }
  if (!options.token) {
    options.log.warning(
      "Skipping sticky comment because github-token is empty. Grant pull-requests: write and pass github.token.",
    );
    return;
  }
  const parsed = parseRepository(options.repository);
  if (!parsed) {
    options.log.warning("Skipping sticky comment because GITHUB_REPOSITORY is missing or invalid.");
    return;
  }

  try {
    const api =
      options.api ??
      createCommentApi({
        token: options.token,
        owner: parsed.owner,
        repo: parsed.repo,
        issueNumber: options.pullRequestNumber,
        ...(options.apiUrl ? { apiUrl: options.apiUrl } : {}),
      });
    const action = await upsertStickyComment(api, renderStickyComment(options.report));
    options.log.info(`Sticky pull request comment ${action}.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    options.log.warning(`Unable to post sticky pull request comment: ${message}`);
  }
}

export function parseRepository(
  value: string | undefined,
): { owner: string; repo: string } | null {
  if (!value) return null;
  const [owner, repo, ...rest] = value.split("/");
  if (!owner || !repo || rest.length > 0) return null;
  return { owner, repo };
}

export function parseBoolean(value: string, name: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  throw new Error(`${name} must be true or false`);
}
