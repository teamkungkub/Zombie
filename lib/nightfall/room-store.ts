import { randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { grenadeFlight, grenadePlayerDamage, knifeTuning } from "./equipment.ts";
import { bosses, enemyTypes } from "./rules.ts";
import { weapons, type WeaponId } from "./weapons.ts";
import { zombieHitZones } from "./room-protocol.ts";
import type {
  CharacterId,
  RoomEvent,
  RoomFrame,
  RoomGrenade,
  RoomPlayer,
  RoomPose,
  RoomSession,
  RoomView,
  RoomWorld,
  ZombieGunImpact,
} from "./room-protocol.ts";

const playerLimit = 4;
const roomLimit = 128;
const presenceTimeout = 45_000;
export const abandonedRoomSeconds = 7 * 24 * 60 * 60;
const eventLimit = 256;
const hitCreditsMax = 28;

type Member = RoomPlayer & {
  secret: string;
  lastSeen: number;
  lastCommand: number;
  hitCredits: number;
  creditedAt: number;
  events: RoomEvent[];
};

export type StoredRoom = Omit<RoomView, "players"> & {
  members: Map<string, Member>;
  lastSeen: number;
  nextEvent: number;
  grenades?: RoomGrenade[];
};
type Room = StoredRoom;

type JsonObject = Record<string, unknown>;
export type RoomReply = { status: number; body: RoomFrame | { ok: true } | { error: string; code?: string } };

function object(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function between(value: unknown, low: number, high: number): value is number {
  return typeof value === "number" && value >= low && value <= high;
}

function integer(value: unknown, low = 0, high = Number.MAX_SAFE_INTEGER): value is number {
  return between(value, low, high) && Number.isInteger(value);
}

function knownKey<T extends object>(record: T, value: unknown): value is Extract<keyof T, string> {
  return typeof value === "string" && Object.hasOwn(record, value);
}

function character(value: unknown): value is CharacterId {
  return value === "vanguard" || value === "wraith" || value === "ember";
}

function position(value: JsonObject) {
  return between(value.x, -32, 32) && between(value.y, -2, 12) &&
    between(value.z, -32, 32) && between(value.yaw, -10_000, 10_000);
}

function pose(value: unknown): value is RoomPose {
  return object(value) && position(value) && between(value.pitch, -4, 4) &&
    typeof value.alive === "boolean" && integer(value.shot) &&
    (value.wave === undefined || integer(value.wave, 1, 100_000));
}

function validBoss(value: unknown) {
  return value === null || (object(value) && knownKey(bosses, value.kind) &&
    between(value.health, 0, 20_000) && between(value.maxHealth, 0, 20_000) &&
    typeof value.warning === "boolean" && (value.followup === undefined || typeof value.followup === "boolean") &&
    (value.ultimate === undefined || typeof value.ultimate === "boolean"));
}

function validZombie(value: unknown): boolean {
  return object(value) && integer(value.id, 1) && knownKey(enemyTypes, value.kind) &&
    position(value) && between(value.health, -5_000, 20_000) && between(value.scale, 0.1, 5) &&
    Array.isArray(value.pose) && value.pose.length === 18 &&
    value.pose.every((component) => between(component, -12, 12));
}

function validStrike(value: unknown) {
  return object(value) && between(value.x, -32, 32) && between(value.z, -32, 32) &&
    between(value.dx, -1, 1) && between(value.dz, -1, 1) && between(value.length, 0, 32) &&
    (value.followup === undefined || typeof value.followup === "boolean") &&
    (value.ultimate === undefined || typeof value.ultimate === "boolean");
}

function worldSnapshot(value: unknown): value is RoomWorld {
  return object(value) && integer(value.wave, 1, 100_000) &&
    (value.motionTime === undefined || between(value.motionTime, 0, 1_000_000)) &&
    between(value.timeLeft, 0, 60_000) && between(value.seconds, 0, 1_000_000) &&
    integer(value.kills) && integer(value.remaining, 0, 100) &&
    typeof value.gateOpen === "boolean" && typeof value.checkpoint === "boolean" &&
    typeof value.finished === "boolean" && typeof value.timedOut === "boolean" &&
    validBoss(value.boss) && (value.bossStrike === undefined || validStrike(value.bossStrike)) &&
    (value.bossReward === undefined || (object(value.bossReward) &&
      between(value.bossReward.x, -26, 26) && between(value.bossReward.z, -26, 26) &&
      value.bossReward.weaponId !== "rifle" && knownKey(weapons, value.bossReward.weaponId))) &&
    (value.bolts === undefined || (Array.isArray(value.bolts) && value.bolts.length <= 80 &&
      value.bolts.every(bolt => object(bolt) && between(bolt.x, -64, 64) &&
        between(bolt.y, -10, 16) && between(bolt.z, -64, 64)))) &&
    Array.isArray(value.zombies) && value.zombies.length <= 80 &&
    value.zombies.every(validZombie);
}

function sessionOf(value: unknown): RoomSession | null {
  if (!object(value) ||
    typeof value.code !== "string" || !/^\d{6}$/.test(value.code) ||
    typeof value.playerId !== "string" || !/^[\w-]{12}$/.test(value.playerId) ||
    typeof value.token !== "string" || !/^[\w-]{32}$/.test(value.token)) return null;
  return { code: value.code, playerId: value.playerId, token: value.token };
}

function fail(status: number, error: string, code?: string): RoomReply {
  return { status, body: { error, code } };
}

function end(room: Room) {
  room.status = "ended";
}

function addMember(room: Room, selected: CharacterId, now: number): RoomSession {
  const slots = new Set([...room.members.values()].map((member) => member.slot));
  const slot = [0, 1, 2, 3].find((index) => !slots.has(index))!;
  const id = randomBytes(9).toString("base64url");
  const secret = randomBytes(24).toString("base64url");
  room.members.set(id, {
    id, character: selected, slot, pose: null, secret,
    lastSeen: now, lastCommand: 0, hitCredits: hitCreditsMax, creditedAt: now, events: [],
  });
  return { code: room.code, playerId: id, token: secret };
}

function frame(room: Room, member: Member, since = 0, session?: RoomSession): RoomReply {
  const roomView: RoomView = {
    code: room.code,
    hostId: room.hostId,
    round: room.round,
    status: room.status,
    players: [...room.members.values()]
      .sort((a, b) => a.slot - b.slot)
      .map(({ id, character, slot, pose }) => ({ id, character, slot, pose })),
    world: room.world,
  };
  return {
    status: 200,
    body: {
      ...(session && { session }),
      room: roomView,
      events: member.events.filter((event) => event.id > since),
    },
  };
}

type PendingEvent = Omit<Extract<RoomEvent, { type: "damage" }>, "id"> |
  Omit<Extract<RoomEvent, { type: "zombie-hit" }>, "id"> |
  Omit<Extract<RoomEvent, { type: "grenade-thrown" }>, "id">;

function deliver(room: Room, recipient: Member, event: PendingEvent) {
  recipient.events.push({ ...event, id: room.nextEvent++ });
  if (recipient.events.length > eventLimit) recipient.events.shift();
}

function weaponMaximum(id: WeaponId) {
  return weapons[id].head * weapons[id].pellets;
}

function gunImpact(value: unknown): ZombieGunImpact | undefined {
  if (!object(value) || !between(value.x, -1, 1) || !between(value.z, -1, 1) ||
    !zombieHitZones.some((zone) => zone === value.zone)) return;
  const length = Math.hypot(value.x, value.z);
  if (length < 0.98 || length > 1.02) return;
  return { zone: value.zone as ZombieGunImpact["zone"], x: value.x / length, z: value.z / length };
}

function spendHit(member: Member) {
  if (member.hitCredits < 1) return false;
  member.hitCredits--;
  return true;
}

function throwGrenade(room: Room, member: Member, value: unknown, now: number) {
  if (!member.pose || !object(value) || !between(value.x, -26, 26) || !between(value.y, -2, 12) ||
    !between(value.z, -26, 26) || !between(value.yaw, -2 * Math.PI, 2 * Math.PI) || !between(value.pitch, -1.4, 1.4) ||
    !between(value.charge, 0, 1) || !integer(value.wave, 1, 100_000) ||
    (room.world?.wave !== undefined && value.wave !== room.world.wave) ||
    (member.pose.wave !== undefined && value.wave !== member.pose.wave)) return;
  const { x, y, z, yaw } = value;
  if (Math.hypot(x - member.pose.x, y - member.pose.y, z - member.pose.z) > 7) return;
  const active = room.grenades ??= [];
  if (active.filter((grenade) => grenade.source === member.id && grenade.detonatesAt > now).length >= 3) return;
  const grenade: RoomGrenade = {
    id: room.nextEvent++, source: member.id, x, y, z, yaw,
    pitch: value.pitch, charge: value.charge, wave: value.wave, detonatesAt: now + grenadeFlight.seconds * 1000,
  };
  active.push(grenade);
  for (const recipient of room.members.values()) deliver(room, recipient, { type: "grenade-thrown", grenade });
}

function grenadeBlast(room: Room, member: Member, value: JsonObject, now: number) {
  if (member.id !== room.hostId || !integer(value.grenadeId, 1) || !Array.isArray(value.targets) ||
    value.targets.length > playerLimit || !between(value.x, -26, 26) || !between(value.y, 0.25, 12) ||
    !between(value.z, -26, 26)) return;
  const active = room.grenades;
  const index = active?.findIndex(({ id }) => id === value.grenadeId) ?? -1;
  if (index < 0 || !active) return;
  const grenade = active[index];
  if (now + 120 < grenade.detonatesAt || (room.world?.wave !== undefined && grenade.wave !== room.world.wave) ||
    Math.hypot(value.x - grenade.x, value.z - grenade.z) > 18) return;
  active.splice(index, 1);
  for (const id of new Set(value.targets)) {
    if (typeof id !== "string" || id === grenade.source || id === member.id) continue;
    const recipient = room.members.get(id);
    const pose = recipient?.pose;
    if (!recipient || !pose?.alive || (pose.wave !== undefined && pose.wave !== grenade.wave)) continue;
    const distance = Math.hypot(pose.x - value.x, pose.y - 0.9 - value.y, pose.z - value.z);
    const amount = grenadePlayerDamage(distance);
    if (amount > 0) deliver(room, recipient, { type: "damage", amount, source: grenade.source, cause: "grenade" });
  }
}

function command(room: Room, member: Member, value: unknown, now: number) {
  if (!object(value) || !integer(value.id, 1) || value.id <= member.lastCommand) return;
  member.lastCommand = value.id;
  if (value.type === "throw-grenade") return throwGrenade(room, member, value.release, now);
  if (value.type === "grenade-blast") return grenadeBlast(room, member, value, now);
  if (!between(value.amount, 0.01, 10_000)) return;
  if (value.type === "hit-zombie") {
    if (room.hostId === member.id || !integer(value.target, 1)) return;
    const host = room.members.get(room.hostId);
    if (!host || (member.pose?.wave && member.pose.wave !== room.world?.wave)) return;
    const maximum = knownKey(weapons, value.weapon) ? weaponMaximum(value.weapon) :
      value.weapon === "knife" ? knifeTuning.damage : 0;
    if (maximum > 0 && spendHit(member)) {
      const impact = knownKey(weapons, value.weapon) ? gunImpact(value.impact) : undefined;
      deliver(room, host, {
        type: "zombie-hit", target: value.target, amount: Math.min(value.amount, maximum), source: member.id,
        ...(impact ? { impact } : {}),
      });
    }
    return;
  }
  if (typeof value.target !== "string" || value.target === member.id) return;
  const recipient = room.members.get(value.target);
  if (!recipient?.pose?.alive || !member.pose?.alive) return;
  if (member.pose.wave && recipient.pose.wave && member.pose.wave !== recipient.pose.wave) return;
  if (value.type === "enemy-damage" && room.hostId === member.id) {
    deliver(room, recipient, { type: "damage", amount: Math.min(value.amount, 100) });
  } else if (value.type === "hit-player" && knownKey(weapons, value.weapon)) {
    if (Math.hypot(member.pose.x - recipient.pose.x, member.pose.y - recipient.pose.y,
      member.pose.z - recipient.pose.z) > weapons[value.weapon].range + 2) return;
    if (spendHit(member)) deliver(room, recipient, {
      type: "damage", source: member.id, amount: Math.min(value.amount, weaponMaximum(value.weapon)),
    });
  }
}

export function createRoomStore(rooms = new Map<string, StoredRoom>(), roomCode?: string) {
  function sweep(now: number) {
    for (const [code, room] of rooms) {
      if (room.grenades?.length) room.grenades = room.grenades.filter(({ detonatesAt }) => detonatesAt + 8_000 >= now);
      for (const member of room.members.values()) {
        if (now - member.lastSeen >= presenceTimeout) member.pose = null;
      }
      if (room.members.size === 0 || now - room.lastSeen >= abandonedRoomSeconds * 1000)
        rooms.delete(code);
    }
  }

  return function handle(payload: unknown, now = Date.now()): RoomReply {
    sweep(now);
    if (!object(payload)) return fail(400, "Invalid room request.");
    if (payload.action === "create" || payload.action === "join") {
      if (!character(payload.character)) return fail(400, "เลือกตัวละครก่อนเข้าห้อง");
      if (payload.action === "create") {
        if (rooms.size >= roomLimit) return fail(503, "ห้องเต็มชั่วคราว ลองใหม่อีกครั้ง");
        let code = roomCode ?? generateRoomCode();
        while (rooms.has(code)) code = generateRoomCode();
        const room: Room = {
          code, hostId: "", status: "lobby", world: null, round: 0,
          members: new Map(), lastSeen: now, nextEvent: 1,
        };
        const session = addMember(room, payload.character, now);
        room.hostId = session.playerId;
        rooms.set(code, room);
        return frame(room, room.members.get(session.playerId)!, 0, session);
      }
      if (typeof payload.code !== "string" || !/^\d{6}$/.test(payload.code))
        return fail(400, "กรอกรหัสห้อง 6 หลัก");
      const room = rooms.get(payload.code);
      if (!room) return fail(404, "ไม่พบห้องนี้");
      if (room.status !== "lobby") return fail(409, "ห้องนี้เริ่มเกมหรือปิดไปแล้ว");
      if (room.members.size >= playerLimit) return fail(409, "ห้องนี้เต็มแล้ว");
      room.lastSeen = now;
      const session = addMember(room, payload.character, now);
      return frame(room, room.members.get(session.playerId)!, 0, session);
    }

    const session = sessionOf(payload.session);
    if (!session) return fail(401, "เซสชันห้องไม่ถูกต้อง", "SESSION_INVALID");
    const room = rooms.get(session.code);
    const member = room?.members.get(session.playerId);
    if (!room) return fail(404, "ห้องนี้ปิดไปแล้ว", "ROOM_CLOSED");
    if (!member || !timingSafeEqual(Buffer.from(member.secret, "base64url"), Buffer.from(session.token, "base64url")))
      return fail(404, "เซสชันห้องนี้ใช้ไม่ได้", "SESSION_INVALID");

    member.lastSeen = Math.max(member.lastSeen, now);
    room.lastSeen = Math.max(room.lastSeen, now);
    const owner = room.hostId === member.id;
    switch (payload.action) {
      case "leave":
        room.members.delete(member.id);
        if (owner) end(room);
        if (room.members.size === 0) rooms.delete(room.code);
        return { status: 200, body: { ok: true } };
      case "select":
        if (room.status !== "lobby") return fail(409, "เปลี่ยนตัวละครได้ก่อนเริ่มเกม");
        if (!character(payload.character)) return fail(400, "ไม่พบตัวละครนี้");
        member.character = payload.character;
        return frame(room, member);
      case "start":
        if (!owner) return fail(403, "ให้เจ้าของห้องเป็นผู้เริ่มเกม");
        if (room.status !== "playing") {
          room.round++;
          room.status = "playing";
          room.world = null;
          room.grenades = [];
          for (const player of room.members.values()) {
            player.pose = null;
            player.events = [];
            player.hitCredits = hitCreditsMax;
            player.creditedAt = now;
          }
        }
        return frame(room, member);
      case "sync": {
        const since = payload.since;
        if (!integer(since) || !Array.isArray(payload.commands) || payload.commands.length > 64 ||
          (payload.pose !== null && !pose(payload.pose)))
          return fail(400, "ข้อมูลผู้เล่นไม่ถูกต้อง");
        if (payload.world !== undefined && (!owner || !worldSnapshot(payload.world)))
          return fail(400, "ข้อมูลสนามไม่ถูกต้อง");
        if (payload.round !== undefined && !integer(payload.round))
          return fail(400, "หมายเลขรอบไม่ถูกต้อง");
        if (payload.round !== undefined && payload.round !== room.round)
          return frame(room, member, since);
        member.events = member.events.filter((event) => event.id > since);
        if (room.status !== "playing") return frame(room, member, since);
        if (payload.pose) member.pose = payload.pose;
        const world = owner && payload.world && (!room.world || payload.world.wave >= room.world.wave) ? payload.world : null;
        if (world) room.world = world;
        if (member.pose?.alive) {
          member.hitCredits = Math.min(hitCreditsMax, member.hitCredits + Math.max(0, now - member.creditedAt) * 0.024);
          member.creditedAt = now;
        }
        for (const entry of payload.commands) {
          if (member.pose?.alive || (owner && object(entry) && entry.type === "grenade-blast")) command(room, member, entry, now);
        }
        if (world?.finished) end(room);
        return frame(room, member, since);
      }
      default:
        return fail(400, "Unknown room action.");
    }
  };
}

export function generateRoomCode() {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function roomRequestKey(payload: unknown) {
  if (!object(payload)) return {};
  if (payload.action === "create") return { create: true };
  if (payload.action === "join") {
    return { key: typeof payload.code === "string" && /^\d{6}$/.test(payload.code) ? payload.code : undefined };
  }
  return { key: sessionOf(payload.session)?.code };
}
