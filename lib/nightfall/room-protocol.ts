import type { BossKind, BossStrike, EnemyType } from "./rules";
import type { WeaponId } from "./weapons";

export const characterIds = ["vanguard", "wraith", "ember"] as const;
export type CharacterId = (typeof characterIds)[number];

export const characters = {
  vanguard: { name: "VANGUARD", role: "หน่วยจู่โจม", color: "#c6a365", description: "เกราะสีทองหม่นกับหมวกจู่โจม" },
  wraith: { name: "WRAITH", role: "หน่วยลาดตระเวน", color: "#75b4ba", description: "ฮู้ดสีฟ้าหม่นกับหน้ากากลาดตระเวน" },
  ember: { name: "EMBER", role: "ผู้รอดชีวิต", color: "#c0795e", description: "แจ็กเก็ตสีแดงอิฐกับผ้าคาดหน้า" },
} as const satisfies Record<CharacterId, { name: string; role: string; color: string; description: string }>;

export type RoomSession = { code: string; playerId: string; token: string };
export type RoomPose = { x: number; y: number; z: number; yaw: number; pitch: number; alive: boolean; shot: number; wave?: number };
export type RoomPlayer = { id: string; character: CharacterId; slot: number; pose: RoomPose | null };
export type RoomZombie = {
  id: number; kind: EnemyType; health: number;
  x: number; y: number; z: number; yaw: number; scale: number;
  // Body, rig, head, arms, legs, wings and throat transforms, in that order.
  pose: number[];
};
export type RoomWorld = {
  wave: number;
  timeLeft: number;
  seconds: number;
  kills: number;
  remaining: number;
  gateOpen: boolean;
  checkpoint: boolean;
  finished: boolean;
  timedOut: boolean;
  boss: { kind: BossKind; health: number; maxHealth: number; warning: boolean } | null;
  bossStrike?: BossStrike;
  bolts?: { x: number; y: number; z: number }[];
  zombies: RoomZombie[];
};
export type RoomView = {
  code: string;
  hostId: string;
  status: "lobby" | "playing" | "ended";
  players: RoomPlayer[];
  world: RoomWorld | null;
};
export type RoomCommandPayload =
  | { type: "hit-player"; target: string; weapon: WeaponId; amount: number }
  | { type: "hit-zombie"; target: number; weapon: WeaponId | "knife" | "grenade"; amount: number }
  | { type: "enemy-damage"; target: string; amount: number };
export type RoomCommand = RoomCommandPayload & { id: number };
export type RoomEvent =
  | { id: number; type: "damage"; amount: number; source?: string }
  | { id: number; type: "zombie-hit"; target: number; amount: number; source: string };
export type RoomFrame = { session?: RoomSession; room: RoomView; events: RoomEvent[] };
