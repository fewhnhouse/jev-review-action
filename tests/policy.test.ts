import { describe, expect, it } from "vitest";
import {
  evaluateCheck,
  noulConcentration,
  parseProbabilityBar,
  peakScores,
  screeningConfidence,
} from "../src/policy.js";
import { finding, report } from "./fixtures.js";

describe("parseProbabilityBar", () => {
  it("accepts none and unit-interval values", () => {
    expect(parseProbabilityBar("none", "fail-on-security")).toBeNull();
    expect(parseProbabilityBar("0.7", "fail-on-security")).toBe(0.7);
    expect(parseProbabilityBar("1", "fail-on-security")).toBe(1);
    expect(() => parseProbabilityBar("1.2", "fail-on-security")).toThrow("0 to 1");
    expect(() => parseProbabilityBar("high", "fail-on-security")).toThrow("0 to 1");
  });
});

describe("screeningConfidence", () => {
  it("uses reported confidence when present and noul concentration otherwise", () => {
    expect(noulConcentration(0.5)).toBe(0);
    expect(noulConcentration(0.82)).toBeCloseTo(0.64);
    expect(noulConcentration(0)).toBe(1);
    expect(screeningConfidence(0.82, 0.91)).toBe(0.91);
    expect(screeningConfidence(0.82, null)).toBeCloseTo(0.64);
  });
});

describe("evaluateCheck", () => {
  const matrixReport = report({
    matrix: [
      {
        file: "src/a.ts",
        probabilities: {
          correctness: 0.1,
          security: 0.82,
          reliability: 0.2,
          compatibility: 0.12,
          testGap: 0.05,
        },
      },
    ],
    findings: [finding],
  });

  it("passes when no fail bars are configured", () => {
    const result = evaluateCheck(matrixReport);
    expect(result.passed).toBe(true);
    expect(result.reasons.join(" ")).toContain("does not fail the job");
    expect(result.reasons.join(" ")).toContain("informational");
  });

  it("fails on a per-category screening bar", () => {
    const result = evaluateCheck(
      report({
        ...matrixReport,
        config: {
          ...matrixReport.config,
          failOnNoul: {
            correctness: null,
            security: 0.7,
            reliability: null,
            compatibility: null,
            testGap: null,
          },
        },
      }),
    );
    expect(result.passed).toBe(false);
    expect(result.reasons[0]).toContain("Security peaked at 0.82");
  });

  it("ignores a category peak below the confidence floor", () => {
    const result = evaluateCheck(
      report({
        matrix: [
          {
            file: "src/a.ts",
            probabilities: {
              correctness: 0.1,
              security: 0.82,
              reliability: 0.2,
              compatibility: 0.12,
              testGap: 0.05,
            },
            confidences: {
              correctness: 0.9,
              security: 0.4,
              reliability: 0.9,
              compatibility: 0.9,
              testGap: 0.9,
            },
          },
        ],
        config: {
          ...report().config,
          failOnNoul: {
            correctness: null,
            security: 0.7,
            reliability: null,
            compatibility: null,
            testGap: null,
          },
          minConfidence: 0.8,
        },
      }),
    );
    expect(result.passed).toBe(true);
  });

  it("fails a category peak that clears both probability and confidence bars", () => {
    const result = evaluateCheck(
      report({
        matrix: [
          {
            file: "src/a.ts",
            probabilities: {
              correctness: 0.1,
              security: 0.82,
              reliability: 0.2,
              compatibility: 0.12,
              testGap: 0.05,
            },
            confidences: {
              correctness: 0.9,
              security: 0.91,
              reliability: 0.9,
              compatibility: 0.9,
              testGap: 0.9,
            },
          },
        ],
        config: {
          ...report().config,
          failOnNoul: {
            correctness: null,
            security: 0.7,
            reliability: null,
            compatibility: null,
            testGap: null,
          },
          confidenceOnNoul: {
            correctness: null,
            security: 0.8,
            reliability: null,
            compatibility: null,
            testGap: null,
          },
        },
      }),
    );
    expect(result.passed).toBe(false);
    expect(result.reasons[0]).toContain("confidence 0.91");
    expect(result.reasons[0]).toContain("confidence bar 0.8");
  });

  it("does not fail on a finding below the confidence floor", () => {
    const result = evaluateCheck(
      report({
        findings: [{ ...finding, locationConfidence: 0.4, mechanismConfidence: 0.4, severityConfidence: 0.4 }],
        config: {
          ...report().config,
          failOnSeverity: 2,
          minConfidence: 0.75,
        },
      }),
    );
    expect(result.passed).toBe(true);
  });

  it("fails on finding severity", () => {
    const result = evaluateCheck(
      report({
        findings: [finding],
        config: {
          ...report().config,
          failOnSeverity: 2,
        },
      }),
    );
    expect(result.passed).toBe(false);
    expect(result.reasons[0]).toContain("severity 2.10");
  });

  it("passes when configured bars are not crossed", () => {
    const result = evaluateCheck(
      report({
        findings: [finding],
        matrix: [
          {
            file: "src/a.ts",
            probabilities: {
              correctness: 0.1,
              security: 0.5,
              reliability: 0.2,
              compatibility: 0.12,
              testGap: 0.05,
            },
          },
        ],
        config: {
          ...report().config,
          failOnSeverity: 3,
          failOnNoul: {
            correctness: null,
            security: 0.7,
            reliability: null,
            compatibility: null,
            testGap: null,
          },
        },
      }),
    );
    expect(result.passed).toBe(true);
    expect(result.reasons.join(" ")).toContain("No confident finding reached severity 3 (highest 2.10)");
    expect(result.reasons.join(" ")).toContain("No category peaked");
  });
});

describe("peakScores", () => {
  it("returns the highest cell per category", () => {
    const peaks = peakScores(
      report({
        matrix: [
          {
            file: "src/b.ts",
            probabilities: {
              correctness: 0.4,
              security: 0.2,
              reliability: 0.1,
              compatibility: 0.1,
              testGap: 0.1,
            },
          },
          {
            file: "src/a.ts",
            probabilities: {
              correctness: 0.4,
              security: 0.9,
              reliability: 0.1,
              compatibility: 0.1,
              testGap: 0.1,
            },
          },
        ],
      }),
    );
    expect(peaks.find((peak) => peak.dimension === "security")).toMatchObject({
      file: "src/a.ts",
      probability: 0.9,
    });
    expect(peaks.find((peak) => peak.dimension === "correctness")?.file).toBe("src/a.ts");
  });
});
