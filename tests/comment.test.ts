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
import { finding, report } from "./fixtures.js";

describe("renderStickyComment", () => {
  it("renders an empty review as a sticky dashboard", () => {
    const body = renderStickyComment(report());
    expect(body.startsWith(COMMENT_MARKER)).toBe(true);
    expect(body).toContain("JEV review");
    expect(body).toContain("<h2>1</h2>");
    expect(body).toContain("No concern survived evidence selection and impact scoring.");
    expect(body).not.toContain("src/a.ts");
  });

  it("renders findings, profiles, and skipped files without free-form model prose", () => {
    const body = renderStickyComment(
      report({
        findings: [finding],
        skippedFiles: ["src/b.ts", "src/c.ts"],
        followedSignals: 1,
        profiles: [
          {
            file: "src/a.ts",
            category: "behavior",
            categoryConfidence: 0.9,
            reviewPriority: 2.2,
            reviewPriorityConfidence: 0.8,
          },
        ],
        workflow: {
          cells: 5,
          signals: 1,
          inspected: 1,
          located: 1,
          routed: 1,
          profiled: 1,
        },
      }),
    );

    expect(body).toContain("FINDINGS");
    expect(body).toContain("request changes");
    expect(body).toContain("Skipped over `max-files`: src/b.ts, src/c.ts");
    expect(body).toContain("How to read this comment");
    expect(body).toContain("FILE PROFILES");
    expect(body).toContain("not a bug list");
  });
});

describe("upsertStickyComment", () => {
  it("creates a comment when none exists", async () => {
    const api = {
      listComments: vi.fn().mockResolvedValue([]),
      createComment: vi.fn().mockResolvedValue({
        htmlUrl: "https://github.com/fewhnhouse/jev-review-action/pull/4#issuecomment-1",
      }),
      updateComment: vi.fn(),
    };

    await expect(upsertStickyComment(api, "body")).resolves.toEqual({
      action: "created",
      htmlUrl: "https://github.com/fewhnhouse/jev-review-action/pull/4#issuecomment-1",
    });
    expect(api.createComment).toHaveBeenCalledWith("body");
    expect(api.updateComment).not.toHaveBeenCalled();
  });

  it("updates the existing sticky comment", async () => {
    const api = {
      listComments: vi.fn().mockResolvedValue([
        { id: 1, body: "unrelated" },
        {
          id: 9,
          body: `${COMMENT_MARKER}\nold`,
          html_url: "https://github.com/fewhnhouse/jev-review-action/pull/4#issuecomment-9",
        },
      ]),
      createComment: vi.fn(),
      updateComment: vi.fn().mockResolvedValue({
        htmlUrl: "https://github.com/fewhnhouse/jev-review-action/pull/4#issuecomment-9",
      }),
    };

    await expect(upsertStickyComment(api, "next")).resolves.toEqual({
      action: "updated",
      htmlUrl: "https://github.com/fewhnhouse/jev-review-action/pull/4#issuecomment-9",
    });
    expect(api.updateComment).toHaveBeenCalledWith(9, "next");
    expect(api.createComment).not.toHaveBeenCalled();
  });
});

describe("postStickySummary", () => {
  const log = { info: vi.fn(), warning: vi.fn() };

  it("skips when disabled or not on a pull request", async () => {
    await expect(
      postStickySummary({
        report: report(),
        enabled: false,
        token: "token",
        repository: "fewhnhouse/jev-review-action",
        pullRequestNumber: 4,
        log,
      }),
    ).resolves.toEqual({ action: "skipped", commentUrl: "" });
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

  it("returns the comment URL after a successful upsert", async () => {
    await expect(
      postStickySummary({
        report: report(),
        enabled: true,
        token: "token",
        repository: "fewhnhouse/jev-review-action",
        pullRequestNumber: 4,
        log,
        api: {
          listComments: vi.fn().mockResolvedValue([]),
          createComment: vi.fn().mockResolvedValue({
            htmlUrl: "https://github.com/fewhnhouse/jev-review-action/pull/4#issuecomment-1",
          }),
          updateComment: vi.fn(),
        },
      }),
    ).resolves.toEqual({
      action: "created",
      commentUrl: "https://github.com/fewhnhouse/jev-review-action/pull/4#issuecomment-1",
    });
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
        text: async () =>
          JSON.stringify({
            html_url: "https://github.com/fewhnhouse/jev-review-action/pull/4#issuecomment-1",
          }),
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
    await expect(api.createComment("hello")).resolves.toEqual({
      htmlUrl: "https://github.com/fewhnhouse/jev-review-action/pull/4#issuecomment-1",
    });
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
