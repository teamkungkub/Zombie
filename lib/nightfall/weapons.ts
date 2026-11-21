export const weaponSlots = [
  "rifle",
  "sidearm",
  "shotgun",
  "lmg",
  "marksman",
  "arc",
  "titan",
] as const;
export type WeaponId = (typeof weaponSlots)[number];
export type BonusWeapon = Exclude<WeaponId, "rifle">;
export const bossWeaponPools = {
  slam: ["sidearm", "shotgun"],
  charge: ["shotgun", "lmg"],
  mortar: ["lmg", "marksman", "shotgun"],
  spores: ["marksman", "lmg", "shotgun"],
} as const satisfies Record<string, readonly BonusWeapon[]>;

export const rareBossDrops = {
  arc: { minStage: 6, baseChance: 0.12, chancePerStage: 0.034, maxChance: 0.8 },
  titan: { minStage: 13, baseChance: 0.16, chancePerStage: 0.024, maxChance: 0.72 },
} as const;

export function rollBossWeapon(kind: keyof typeof bossWeaponPools, stage: number, random = Math.random): BonusWeapon {
  const { arc, titan } = rareBossDrops;
  if (stage >= arc.minStage && random() < Math.min(arc.maxChance, arc.baseChance + (stage - arc.minStage) * arc.chancePerStage)) {
    if (stage >= titan.minStage && random() < Math.min(titan.maxChance, titan.baseChance + (stage - titan.minStage) * titan.chancePerStage))
      return "titan";
    return "arc";
  }
  const pool = bossWeaponPools[kind];
  return pool[Math.floor(random() * pool.length)];
}

export function isRareWeapon(id: WeaponId) {
  return id === "arc" || id === "titan";
}

export function hasScope(id: WeaponId) {
  return id === "marksman" || id === "titan";
}
export type Ammo = { ammo: number; reserve: number };
export type Arsenal = Partial<Record<WeaponId, Ammo>>;
export const shotgunShellSeconds = 0.58;
export const surfaceImpactTuning = {
  markSeconds: 9,
  fadeSeconds: 3,
  maxMarks: 48,
  dustSeconds: 0.48,
  sparkSeconds: 0.22,
} as const;

export function loadShotgunShell(rounds: Ammo, capacity: number) {
  if (!rounds.reserve || rounds.ammo >= capacity) return false;
  rounds.ammo++;
  rounds.reserve--;
  return rounds.ammo < capacity && rounds.reserve > 0;
}

export const weapons = {
  rifle: {
    name: "M4A1",
    caliber: "5.56 MM",
    capacity: 30,
    pack: 0,
    delay: 0.12,
    reload: 2.1,
    damage: 38,
    head: 110,
    pellets: 1,
    spread: 0.006,
    range: 100,
    kick: 0.016,
    auto: true,
    muzzle: -1.13,
    sight: 48,
    fireFx: { recovery: 19, flash: 0.046, muzzleY: 0, portZ: -0.13, caseRadius: 0.012, caseLength: 0.048 },
  },
  sidearm: {
    name: "ปืนพก",
    caliber: "9 MM",
    capacity: 12,
    pack: 18,
    delay: 0.27,
    reload: 1.25,
    damage: 30,
    head: 85,
    pellets: 1,
    spread: 0.009,
    range: 45,
    kick: 0.012,
    auto: false,
    muzzle: -0.48,
    sight: 55,
    fireFx: { recovery: 24, flash: 0.043, muzzleY: 0.024, portZ: -0.19, caseRadius: 0.013, caseLength: 0.032 },
  },
  shotgun: {
    name: "ลูกซอง",
    caliber: "12 GA",
    capacity: 6,
    pack: 12,
    delay: 0.85,
    reload: shotgunShellSeconds,
    damage: 23,
    head: 35,
    pellets: 7,
    spread: 0.115,
    range: 23,
    kick: 0.044,
    auto: false,
    muzzle: -1.13,
    sight: 56,
    fireFx: { recovery: 12, flash: 0.072, muzzleY: 0.035, portZ: -0.2, caseRadius: 0.019, caseLength: 0.066 },
  },
  lmg: {
    name: "ปืนกลเบา",
    caliber: "LMG AMMO",
    capacity: 48,
    pack: 48,
    delay: 0.095,
    reload: 3.35,
    damage: 33,
    head: 89,
    pellets: 1,
    spread: 0.023,
    range: 85,
    kick: 0.021,
    auto: true,
    muzzle: -1.13,
    sight: 53,
    fireFx: { recovery: 17, flash: 0.053, muzzleY: 0.035, portZ: -0.22, caseRadius: 0.012, caseLength: 0.053 },
  },
  marksman: {
    name: "ไรเฟิลแม่นยำ",
    caliber: "7.62 MM",
    capacity: 8,
    pack: 16,
    delay: 0.55,
    reload: 2.3,
    damage: 86,
    head: 175,
    pellets: 1,
    spread: 0.002,
    range: 120,
    kick: 0.031,
    auto: false,
    muzzle: -1.22,
    sight: 38,
    fireFx: { recovery: 14, flash: 0.063, muzzleY: 0.035, portZ: -0.21, caseRadius: 0.014, caseLength: 0.061 },
  },
  arc: {
    name: "อาร์ก-9",
    caliber: ".45 ARC",
    capacity: 20,
    pack: 10,
    delay: 0.095,
    reload: 2.55,
    damage: 61,
    head: 137,
    pellets: 1,
    spread: 0.012,
    range: 95,
    kick: 0.028,
    auto: true,
    muzzle: -1.16,
    sight: 50,
    fireFx: { recovery: 17, flash: 0.056, muzzleY: 0.035, portZ: -0.21, caseRadius: 0.013, caseLength: 0.056 },
  },
  titan: {
    name: "ไททัน",
    caliber: "13 MM TITAN",
    capacity: 5,
    pack: 5,
    delay: 0.73,
    reload: 2.8,
    damage: 149,
    head: 275,
    pellets: 1,
    spread: 0.0015,
    range: 130,
    kick: 0.052,
    auto: false,
    muzzle: -1.33,
    sight: 35,
    fireFx: { recovery: 14, flash: 0.075, muzzleY: 0.035, portZ: -0.22, caseRadius: 0.017, caseLength: 0.074 },
  },
} as const;

export function collectWeapon(
  arsenal: Arsenal,
  id: Exclude<WeaponId, "rifle">,
) {
  const weapon = weapons[id];
  const previous = arsenal[id];
  if (!previous) {
    arsenal[id] = { ammo: weapon.capacity, reserve: weapon.pack };
    return { unlocked: true, added: weapon.pack };
  }
  const added = Math.min(
    weapon.pack,
    Math.max(0, weapon.pack * 2 - previous.reserve),
  );
  previous.reserve += added;
  return { unlocked: false, added };
}

export const ammoDropChance = 0.2;
export const dropRounds: Readonly<Record<WeaponId, number>> = {
  rifle: 3,
  sidearm: 2,
  shotgun: 1,
  lmg: 4,
  marksman: 1,
  arc: 1,
  titan: 1,
};

export type AmmoDrop = { weaponId: WeaponId; rounds: number };

export function rollAmmoDrop(
  arsenal: Arsenal,
  random = Math.random,
): AmmoDrop | null {
  if (random() >= ammoDropChance) return null;
  const owned = weaponSlots.filter((id) => arsenal[id]);
  const weaponId = owned[Math.floor(random() * owned.length)];
  return weaponId ? { weaponId, rounds: dropRounds[weaponId] } : null;
}

export function collectAmmoDrop(arsenal: Arsenal, drop: AmmoDrop) {
  const ammo = arsenal[drop.weaponId];
  if (!ammo) return false;
  if (isRareWeapon(drop.weaponId) && ammo.reserve + drop.rounds > weapons[drop.weaponId].pack * 2) return false;
  ammo.reserve += drop.rounds;
  return true;
}
