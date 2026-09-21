import {
  dimensionLabels,
  dimensionOrder,
  type Dimension,
  type Finding,
  type ReviewReport,
} from "./types.js";

export type FailOnNoul = Record<Dimension, number | null>;
export type ConfidenceOnNoul = Record<Dimension, number | null>;

export function emptyFailOnNoul(): FailOnNoul {
  return {
    correctness: null,
    security: null,
    reliability: null,
    compatibility: null,
    testGap: null,
  };
}

export function emptyConfidenceOnNoul(): ConfidenceOnNoul {
  return emptyFailOnNoul();
}

export type PeakScore = {
  dimension: Dimension;
  probability: number;
  confidence: number;
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

/** Binary concentration of a noul probability: 0 at 0.5, 1 at 0 or 1. */
export function noulConcentration(probability: number): number {
  return Math.min(1, Math.max(0, 2 * Math.abs(probability - 0.5)));
}

export function screeningConfidence(
  probability: number,
  reported: number | null | undefined,
): number {
  if (typeof reported === "number" && Number.isFinite(reported)) return reported;
  return noulConcentration(probability);
}

export function confidenceBar(report: ReviewReport, dimension: Dimension): number | null {
  const specific = report.config.confidenceOnNoul[dimension];
  if (specific !== null) return specific;
  return report.config.minConfidence;
}

export function findingConfidence(finding: Finding): number {
  const scores = [finding.locationConfidence, finding.mechanismConfidence, finding.severityConfidence];
  if (finding.ownerConfidence !== null) scores.push(finding.ownerConfidence);
  return Math.min(...scores);
}

export function peakScores(report: ReviewReport): PeakScore[] {
  return dimensionOrder.map((dimension) => {
    let peak: PeakScore | null = null;
    for (const entry of report.matrix) {
      const probability = entry.probabilities[dimension];
      const confidence = screeningConfidence(probability, entry.confidences?.[dimension]);
      if (
        !peak ||
        probability > peak.probability ||
        (probability === peak.probability &&
          (confidence > peak.confidence ||
            (confidence === peak.confidence && entry.file.localeCompare(peak.file) < 0)))
      ) {
        peak = { dimension, probability, confidence, file: entry.file };
      }
    }
    return peak ?? { dimension, probability: 0, confidence: 0, file: "" };
  });
}

export function evaluateCheck(report: ReviewReport): CheckGate {
  const reasons: string[] = [];
  const { failOnSeverity, failOnNoul, screenThreshold } = report.config;

  if (failOnSeverity !== null) {
    const hit = report.findings.find(
      (finding) =>
        finding.severity >= failOnSeverity && meetsConfidence(findingConfidence(finding), confidenceBar(report, finding.dimension)),
    );
    if (hit) {
      reasons.push(
        `A ${dimensionLabels[hit.dimension]} finding in ${hit.file} scored severity ${hit.severity.toFixed(2)} (fail bar ${failOnSeverity}, confidence ${findingConfidence(hit).toFixed(2)}).`,
      );
    }
  }

  for (const peak of peakScores(report)) {
    const bar = failOnNoul[peak.dimension];
    const confBar = confidenceBar(report, peak.dimension);
    if (bar === null || !peak.file || peak.probability < bar) continue;
    if (!meetsConfidence(peak.confidence, confBar)) continue;
    const confidenceNote =
      confBar === null
        ? `confidence ${peak.confidence.toFixed(2)}`
        : `confidence ${peak.confidence.toFixed(2)}, confidence bar ${confBar}`;
    reasons.push(
      `${dimensionLabels[peak.dimension]} peaked at ${peak.probability.toFixed(2)} in ${peak.file} (fail bar ${bar}, ${confidenceNote}).`,
    );
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
      `No confident finding reached severity ${failOnSeverity} (highest ${highestFindingSeverity(report) || "none"}).`,
    );
  }
  if (dimensionOrder.every((dimension) => failOnNoul[dimension] === null)) {
    passedReasons.push("No per-category screening fail bar is set.");
  } else {
    passedReasons.push("No category peaked at or above its fail bar with enough confidence.");
  }
  return { passed: true, reasons: passedReasons };
}

function meetsConfidence(confidence: number, bar: number | null): boolean {
  return bar === null || confidence >= bar;
}

function highestFindingSeverity(report: ReviewReport): string {
  if (report.findings.length === 0) return "";
  return Math.max(...report.findings.map((finding) => finding.severity)).toFixed(2);
}
