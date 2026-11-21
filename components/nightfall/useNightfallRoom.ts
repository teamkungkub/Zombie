import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { NightfallEngine } from "../../lib/nightfall/engine";
import type { CharacterId, RoomFrame, RoomSession, RoomView } from "../../lib/nightfall/room-protocol";

class RoomRequestError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message);
  }
}

async function sendRoomRequest<T>(
  body: Record<string, unknown>,
  signal?: AbortSignal,
  keepalive = false,
): Promise<T> {
  const response = await fetch("/api/nightfall/room", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(8000)]) : AbortSignal.timeout(8000),
    keepalive,
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    throw new RoomRequestError(
      typeof result?.error === "string" ? result.error : "ติดต่อห้องไม่ได้ กรุณาลองอีกครั้ง",
      typeof result?.code === "string" ? result.code : undefined,
    );
  }
  if (!result) throw new RoomRequestError("ระบบห้องกำลังเชื่อมต่อใหม่");
  return result as T;
}

function sameRoster(previous: RoomView | null, next: RoomView) {
  return previous?.code === next.code &&
    previous.status === next.status &&
    previous.round === next.round &&
    previous.hostId === next.hostId &&
    previous.players.length === next.players.length &&
    previous.players.every((player, index) => {
      const other = next.players[index];
      return player.id === other.id &&
        player.slot === other.slot &&
        player.character === other.character &&
        player.pose?.alive === other.pose?.alive;
    });
}

export function useNightfallRoom(
  engine: RefObject<NightfallEngine | null>,
  onStarted: () => void,
  onDisconnected: (message: string) => void,
) {
  const [session, setSession] = useState<RoomSession | null>(null);
  const [room, setRoom] = useState<RoomView | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const currentSession = useRef<RoomSession | null>(null);
  const currentRoom = useRef<RoomView | null>(null);
  const cursor = useRef(0);
  const commandRequest = useRef<AbortController | null>(null);
  const syncRequest = useRef<AbortController | null>(null);

  const clear = useCallback(() => {
    currentSession.current = null;
    currentRoom.current = null;
    cursor.current = 0;
    setSession(null);
    setRoom(null);
    engine.current?.leaveRoom();
  }, [engine]);

  const consume = useCallback((frame: RoomFrame, identity: RoomSession) => {
    const started = frame.room.status === "playing" &&
      (currentRoom.current?.status !== "playing" || currentRoom.current.round !== frame.room.round);
    engine.current?.applyRoomFrame(frame.room, identity.playerId, frame.events);
    currentRoom.current = frame.room;
    cursor.current = frame.events.reduce((last, event) => Math.max(last, event.id), cursor.current);
    setRoom((previous) => sameRoster(previous, frame.room) ? previous : frame.room);
    if (started) onStarted();
  }, [engine, onStarted]);

  useEffect(() => {
    if (!session) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let failures = 0;
    const tick = async () => {
      if (stopped || currentSession.current !== session) return;
      if (!commandRequest.current) {
        const request = new AbortController();
        syncRequest.current = request;
        try {
          const outgoing = engine.current?.roomUpdate() ?? { pose: null, commands: [] };
          const frame = await sendRoomRequest<RoomFrame>({
            action: "sync",
            session,
            since: cursor.current,
            ...outgoing,
          }, request.signal);
          if (stopped || request.signal.aborted || currentSession.current !== session) return;
          const through = outgoing.commands.at(-1)?.id;
          if (through !== undefined) engine.current?.acknowledgeRoomCommands(through);
          consume(frame, session);
          if (failures >= 3) setError("");
          failures = 0;
        } catch (cause) {
          if (!request.signal.aborted && currentSession.current === session) {
            if (cause instanceof RoomRequestError && (cause.code === "ROOM_CLOSED" || cause.code === "SESSION_INVALID")) {
              clear();
              onDisconnected(cause.message);
              return;
            }
            failures++;
            engine.current?.setRoomConnected(false);
            if (failures === 3) setError("สัญญาณห้องขาดหาย กำลังเชื่อมต่อใหม่…");
          }
        } finally {
          if (syncRequest.current === request) syncRequest.current = null;
        }
      }
      if (!stopped) {
        const delay = currentRoom.current?.status === "playing" ? 100 : 500;
        timer = setTimeout(tick, failures ? Math.min(3000, Math.max(delay, 350 * failures)) : delay);
      }
    };
    const wake = () => {
      if (stopped || document.hidden || syncRequest.current || commandRequest.current) return;
      clearTimeout(timer);
      timer = setTimeout(tick, 0);
    };
    timer = setTimeout(tick, 0);
    window.addEventListener("online", wake);
    document.addEventListener("visibilitychange", wake);
    return () => {
      stopped = true;
      clearTimeout(timer);
      syncRequest.current?.abort();
      window.removeEventListener("online", wake);
      document.removeEventListener("visibilitychange", wake);
    };
  }, [clear, consume, engine, onDisconnected, session]);

  useEffect(() => {
    return () => {
      commandRequest.current?.abort();
    };
  }, []);

  const command = async (action: "create" | "join" | "select" | "start", values: { code?: string; character?: CharacterId } = {}) => {
    if (commandRequest.current) return false;
    const request = new AbortController();
    commandRequest.current = request;
    syncRequest.current?.abort();
    setPending(true);
    setError("");
    const identity = currentSession.current;
    try {
      const frame = await sendRoomRequest<RoomFrame>({
        action,
        ...values,
        ...(identity ? { session: identity } : {}),
      }, request.signal);
      if (request.signal.aborted) return false;
      const nextIdentity = frame.session ?? identity;
      if (!nextIdentity) throw new Error("Room response missing session");
      if (frame.session && !identity) {
        cursor.current = 0;
        currentSession.current = frame.session;
        setSession(frame.session);
      }
      consume(frame, nextIdentity);
      return true;
    } catch (cause) {
      if (!request.signal.aborted) {
        if (identity && cause instanceof RoomRequestError && (cause.code === "ROOM_CLOSED" || cause.code === "SESSION_INVALID")) clear();
        setError(cause instanceof RoomRequestError ? cause.message : "เชื่อมต่อไม่ได้ กรุณาลองอีกครั้ง");
      }
      return false;
    } finally {
      if (commandRequest.current === request) {
        commandRequest.current = null;
        setPending(false);
      }
    }
  };

  const leave = () => {
    const identity = currentSession.current;
    commandRequest.current?.abort();
    commandRequest.current = null;
    syncRequest.current?.abort();
    setError("");
    setPending(false);
    clear();
    if (identity) void sendRoomRequest({ action: "leave", session: identity }, undefined, true).catch(() => {});
  };

  return { session, room, pending, error, command, leave };
}
