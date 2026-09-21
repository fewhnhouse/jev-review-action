import { describe, expect, it, vi } from "vitest";
import { locateSignal, profileFile, runReview, screenFile, buildClientConfig, describeEndpoint, type SystemOneClient } from "../src/review.js";
import type { ChangedFile, Signal } from "../src/types.js";

const file: ChangedFile = {
  path: "src/example.ts",
  patch: "@@ -9,2 +9,2 @@\n-return true\n+return false",
  truncated: false,
};

function fakeClient(
  responder: (request: { questions: Record<string, unknown> }) => unknown,
): { client: SystemOneClient; systemOne: ReturnType<typeof vi.fn> } {
  const systemOne = vi.fn(async (request: { questions: Record<string, unknown> }) =>
    responder(request),
  );
  return {
    client: { systemOne } as unknown as SystemOneClient,
    systemOne,
  };
}

function screening(correctness = 0.85) {
  return {
    model: "test",
    usage: { input_tokens: 1, output_tokens: 1 },
    answers: {
      correctness: { type: "noul", noul: correctness },
      security: { type: "noul", noul: 0.1 },
      reliability: { type: "noul", noul: 0.2 },
      compatibility: { type: "noul", noul: 0.3 },
      testGap: { type: "noul", noul: 0.4 },
    },
  };
}

function profile() {
  return {
    answers: {
      category: {
        type: "choice",
        choice: "behavior",
        confidence: 0.91,
        probabilities: { behavior: 0.91 },
      },
      reviewPriority: {
        type: "score",
        score: 2.2,
        confidence: 0.8,
        legend: {},
        probabilities: {},
      },
    },
  };
}

describe("screenFile", () => {
  it("maps JEV noul answers to dimension probabilities", async () => {
    const { client } = fakeClient(() => screening());

    const result = await screenFile(client, file, []);

    expect(result.probabilities).toEqual({
      correctness: 0.85,
      security: 0.1,
      reliability: 0.2,
      compatibility: 0.3,
      testGap: 0.4,
    });
  });
});

describe("profileFile", () => {
  it("maps category and review priority from JEV answers", async () => {
    const { client } = fakeClient(() => profile());
    await expect(
      profileFile(client, file, {
        correctness: 0.2,
        security: 0.1,
        reliability: 0,
        compatibility: 0,
        testGap: 0,
      }),
    ).resolves.toEqual({
      file: "src/example.ts",
      category: "behavior",
      categoryConfidence: 0.91,
      reviewPriority: 2.2,
      reviewPriorityConfidence: 0.8,
    });
  });
});

describe("locateSignal", () => {
  const signal: Signal = { file, dimension: "correctness", probability: 0.85 };

  it("drops a signal when evidence selection says noMatch", async () => {
    const { client } = fakeClient(() => ({
      answers: {
        evidence: {
          type: "choice",
          choice: "noMatch",
          confidence: 0.9,
          probabilities: { noMatch: 0.9, hunk_1: 0.1 },
        },
      },
    }));

    await expect(locateSignal(client, signal)).resolves.toBeNull();
  });

  it("drops low-confidence evidence", async () => {
    const { client } = fakeClient(() => ({
      answers: {
        evidence: {
          type: "choice",
          choice: "hunk_1",
          confidence: 0.4,
          probabilities: { noMatch: 0.6, hunk_1: 0.4 },
        },
      },
    }));

    await expect(locateSignal(client, signal)).resolves.toBeNull();
  });
});

describe("runReview", () => {
  it("runs screen, locate, assess, and route stages", async () => {
    const { client, systemOne } = fakeClient(({ questions }) => {
      if ("correctness" in questions) return screening();
      if ("category" in questions) return profile();
      if ("evidence" in questions) {
        return {
          answers: {
            evidence: {
              type: "choice",
              choice: "hunk_1",
              confidence: 0.9,
              probabilities: { hunk_1: 0.9, noMatch: 0.1 },
            },
          },
        };
      }
      if ("mechanism" in questions) {
        return {
          answers: {
            mechanism: {
              type: "choice",
              choice: "condition",
              confidence: 0.88,
              probabilities: { condition: 0.88, noIssue: 0.12 },
            },
            severity: {
              type: "score",
              score: 2.25,
              confidence: 0.8,
              legend: {},
              probabilities: {},
            },
          },
        };
      }
      return {
        answers: {
          owner: {
            type: "choice",
            choice: "runtime",
            confidence: 0.75,
            probabilities: { runtime: 0.75 },
          },
        },
      };
    });

    const report = await runReview({
      client,
      sourceFiles: [file],
      testFiles: [],
      skippedFiles: ["src/skipped.ts"],
      baseSha: "base",
      headSha: "head",
      maxFiles: 1,
      now: () => new Date("2026-09-20T12:00:00.000Z"),
    });

    expect(systemOne).toHaveBeenCalledTimes(5);
    expect(report.generatedAt).toBe("2026-09-20T12:00:00.000Z");
    expect(report.skippedFiles).toEqual(["src/skipped.ts"]);
    expect(report.followedSignals).toBe(1);
    expect(report.profiles).toEqual([
      expect.objectContaining({
        file: "src/example.ts",
        category: "behavior",
        reviewPriority: 2.2,
      }),
    ]);
    expect(report.workflow).toEqual({
      cells: 5,
      signals: 1,
      inspected: 1,
      located: 1,
      routed: 1,
      profiled: 1,
    });
    expect(report.findings).toEqual([
      expect.objectContaining({
        file: "src/example.ts",
        line: 9,
        dimension: "correctness",
        mechanism: "condition",
        severity: 2.25,
        owner: "runtime",
        action: "request_changes",
      }),
    ]);
  });

  it("does not follow signals below the screening threshold", async () => {
    const { client, systemOne } = fakeClient(({ questions }) => {
      if ("correctness" in questions) return screening(0.2);
      if ("category" in questions) return profile();
      throw new Error("unexpected follow-up");
    });

    const report = await runReview({
      client,
      sourceFiles: [file],
      testFiles: [],
      skippedFiles: [],
      baseSha: "base",
      headSha: "head",
      maxFiles: 25,
    });

    expect(systemOne).toHaveBeenCalledTimes(2);
    expect(report.findings).toEqual([]);
    expect(report.profiles).toHaveLength(1);
    expect(report.workflow.signals).toBe(0);
  });

  it("returns an empty report without making API calls for docs-only changes", async () => {
    const { client, systemOne } = fakeClient(() => screening());

    const report = await runReview({
      client,
      sourceFiles: [],
      testFiles: [],
      skippedFiles: [],
      baseSha: "base",
      headSha: "head",
      maxFiles: 25,
    });

    expect(systemOne).not.toHaveBeenCalled();
    expect(report.reviewedFiles).toBe(0);
    expect(report.findings).toEqual([]);
    expect(report.profiles).toEqual([]);
    expect(report.workflow).toEqual({
      cells: 0,
      signals: 0,
      inspected: 0,
      located: 0,
      routed: 0,
      profiled: 0,
    });
  });
});

describe("client config", () => {
  it("omits unset gateway options and describes the endpoint without query strings", () => {
    expect(buildClientConfig({ baseURL: null, model: null })).toEqual({});
    expect(
      buildClientConfig({
        baseURL: "https://gateway.example.test/jev",
        model: "jev-latest",
      }),
    ).toEqual({
      baseURL: "https://gateway.example.test/jev",
      defaultModel: "jev-latest",
    });
    expect(describeEndpoint(null)).toBe("https://api.typesafe.ai");
    expect(describeEndpoint("https://gateway.example.test/jev?token=secret")).toBe(
      "https://gateway.example.test/jev",
    );
  });
});
