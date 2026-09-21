import {
  choice,
  noul,
  score,
  TypeSafeClient,
  type TypeSafeClientConfig,
} from "@typesafe-ai/sdk";
import { parseHunks } from "./patch.js";
import {
  dimensions,
  type ChangedFile,
  type Dimension,
  type Finding,
  type ReviewReport,
  type Screening,
  type Signal,
} from "./types.js";

export const SCREEN_THRESHOLD = 0.7;
export const MAX_FOLLOW_UPS = 8;
const CONCURRENCY = 3;
const MIN_LOCATION_CONFIDENCE = 0.55;
const ROUTE_SEVERITY = 1.5;
const BLOCKING_SEVERITY = 2;

export type SystemOneClient = Pick<TypeSafeClient, "systemOne">;

const mechanisms: Record<Dimension, Record<string, string>> = {
  correctness: {
    condition: "A condition handles the wrong cases",
    state: "State is read, updated, or retained incorrectly",
    dataFlow: "Data is transformed or passed incorrectly",
    asyncControl: "Asynchronous ordering or error handling is incorrect",
    other: "Another concrete correctness mechanism",
    noIssue: "The selected evidence does not support a concrete correctness issue",
  },
  security: {
    authorization: "Authorization or trust boundaries are weakened",
    injection: "Untrusted input can reach an unsafe interpreter or sink",
    exposure: "Sensitive data can be disclosed",
    unsafeDefault: "A default configuration creates avoidable exposure",
    other: "Another concrete security mechanism",
    noIssue: "The selected evidence does not support a concrete security issue",
  },
  reliability: {
    cleanup: "A resource or side effect is not cleaned up",
    concurrency: "Concurrency can race, deadlock, or lose work",
    recovery: "Failure or cancellation recovery is incomplete",
    crash: "A realistic path can terminate unexpectedly",
    other: "Another concrete reliability mechanism",
    noIssue: "The selected evidence does not support a concrete reliability issue",
  },
  compatibility: {
    api: "A public API or type contract changes incompatibly",
    behavior: "Existing callers observe changed behavior",
    dataFormat: "A persisted or exchanged format changes incompatibly",
    protocol: "An external command or protocol contract changes",
    other: "Another concrete compatibility mechanism",
    noIssue: "The selected evidence does not support a concrete compatibility issue",
  },
  testGap: {
    branch: "An important branch lacks targeted coverage",
    failure: "A failure or cancellation path lacks coverage",
    boundary: "A boundary or edge case lacks coverage",
    integration: "An interaction between components lacks coverage",
    other: "Another concrete test gap",
    noIssue: "The selected evidence does not support a concrete test gap",
  },
};

const severityRubric = [
  "No meaningful impact or no supported issue",
  "Minor or narrowly limited impact",
  "Significant correctness, reliability, compatibility, or security impact",
  "Critical security, data-loss, or widespread outage impact",
] as const;

const owners = {
  security: "Security, authentication, authorization, or data exposure",
  api: "Public APIs, compatibility, schemas, or protocols",
  runtime: "Execution, concurrency, resources, or failure recovery",
  testing: "Coverage strategy, fixtures, or regression testing",
  maintainer: "The owning domain or feature maintainer",
} as const;

export function createClient(apiKey: string, config: Omit<TypeSafeClientConfig, "apiKey"> = {}) {
  return new TypeSafeClient({ ...config, apiKey, logLevel: "warn" });
}

export async function runReview(options: {
  client: SystemOneClient;
  sourceFiles: ChangedFile[];
  testFiles: ChangedFile[];
  skippedFiles: string[];
  baseSha: string;
  headSha: string;
  maxFiles: number;
  now?: () => Date;
  log?: (message: string) => void;
}): Promise<ReviewReport> {
  const {
    client,
    sourceFiles,
    testFiles,
    skippedFiles,
    baseSha,
    headSha,
    maxFiles,
  } = options;
  const log = options.log ?? (() => undefined);
  const changedTests = compactTests(testFiles);

  log(`Screening ${sourceFiles.length} changed source file(s)`);
  const matrix = await mapLimit(sourceFiles, CONCURRENCY, async (file) => {
    log(`Screening ${file.path}`);
    return screenFile(client, file, changedTests);
  });

  const signals = matrix
    .flatMap(({ file, probabilities }) =>
      (Object.entries(probabilities) as Array<[Dimension, number]>).map(
        ([dimension, probability]): Signal => ({ file, dimension, probability }),
      ),
    )
    .filter(({ probability }) => probability >= SCREEN_THRESHOLD)
    .sort(
      (left, right) =>
        right.probability - left.probability ||
        left.file.path.localeCompare(right.file.path) ||
        left.dimension.localeCompare(right.dimension),
    )
    .slice(0, MAX_FOLLOW_UPS);

  log(`Inspecting ${signals.length} signal(s)`);
  const located = await mapLimit(signals, CONCURRENCY, (signal) =>
    locateSignal(client, signal),
  );
  const findings = located
    .filter((finding): finding is Finding => finding !== null)
    .sort(
      (left, right) =>
        right.severity - left.severity ||
        right.screeningProbability - left.screeningProbability ||
        left.file.localeCompare(right.file),
    );

  return {
    version: 1,
    baseSha,
    headSha,
    generatedAt: (options.now ?? (() => new Date()))().toISOString(),
    config: {
      screenThreshold: SCREEN_THRESHOLD,
      maxFollowUps: MAX_FOLLOW_UPS,
      maxFiles,
    },
    reviewedFiles: sourceFiles.length,
    skippedFiles,
    changedTests: testFiles.map(({ path }) => path),
    truncatedFiles: [...sourceFiles, ...testFiles]
      .filter(({ truncated }) => truncated)
      .map(({ path }) => path),
    matrix: matrix.map(({ file, probabilities }) => ({ file: file.path, probabilities })),
    findings,
  };
}

export async function screenFile(
  client: SystemOneClient,
  file: ChangedFile,
  changedTests: ChangedFile[],
): Promise<Screening> {
  const response = await client.systemOne({
    state: {
      file: { path: file.path, patch: file.patch },
      changedTests: changedTests.map(({ path, patch }) => ({ path, patch })),
    },
    questions: {
      correctness: noul(
        {
          question:
            "Does file.patch directly support that this change likely introduces incorrect runtime behavior?",
          inspect: "file.patch",
          focus: "Concrete behavior, state, data-flow, or async errors in changed lines",
          ignore: ["Style preferences", "Naming concerns", "Unsupported speculation"],
        },
        {
          true: "The patch contains a realistic path to a wrong runtime result",
          false: "The patch is correct, non-behavioral, or lacks direct evidence of a bug",
        },
      ),
      security: noul(
        {
          question:
            "Does file.patch directly support that this change introduces or weakens a security boundary?",
          focus: "Authorization, injection, secret exposure, trust boundaries, and unsafe defaults",
        },
        {
          true: "The patch creates a concrete path around a control or into an unsafe sink",
          false: "No security boundary is weakened by the patch",
        },
      ),
      reliability: noul(
        {
          question:
            "Does file.patch directly support that this change can crash, race, leak, deadlock, or recover poorly?",
          focus: "Realistic resource, concurrency, cancellation, and failure paths",
        },
        {
          true: "A changed path can lose work, leak resources, hang, crash, or remain inconsistent",
          false: "The patch preserves safe lifecycle and failure handling",
        },
      ),
      compatibility: noul(
        {
          question:
            "Does file.patch directly support that this change can break an existing caller, format, protocol, or public behavior?",
          focus: "Externally observed contracts rather than implementation details",
        },
        {
          true: "An existing consumer can fail because a contract changed without a safe migration",
          false: "The changed contract remains compatible or is entirely internal",
        },
      ),
      testGap: noul(
        {
          question:
            "Does file.patch change important behavior without adequate targeted evidence in changedTests?",
          compare: ["file.patch", "changedTests"],
          focus: "New branches, boundaries, failure paths, and component interactions",
        },
        {
          true: "Important changed behavior has no targeted changed test",
          false: "Changed tests cover the behavior, or the patch is non-behavioral",
        },
      ),
    },
  });

  return {
    file,
    probabilities: {
      correctness: response.answers.correctness.noul,
      security: response.answers.security.noul,
      reliability: response.answers.reliability.noul,
      compatibility: response.answers.compatibility.noul,
      testGap: response.answers.testGap.noul,
    },
  };
}

export async function locateSignal(
  client: SystemOneClient,
  signal: Signal,
): Promise<Finding | null> {
  const hunks = parseHunks(signal.file.patch);
  if (hunks.length === 0) return null;

  const location = await client.systemOne({
    state: {
      file: signal.file.path,
      suspectedConcern: {
        dimension: signal.dimension,
        definition: dimensions[signal.dimension],
        screeningProbability: signal.probability,
      },
      candidateHunks: hunks,
    },
    questions: {
      evidence: choice(
        {
          question:
            "Which candidate hunk provides the strongest direct evidence for suspectedConcern?",
          fallback: "Select noMatch when no hunk provides sufficient evidence",
        },
        {
          ...Object.fromEntries(
            hunks.map((hunk) => [
              hunk.id,
              `Candidate beginning at changed-file line ${hunk.startLine}`,
            ]),
          ),
          noMatch: "No candidate hunk directly supports the suspected concern",
        },
      ),
    },
  });

  const evidence = location.answers.evidence;
  if (evidence.choice === "noMatch" || evidence.confidence < MIN_LOCATION_CONFIDENCE) {
    return null;
  }
  const hunk = hunks.find(({ id }) => id === evidence.choice);
  if (!hunk) return null;

  const assessment = await client.systemOne({
    state: {
      file: signal.file.path,
      suspectedConcern: {
        dimension: signal.dimension,
        definition: dimensions[signal.dimension],
      },
      selectedEvidence: hunk,
    },
    questions: {
      mechanism: choice(
        "Which mechanism best describes the concern supported by selectedEvidence?",
        mechanisms[signal.dimension],
      ),
      severity: score(
        "Assuming selectedEvidence exhibits suspectedConcern, rate the likely production impact.",
        severityRubric,
      ),
    },
  });

  const mechanism = assessment.answers.mechanism;
  const severity = assessment.answers.severity;
  if (mechanism.choice === "noIssue" || severity.score < 0.5) return null;

  let owner: string | null = null;
  let ownerConfidence: number | null = null;
  if (severity.score >= ROUTE_SEVERITY) {
    const routing = await client.systemOne({
      state: {
        file: signal.file.path,
        concern: {
          dimension: signal.dimension,
          mechanism: mechanism.choice,
          severity: severity.score,
        },
        selectedEvidence: hunk,
      },
      questions: {
        owner: choice("Which reviewer is best suited to investigate this concern?", owners),
      },
    });
    owner = routing.answers.owner.choice;
    ownerConfidence = routing.answers.owner.confidence;
  }

  return {
    file: signal.file.path,
    line: hunk.startLine,
    dimension: signal.dimension,
    screeningProbability: signal.probability,
    locationConfidence: evidence.confidence,
    mechanism: mechanism.choice,
    mechanismConfidence: mechanism.confidence,
    severity: severity.score,
    severityConfidence: severity.confidence,
    owner,
    ownerConfidence,
    action: severity.score >= BLOCKING_SEVERITY ? "request_changes" : "comment",
  };
}

function compactTests(testFiles: ChangedFile[]): ChangedFile[] {
  return testFiles.slice(0, 4).map((file) => ({
    ...file,
    patch: file.patch.slice(0, 4_000),
    truncated: file.truncated || file.patch.length > 4_000,
  }));
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  callback: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      const item = items[index];
      if (item !== undefined) results[index] = await callback(item);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
