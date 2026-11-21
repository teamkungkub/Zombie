import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  abandonedRoomSeconds, createRoomStore, generateRoomCode, roomRequestKey,
  type RoomReply, type StoredRoom,
} from "./room-store.ts";

interface RoomStorage {
  read(key: string): Promise<string | null>;
  compareAndSet(key: string, expected: string | null, next: string | null): Promise<boolean>;
}

type RoomDocument = Omit<StoredRoom, "members"> & { members: [string, StoredRoom["members"] extends Map<string, infer M> ? M : never][] };

const noStorage: RoomReply = {
  status: 503, body: { error: "ระบบห้องกำลังเชื่อมต่อใหม่", code: "ROOM_STORAGE_UNAVAILABLE" },
};

export function createPersistentRoomHandler(storage: RoomStorage | null) {
  return async function handle(payload: unknown, now = Date.now()): Promise<RoomReply> {
    const request = roomRequestKey(payload);
    if (!request.key && !request.create) return createRoomStore()(payload, now);
    if (!storage) return noStorage;
    try {
      for (let attempt = 0; attempt < 7; attempt++) {
        const key = request.key ?? generateRoomCode();
        const previous = await storage.read(key);
        if (request.create && previous !== null) continue;
        const rooms = new Map<string, StoredRoom>();
        if (previous !== null) {
          const saved = JSON.parse(previous) as RoomDocument;
          rooms.set(key, { ...saved, members: new Map(saved.members) });
        }
        const result = createRoomStore(rooms, request.create ? key : undefined)(payload, now);
        const room = rooms.get(key);
        const next = room ? JSON.stringify({ ...room, members: [...room.members] }) : null;
        if (next === previous || await storage.compareAndSet(key, previous, next)) return result;
        await delay(5 + Math.floor(Math.random() * 16));
      }
    } catch {
      return noStorage;
    }
    return noStorage;
  };
}

const localLocks = new Map<string, Promise<void>>();

export function fileRoomStorage(directory: string): RoomStorage {
  const filename = (key: string) => join(directory, `${key}.json`);

  async function read(key: string) {
    try {
      return await readFile(filename(key), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  return {
    read,
    async compareAndSet(key, expected, next) {
      const target = filename(key);
      const previousLock = localLocks.get(target);
      let release!: () => void;
      const lock = new Promise<void>(resolve => { release = resolve; });
      localLocks.set(target, lock);
      await previousLock;
      try {
        if (await read(key) !== expected) return false;
        if (next === null) {
          await unlink(target);
        } else {
          await mkdir(directory, { recursive: true, mode: 0o700 });
          const temporary = `${target}.${randomUUID()}.tmp`;
          try {
            await writeFile(temporary, next, { flag: "wx", mode: 0o600 });
            await rename(temporary, target);
          } finally {
            await unlink(temporary).catch(() => {});
          }
        }
        return true;
      } finally {
        release();
        if (localLocks.get(target) === lock) localLocks.delete(target);
      }
    },
  };
}

const compareAndSetScript = `
local value = redis.call('GET', KEYS[1]) or ''
if value ~= ARGV[1] then return 0 end
if ARGV[2] == '' then
  redis.call('DEL', KEYS[1])
else
  redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3])
end
return 1
`;

export function redisRoomStorage(url: string, token: string, namespace = "nightfall:room:v2"): RoomStorage {
  const redisKey = (code: string) => `${namespace}:${code}`;
  async function command(parts: (number | string)[]) {
    const response = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(parts),
      cache: "no-store",
      signal: AbortSignal.timeout(3500),
    });
    if (!response.ok) throw new Error("Room storage request failed");
    const data = await response.json() as { result?: unknown; error?: string };
    if (data.error || !("result" in data)) throw new Error("Room storage returned an error");
    return data.result;
  }
  return {
    async read(key) {
      const result = await command(["GET", redisKey(key)]);
      if (result !== null && typeof result !== "string") throw new Error("Invalid room record");
      return result;
    },
    async compareAndSet(key, expected, next) {
      return await command([
        "EVAL", compareAndSetScript, 1, redisKey(key), expected ?? "", next ?? "", abandonedRoomSeconds,
      ]) === 1;
    },
  };
}

export function supabaseRoomStorage(url: string, secret: string, namespace = "nightfall:room:v2"): RoomStorage {
  const endpoint = `${url.replace(/\/+$/, "")}/rest/v1`;
  const roomKey = (code: string) => `${namespace}:${code}`;
  async function request(path: string, payload?: object): Promise<unknown> {
    const response = await fetch(`${endpoint}/${path}`, {
      method: payload ? "POST" : "GET",
      headers: { apikey: secret, "Content-Type": "application/json" },
      body: payload ? JSON.stringify(payload) : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(3500),
    });
    if (!response.ok) throw new Error("Room storage request failed");
    return response.json();
  }
  return {
    async read(key) {
      const query = new URLSearchParams({ select: "room_data", room_key: `eq.${roomKey(key)}` });
      const rows = await request(`nightfall_rooms?${query}`);
      if (!Array.isArray(rows)) throw new Error("Invalid room record");
      if (rows.length === 0) return null;
      if (rows.length !== 1 || typeof rows[0]?.room_data !== "string") throw new Error("Invalid room record");
      return rows[0].room_data;
    },
    async compareAndSet(key, expected, next) {
      const saved = await request("rpc/nightfall_room_compare_and_set", {
        p_room_key: roomKey(key), p_expected: expected, p_next: next,
      });
      if (typeof saved !== "boolean") throw new Error("Invalid room update result");
      return saved;
    },
  };
}

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseSecret = process.env.SUPABASE_SECRET_KEY;
const redisUrl = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
const namespace = `nightfall:${process.env.VERCEL_ENV ?? "local"}:room:v2`;
const storage = supabaseUrl || supabaseSecret
  ? supabaseUrl && supabaseSecret ? supabaseRoomStorage(supabaseUrl, supabaseSecret, namespace) : null
  : redisUrl && redisToken
    ? redisRoomStorage(redisUrl, redisToken, namespace)
    : process.env.VERCEL === "1" || redisUrl || redisToken
      ? null
      : fileRoomStorage(join(process.cwd(), ".nightfall-rooms"));

export const handleRoomRequest = createPersistentRoomHandler(storage);
