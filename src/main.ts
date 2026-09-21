import * as core from "@actions/core";
import { collectChangedFiles, createGitRunner } from "./git.js";
import { readInputs } from "./inputs.js";
import { publishResults, writeReport } from "./report.js";
import { createClient, runReview } from "./review.js";

export async function run(): Promise<void> {
  try {
    const workspace = process.env.GITHUB_WORKSPACE ?? process.cwd();
    const inputs = readInputs(workspace);

    core.startGroup("Discover changed files");
    const changed = collectChangedFiles({
      git: createGitRunner(workspace),
      baseSha: inputs.baseSha,
      headSha: inputs.headSha,
      paths: inputs.paths,
      maxFiles: inputs.maxFiles,
    });
    core.info(
      `Found ${changed.sourceFiles.length} source file(s), ${changed.testFiles.length} test file(s), and ${changed.skippedFiles.length} skipped source file(s).`,
    );
    core.endGroup();

    core.startGroup("Run JEV System One review");
    const report = await runReview({
      client: createClient(inputs.apiKey),
      sourceFiles: changed.sourceFiles,
      testFiles: changed.testFiles,
      skippedFiles: changed.skippedFiles,
      baseSha: inputs.baseSha,
      headSha: inputs.headSha,
      maxFiles: inputs.maxFiles,
      log: core.info,
    });
    core.endGroup();

    writeReport(inputs.reportPath, report);
    await publishResults(report, inputs.reportPath, inputs.failOnSeverity);
  } catch (error) {
    core.endGroup();
    const message = error instanceof Error ? error.message : String(error);
    core.setFailed(message);
  }
}

void run();
