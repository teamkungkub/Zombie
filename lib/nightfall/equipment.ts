export const equipmentOrder = ["gun", "katana", "grenade", "medkit", "energy"] as const;
export type HeldItem = (typeof equipmentOrder)[number];
export const equipmentLimits = { grenade: 3, medkit: 2, energy: 2 } as const;
export type Equipment = keyof typeof equipmentLimits;
export const equipmentDropTuning = { chance: 0.35, maxMisses: 2, items: ["medkit", "medkit", "grenade", "energy"] } as const;

export function rollEquipmentDrop(misses: number, random = Math.random): Equipment | null {
  if (misses < equipmentDropTuning.maxMisses && random() >= equipmentDropTuning.chance) return null;
  const options = equipmentDropTuning.items;
  return options[Math.floor(random() * options.length)];
}
export const healingSeconds = 1.5;
export const injectionTiming = {
  liftEnd: 0.33,
  contact: 0.58,
  pressEnd: 1.06,
  withdrawEnd: 1.28,
} as const;

export function injectionPose(seconds: number) {
  const { liftEnd, contact, pressEnd, withdrawEnd } = injectionTiming;
  const ease = (start: number, end: number) => {
    const t = Math.max(0, Math.min(1, (seconds - start) / (end - start)));
    return t * t * (3 - 2 * t);
  };
  return {
    arm: ease(0, liftEnd) * (1 - ease(1.12, healingSeconds)),
    seat: ease(liftEnd, contact) * (1 - ease(pressEnd, withdrawEnd)),
    press: ease(contact, pressEnd),
    capped: seconds < 0.22,
  };
}

export const healAmount = 35;
export const boostSeconds = 10;
export const drinkingSeconds = 1.8;
export const drinkOpeningSeconds = 0.42;
export const throwChargeSeconds = 1;
export const knifeTuning = {
  staminaCost: 9,
  hitSeconds: 0.17,
  swingSeconds: 0.52,
  reach: 1.75,
  damage: 48,
  staggerSeconds: 0.26,
  pushback: 0.55,
} as const;

export function nextHeldItem(
  current: HeldItem,
  stock: Record<Equipment, number>,
) {
  const index = equipmentOrder.indexOf(current);
  for (let step = 1; step < equipmentOrder.length; step++) {
    const item = equipmentOrder[(index + step) % equipmentOrder.length];
    if (item === "gun" || item === "katana" || stock[item] > 0) return item;
  }
  return "gun";
}

export function throwCharge(heldSeconds: number) {
  return Math.max(0, Math.min(1, heldSeconds / throwChargeSeconds));
}
