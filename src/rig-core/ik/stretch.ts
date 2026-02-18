import { clamp } from "../graph";

export type SoftStretchConfig = {
  enabled: boolean;
  maxStretchRatio: number;
  curveStrength: number;
};

export const DEFAULT_SOFT_STRETCH_CONFIG: SoftStretchConfig = {
  enabled: false,
  maxStretchRatio: 1.25,
  curveStrength: 0.55,
};

const sanitizeConfig = (config?: Partial<SoftStretchConfig>): SoftStretchConfig => ({
  enabled: Boolean(config?.enabled),
  maxStretchRatio: Math.max(1, config?.maxStretchRatio ?? DEFAULT_SOFT_STRETCH_CONFIG.maxStretchRatio),
  curveStrength: clamp(config?.curveStrength ?? DEFAULT_SOFT_STRETCH_CONFIG.curveStrength, 0.05, 3),
});

export const resolveSoftStretchRatio = (
  targetDistance: number,
  baseLength: number,
  config?: Partial<SoftStretchConfig>
): number => {
  const safeLength = Math.max(1e-6, baseLength);
  const safeTarget = Math.max(0, targetDistance);
  const ratioToTarget = safeTarget / safeLength;
  const settings = sanitizeConfig(config);

  if (!settings.enabled || ratioToTarget <= 1) {
    return 1;
  }

  // Soft-IK style exponential damping inspired by common open-source rig solvers:
  // grow stretch gradually near extension instead of snapping to rigid reach ratio.
  const maxRatio = settings.maxStretchRatio;
  const normalized = clamp((ratioToTarget - 1) / Math.max(1e-6, maxRatio - 1), 0, 1);
  const curved = 1 - Math.exp(-(normalized / settings.curveStrength));
  const ratio = 1 + (maxRatio - 1) * curved;
  return clamp(ratio, 1, maxRatio);
};
