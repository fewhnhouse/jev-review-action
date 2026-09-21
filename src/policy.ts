import {
  dimensionLabels,
  dimensionOrder,
  type Dimension,
  type ReviewReport,
} from "./types.js";

export type FailOnNoul = Record<Dimension, number | null>;

export function emptyFailOnNoul(): FailOnNoul {
  return {
    correctness: null,
    security: null,
    reliability: null,
    compatibility: null,
    testGap: null,
  };
}

export type PeakScore = {
  dimension: Dimension;
  probability: number;
  file: string;
};

export type CheckGate = {
  passed: boolean;
  reasons: string[];
};

export function parseProbabilityBar(value: string, name: string): number | null {
  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized === "none") return null;
  if (!/^(?:0(?:\.\d+)?|1(?:\.0+)?)$/.test(normalized)) {
    throw new Error(`${name} must be none or a number from 0 to 1`);
  }
  const parsed = Number(normalized);
  if (parsed < 0 || parsed > 1) {
    throw new Error(`${name} must be none or a number from 0 to 1`);
  }
  return parsed;
}

export function peakScores(report: ReviewReport): PeakScore[] {
  return dimensionOrder.map((dimension) => {
    let peak: PeakScore | null = null;
    for (const entry of report.matrix) {
      const probability = entry.probabilities[dimension];
      if (
        !peak ||
        probability > peak.probability ||
        (probability === peak.probability && entry.file.localeCompare(peak.file) < 0)
      ) {
        peak = { dimension, probability, file: entry.file };
      }
    }
    return peak ?? { dimension, probability: 0, file: "" };
  });
}

export function evaluateCheck(report: ReviewReport): CheckGate {
  const reasons: string[] = [];
  const { failOnSeverity, failOnNoul, screenThreshold } = report.config;

  if (failOnSeverity !== null) {
    const hit = report.findings.find((finding) => finding.severity >= failOnSeverity);
    if (hit) {
      reasons.push(
        `A ${dimensionLabels[hit.dimension]} finding in ${hit.file} scored severity ${hit.severity.toFixed(2)} (fail bar ${failOnSeverity}).`,
      );
    }
  }

  for (const peak of peakScores(report)) {
    const bar = failOnNoul[peak.dimension];
    if (bar !== null && peak.file && peak.probability >= bar) {
      reasons.push(
        `${dimensionLabels[peak.dimension]} peaked at ${peak.probability.toFixed(2)} in ${peak.file} (fail bar ${bar}).`,
      );
    }
  }

  if (reasons.length > 0) {
    return { passed: false, reasons };
  }

  const passedReasons = [
    `Screening ≥ ${screenThreshold} only decides which cells to inspect. It does not fail the job.`,
  ];
  if (failOnSeverity === null) {
    passedReasons.push("No fail-on-severity bar is set, so findings are informational.");
  } else {
    passedReasons.push(
      `No finding reached severity ${failOnSeverity} (highest ${highestFindingSeverity(report) || "none"}).`,
    );
  }
  if (dimensionOrder.every((dimension) => failOnNoul[dimension] === null)) {
    passedReasons.push("No per-category screening fail bar is set.");
  } else {
    passedReasons.push("No category peaked at or above its fail bar.");
  }
  return { passed: true, reasons: passedReasons };
}

function highestFindingSeverity(report: ReviewReport): string {
  if (report.findings.length === 0) return "";
  return Math.max(...report.findings.map((finding) => finding.severity)).toFixed(2);
}
