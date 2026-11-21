export type Obstacle = { x: number; z: number; w: number; d: number };

export function damageForHit(headshot: boolean) {
  return headshot ? 110 : 38;
}
export function reloadAmmo(ammo: number, reserve: number, capacity = 30) {
  const amount = Math.min(capacity - ammo, reserve);
  return { ammo: ammo + amount, reserve: reserve - amount };
}
export function waveSize(wave: number) {
  return Math.min(4 + wave * 2, 24);
}

export const enemyTypes = {
  standard: {
    health: 100,
    speed: 0.9,
    scale: 1,
    damage: 1,
    color: "#535943",
    width: 1,
  },
  brute: {
    health: 250,
    speed: 0.73,
    scale: 1.45,
    damage: 1.6,
    color: "#794737",
    width: 1.2,
  },
  hunter: {
    health: 145,
    speed: 2.15,
    scale: 1.24,
    damage: 1.2,
    color: "#795c39",
    width: 0.9,
  },
  tank: {
    health: 440,
    speed: 0.56,
    scale: 1.75,
    damage: 2,
    color: "#494864",
    width: 1.24,
  },
  flier: {
    health: 110,
    speed: 1.65,
    scale: 0.9,
    damage: 0.85,
    color: "#49516d",
    width: 0.86,
  },
  spitter: {
    health: 125,
    speed: 0.81,
    scale: 1.07,
    damage: 1.02,
    color: "#657a40",
    width: 0.94,
  },
};
export type EnemyType = keyof typeof enemyTypes;
export const spitterWindupSeconds = 0.92;
export const meleeWindupSeconds = {
  standard: 0.7,
  brute: 0.84,
  hunter: 0.56,
  tank: 0.92,
  flier: 0.64,
  spitter: 0.72,
} as const;
export const meleeRecoverySeconds = 0.46;

export function meleeStrikeHits(
  yaw: number,
  dx: number,
  dz: number,
  reach: number,
  arc = 0.55,
) {
  const distance = Math.hypot(dx, dz);
  return (
    distance <= reach &&
    dx * Math.sin(yaw) + dz * Math.cos(yaw) >= distance * arc
  );
}
export type Difficulty = "recruit" | "survivor" | "veteran";

export function zombieHitAmount(seconds: number) {
  return seconds >= 0 && seconds < 0.32
    ? Math.sin((seconds / 0.32) ** 0.5 * Math.PI) * (1 - seconds / 0.32)
    : 0;
}

export const bosses = {
  slam: {
    name: "ผู้พิทักษ์กักกัน",
    warning: "ทุบพื้น · ออกจากวงแดง",
    body: "brute",
    color: "#dc684e",
    health: 480,
    reach: 3.5,
    width: 3.5,
    windup: 0.95,
    damage: 25,
    cooldown: 2.1,
  },
  charge: {
    name: "นักล่ารางเหล็ก",
    warning: "กำลังพุ่งชน · หลบออกด้านข้าง",
    body: "hunter",
    color: "#ffbd62",
    health: 560,
    reach: 12,
    width: 1.35,
    windup: 1.05,
    damage: 30,
    cooldown: 2.25,
  },
  mortar: {
    name: "ยักษ์เตาหลอม",
    warning: "ลูกไฟกำลังตก · ออกจากวงสีส้ม",
    body: "tank",
    color: "#ff873f",
    health: 690,
    reach: 18,
    width: 2.9,
    windup: 1.35,
    damage: 29,
    cooldown: 2.35,
  },
  spores: {
    name: "แม่พันธุ์สปอร์",
    warning: "พ่นสปอร์ · ออกจากกรวยสีม่วง",
    body: "brute",
    color: "#e7a1fd",
    health: 620,
    reach: 9,
    width: 0.55,
    windup: 1.05,
    damage: 31,
    cooldown: 2.15,
  },
} as const satisfies Record<
  string,
  {
    name: string;
    warning: string;
    body: EnemyType;
    color: string;
    health: number;
    reach: number;
    width: number;
    windup: number;
    damage: number;
    cooldown: number;
  }
>;
export type BossKind = keyof typeof bosses;
export const bossCombos = {
  slam: { warning: "คลื่นกระแทกซ้ำ · หลบเข้าวงในหรือออกนอกวง", width: 6.2, windup: 0.85 },
  charge: { warning: "พุ่งชนรอบสอง · หลบออกด้านข้าง", width: 1.55, windup: 0.76 },
  mortar: { warning: "ลูกไฟสามลูก · ออกจากวงส้มทั้งหมด", width: 2.05, windup: 1.1 },
  spores: { warning: "พ่นกวาดซ้ำ · ออกจากกรวยม่วง", width: 0.84, windup: 0.85 },
} as const;
export const bossComboTiming = { gap: 0.36, chargeSeconds: 0.32, enrageHealth: 0.45, enragedWindup: 0.88, enragedCooldown: 0.75 } as const;
export const bossMortarSpread = 2.85;
export const bossUltimateMortarSpread = 3.6;
export const bossUltimateHealth = 0.22;
export const bossUltimates = {
  slam: { name: "พื้นถล่ม", warning: "พื้นถล่ม · พุ่งออกจากวงแดง", width: 8.2, reach: 8.2, windup: 1.3, damage: 48, color: "#ff4632" },
  charge: { name: "พุ่งชนระเบิดปลายทาง", warning: "พุ่งชนระเบิดปลายทาง · หลบทั้งแนวพุ่งและวงระเบิด", width: 2.05, reach: 19, windup: 1.35, damage: 49, color: "#ffd140" },
  mortar: { name: "ฝนดาวเพลิง", warning: "ฝนดาวเพลิง · พุ่งออกจากวงทั้งหมด", width: 2.4, reach: 22, windup: 1.5, damage: 51, color: "#ff5235" },
  spores: { name: "สปอร์สองทิศ", warning: "สปอร์สองทิศ · พุ่งหลบไปด้านข้าง", width: 0.79, reach: 14, windup: 1.32, damage: 46, color: "#ff77df" },
} as const;
export const bossCrashRadius = 3.25;
export type BossStrike = {
  x: number;
  z: number;
  dx: number;
  dz: number;
  length: number;
  followup?: boolean;
  ultimate?: boolean;
};

export function bossMortarTargets(strike: BossStrike) {
  const spread = strike.ultimate ? bossUltimateMortarSpread : bossMortarSpread;
  const offsets = strike.ultimate ? [[0, 0], [0, spread], [0, -spread], [spread, 0], [-spread, 0]] :
    strike.followup ? [[0, -spread], [0, 0], [0, spread]] : [[0, 0]];
  return offsets.map(([forward, side]) => ({
    x: strike.x + strike.dx * forward - strike.dz * side,
    z: strike.z + strike.dz * forward + strike.dx * side,
  }));
}

export function bossCrashCenter(strike: BossStrike) {
  return { x: strike.x + strike.dx * strike.length, z: strike.z + strike.dz * strike.length };
}

export function bossAttackWidth(kind: BossKind, strike: BossStrike) {
  return strike.ultimate ? bossUltimates[kind].width : strike.followup ? bossCombos[kind].width : bosses[kind].width;
}

export function bossAttackHits(
  kind: BossKind,
  strike: BossStrike,
  x: number,
  z: number,
) {
  const px = x - strike.x,
    pz = z - strike.z;
  const distance = Math.hypot(px, pz);
  const ahead = px * strike.dx + pz * strike.dz;
  const width = bossAttackWidth(kind, strike);
  if (kind === "charge") {
    const sideways = Math.abs(px * strike.dz - pz * strike.dx);
    return ahead >= 0 && ahead <= strike.length && sideways <= width;
  }
  if (kind === "spores")
    return distance <= strike.length && (strike.ultimate ? Math.abs(ahead) : ahead) >= distance * Math.cos(width);
  if (kind === "mortar" && (strike.followup || strike.ultimate))
    return bossMortarTargets(strike).some((target) => Math.hypot(x - target.x, z - target.z) <= width);
  if (kind === "slam" && strike.followup && !strike.ultimate) return distance > bosses.slam.width && distance <= width;
  return distance <= width;
}

export function stageEnemyScaling(stage: number) {
  const cleared = Math.max(0, stage - 1);
  return {
    health: 1 + 3 * Math.log1p(cleared * 0.035),
    speed: 1.09 + 0.95 * cleared / (cleared + 6),
    damage: 1 + 1.5 * cleared / (cleared + 18),
  };
}

export function nextStagePhase(remaining: number, defeatedBoss: boolean) {
  return remaining > 0 ? "combat" : defeatedBoss ? "exit" : "boss";
}

export function stagePlan(stage: number, difficulty: Difficulty) {
  const tier =
    stage + (difficulty === "veteran" ? 1 : difficulty === "recruit" ? -1 : 0);
  const enemies = Array.from({ length: waveSize(stage) }, (_, i): EnemyType => {
    if (tier >= 5 && i % 7 === 0) return "tank";
    if (tier >= 4 && i % 6 === 3) return "spitter";
    if (tier >= 3 && i % 6 === 2) return "flier";
    if (tier >= 2 && i % 4 === 1) return "hunter";
    if (tier >= 2 && i % 5 === 0) return "brute";
    return "standard";
  });
  const scale = stageEnemyScaling(stage).health;
  const baseShots = enemies.reduce(
    (total, kind) =>
      total + Math.ceil(enemyTypes[kind].health / damageForHit(false)),
    0,
  );
  const bodyShots = enemies.reduce(
    (total, kind) => total + Math.ceil(enemyTypes[kind].health * scale / damageForHit(false)), 0,
  );
  const allowance =
    difficulty === "recruit" ? 2.4 : difficulty === "veteran" ? 1.45 : 1.9;
  const time =
    difficulty === "recruit" ? 120 : difficulty === "veteran" ? 75 : 95;
  const bossKind = zoneForStage(stage).boss;
  const baseBossHealth = bosses[bossKind].health *
    (difficulty === "recruit" ? 0.82 : difficulty === "veteran" ? 1.18 : 1);
  const bossHealth = Math.round(baseBossHealth * (1 + (scale - 1) * 0.72));
  return {
    enemies,
    ammo: Math.ceil(
      (bodyShots + Math.ceil(bossHealth / damageForHit(false))) * allowance,
    ),
    time: Math.max(55, time - (stage - 1) * 3) + Math.ceil((bodyShots - baseShots) * 0.3),
    bossKind,
    bossHealth,
    bossTime: (difficulty === "recruit" ? 65 : difficulty === "veteran" ? 45 : 55) +
      Math.ceil((bossHealth - Math.round(baseBossHealth)) / damageForHit(false) * 0.8),
  };
}

export const zones = [
  {
    name: "ลานกักกัน",
    code: "QUARANTINE",
    sky: "#737e7a",
    ground: "#484b45",
    light: "#ffe3b5",
    exitX: 0,
    weapon: "sidearm",
    boss: "slam",
  },
  {
    name: "สถานีรถไฟร้าง",
    code: "RAIL DEPOT",
    sky: "#667c8d",
    ground: "#424b55",
    light: "#b4d8ff",
    exitX: -6,
    weapon: "shotgun",
    boss: "charge",
  },
  {
    name: "โรงหล่อเหล็ก",
    code: "FOUNDRY",
    sky: "#987965",
    ground: "#51463c",
    light: "#ffb076",
    exitX: 6,
    weapon: "lmg",
    boss: "mortar",
  },
  {
    name: "สวนพฤกษศาสตร์",
    code: "CONSERVATORY",
    sky: "#789688",
    ground: "#405149",
    light: "#c6edce",
    exitX: 0,
    weapon: "marksman",
    boss: "spores",
  },
] as const;
export const GATE_Z = -23;
export function zoneForStage(stage: number) {
  return zones[(stage - 1) % zones.length];
}
export function nextCheckpoint(stage: number) {
  return { x: zoneForStage(stage).exitX, z: GATE_Z + 2.5 };
}

export function crossedGate(
  stage: number,
  x: number,
  z: number,
  open: boolean,
) {
  return (
    open && Math.abs(x - zoneForStage(stage).exitX) <= 1.85 && z <= GATE_Z - 0.6
  );
}

export function objectiveAt(
  remaining: number,
  timeLeft: number,
  distance: number,
) {
  if (timeLeft <= 0) return "timeout";
  if (remaining === 0 && distance <= 2) return "advance";
  return "continue";
}

export function stageLoadout(ammo: number, reserve: number, budget: number) {
  return { ammo, reserve: Math.max(reserve, budget - ammo) };
}
export function canOccupy(x: number, z: number, obstacles: Obstacle[]) {
  const radius = 0.38;
  if (Math.abs(x) > 26 || Math.abs(z) > 26) return false;
  return !obstacles.some(
    (o) =>
      Math.abs(x - o.x) < o.w / 2 + radius &&
      Math.abs(z - o.z) < o.d / 2 + radius,
  );
}

const GRID_SIZE = 53;
const GRID_OFFSET = 26;
const DIRECTIONS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];
export type NavigationField = { distances: Int16Array; open: Uint8Array };

/** One shared reverse breadth-first search steers all enemies toward the player. */
export function buildNavigationField(
  playerX: number,
  playerZ: number,
  obstacles: Obstacle[],
): NavigationField {
  const distances = new Int16Array(GRID_SIZE * GRID_SIZE).fill(-1);
  const open = new Uint8Array(distances.length);
  const index = (x: number, z: number) =>
    (z + GRID_OFFSET) * GRID_SIZE + x + GRID_OFFSET;
  for (let z = -26; z <= 26; z++)
    for (let x = -26; x <= 26; x++)
      open[index(x, z)] = canOccupy(x, z, obstacles) ? 1 : 0;
  let goalX = Math.round(playerX),
    goalZ = Math.round(playerZ);
  if (!open[index(goalX, goalZ)]) {
    const baseX = goalX,
      baseZ = goalZ;
    let best = Infinity;
    for (let z = baseZ - 2; z <= baseZ + 2; z++)
      for (let x = baseX - 2; x <= baseX + 2; x++) {
        if (Math.abs(x) > 26 || Math.abs(z) > 26 || !open[index(x, z)])
          continue;
        const d = Math.hypot(x - playerX, z - playerZ);
        if (d < best) {
          best = d;
          goalX = x;
          goalZ = z;
        }
      }
  }
  const queue = new Int16Array(distances.length);
  const start = index(goalX, goalZ);
  if (!open[start]) return { distances, open };
  let head = 0,
    tail = 1;
  queue[0] = start;
  distances[start] = 0;
  while (head < tail) {
    const current = queue[head++],
      x = (current % GRID_SIZE) - GRID_OFFSET,
      z = Math.floor(current / GRID_SIZE) - GRID_OFFSET;
    for (const [dx, dz] of DIRECTIONS) {
      const nx = x + dx,
        nz = z + dz;
      if (Math.abs(nx) > 26 || Math.abs(nz) > 26) continue;
      const next = index(nx, nz);
      if (!open[next] || distances[next] !== -1) continue;
      if (dx && dz && (!open[index(x + dx, z)] || !open[index(x, z + dz)]))
        continue;
      distances[next] = distances[current] + 1;
      queue[tail++] = next;
    }
  }
  return { distances, open };
}

export function clearSegment(
  x: number,
  z: number,
  tx: number,
  tz: number,
  obstacles: Obstacle[],
) {
  const steps = Math.max(1, Math.ceil(Math.hypot(tx - x, tz - z) / 0.2));
  for (let i = 1; i <= steps; i++)
    if (
      !canOccupy(
        x + ((tx - x) * i) / steps,
        z + ((tz - z) * i) / steps,
        obstacles,
      )
    )
      return false;
  return true;
}

export function chaseWaypoint(
  x: number,
  z: number,
  playerX: number,
  playerZ: number,
  obstacles: Obstacle[],
  field: NavigationField,
) {
  if (clearSegment(x, z, playerX, playerZ, obstacles))
    return { x: playerX, z: playerZ };
  const cx = Math.round(x),
    cz = Math.round(z);
  let best = Infinity,
    target = { x, z };
  for (let nz = cz - 1; nz <= cz + 1; nz++)
    for (let nx = cx - 1; nx <= cx + 1; nx++) {
      if (Math.abs(nx) > 26 || Math.abs(nz) > 26) continue;
      const index = (nz + GRID_OFFSET) * GRID_SIZE + nx + GRID_OFFSET;
      if (
        !field.open[index] ||
        field.distances[index] < 0 ||
        !clearSegment(x, z, nx, nz, obstacles)
      )
        continue;
      const score = field.distances[index] + Math.hypot(nx - x, nz - z) * 0.45;
      if (score < best) {
        best = score;
        target = { x: nx, z: nz };
      }
    }
  return target;
}
