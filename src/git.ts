import { execFileSync } from "node:child_process";
import { limitPatch } from "./patch.js";
import type { ChangedFile } from "./types.js";

const SOURCE_FILE = /\.(?:[cm]?[jt]sx?)$/i;
export const TEST_FILE =
  /(?:^|\/)(?:tests?|__tests__)(?:\/|$)|\.(?:spec|test)\.[cm]?[jt]sx?$/i;

export type GitRunner = (args: string[]) => string;

export type ChangedFilesResult = {
  sourceFiles: ChangedFile[];
  testFiles: ChangedFile[];
  skippedFiles: string[];
};

export function createGitRunner(cwd: string): GitRunner {
  return (args) =>
    execFileSync("git", ["-C", cwd, ...args], {
      encoding: "utf8",
      maxBuffer: 30 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
}

export function collectChangedFiles(options: {
  git: GitRunner;
  baseSha: string;
  headSha: string;
  paths: string[];
  maxFiles: number;
}): ChangedFilesResult {
  const { git, baseSha, headSha, paths, maxFiles } = options;
  assertRevision(baseSha, "base-sha");
  assertRevision(headSha, "head-sha");
  paths.forEach(assertPathspec);

  verifyRevision(git, baseSha);
  verifyRevision(git, headSha);
  const range = `${baseSha}...${headSha}`;
  const names = splitNull(
    git([
      "diff",
      "--name-only",
      "-z",
      "--diff-filter=ACMRTUXB",
      range,
      "--",
      ...paths,
    ]),
  ).filter((path) => SOURCE_FILE.test(path));

  const testPaths = names.filter((path) => TEST_FILE.test(path));
  const sourcePaths = names.filter((path) => !TEST_FILE.test(path));
  const selectedPaths = sourcePaths.slice(0, maxFiles);
  const skippedFiles = sourcePaths.slice(maxFiles);

  const load = (path: string): ChangedFile => {
    const fullPatch = git(["diff", "--no-ext-diff", "--unified=3", range, "--", path]);
    const limited = limitPatch(fullPatch);
    return { path, ...limited };
  };

  return {
    sourceFiles: selectedPaths.map(load),
    testFiles: testPaths.slice(0, maxFiles).map(load),
    skippedFiles,
  };
}

function verifyRevision(git: GitRunner, revision: string): void {
  try {
    git(["rev-parse", "--verify", `${revision}^{commit}`]);
  } catch {
    throw new Error(
      `Git revision "${revision}" is unavailable. Use actions/checkout with fetch-depth: 0 or provide a fetched base-sha.`,
    );
  }
}

function assertRevision(revision: string, name: string): void {
  if (
    !/^[0-9A-Za-z][0-9A-Za-z._/-]{0,199}$/.test(revision) ||
    revision.includes("..") ||
    revision.includes("@{")
  ) {
    throw new Error(`${name} is not a safe Git revision`);
  }
}

function assertPathspec(path: string): void {
  if (
    path.length === 0 ||
    path.length > 1_000 ||
    path.startsWith("-") ||
    path.startsWith(":") ||
    /[\0\r\n]/.test(path)
  ) {
    throw new Error(`Unsafe or invalid pathspec: ${JSON.stringify(path)}`);
  }
}

function splitNull(output: string): string[] {
  return output.split("\0").filter(Boolean);
}
