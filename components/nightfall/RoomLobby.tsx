import Image from "next/image";
import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { characterIds, characters, type CharacterId } from "../../lib/nightfall/room-protocol";
import type { useNightfallRoom } from "./useNightfallRoom";
import "./room-lobby.css";

let portraits: Promise<Partial<Record<CharacterId, string>>> | undefined;
function loadPortraits() {
  return portraits ??= Promise.all([
    import("three"),
    import("../../lib/nightfall/survivor-models"),
  ]).then(([THREE, { SurvivorModels }]) => {
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(240, 220);
    renderer.setClearColor(0x000000, 0);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.16;
    const models = new SurvivorModels();
    try {
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(30, 240 / 220, 0.1, 12);
      camera.position.set(0.63, 1.63, 2.8);
      camera.lookAt(0, 1.33, 0);
      scene.add(new THREE.HemisphereLight("#dce7e1", "#667157", 2.8));
      const key = new THREE.DirectionalLight("#ffe7c4", 2.8);
      key.position.set(3, 4, 5);
      scene.add(key);
      const rim = new THREE.DirectionalLight("#99d8c5", 1.7);
      rim.position.set(-2, 0.5, -2);
      scene.add(rim);
      return Object.fromEntries(characterIds.map((id) => {
        const { group } = models.create(id);
        scene.add(group);
        renderer.render(scene, camera);
        const image = renderer.domElement.toDataURL("image/png");
        group.removeFromParent();
        return [id, image];
      }));
    } finally {
      models.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    }
  }).catch(() => ({}));
}

type Props = {
  mode: "room" | "character";
  selected: CharacterId;
  ready: boolean;
  multiplayer: ReturnType<typeof useNightfallRoom>;
  onSelect: (id: CharacterId) => void;
  onClose: () => void;
};

export default function RoomLobby({ mode, selected, ready, multiplayer, onSelect, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [code, setCode] = useState("");
  const [copied, setCopied] = useState(false);
  const [images, setImages] = useState<Partial<Record<CharacterId, string>>>({});
  const { session, room, pending, error, command, leave } = multiplayer;
  const owner = room && room.hostId === session?.playerId;
  const inRoom = !!session && !!room;
  const ended = room?.status === "ended";

  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    let mounted = true;
    void loadPortraits().then((next) => {
      if (mounted) setImages(next);
    });
    return () => {
      mounted = false;
      element?.close();
    };
  }, []);

  const select = async (id: CharacterId) => {
    if (inRoom && !(await command("select", { character: id }))) return;
    onSelect(id);
  };

  const join = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (code.length !== 6) {
      input.current?.focus();
      return;
    }
    void command("join", { code, character: selected });
  };

  const copy = async () => {
    if (!room) return;
    try {
      await navigator.clipboard.writeText(room.code);
      setCopied(true);
    } catch {
      const range = document.createRange();
      const number = dialog.current?.querySelector(".room-code strong");
      if (!number) return;
      range.selectNodeContents(number);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
  };

  return (
    <dialog
      ref={dialog}
      className="room-lobby"
      aria-labelledby="room-lobby-title"
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onClick={(event) => { if (event.currentTarget === event.target) onClose(); }}
    >
      <div className="room-lobby-inner">
        <header className="room-lobby-header">
          <div>
            <h2 id="room-lobby-title">{mode === "room" ? "เล่นกับเพื่อน" : "เลือกตัวละคร"}</h2>
            {mode === "room" && <p>ส่งรหัสห้องให้เพื่อน แล้วลงสนามด้วยกัน</p>}
          </div>
          <button className="room-close" onClick={onClose} aria-label="ปิดหน้าต่าง" autoFocus>
            <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
          </button>
        </header>

        <fieldset className="room-operators" disabled={pending || ended}>
          <legend>{mode === "room" ? "ตัวละครของคุณ" : "ตัวละครทั้งสาม"}</legend>
          <div className="room-operator-grid">
            {characterIds.map((id) => {
              const entry = characters[id];
              return (
                <label className="room-operator" key={id} style={{ "--operator-color": entry.color } as CSSProperties}>
                  <input type="radio" name="nightfall-character" checked={selected === id} onChange={() => void select(id)} />
                  <span className="room-operator-body">
                    <span className="room-portrait" aria-hidden="true">
                      {images[id] ? (
                        <Image src={images[id]} alt="" fill unoptimized sizes="(max-width: 600px) 30vw, 220px" />
                      ) : (
                        <span className="room-portrait-initial">{entry.name.charAt(0)}</span>
                      )}
                      <span className="room-operator-mark" />
                    </span>
                    <span className="room-operator-label">
                      <strong>{entry.name}</strong>
                      <span>{entry.role}</span>
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
          <p className="room-operator-description">{characters[selected].description}</p>
        </fieldset>

        {mode === "room" && (
          <section className="room-controls" aria-label="จัดการห้อง">
            <p className="room-friendly-fire">
              <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 2.5 20h19L12 3Zm0 6v4m0 3v.5" /></svg>
              เปิดการยิงโดนเพื่อน กระสุนสร้างความเสียหายให้คนในทีมได้
            </p>
            {inRoom ? (
              <>
                <div className="room-code">
                  <div>
                    <span>รหัสห้อง</span>
                    <strong>{room.code}</strong>
                  </div>
                  <button className="room-button" onClick={() => void copy()}>{copied ? "คัดลอกแล้ว" : "คัดลอกรหัส"}</button>
                </div>
                <div className="room-roster-title"><span>สมาชิกในห้อง</span><strong>{room.players.length}/4</strong></div>
                <ul className="room-roster">
                  {room.players.map((player) => (
                    <li key={player.id}>
                      <span className="room-member-dot" style={{ background: characters[player.character].color }} />
                      <span>{characters[player.character].name}</span>
                      <small>{player.id === session.playerId && "คุณ"}{player.id === session.playerId && player.id === room.hostId && " · "}{player.id === room.hostId && "เจ้าของห้อง"}</small>
                    </li>
                  ))}
                </ul>
                <div className="room-footer">
                  {ended ? (
                    <span role="status">ห้องปิดแล้ว</span>
                  ) : owner ? (
                    <button className="room-button room-button-primary" disabled={pending || !ready || room.players.length < 2} onClick={() => void command("start")}>เริ่มภารกิจ</button>
                  ) : (
                    <span role="status">รอเจ้าของห้องเริ่มภารกิจ</span>
                  )}
                  <button className="room-button room-button-leave" onClick={leave}>ออกจากห้อง</button>
                </div>
              </>
            ) : (
              <div className="room-connect">
                <button className="room-button room-button-primary" disabled={pending || !ready} onClick={() => void command("create", { character: selected })}>สร้างห้อง</button>
                <form className="room-join" onSubmit={join}>
                  <label htmlFor="room-code-input">รหัสห้อง 6 หลัก</label>
                  <div>
                    <input id="room-code-input" ref={input} autoComplete="off" inputMode="numeric" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/[^0-9]/g, ""))} placeholder="000000" />
                    <button className="room-button" disabled={pending || !ready || code.length !== 6}>เข้าห้อง</button>
                  </div>
                </form>
              </div>
            )}
            {pending && <p className="room-message" role="status">กำลังติดต่อห้อง…</p>}
            {error && <p className="room-message room-error" role="alert">{error}</p>}
          </section>
        )}
        {mode === "character" && <div className="room-footer"><button className="room-button room-button-primary" onClick={onClose}>ยืนยันตัวละคร</button></div>}
      </div>
    </dialog>
  );
}
