import * as core from "@actions/core";
import { readFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { parseBoolean } from "./comment.js";
import { emptyFailOnNoul, parseProbabilityBar, type FailOnNoul } from "./policy.js";
import { dimensionOrder, type Dimension } from "./types.js";

export type ActionInputs = {
  apiKey: string;
  apiBaseUrl: string | null;
  apiModel: string | null;
  baseSha: string;
  headSha: string;
  paths: string[];
  maxFiles: number;
  failOnSeverity: number | null;
  failOnNoul: FailOnNoul;
  reportPath: string;
  githubToken: string;
  postComment: boolean;
  pullRequestNumber: number | null;
};

type EventPayload = {
  before?: unknown;
  pull_request?: {
    number?: unknown;
    base?: { sha?: unknown };
    head?: { sha?: unknown };
  };
};

type InputIo = {
  getInput: typeof core.getInput;
  setSecret: typeof core.setSecret;
};

export function readInputs(
  cwd = process.env.GITHUB_WORKSPACE ?? process.cwd(),
  env = process.env,
  io: InputIo = { getInput: core.getInput, setSecret: core.setSecret },
): ActionInputs {
  const apiKey =
    optionalInput(io, "api-key") ?? optionalInput(io, "typesafe-api-key") ?? "";
  if (!apiKey) {
    throw new Error("Provide api-key or typesafe-api-key.");
  }
  io.setSecret(apiKey);
  const githubToken = optionalInput(io, "github-token") ?? "";
  if (githubToken) io.setSecret(githubToken);

  const event = readEvent(env.GITHUB_EVENT_PATH);
  const baseSha =
    optionalInput(io, "base-sha") ??
    stringValue(event.pull_request?.base?.sha) ??
    usablePushBase(event.before);
  const headSha =
    optionalInput(io, "head-sha") ??
    stringValue(event.pull_request?.head?.sha) ??
    stringValue(env.GITHUB_SHA) ??
    "HEAD";

  if (!baseSha) {
    throw new Error(
      "Could not infer base-sha from this event. Provide the base-sha input explicitly.",
    );
  }

  const maxFiles = parseInteger(io.getInput("max-files") || "25", "max-files", 1, 100);
  const reportPath = safeReportPath(
    cwd,
    io.getInput("report-path", { trimWhitespace: true }) || "jev-review-report.json",
  );

  return {
    apiKey,
    apiBaseUrl: parseApiBaseUrl(optionalInput(io, "api-base-url")),
    apiModel: optionalInput(io, "api-model") ?? null,
    baseSha,
    headSha,
    paths: parsePaths(io.getInput("paths") || "."),
    maxFiles,
    failOnSeverity: parseFailSeverity(io.getInput("fail-on-severity") || "none"),
    failOnNoul: parseFailOnNoul(io),
    reportPath,
    githubToken,
    postComment: parseBoolean(io.getInput("post-comment") || "true", "post-comment"),
    pullRequestNumber: parseIssueNumber(event.pull_request?.number),
  };
}

export function parsePaths(value: string): string[] {
  const paths = value
    .split(/[\n,]/)
    .map((path) => path.trim())
    .filter(Boolean);
  if (paths.length === 0) throw new Error("paths must contain at least one pathspec");
  return [...new Set(paths)];
}

export function parseFailSeverity(value: string): number | null {
  const normalized = value.trim().toLowerCase();
  if (normalized === "none") return null;
  if (!/^[123]$/.test(normalized)) {
    throw new Error("fail-on-severity must be one of: none, 1, 2, 3");
  }
  return Number(normalized);
}

const noulInputNames = {
  correctness: "fail-on-correctness",
  security: "fail-on-security",
  reliability: "fail-on-reliability",
  compatibility: "fail-on-compatibility",
  testGap: "fail-on-test-gap",
} as const satisfies Record<Dimension, string>;

export function parseFailOnNoul(io: InputIo): FailOnNoul {
  const bars = emptyFailOnNoul();
  for (const dimension of dimensionOrder) {
    bars[dimension] = parseProbabilityBar(
      io.getInput(noulInputNames[dimension]) || "none",
      noulInputNames[dimension],
    );
  }
  return bars;
}

export function parseApiBaseUrl(value: string | undefined): string | null {
  if (!value) return null;
  if (value.length > 2048) throw new Error("api-base-url is too long");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("api-base-url must be an absolute URL");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("api-base-url must use http or https");
  }
  if (url.username || url.password) {
    throw new Error("api-base-url must not contain credentials");
  }
  return value.replace(/\/+$/, "");
}

export function safeReportPath(cwd: string, value: string): string {
  if (isAbsolute(value)) throw new Error("report-path must be workspace-relative");
  const target = resolve(cwd, value);
  const fromWorkspace = relative(resolve(cwd), target);
  if (fromWorkspace.startsWith("..") || isAbsolute(fromWorkspace)) {
    throw new Error("report-path must stay inside GITHUB_WORKSPACE");
  }
  return target;
}

function optionalInput(io: InputIo, name: string): string | undefined {
  return stringValue(io.getInput(name, { trimWhitespace: true }));
}

function readEvent(path: string | undefined): EventPayload {
  if (!path) return {};
  try {
    const value: unknown = JSON.parse(readFileSync(path, "utf8"));
    return value && typeof value === "object" ? (value as EventPayload) : {};
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to read GITHUB_EVENT_PATH: ${message}`, { cause: error });
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function usablePushBase(value: unknown): string | undefined {
  const base = stringValue(value);
  return base && !/^0+$/.test(base) ? base : undefined;
}

function parseInteger(value: string, name: string, min: number, max: number): number {
  if (!/^\d+$/.test(value)) throw new Error(`${name} must be an integer`);
  const parsed = Number(value);
  if (parsed < min || parsed > max) {
    throw new Error(`${name} must be between ${min} and ${max}`);
  }
  return parsed;
}

function parseIssueNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}
