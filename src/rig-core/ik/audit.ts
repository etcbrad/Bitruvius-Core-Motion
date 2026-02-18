import type { RigSolveDiagnostics } from "../types";

export type IkAuditSample = RigSolveDiagnostics & {
  step: number;
  label?: string;
};

export type IkAuditThresholds = {
  solveMsBudget: number;
  residualBudget: number;
  iterationBudget: number;
};

export type IkAuditFindingCode = "solve_ms" | "residual" | "iterations";

export type IkAuditFinding = {
  code: IkAuditFindingCode;
  step: number;
  label: string;
  value: number;
  threshold: number;
};

export type IkAuditReport = {
  sampleCount: number;
  maxSolveMs: number;
  averageSolveMs: number;
  maxResidual: number;
  averageResidual: number;
  maxIterations: number;
  findings: IkAuditFinding[];
};

export const DEFAULT_IK_AUDIT_THRESHOLDS: IkAuditThresholds = {
  solveMsBudget: 6,
  residualBudget: 5,
  iterationBudget: 80,
};

const safeMean = (values: number[]): number => {
  if (!values.length) {
    return 0;
  }
  const sum = values.reduce((acc, value) => acc + value, 0);
  return sum / values.length;
};

const safeMax = (values: number[]): number => {
  if (!values.length) {
    return 0;
  }
  return Math.max(...values);
};

export const createIkAuditReport = (
  samples: IkAuditSample[],
  thresholds: Partial<IkAuditThresholds> = {}
): IkAuditReport => {
  const activeThresholds = {
    ...DEFAULT_IK_AUDIT_THRESHOLDS,
    ...thresholds,
  };
  const findings: IkAuditFinding[] = [];

  for (const sample of samples) {
    const label = sample.label ?? `step-${sample.step}`;
    if (sample.solveMs > activeThresholds.solveMsBudget) {
      findings.push({
        code: "solve_ms",
        step: sample.step,
        label,
        value: sample.solveMs,
        threshold: activeThresholds.solveMsBudget,
      });
    }
    if (sample.residual > activeThresholds.residualBudget) {
      findings.push({
        code: "residual",
        step: sample.step,
        label,
        value: sample.residual,
        threshold: activeThresholds.residualBudget,
      });
    }
    if (sample.iterations > activeThresholds.iterationBudget) {
      findings.push({
        code: "iterations",
        step: sample.step,
        label,
        value: sample.iterations,
        threshold: activeThresholds.iterationBudget,
      });
    }
  }

  const solveMsValues = samples.map((sample) => sample.solveMs);
  const residualValues = samples.map((sample) => sample.residual);
  const iterationValues = samples.map((sample) => sample.iterations);

  return {
    sampleCount: samples.length,
    maxSolveMs: safeMax(solveMsValues),
    averageSolveMs: safeMean(solveMsValues),
    maxResidual: safeMax(residualValues),
    averageResidual: safeMean(residualValues),
    maxIterations: safeMax(iterationValues),
    findings,
  };
};
