import { describe, expect, it, vi } from "vitest";
import {
  COMMENT_MARKER,
  createCommentApi,
  parseBoolean,
  parseRepository,
  postStickySummary,
  renderStickyComment,
  upsertStickyComment,
} from "../src/comment.js";
import type { ReviewReport } from "../src/types.js";

function report(overrides: Partial<ReviewReport> = {}): ReviewReport {
  return {
    version: 1,
    baseSha: "base",
    headSha: "head",
    generatedAt: "2026-09-21T10:00:00.000Z",
    config: { screenThreshold: 0.7, maxFollowUps: 8, maxFiles: 25 },
    reviewedFiles: 1,
    skippedFiles: [],
    changedTests: [],
    truncatedFiles: [],
    matrix: [],
    findings: [],
    ...overrides,
  };
}

describe("renderStickyComment", () => {
  it("renders an empty review as a sticky summary", () => {
    const body = renderStickyComment(report());
    expect(body).toContain(COMMENT_MARKER);
    expect(body).toContain("found **0** supported concern(s)");
    expect(body).toContain("No concern survived evidence selection and impact scoring.");
    expect(body).not.toContain("src/a.ts");
  });

  it("renders findings without free-form model prose", () => {
    const body = renderStickyComment(
      report({
        findings: [
          {
            file: "src/a.ts",
            line: 4,
            dimension: "security",
            screeningProbability: 0.9,
            locationConfidence: 0.8,
            mechanism: "unsafeDefault",
            mechanismConfidence: 0.85,
            severity: 2.1,
            severityConfidence: 0.75,
            owner: "security",
            ownerConfidence: 0.7,
            action: "request_changes",
          },
        ],
        skippedFiles: ["src/b.ts", "src/c.ts"],
      }),
    );

    expect(body).toContain("| src/a.ts:4 | security / unsafe default | 2.10 | request_changes |");
    expect(body).toContain("Skipped over `max-files`: src/b.ts, src/c.ts");
    expect(body).toContain("structured questions");
  });
});

describe("upsertStickyComment", () => {
  it("creates a comment when none exists", async () => {
    const api = {
      listComments: vi.fn().mockResolvedValue([]),
      createComment: vi.fn().mockResolvedValue(undefined),
      updateComment: vi.fn(),
    };

    await expect(upsertStickyComment(api, "body")).resolves.toBe("created");
    expect(api.createComment).toHaveBeenCalledWith("body");
    expect(api.updateComment).not.toHaveBeenCalled();
  });

  it("updates the existing sticky comment", async () => {
    const api = {
      listComments: vi.fn().mockResolvedValue([
        { id: 1, body: "unrelated" },
        { id: 9, body: `${COMMENT_MARKER}\nold` },
      ]),
      createComment: vi.fn(),
      updateComment: vi.fn().mockResolvedValue(undefined),
    };

    await expect(upsertStickyComment(api, "next")).resolves.toBe("updated");
    expect(api.updateComment).toHaveBeenCalledWith(9, "next");
    expect(api.createComment).not.toHaveBeenCalled();
  });
});

describe("postStickySummary", () => {
  const log = { info: vi.fn(), warning: vi.fn() };

  it("skips when disabled or not on a pull request", async () => {
    await postStickySummary({
      report: report(),
      enabled: false,
      token: "token",
      repository: "fewhnhouse/jev-review-action",
      pullRequestNumber: 4,
      log,
    });
    await postStickySummary({
      report: report(),
      enabled: true,
      token: "token",
      repository: "fewhnhouse/jev-review-action",
      pullRequestNumber: null,
      log,
    });
    expect(log.info).toHaveBeenCalledWith("Sticky pull request comment is disabled.");
    expect(log.info).toHaveBeenCalledWith(
      "Skipping sticky comment because this event is not a pull request.",
    );
  });

  it("warns when the token or repository is missing", async () => {
    await postStickySummary({
      report: report(),
      enabled: true,
      token: "",
      repository: "fewhnhouse/jev-review-action",
      pullRequestNumber: 4,
      log,
    });
    await postStickySummary({
      report: report(),
      enabled: true,
      token: "token",
      repository: "invalid",
      pullRequestNumber: 4,
      log,
    });
    expect(log.warning).toHaveBeenCalledWith(expect.stringContaining("github-token is empty"));
    expect(log.warning).toHaveBeenCalledWith(
      expect.stringContaining("GITHUB_REPOSITORY is missing or invalid"),
    );
  });

  it("warns instead of failing when the GitHub API rejects the comment", async () => {
    await postStickySummary({
      report: report(),
      enabled: true,
      token: "token",
      repository: "fewhnhouse/jev-review-action",
      pullRequestNumber: 4,
      log,
      api: {
        listComments: vi.fn().mockRejectedValue(new Error("GitHub comment API 403 Forbidden")),
        createComment: vi.fn(),
        updateComment: vi.fn(),
      },
    });
    expect(log.warning).toHaveBeenCalledWith(
      expect.stringContaining("Unable to post sticky pull request comment"),
    );
  });
});

describe("createCommentApi", () => {
  it("lists and creates comments through the GitHub HTTP API", async () => {
    const fetchImpl = vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
      if (String(url).includes("/issues/4/comments") && (!init?.method || init.method === "GET")) {
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          text: async () => JSON.stringify([]),
        };
      }
      return {
        ok: true,
        status: 201,
        statusText: "Created",
        text: async () => "{}",
      };
    });

    const api = createCommentApi({
      token: "token",
      owner: "fewhnhouse",
      repo: "jev-review-action",
      issueNumber: 4,
      fetch: fetchImpl,
    });

    await expect(api.listComments(1)).resolves.toEqual([]);
    await api.createComment("hello");
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.github.com/repos/fewhnhouse/jev-review-action/issues/4/comments",
      expect.objectContaining({ method: "POST" }),
    );
  });
});

describe("parsers", () => {
  it("accepts owner/repo pairs and strict booleans", () => {
    expect(parseRepository("fewhnhouse/jev-review-action")).toEqual({
      owner: "fewhnhouse",
      repo: "jev-review-action",
    });
    expect(parseRepository("invalid")).toBeNull();
    expect(parseBoolean("true", "post-comment")).toBe(true);
    expect(parseBoolean("false", "post-comment")).toBe(false);
    expect(() => parseBoolean("yes", "post-comment")).toThrow("true or false");
  });
});
