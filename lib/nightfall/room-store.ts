import { randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { knifeTuning } from "./equipment.ts";
import { bosses, enemyTypes } from "./rules.ts";
import { weapons, type WeaponId } from "./weapons.ts";
import type {
  CharacterId,
  RoomEvent,
  RoomFrame,
  RoomPlayer,
  RoomPose,
  RoomSession,
  RoomView,
  RoomWorld,
} from "./room-protocol.ts";

const playerLimit = 4;
const roomLimit = 128;
const playerTimeout = 30_000;
const roomTimeout = 300_000;
const eventLimit = 256;
const hitCreditsMax = 28;

type Member = RoomPlayer & {
  secret: Buffer;
  lastSeen: number;
  lastCommand: number;
  hitCredits: number;
  creditedAt: number;
  events: RoomEvent[];
};

type Room = Omit<RoomView, "players"> & {
  members: Map<string, Member>;
  lastSeen: number;
  nextEvent: number;
};

type JsonObject = Record<string, unknown>;
type Reply = { status: number; body: RoomFrame | { ok: true } | { error: string } };

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
    typeof value.warning === "boolean");
}

function validZombie(value: unknown): boolean {
  return object(value) && integer(value.id, 1) && knownKey(enemyTypes, value.kind) &&
    position(value) && between(value.health, -5_000, 20_000) && between(value.scale, 0.1, 5) &&
    Array.isArray(value.pose) && value.pose.length === 18 &&
    value.pose.every((component) => between(component, -12, 12));
}

function validStrike(value: unknown) {
  return object(value) && between(value.x, -32, 32) && between(value.z, -32, 32) &&
    between(value.dx, -1, 1) && between(value.dz, -1, 1) && between(value.length, 0, 32);
}

function worldSnapshot(value: unknown): value is RoomWorld {
  return object(value) && integer(value.wave, 1, 100_000) &&
    between(value.timeLeft, 0, 60_000) && between(value.seconds, 0, 1_000_000) &&
    integer(value.kills) && integer(value.remaining, 0, 100) &&
    typeof value.gateOpen === "boolean" && typeof value.checkpoint === "boolean" &&
    typeof value.finished === "boolean" && typeof value.timedOut === "boolean" &&
    validBoss(value.boss) && (value.bossStrike === undefined || validStrike(value.bossStrike)) &&
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

function fail(status: number, error: string): Reply {
  return { status, body: { error } };
}

function end(room: Room) {
  room.status = "ended";
}

function addMember(room: Room, selected: CharacterId, now: number): RoomSession {
  const slots = new Set([...room.members.values()].map((member) => member.slot));
  const slot = [0, 1, 2, 3].find((index) => !slots.has(index))!;
  const id = randomBytes(9).toString("base64url");
  const secret = randomBytes(24);
  room.members.set(id, {
    id, character: selected, slot, pose: null, secret,
    lastSeen: now, lastCommand: 0, hitCredits: hitCreditsMax, creditedAt: now, events: [],
  });
  return { code: room.code, playerId: id, token: secret.toString("base64url") };
}

function frame(room: Room, member: Member, since = 0, session?: RoomSession): Reply {
  const roomView: RoomView = {
    code: room.code,
    hostId: room.hostId,
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
  Omit<Extract<RoomEvent, { type: "zombie-hit" }>, "id">;

function deliver(room: Room, recipient: Member, event: PendingEvent) {
  recipient.events.push({ ...event, id: room.nextEvent++ });
  if (recipient.events.length > eventLimit) recipient.events.shift();
}

function weaponMaximum(id: WeaponId) {
  return weapons[id].head * weapons[id].pellets;
}

function spendHit(member: Member) {
  if (member.hitCredits < 1) return false;
  member.hitCredits--;
  return true;
}

function command(room: Room, member: Member, value: unknown) {
  if (!object(value) || !integer(value.id, 1) || value.id <= member.lastCommand ||
    !between(value.amount, 0.01, 10_000)) return;
  member.lastCommand = value.id;
  if (value.type === "hit-zombie") {
    if (room.hostId === member.id || !integer(value.target, 1)) return;
    const host = room.members.get(room.hostId);
    if (!host || (member.pose?.wave && member.pose.wave !== room.world?.wave)) return;
    const maximum = knownKey(weapons, value.weapon) ? weaponMaximum(value.weapon) :
      value.weapon === "knife" ? knifeTuning.damage :
      value.weapon === "grenade" ? 210 : 0;
    if (maximum > 0 && spendHit(member)) deliver(room, host, {
      type: "zombie-hit", target: value.target, amount: Math.min(value.amount, maximum), source: member.id,
    });
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

export function createRoomStore() {
  const rooms = new Map<string, Room>();

  function sweep(now: number) {
    for (const [code, room] of rooms) {
      for (const [id, member] of room.members) {
        if (now - member.lastSeen < playerTimeout) continue;
        room.members.delete(id);
        if (id === room.hostId) end(room);
      }
      if (room.members.size === 0 || now - room.lastSeen >= roomTimeout) rooms.delete(code);
    }
  }

  return function handle(payload: unknown, now = Date.now()): Reply {
    sweep(now);
    if (!object(payload)) return fail(400, "Invalid room request.");
    if (payload.action === "create" || payload.action === "join") {
      if (!character(payload.character)) return fail(400, "เลือกตัวละครก่อนเข้าห้อง");
      if (payload.action === "create") {
        if (rooms.size >= roomLimit) return fail(503, "ห้องเต็มชั่วคราว ลองใหม่อีกครั้ง");
        let code: string;
        do code = String(randomInt(0, 1_000_000)).padStart(6, "0");
        while (rooms.has(code));
        const room: Room = {
          code, hostId: "", status: "lobby", world: null,
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
    if (!session) return fail(401, "เซสชันห้องไม่ถูกต้อง");
    const room = rooms.get(session.code);
    const member = room?.members.get(session.playerId);
    if (!room || !member || !timingSafeEqual(member.secret, Buffer.from(session.token, "base64url")))
      return fail(404, "ห้องหรือเซสชันนี้หมดอายุแล้ว");

    member.lastSeen = room.lastSeen = now;
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
        if (room.status === "ended") return fail(409, "ห้องนี้ปิดแล้ว");
        room.status = "playing";
        return frame(room, member);
      case "sync": {
        const since = payload.since;
        if (!integer(since) || !Array.isArray(payload.commands) || payload.commands.length > 64 ||
          (payload.pose !== null && !pose(payload.pose)))
          return fail(400, "ข้อมูลผู้เล่นไม่ถูกต้อง");
        if (payload.world !== undefined && (!owner || !worldSnapshot(payload.world)))
          return fail(400, "ข้อมูลสนามไม่ถูกต้อง");
        member.events = member.events.filter((event) => event.id > since);
        if (room.status !== "playing") return frame(room, member, since);
        if (payload.pose) member.pose = payload.pose;
        if (member.pose?.alive) {
          member.hitCredits = Math.min(hitCreditsMax, member.hitCredits + Math.max(0, now - member.creditedAt) * 0.024);
          member.creditedAt = now;
          for (const entry of payload.commands) command(room, member, entry);
        }
        if (owner && payload.world && (!room.world || payload.world.wave >= room.world.wave)) {
          room.world = payload.world;
          if (room.world.finished) end(room);
        }
        return frame(room, member, since);
      }
      default:
        return fail(400, "Unknown room action.");
    }
  };
}

const processRooms = globalThis as typeof globalThis & {
  nightfallRoomStore?: ReturnType<typeof createRoomStore>;
};

export const handleRoomRequest = processRooms.nightfallRoomStore ??= createRoomStore();
