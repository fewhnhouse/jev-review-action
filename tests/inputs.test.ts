import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  parseApiBaseUrl,
  parseFailSeverity,
  parsePaths,
  readInputs,
  safeReportPath,
} from "../src/inputs.js";

describe("parsePaths", () => {
  it("accepts comma and newline delimiters and removes duplicates", () => {
    expect(parsePaths("src,\ntests\nsrc")).toEqual(["src", "tests"]);
  });

  it("requires at least one path", () => {
    expect(() => parsePaths(" , \n")).toThrow("at least one");
  });
});

describe("parseFailSeverity", () => {
  it.each([
    ["none", null],
    ["1", 1],
    ["2", 2],
    ["3", 3],
  ])("maps %s to %s", (input, expected) => {
    expect(parseFailSeverity(input)).toBe(expected);
  });

  it("rejects ambiguous thresholds", () => {
    expect(() => parseFailSeverity("high")).toThrow("none, 1, 2, 3");
    expect(() => parseFailSeverity("0")).toThrow("none, 1, 2, 3");
  });
});

describe("safeReportPath", () => {
  it("resolves a path inside the workspace", () => {
    expect(safeReportPath("/work", "artifacts/report.json")).toBe(
      "/work/artifacts/report.json",
    );
  });

  it("rejects absolute paths and traversal", () => {
    expect(() => safeReportPath("/work", "/tmp/report.json")).toThrow(
      "workspace-relative",
    );
    expect(() => safeReportPath("/work", "../report.json")).toThrow(
      "inside GITHUB_WORKSPACE",
    );
  });
});

describe("readInputs", () => {
  function io(values: Record<string, string>) {
    return {
      getInput: vi.fn((name: string) => values[name] ?? ""),
      setSecret: vi.fn(),
    };
  }

  it("infers pull request revisions and applies defaults", () => {
    const root = mkdtempSync(join(tmpdir(), "jev-inputs-"));
    const eventPath = join(root, "event.json");
    writeFileSync(
      eventPath,
      JSON.stringify({
        pull_request: {
          number: 4,
          base: { sha: "base-sha" },
          head: { sha: "head-sha" },
        },
      }),
    );
    const inputIo = io({ "typesafe-api-key": "secret" });

    try {
      expect(
        readInputs(root, { GITHUB_EVENT_PATH: eventPath }, inputIo),
      ).toEqual({
        apiKey: "secret",
        apiBaseUrl: null,
        apiModel: null,
        baseSha: "base-sha",
        headSha: "head-sha",
        paths: ["."],
        maxFiles: 25,
        failOnSeverity: null,
        reportPath: join(root, "jev-review-report.json"),
        githubToken: "",
        postComment: true,
        pullRequestNumber: 4,
        failOnNoul: {
          correctness: 0.8,
          security: 0.8,
          reliability: 0.8,
          compatibility: 0.8,
          testGap: 0.8,
        },
        minConfidence: 0.7,
        confidenceOnNoul: {
          correctness: null,
          security: null,
          reliability: null,
          compatibility: null,
          testGap: null,
        },
      });
      expect(inputIo.setSecret).toHaveBeenCalledWith("secret");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("prefers explicit revisions and parses configured controls", () => {
    const inputIo = io({
      "api-key": "gateway-secret",
      "typesafe-api-key": "ignored-legacy",
      "api-base-url": "https://gateway.example.test/jev/",
      "api-model": "jev-latest",
      "base-sha": "explicit-base",
      "head-sha": "explicit-head",
      paths: "src, packages/api",
      "max-files": "7",
      "fail-on-severity": "2",
      "fail-on-security": "0.7",
      "fail-on-test-gap": "0.85",
      "min-confidence": "0.6",
      "confidence-on-security": "0.8",
      "report-path": "out/report.json",
      "github-token": "gh-token",
      "post-comment": "false",
    });

    expect(readInputs("/work", {}, inputIo)).toMatchObject({
      apiKey: "gateway-secret",
      apiBaseUrl: "https://gateway.example.test/jev",
      apiModel: "jev-latest",
      baseSha: "explicit-base",
      headSha: "explicit-head",
      paths: ["src", "packages/api"],
      maxFiles: 7,
      failOnSeverity: 2,
      failOnNoul: {
        correctness: 0.8,
        security: 0.7,
        reliability: 0.8,
        compatibility: 0.8,
        testGap: 0.85,
      },
      minConfidence: 0.6,
      confidenceOnNoul: {
        correctness: null,
        security: 0.8,
        reliability: null,
        compatibility: null,
        testGap: null,
      },
      reportPath: "/work/out/report.json",
      githubToken: "gh-token",
      postComment: false,
      pullRequestNumber: null,
    });
    expect(inputIo.setSecret).toHaveBeenCalledWith("gateway-secret");
    expect(inputIo.setSecret).toHaveBeenCalledWith("gh-token");
  });

  it("uses push before and GITHUB_SHA", () => {
    const root = mkdtempSync(join(tmpdir(), "jev-inputs-"));
    const eventPath = join(root, "event.json");
    writeFileSync(eventPath, JSON.stringify({ before: "push-base" }));

    try {
      expect(
        readInputs(
          root,
          { GITHUB_EVENT_PATH: eventPath, GITHUB_SHA: "push-head" },
          io({ "typesafe-api-key": "secret" }),
        ),
      ).toMatchObject({ baseSha: "push-base", headSha: "push-head" });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("requires an explicit base for new-branch pushes", () => {
    const root = mkdtempSync(join(tmpdir(), "jev-inputs-"));
    const eventPath = join(root, "event.json");
    writeFileSync(eventPath, JSON.stringify({ before: "0".repeat(40) }));

    try {
      expect(() =>
        readInputs(
          root,
          { GITHUB_EVENT_PATH: eventPath, GITHUB_SHA: "head" },
          io({ "typesafe-api-key": "secret" }),
        ),
      ).toThrow("Could not infer base-sha");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects malformed event JSON and invalid file limits", () => {
    const root = mkdtempSync(join(tmpdir(), "jev-inputs-"));
    const eventPath = join(root, "event.json");
    writeFileSync(eventPath, "{not-json");

    try {
      expect(() =>
        readInputs(
          root,
          { GITHUB_EVENT_PATH: eventPath },
          io({ "typesafe-api-key": "secret", "base-sha": "base" }),
        ),
      ).toThrow("Unable to read GITHUB_EVENT_PATH");
      expect(() =>
        readInputs(
          root,
          {},
          io({
            "typesafe-api-key": "secret",
            "base-sha": "base",
            "max-files": "101",
          }),
        ),
      ).toThrow("between 1 and 100");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("requires an API key and rejects unsafe gateway URLs", () => {
    expect(() => readInputs("/work", {}, io({ "base-sha": "base" }))).toThrow(
      "Provide api-key or typesafe-api-key",
    );
    expect(parseApiBaseUrl(undefined)).toBeNull();
    expect(parseApiBaseUrl("https://ai-gateway.example.test/typesafe/")).toBe(
      "https://ai-gateway.example.test/typesafe",
    );
    expect(() => parseApiBaseUrl("not-a-url")).toThrow("absolute URL");
    expect(() => parseApiBaseUrl("ftp://example.test")).toThrow("http or https");
    expect(() => parseApiBaseUrl("https://user:pass@example.test")).toThrow("credentials");
  });

  it("rejects invalid per-category fail bars", () => {
    expect(() =>
      readInputs(
        "/work",
        {},
        io({ "api-key": "secret", "base-sha": "base", "fail-on-security": "2" }),
      ),
    ).toThrow("fail-on-security");
    expect(() =>
      readInputs(
        "/work",
        {},
        io({ "api-key": "secret", "base-sha": "base", "min-confidence": "high" }),
      ),
    ).toThrow("min-confidence");
  });

  it("accepts none to disable a default category bar", () => {
    expect(
      readInputs(
        "/work",
        {},
        io({
          "api-key": "secret",
          "base-sha": "base",
          "fail-on-compatibility": "none",
          "min-confidence": "none",
        }),
      ),
    ).toMatchObject({
      failOnNoul: {
        correctness: 0.8,
        security: 0.8,
        reliability: 0.8,
        compatibility: null,
        testGap: 0.8,
      },
      minConfidence: null,
    });
  });
});
