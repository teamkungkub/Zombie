import type { EnemyType } from "./rules";

export const zombieMelee = {
  standard: { style: "swipe", trigger: 1.29, reach: 1.52, arc: 0.55 },
  brute: { style: "slam", trigger: 1.46, reach: 1.65, arc: 0.28 },
  hunter: { style: "pounce", trigger: 2.55, reach: 1.52, arc: 0.55 },
  tank: { style: "shove", trigger: 1.29, reach: 1.52, arc: 0.72 },
  flier: { style: "dive", trigger: 1.29, reach: 1.52, arc: 0.62 },
  spitter: { style: "bite", trigger: 1.29, reach: 1.38, arc: 0.56 },
} as const satisfies Record<EnemyType, { style: string; trigger: number; reach: number; arc: number }>;

export const hunterPounce = { duration: 0.26, maxDistance: 3.35, radius: 0.64 } as const;

export function hunterPounceMotion(progress: number) {
  const t = Math.max(0, Math.min(1, progress));
  return { travel: t * t * (3 - 2 * t), lift: 4 * t * (1 - t) };
}

export function hunterPounceHits(x: number, z: number, endX: number, endZ: number, playerX: number, playerZ: number) {
  const dx = endX - x;
  const dz = endZ - z;
  const lengthSq = dx * dx + dz * dz;
  const progress = lengthSq
    ? Math.min(1, Math.max(0, ((playerX - x) * dx + (playerZ - z) * dz) / lengthSq))
    : 0;
  return Math.hypot(playerX - (x + dx * progress), playerZ - (z + dz * progress)) <= hunterPounce.radius;
}
