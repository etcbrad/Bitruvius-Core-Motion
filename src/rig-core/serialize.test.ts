import { describe, expect, it } from "vitest";
import { fromRigSnapshotV2, toRigSnapshotV2 } from "./serialize";
import { createInitialRigState } from "./types";

describe("fromRigSnapshotV2 skeletonVersion", () => {
  it("falls back to the runtime default when skeletonVersion is missing", () => {
    const initial = createInitialRigState();
    const snapshot = toRigSnapshotV2(initial) as Record<string, unknown>;
    delete snapshot.skeletonVersion;

    const parsed = fromRigSnapshotV2(snapshot);
    expect(parsed.skeletonVersion).toBe(initial.skeletonVersion);
  });

  it("preserves an explicit skeletonVersion", () => {
    const initial = createInitialRigState();
    const snapshot = {
      ...toRigSnapshotV2(initial),
      skeletonVersion: "v1" as const,
    };

    const parsed = fromRigSnapshotV2(snapshot);
    expect(parsed.skeletonVersion).toBe("v1");
  });
});
