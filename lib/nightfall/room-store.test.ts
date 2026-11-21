import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join as joinPath } from "node:path";
import { test } from "node:test";
import type { RoomFrame, RoomPose, RoomSession, RoomWorld } from "./room-protocol.ts";
import { createRoomStore } from "./room-store.ts";
import { createPersistentRoomHandler, fileRoomStorage, supabaseRoomStorage } from "./room-persistence.ts";

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
  sync(guest, { pose: guestPose, commands: [
    { id: 3, type: "hit-zombie", target: 1, amount: 30, weapon: "sidearm", impact: { zone: "right-leg", x: 0, z: -1 } },
    { id: 4, type: "hit-zombie", target: 1, amount: 30, weapon: "sidearm", impact: { zone: "left-leg", x: 1, z: 1 } },
  ] });
  const hits = sync(host, { since: 1 }).events;
  assert.deepEqual(hits[0], { id: 3, type: "zombie-hit", target: 1, amount: 30, source: guest.playerId, impact: { zone: "right-leg", x: 0, z: -1 } });
  assert.deepEqual(hits[1], { id: 4, type: "zombie-hit", target: 1, amount: 30, source: guest.playerId });
  assert.equal(sync(host, { world: { ...world, finished: true } }).room.status, "ended");
});

test("a long interruption preserves the room and either player can reconnect with the same session", () => {
  const { send, create, join, sync, advance } = setup();
  const host = create();
  const guest = join(host.code);
  send({ action: "start", session: host });
  sync(host, { pose: hostPose });
  advance(60_000);
  assert.equal(sync(guest).room.status, "playing");
  assert.equal(sync(guest).room.players.find(player => player.id === host.playerId)?.pose, null);
  assert.equal(sync(host, { pose: hostPose }).room.status, "playing");
  advance(15 * 60_000);
  assert.deepEqual(sync(host, { pose: hostPose }).room.players.map(player => player.id), [host.playerId, guest.playerId]);
  assert.equal(sync(guest, { pose: guestPose }).room.players.length, 2);
  assert.equal(send({ action: "leave", session: host }).status, 200);
  assert.equal(sync(guest).room.status, "ended");
  assert.equal(send({ action: "start", session: host }).status, 404);
});

test("the host can start another round in the same room and stale commands cannot end it", () => {
  const { send, frame, create, join, sync } = setup();
  const host = create();
  const guest = join(host.code);
  const first = frame({ action: "start", session: host }).room.round;
  const finished: RoomWorld = {
    wave: 1, timeLeft: 0, seconds: 60, kills: 0, remaining: 6,
    gateOpen: false, checkpoint: false, finished: true, timedOut: true,
    boss: null, zombies: [],
  };
  assert.equal(sync(host, { round: first, world: finished }).room.status, "ended");
  assert.equal(send({ action: "start", session: guest }).status, 403);
  const replay = frame({ action: "start", session: host }).room;
  assert.equal(replay.round, first + 1);
  assert.equal(replay.code, host.code);
  assert.equal(replay.players.length, 2);
  assert.equal(sync(host, { round: first, world: finished }).room.status, "playing");
});

test("a second room handler can recover persisted credentials and preserve concurrent joins", async (t) => {
  const directory = await mkdtemp(joinPath(tmpdir(), "nightfall-room-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const first = createPersistentRoomHandler(fileRoomStorage(directory));
  const opened = await first({ action: "create", character: "vanguard" }, 1000);
  assert.ok("session" in opened.body && opened.body.session);
  const host = opened.body.session;
  const second = createPersistentRoomHandler(fileRoomStorage(directory));
  const guests = await Promise.all(["wraith", "ember", "vanguard"].map((character) =>
    second({ action: "join", character, code: host.code }, 2000),
  ));
  assert.ok(guests.every(guest => guest.status === 200));
  assert.equal((await second({ action: "start", session: host }, 3000)).status, 200);
  const sync = { action: "sync", session: host, pose: hostPose, commands: [], since: 0, round: 1 };
  const resumed = await createPersistentRoomHandler(fileRoomStorage(directory))(sync, 15 * 60_000);
  assert.ok("room" in resumed.body);
  assert.equal(resumed.body.room.status, "playing");
  assert.equal(resumed.body.room.players.length, 4);
  assert.equal(resumed.body.room.players[0].id, host.playerId);
  const unavailable = await createPersistentRoomHandler(null)(sync);
  assert.equal(unavailable.status, 503);
  assert.ok("code" in unavailable.body);
  assert.equal(unavailable.body.code, "ROOM_STORAGE_UNAVAILABLE");
});

test("Supabase room storage keeps credentials server-side and retries a concurrent write", async (t) => {
  const records = new Map<string, string>();
  const endpoint = "https://example.supabase.co/rest/v1";
  const secret = "sb_secret_test";
  let conflicts = 0;
  t.mock.method(globalThis, "fetch", async (input: string, options: RequestInit) => {
    assert.equal(new Headers(options.headers).get("apikey"), secret);
    assert.equal(new Headers(options.headers).has("authorization"), false);
    if (options.method === "GET") {
      const url = new URL(input);
      assert.equal(url.origin + url.pathname, endpoint + "/nightfall_rooms");
      assert.equal(url.searchParams.get("select"), "room_data");
      const key = url.searchParams.get("room_key")!.slice(3);
      const record = records.get(key);
      return Response.json(record === undefined ? [] : [{ room_data: record }]);
    }
    assert.equal(input, endpoint + "/rpc/nightfall_room_compare_and_set");
    const { p_room_key, p_expected, p_next } = JSON.parse(options.body as string);
    if ((records.get(p_room_key) ?? null) !== p_expected) {
      conflicts++;
      return Response.json(false);
    }
    if (p_next === null) records.delete(p_room_key);
    else records.set(p_room_key, p_next);
    return Response.json(true);
  });
  const handle = createPersistentRoomHandler(supabaseRoomStorage("https://example.supabase.co/", secret));
  const opened = await handle({ action: "create", character: "vanguard" }, 1000);
  assert.ok("session" in opened.body && opened.body.session);
  const host = opened.body.session;
  const second = createPersistentRoomHandler(supabaseRoomStorage("https://example.supabase.co", secret));
  const joined = await Promise.all(["wraith", "ember"].map((character) =>
    second({ action: "join", code: host.code, character }, 1100),
  ));
  assert.ok(joined.every((reply) => reply.status === 200));
  assert.ok(conflicts > 0);
  const state = await handle({ action: "start", session: host }, 1200);
  assert.ok("room" in state.body);
  assert.equal(state.body.room.players.length, 3);
  assert.doesNotMatch(JSON.stringify(state.body), /sb_secret_test/);
});
