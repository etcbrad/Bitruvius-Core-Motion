import { describe, expect, it } from "vitest";
import { computeWorldTransforms } from "../graph";
import { createInitialRigReducerState, rigReducer } from "../reducer";
import { createIkAuditReport, type IkAuditSample } from "./audit";

const collectSingleChainHandDragSamples = (): IkAuditSample[] => {
  let state = createInitialRigReducerState({
    mode: "IK",
    ikSolveMode: "single_chain",
    selectedJointId: "l_hand",
  });

  const world = computeWorldTransforms(state.joints);
  const hand = world.l_hand.worldPosition;
  const dragOffsets: Array<{ x: number; y: number }> = [
    { x: 18, y: -8 },
    { x: 36, y: -12 },
    { x: 58, y: -18 },
    { x: 72, y: -20 },
    { x: 84, y: -16 },
    { x: 92, y: -10 },
  ];

  return dragOffsets.map((offset, index) => {
    state = rigReducer(state, {
      type: "IK_SET_TARGET",
      jointId: "l_hand",
      x: hand.x + offset.x,
      y: hand.y + offset.y,
    });
    return {
      step: index + 1,
      label: `single_chain_drag_${index + 1}`,
      ...state.diagnostics,
    };
  });
};

describe("createIkAuditReport", () => {
  it("summarizes realistic IK drag diagnostics with no findings under relaxed thresholds", () => {
    const samples = collectSingleChainHandDragSamples();
    const report = createIkAuditReport(samples, {
      solveMsBudget: 100,
      residualBudget: 200,
      iterationBudget: 500,
    });

    expect(report.sampleCount).toBe(samples.length);
    expect(report.sampleCount).toBeGreaterThan(0);
    expect(report.maxIterations).toBeGreaterThan(0);
    expect(report.findings).toHaveLength(0);
  });

  it("detects threshold violations from audit fixture data", () => {
    const fixtureData: IkAuditSample[] = [
      {
        step: 1,
        label: "warmup",
        iterations: 12,
        residual: 0.25,
        solveMs: 1.1,
        chainsSolved: 1,
        globalPasses: 1,
      },
      {
        step: 2,
        label: "tracking",
        iterations: 16,
        residual: 0.42,
        solveMs: 1.5,
        chainsSolved: 1,
        globalPasses: 1,
      },
      {
        step: 3,
        label: "spike",
        iterations: 126,
        residual: 17,
        solveMs: 13.2,
        chainsSolved: 5,
        globalPasses: 6,
      },
    ];

    const report = createIkAuditReport(fixtureData, {
      solveMsBudget: 6,
      residualBudget: 5,
      iterationBudget: 80,
    });

    expect(report.findings.map((finding) => finding.code)).toEqual([
      "solve_ms",
      "residual",
      "iterations",
    ]);
    expect(report.findings.every((finding) => finding.label === "spike")).toBe(true);
  });
});
