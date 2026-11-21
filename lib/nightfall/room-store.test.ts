import assert from "node:assert/strict";
import { test } from "node:test";
import type { RoomFrame, RoomPose, RoomSession, RoomWorld } from "./room-protocol.ts";
import { createRoomStore } from "./room-store.ts";

const hostPose: RoomPose = { x: 0, y: 1.7, z: 17, yaw: 0, pitch: 0, alive: true, shot: 0 };
const guestPose: RoomPose = { ...hostPose, x: 2 };

function setup() {
  let now = 0;
  const handle = createRoomStore();
  const send = (request: Record<string, unknown>) => handle(request, now);
  const frame = (request: Record<string, unknown>) => {
    const response = send(request);
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.ok("room" in response.body);
    return response.body;
  };
  const create = () => frame({ action: "create", character: "vanguard" }).session!;
  const join = (code: string) => frame({ action: "join", code, character: "wraith" }).session!;
  const sync = (session: RoomSession, fields: Record<string, unknown> = {}): RoomFrame =>
    frame({ action: "sync", session, since: 0, pose: null, commands: [], ...fields });
  return { send, frame, create, join, sync, advance: (ms: number) => { now += ms; } };
}

test("protected six-digit rooms support four selections and only the host can start", () => {
  const { send, frame, create, join, sync } = setup();
  const host = create();
  const guest = join(host.code);
  assert.match(host.code, /^\d{6}$/);
  assert.notEqual(host.token, guest.token);
  assert.equal(send({ action: "start", session: guest }).status, 403);
  assert.equal(send({ action: "start", session: { ...host, token: guest.token } }).status, 404);
  assert.equal(frame({ action: "select", session: guest, character: "ember" }).room.players[1].character, "ember");
  join(host.code);
  join(host.code);
  assert.equal(send({ action: "join", code: host.code, character: "ember" }).status, 409);
  assert.equal(frame({ action: "start", session: host }).room.status, "playing");
  assert.equal(sync(guest).room.status, "playing");
  assert.equal(send({ action: "select", session: guest, character: "wraith" }).status, 409);
});

test("friendly fire is bounded, relayed once, and acknowledged by event cursor", () => {
  const { send, create, join, sync } = setup();
  const host = create();
  const guest = join(host.code);
  send({ action: "start", session: host });
  sync(host, { pose: hostPose });
  const shot = { id: 1, type: "hit-player", target: host.playerId, weapon: "sidearm", amount: 900 };
  sync(guest, { pose: guestPose, commands: [shot] });
  sync(guest, { pose: guestPose, commands: [shot] });
  const [event, extra] = sync(host).events;
  assert.equal(event.type, "damage");
  assert.equal(event.amount, 85);
  assert.equal(event.source, guest.playerId);
  assert.equal(extra, undefined);
  assert.deepEqual(sync(host, { since: event.id }).events, []);
  sync(guest, { pose: { ...guestPose, alive: false }, commands: [{ ...shot, id: 2 }] });
  assert.deepEqual(sync(host).events, []);
});

test("only a host owns world snapshots and enemy damage while guests can report zombie hits", () => {
  const { send, create, join, sync } = setup();
  const host = create();
  const guest = join(host.code);
  send({ action: "start", session: host });
  const world: RoomWorld = {
    wave: 1, timeLeft: 90, seconds: 4, kills: 0, remaining: 1, gateOpen: false,
    checkpoint: false, finished: false, timedOut: false, boss: null,
    zombies: [{ id: 1, kind: "standard", health: 100, x: 2, y: 0, z: 15, yaw: 0, scale: 1, pose: Array(18).fill(0) }],
  };
  sync(host, { pose: hostPose, world });
  const invalidWorld = { ...world, zombies: [{ ...world.zombies[0], pose: [] }] };
  assert.equal(send({ action: "sync", session: host, pose: hostPose, commands: [], since: 0, world: invalidWorld }).status, 400);
  assert.equal(send({ action: "sync", session: guest, pose: guestPose, commands: [], since: 0, world }).status, 400);

  const guestReply = sync(guest, { pose: guestPose, commands: [
    { id: 1, type: "enemy-damage", target: host.playerId, amount: 17 },
    { id: 2, type: "hit-zombie", target: 1, amount: 95, weapon: "knife" },
  ] });
  assert.deepEqual(guestReply.room.world, world);
  const hostReply = sync(host, { pose: hostPose, commands: [
    { id: 1, type: "enemy-damage", target: guest.playerId, amount: 17 },
  ] });
  assert.deepEqual(hostReply.events, [{ id: 1, type: "zombie-hit", target: 1, amount: 48, source: guest.playerId }]);
  assert.deepEqual(sync(guest).events, [{ id: 2, type: "damage", amount: 17 }]);
  assert.equal(sync(host, { world: { ...world, finished: true } }).room.status, "ended");
});

test("a dropped host closes the shared session and stale room credentials expire", () => {
  const { send, create, join, sync, advance } = setup();
  const host = create();
  const guest = join(host.code);
  send({ action: "start", session: host });
  advance(20_000);
  assert.equal(sync(guest).room.status, "playing");
  advance(12_000);
  assert.equal(sync(guest).room.status, "ended");
  assert.equal(send({ action: "start", session: host }).status, 404);
  advance(30_000);
  assert.equal(send({ action: "join", code: host.code, character: "wraith" }).status, 404);
});
