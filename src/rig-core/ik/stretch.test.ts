import { describe, expect, it } from "vitest";
import { resolveSoftStretchRatio } from "./stretch";

describe("resolveSoftStretchRatio", () => {
  it("returns rigid ratio when stretch is disabled", () => {
    const ratio = resolveSoftStretchRatio(240, 200, {
      enabled: false,
      maxStretchRatio: 1.4,
      curveStrength: 0.5,
    });
    expect(ratio).toBe(1);
  });

  it("applies a curve and caps to configured max ratio", () => {
    const ratioNear = resolveSoftStretchRatio(210, 200, {
      enabled: true,
      maxStretchRatio: 1.3,
      curveStrength: 0.5,
    });
    const ratioFar = resolveSoftStretchRatio(420, 200, {
      enabled: true,
      maxStretchRatio: 1.3,
      curveStrength: 0.5,
    });

    expect(ratioNear).toBeGreaterThan(1);
    expect(ratioNear).toBeLessThan(1.3);
    expect(ratioFar).toBeLessThanOrEqual(1.3);
    expect(ratioFar).toBeGreaterThan(ratioNear);
  });
});
