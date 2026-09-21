import { emptyConfidenceOnNoul, emptyFailOnNoul } from "../src/policy.js";
import type { Finding, ReviewReport } from "../src/types.js";

export const finding: Finding = {
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
};

export function report(overrides: Partial<ReviewReport> = {}): ReviewReport {
  return {
    version: 1,
    baseSha: "base",
    headSha: "head",
    generatedAt: "2026-09-21T10:00:00.000Z",
    config: {
      screenThreshold: 0.7,
      maxFollowUps: 8,
      maxFiles: 25,
      maxProfiles: 5,
      failOnSeverity: null,
      failOnNoul: emptyFailOnNoul(),
      minConfidence: null,
      confidenceOnNoul: emptyConfidenceOnNoul(),
    },
    reviewedFiles: 1,
    skippedFiles: [],
    changedTests: [],
    truncatedFiles: [],
    followedSignals: 0,
    matrix: [],
    profiles: [],
    workflow: {
      cells: 5,
      signals: 0,
      inspected: 0,
      located: 0,
      routed: 0,
      profiled: 0,
    },
    findings: [],
    ...overrides,
  };
}
