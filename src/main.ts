import * as core from "@actions/core";
import { collectChangedFiles, createGitRunner } from "./git.js";
import { readInputs } from "./inputs.js";
import { postStickySummary } from "./comment.js";
import { setReviewOutputs } from "./outputs.js";
import { publishResults, writeReport } from "./report.js";
import { buildClientConfig, createClient, describeEndpoint, runReview } from "./review.js";

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
    core.info(
      `JEV endpoint ${describeEndpoint(inputs.apiBaseUrl)}${inputs.apiModel ? ` model ${inputs.apiModel}` : ""}`,
    );
    const report = await runReview({
      client: createClient(
        inputs.apiKey,
        buildClientConfig({ baseURL: inputs.apiBaseUrl, model: inputs.apiModel }),
      ),
      sourceFiles: changed.sourceFiles,
      testFiles: changed.testFiles,
      skippedFiles: changed.skippedFiles,
      baseSha: inputs.baseSha,
      headSha: inputs.headSha,
      maxFiles: inputs.maxFiles,
      log: core.info,
    });
    report.config.failOnSeverity = inputs.failOnSeverity;
    report.config.failOnNoul = inputs.failOnNoul;
    core.endGroup();

    writeReport(inputs.reportPath, report);
    const comment = await postStickySummary({
      report,
      enabled: inputs.postComment,
      token: inputs.githubToken,
      repository: process.env.GITHUB_REPOSITORY,
      pullRequestNumber: inputs.pullRequestNumber,
      log: { info: core.info, warning: core.warning },
      ...(process.env.GITHUB_API_URL ? { apiUrl: process.env.GITHUB_API_URL } : {}),
    });
    setReviewOutputs(report, inputs.reportPath, comment.commentUrl);
    await publishResults(report, inputs.reportPath);
  } catch (error) {
    core.endGroup();
    const message = error instanceof Error ? error.message : String(error);
    core.setFailed(message);
  }
}

void run();
