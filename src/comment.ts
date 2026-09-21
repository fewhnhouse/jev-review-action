import { renderReviewDashboard } from "./dashboard.js";
import type { ReviewReport } from "./types.js";

export const COMMENT_MARKER = "<!-- jev-review-action -->";

export type CommentRecord = {
  id: number;
  body?: string | null;
  html_url?: string | null;
};

export type CommentWriteResult = {
  htmlUrl: string;
};

export type CommentApi = {
  listComments: (page: number) => Promise<CommentRecord[]>;
  createComment: (body: string) => Promise<CommentWriteResult>;
  updateComment: (id: number, body: string) => Promise<CommentWriteResult>;
};

export type CommentLogger = {
  info: (message: string) => void;
  warning: (message: string) => void;
};

export type StickyCommentResult = {
  action: "created" | "updated" | "skipped";
  commentUrl: string;
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
  return `${COMMENT_MARKER}\n${renderReviewDashboard(report)}`;
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
      const text = await request(`/issues/${options.issueNumber}/comments`, {
        method: "POST",
        body: JSON.stringify({ body }),
      });
      return { htmlUrl: htmlUrlFrom(text) };
    },
    async updateComment(id: number, body: string) {
      const text = await request(`/issues/comments/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ body }),
      });
      return { htmlUrl: htmlUrlFrom(text) };
    },
  };
}

export async function upsertStickyComment(
  api: CommentApi,
  body: string,
): Promise<{ action: "created" | "updated"; htmlUrl: string }> {
  let page = 1;
  while (true) {
    const comments = await api.listComments(page);
    const existing = comments.find((comment) => comment.body?.includes(COMMENT_MARKER));
    if (existing) {
      const written = await api.updateComment(existing.id, body);
      return {
        action: "updated",
        htmlUrl: written.htmlUrl || existing.html_url || "",
      };
    }
    if (comments.length < 100) break;
    page += 1;
  }
  const written = await api.createComment(body);
  return { action: "created", htmlUrl: written.htmlUrl };
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
}): Promise<StickyCommentResult> {
  if (!options.enabled) {
    options.log.info("Sticky pull request comment is disabled.");
    return { action: "skipped", commentUrl: "" };
  }
  if (options.pullRequestNumber === null) {
    options.log.info("Skipping sticky comment because this event is not a pull request.");
    return { action: "skipped", commentUrl: "" };
  }
  if (!options.token) {
    options.log.warning(
      "Skipping sticky comment because github-token is empty. Grant pull-requests: write and pass github.token.",
    );
    return { action: "skipped", commentUrl: "" };
  }
  const parsed = parseRepository(options.repository);
  if (!parsed) {
    options.log.warning("Skipping sticky comment because GITHUB_REPOSITORY is missing or invalid.");
    return { action: "skipped", commentUrl: "" };
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
    const result = await upsertStickyComment(api, renderStickyComment(options.report));
    options.log.info(`Sticky pull request comment ${result.action}.`);
    return { action: result.action, commentUrl: result.htmlUrl };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    options.log.warning(`Unable to post sticky pull request comment: ${message}`);
    return { action: "skipped", commentUrl: "" };
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

function htmlUrlFrom(text: string): string {
  if (!text.trim()) return "";
  try {
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) return "";
    const url = (value as { html_url?: unknown }).html_url;
    return typeof url === "string" ? url : "";
  } catch {
    return "";
  }
}
