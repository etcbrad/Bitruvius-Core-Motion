import { describe, expect, it } from "vitest";
import { cloneJoints, computeWorldTransforms, normalizeAngleDeg } from "./graph";
import { createSvgOverlay, calibrateOverlaySegmentRestPose, resolveOverlayRenderPose } from "./overlay";
import { createInitialRigState } from "./types";

const approx = (a: number, b: number, epsilon = 1e-4): boolean => Math.abs(a - b) <= epsilon;

describe("overlay segment binding", () => {
  it("calibrates child-linked overlays and tracks segment rotation/scale", () => {
    const state = createInitialRigState();
    const overlay = createSvgOverlay({
      id: "test-segment-overlay",
      name: "Segment Overlay",
      dataUrl: "data:image/svg+xml;base64,PHN2Zy8+",
      parentJointId: "l_hip",
    });
    overlay.childJointId = "l_foot";
    overlay.rotation = 10;

    const restWorld = computeWorldTransforms(state.joints);
    const calibrated = calibrateOverlaySegmentRestPose(overlay, restWorld);
    expect(calibrated.segmentRestLength).not.toBeNull();
    expect(calibrated.segmentRestAngleDeg).not.toBeNull();

    const restPose = resolveOverlayRenderPose(calibrated, restWorld);

    const stretchedJoints = cloneJoints(state.joints);
    stretchedJoints.l_foot = {
      ...stretchedJoints.l_foot,
      localTranslation: {
        ...stretchedJoints.l_foot.localTranslation,
        y: stretchedJoints.l_foot.localTranslation.y * 1.55,
      },
    };
    const stretchedWorld = computeWorldTransforms(stretchedJoints);
    const stretchedPose = resolveOverlayRenderPose(calibrated, stretchedWorld);
    expect(stretchedPose.scaleX).toBeGreaterThan(restPose.scaleX);
    expect(stretchedPose.scaleY).toBeGreaterThan(restPose.scaleY);

    const rotatedJoints = cloneJoints(stretchedJoints);
    rotatedJoints.l_hip = {
      ...rotatedJoints.l_hip,
      localRotationDegRaw: rotatedJoints.l_hip.localRotationDegRaw + 28,
    };
    const rotatedWorld = computeWorldTransforms(rotatedJoints);
    const rotatedPose = resolveOverlayRenderPose(calibrated, rotatedWorld);
    expect(Math.abs(rotatedPose.rotationDeg - restPose.rotationDeg)).toBeGreaterThan(10);
  });

  it("keeps parent-only overlays on parent rotation and authored scale", () => {
    const state = createInitialRigState();
    const joints = cloneJoints(state.joints);
    joints.r_shoulder = {
      ...joints.r_shoulder,
      localRotationDegRaw: 25,
    };
    const world = computeWorldTransforms(joints);

    const overlay = createSvgOverlay({
      id: "test-parent-overlay",
      name: "Parent Overlay",
      dataUrl: "data:image/svg+xml;base64,PHN2Zy8+",
      parentJointId: "r_shoulder",
    });
    overlay.rotation = 12;
    overlay.scale = 1.8;
    overlay.flipX = true;

    const pose = resolveOverlayRenderPose(overlay, world);
    const expectedRotation = normalizeAngleDeg(world.r_shoulder.worldRotationDeg + overlay.rotation);
    expect(approx(pose.rotationDeg, expectedRotation)).toBe(true);
    expect(approx(pose.scaleX, -1.8)).toBe(true);
    expect(approx(pose.scaleY, 1.8)).toBe(true);
    expect(pose.childAnchorWorld).toBeNull();
  });
});
