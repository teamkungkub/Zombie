import type { EnemyType } from "./rules";

export const zombieGaits = {
  standard: { cycleDistance: 0.98, lean: 0.09, stride: 0.45, roll: 0.065, drop: 0.03, armReach: -0.87, armSwing: 0.23, asymmetry: 0.22, stepWeight: 1 },
  brute: { cycleDistance: 1.16, lean: 0.12, stride: 0.59, roll: 0.125, drop: 0.073, armReach: -0.42, armSwing: 0.43, asymmetry: 0.08, stepWeight: 1.7 },
  hunter: { cycleDistance: 1.30, lean: 0.47, stride: 0.94, roll: 0.047, drop: -0.067, armReach: -0.38, armSwing: 0.87, asymmetry: 0.05, stepWeight: 0.72 },
  tank: { cycleDistance: 0.88, lean: 0.045, stride: 0.29, roll: 0.152, drop: 0.059, armReach: -0.29, armSwing: 0.14, asymmetry: 0.1, stepWeight: 2 },
  flier: { cycleDistance: 1, lean: 0.19, stride: 0, roll: 0, drop: 0, armReach: -0.31, armSwing: 0, asymmetry: 0, stepWeight: 0 },
  spitter: { cycleDistance: 0.79, lean: 0.23, stride: 0.36, roll: 0.086, drop: 0.036, armReach: -0.69, armSwing: 0.14, asymmetry: 0.38, stepWeight: 0.88 },
} as const satisfies Record<EnemyType, Record<string, number>>;

export function advanceZombieGait(kind: EnemyType, phase: number, travel: number, scale: number) {
  return phase + travel / (zombieGaits[kind].cycleDistance * scale);
}

export function zombieGaitPose(kind: EnemyType, phase: number, weight: number) {
  const gait = zombieGaits[kind];
  const swing = Math.sin(phase * 2 * Math.PI) * weight;
  const rightSwing = -Math.sin((phase + gait.asymmetry * 0.1) * 2 * Math.PI) * weight;
  const contact = phase * 2 % 1;
  const plant = Math.sin(contact * Math.PI) * (gait.drop > 0 ? Math.exp(-contact * 5) * 3.8 : 1);
  const tuck = kind === "flier" ? 0.26 + weight * 0.3 : 0;
  return {
    lean: gait.lean * (0.28 + weight * 0.72),
    roll: swing * gait.roll,
    height: -plant * gait.drop * weight,
    leftLeg: swing * gait.stride + tuck,
    rightLeg: rightSwing * gait.stride * (1 - gait.asymmetry) + tuck,
    leftArm: gait.armReach - swing * gait.armSwing,
    rightArm: gait.armReach - rightSwing * gait.armSwing - gait.asymmetry * 0.38,
  };
}
