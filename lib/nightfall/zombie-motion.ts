import type { EnemyType } from "./rules";
import type { RoomZombie } from "./room-protocol";

export type ZombieMotion = Pick<RoomZombie, "x" | "y" | "z" | "yaw" | "pose">;

export const zombieCrawl = {
  legHits: 2,
  heavyLegHits: 3,
  collapseSeconds: 0.82,
  maxSpeed: 0.62,
  speedRatio: 0.54,
  rigHeight: 0.27,
  melee: { style: "crawl", trigger: 1.16, reach: 1.46, arc: 0.61, windup: 0.48 },
} as const;

export function zombieCrawlThreshold(kind: EnemyType) {
  return kind === "brute" || kind === "tank" ? zombieCrawl.heavyLegHits : zombieCrawl.legHits;
}

export function zombieImpactDirection(x: number, z: number, yaw: number) {
  const length = Math.hypot(x, z);
  return length > 0.001 ? { x: x / length, z: z / length } : { x: -Math.sin(yaw), z: -Math.cos(yaw) };
}

export function zombieLocalImpact(x: number, z: number, yaw: number) {
  return {
    forward: x * Math.sin(yaw) + z * Math.cos(yaw),
    sideways: x * Math.cos(yaw) - z * Math.sin(yaw),
  };
}

export function turnZombieToward(current: number, target: number, dt: number) {
  const delta = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  const step = delta * (1 - Math.exp(-12 * dt));
  return current + Math.max(-9 * dt, Math.min(9 * dt, step));
}

export function steerZombieVelocity(x: number, z: number, desiredX: number, desiredZ: number, dt: number) {
  const blend = 1 - Math.exp(-10 * dt);
  return { x: x + (desiredX - x) * blend, z: z + (desiredZ - z) * blend };
}

export function blendZombieMotion(from: ZombieMotion, to: ZombieMotion, amount: number): ZombieMotion {
  const t = Math.max(0, Math.min(1, amount));
  const lerp = (a: number, b: number) => a + (b - a) * t;
  const yaw = Math.atan2(Math.sin(to.yaw - from.yaw), Math.cos(to.yaw - from.yaw));
  return {
    x: lerp(from.x, to.x), y: lerp(from.y, to.y), z: lerp(from.z, to.z),
    yaw: from.yaw + yaw * t,
    pose: from.pose.map((angle, i) => lerp(angle, to.pose[i])),
  };
}

function ease(value: number, start: number, end: number) {
  const t = Math.max(0, Math.min(1, (value - start) / (end - start)));
  return t * t * (3 - 2 * t);
}

export function zombieCrawlTransition(seconds: number) {
  return {
    lower: ease(seconds, 0, zombieCrawl.collapseSeconds),
    brace: ease(seconds, 0, 0.29) * (1 - ease(seconds, 0.33, zombieCrawl.collapseSeconds)),
  };
}

export function zombieImpactMotion(seconds: number) {
  return ease(seconds, 0, 0.07) * (1 - ease(seconds, 0.10, 0.36));
}

export function zombieFallMotion(kind: EnemyType, seconds: number, startHeight: number, fallSpeed: number) {
  const heavy = kind === "brute" || kind === "tank";
  const flying = kind === "flier" && startHeight > 0.035;
  const gravity = 13;
  const dropTime = flying
    ? (Math.sqrt(fallSpeed ** 2 + 2 * gravity * startHeight) - fallSpeed) / gravity
    : 0;
  const landing = flying ? dropTime : heavy ? 0.96 : 0.67;
  const brace = heavy ? 0.30 : 0.10;
  const collapse = flying
    ? ease(seconds, 0, landing * 0.96)
    : ease(seconds, brace, landing);
  const stagger = heavy
    ? ease(seconds, 0, 0.16) * (1 - ease(seconds, 0.24, 0.62))
    : ease(seconds, 0, 0.12) * (1 - ease(seconds, 0.16, 0.42));
  const sinceImpact = Math.max(0, seconds - landing);
  const settle = seconds >= landing
    ? Math.sin(sinceImpact * (heavy ? 13 : 19)) * Math.exp(-sinceImpact * 10)
    : 0;
  return {
    airborne: flying,
    landed: seconds >= landing,
    height: flying ? Math.max(0, startHeight - fallSpeed * seconds - gravity * seconds ** 2 / 2) : 0,
    stagger,
    collapse,
    settle,
    release: ease(seconds, 0, flying ? Math.min(0.18, dropTime) : 0.2),
  };
}

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

export function zombieGaitPose(kind: EnemyType, phase: number, weight: number, limp = 0) {
  const gait = zombieGaits[kind];
  const swing = Math.sin(phase * 2 * Math.PI) * weight;
  const rightSwing = -Math.sin((phase + gait.asymmetry * 0.1) * 2 * Math.PI) * weight;
  const contact = phase * 2 % 1;
  const plant = Math.sin(contact * Math.PI) ** 2 * (gait.drop > 0 ? Math.exp(-contact * 5) * 6.5 : 1);
  const tuck = kind === "flier" ? 0.26 + weight * 0.3 : 0;
  const leftDrag = Math.max(0, -limp);
  const rightDrag = Math.max(0, limp);
  const uneven = Math.cos(phase * 2 * Math.PI) * weight * limp;
  return {
    lean: gait.lean * (0.28 + weight * 0.72),
    roll: swing * gait.roll - uneven * 0.13,
    height: -plant * gait.drop * weight - Math.max(0, uneven) * 0.045,
    leftLeg: swing * gait.stride * (1 - leftDrag * 0.66) + tuck + leftDrag * weight * 0.16,
    rightLeg: rightSwing * gait.stride * (1 - gait.asymmetry) * (1 - rightDrag * 0.66) + tuck + rightDrag * weight * 0.16,
    leftArm: gait.armReach - swing * gait.armSwing,
    rightArm: gait.armReach - rightSwing * gait.armSwing - gait.asymmetry * 0.38,
  };
}
