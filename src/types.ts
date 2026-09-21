export const dimensions = {
  correctness: "The change likely introduces incorrect runtime behavior.",
  security: "The change introduces or weakens a security boundary.",
  reliability: "The change can crash, race, leak, deadlock, or recover poorly.",
  compatibility: "The change can break a caller, format, protocol, or public behavior.",
  testGap: "Important changed behavior lacks targeted test evidence.",
} as const;

export type Dimension = keyof typeof dimensions;

export const dimensionOrder = [
  "correctness",
  "security",
  "reliability",
  "compatibility",
  "testGap",
] as const satisfies readonly Dimension[];

export const dimensionLabels: Record<Dimension, string> = {
  correctness: "Correctness",
  security: "Security",
  reliability: "Reliability",
  compatibility: "Compatibility",
  testGap: "Test gap",
};

export type ChangedFile = {
  path: string;
  patch: string;
  truncated: boolean;
};

export type Hunk = {
  id: string;
  startLine: number;
  patch: string;
};

export type Screening = {
  file: ChangedFile;
  probabilities: Record<Dimension, number>;
};

export type Signal = {
  file: ChangedFile;
  dimension: Dimension;
  probability: number;
};

export type Finding = {
  file: string;
  line: number;
  dimension: Dimension;
  screeningProbability: number;
  locationConfidence: number;
  mechanism: string;
  mechanismConfidence: number;
  severity: number;
  severityConfidence: number;
  owner: string | null;
  ownerConfidence: number | null;
  action: "comment" | "request_changes";
};

export type FileProfile = {
  file: string;
  category: string;
  categoryConfidence: number;
  reviewPriority: number;
  reviewPriorityConfidence: number;
};

export type ReviewWorkflow = {
  cells: number;
  signals: number;
  inspected: number;
  located: number;
  routed: number;
  profiled: number;
};

export type ReviewConclusion = "success" | "comment" | "request_changes";

export type ReviewReport = {
  version: 1;
  baseSha: string;
  headSha: string;
  generatedAt: string;
  config: {
    screenThreshold: number;
    maxFollowUps: number;
    maxFiles: number;
    maxProfiles: number;
    failOnSeverity: number | null;
    failOnNoul: Record<Dimension, number | null>;
  };
  reviewedFiles: number;
  skippedFiles: string[];
  changedTests: string[];
  truncatedFiles: string[];
  followedSignals: number;
  matrix: Array<{ file: string; probabilities: Record<Dimension, number> }>;
  profiles: FileProfile[];
  workflow: ReviewWorkflow;
  findings: Finding[];
};
