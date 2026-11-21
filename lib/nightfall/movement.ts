export const dodgeTuning = {
  staminaCost: 14,
  seconds: 0.22,
  distance: 2.4,
  cooldownSeconds: 0.68,
  recoveryDelay: 0.42,
} as const;

export function movementInWorld(forward: number, right: number, yaw: number) {
  return {
    x: -Math.sin(yaw) * forward + Math.cos(yaw) * right,
    z: -Math.cos(yaw) * forward - Math.sin(yaw) * right,
  };
}

export function dodgeDistanceAt(seconds: number) {
  const fraction = Math.max(0, Math.min(1, seconds / dodgeTuning.seconds));
  return dodgeTuning.distance * (1 - (1 - fraction) ** 1.4);
}
