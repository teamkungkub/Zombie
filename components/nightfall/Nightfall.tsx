"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  NightfallEngine,
  Settings,
  Snapshot,
  Difficulty,
} from "../../lib/nightfall/engine";
import "./nightfall.css";
import { bossCombos, bosses, bossUltimates, zoneForStage } from "../../lib/nightfall/rules";
import { weapons, weaponSlots } from "../../lib/nightfall/weapons";
import { characters, type CharacterId } from "../../lib/nightfall/room-protocol";
import RoomLobby from "./RoomLobby";
import { useNightfallRoom } from "./useNightfallRoom";
import {
  drinkOpeningSeconds,
  drinkingSeconds,
  knifeTuning,
} from "../../lib/nightfall/equipment";

const INITIAL: Snapshot = {
  status: "menu",
  fps: null,
  health: 100,
  ammo: 30,
  reserve: 0,
  weaponId: "rifle",
  inventory: [{ id: "rifle", total: 30 }],
  weaponPickup: null,
  kills: 0,
  wave: 1,
  remaining: 6,
  seconds: 0,
  reloading: false,
  reloadProgress: null,
  stamina: 100,
  aiming: false,
  message: "",
  hit: 0,
  hurt: 0,
  timeLeft: 0,
  checkpointDistance: null,
  checkpointAngle: 0,
  grenades: 0,
  medkits: 0,
  energy: 0,
  heldItem: "gun",
  healProgress: null,
  drinkProgress: null,
  throwProgress: null,
  boost: 0,
  timedOut: false,
  gateOpen: false,
  spitWarning: false,
  boss: null,
};
const heldLabels = {
  katana: { name: "ดาบคาตานะ", action: "คลิกซ้ายหรือกด V เพื่อฟัน" },
  grenade: { name: "ระเบิด", action: "กดค้าง แล้วปล่อยเพื่อโยน" },
  medkit: { name: "ยาฉีดรักษา", action: "คลิกซ้ายเพื่อฉีดยา" },
  energy: { name: "เครื่องดื่มชูกำลัง", action: "คลิกซ้ายเพื่อดื่ม" },
};
const DEFAULT_SETTINGS: Settings = {
  sensitivity: 1,
  volume: 65,
  quality: true,
  prefer120: false,
  difficulty: "survivor",
};
const DIFFICULTIES: { id: Difficulty; label: string; thai: string }[] = [
  { id: "recruit", label: "RECRUIT", thai: "เริ่มต้น" },
  { id: "survivor", label: "SURVIVOR", thai: "เอาตัวรอด" },
  { id: "veteran", label: "VETERAN", thai: "ท้าทาย" },
];

function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const paths: Record<string, React.ReactNode> = {
    arrow: <path d="M4 12h15m-6-6 6 6-6 6" />,
    cross: (
      <>
        <path d="M12 3v4m0 10v4M3 12h4m10 0h4" />
        <circle cx="12" cy="12" r="5" />
        <circle cx="12" cy="12" r="1" />
      </>
    ),
    settings: (
      <>
        <path d="M4 7h16M4 17h16M8 4v6m8 4v6" />
        <circle cx="8" cy="7" r="2" />
        <circle cx="16" cy="17" r="2" />
      </>
    ),
    sound: (
      <>
        <path d="m11 4-5 4H3v8h3l5 4V4Z" />
        <path d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14" />
      </>
    ),
    mute: (
      <>
        <path d="m11 4-5 4H3v8h3l5 4V4Z" />
        <path d="m16 9 6 6m0-6-6 6" />
      </>
    ),
    fullscreen: <path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5" />,
    shield: (
      <>
        <path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z" />
        <path d="m8 12 3 3 5-6" />
      </>
    ),
    chevrondown: <path d="m6 9 6 6 6-6" />,
    close: <path d="m6 6 12 12M18 6 6 18" />,
    heart: (
      <path d="M20 5c-3-3-7-1-8 1-1-2-5-4-8-1-4 4 0 9 8 15 8-6 12-11 8-15Z" />
    ),
    skull: (
      <>
        <path d="M5 15a9 9 0 1 1 14 0l-2 2v4H7v-4l-2-2Z" />
        <circle cx="8" cy="11" r="1.5" />
        <circle cx="16" cy="11" r="1.5" />
        <path d="m11 15 1-2 1 2m-3 3v3m4-3v3" />
      </>
    ),
    reload: <path d="M20 8a9 9 0 1 0 1 7M20 3v6h-6" />,
    pause: <path d="M8 5v14M16 5v14" />,
    book: (
      <path d="M12 6c-3-2-6-2-9-1v14c3-1 6-1 9 1 3-2 6-2 9-1V5c-3-1-6-1-9 1Zm0 0v14" />
    ),
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] || paths.cross}
    </svg>
  );
}

function Emblem({ size = 35 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 44"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M20 2 37 11v18L20 42 3 29V11L20 2Z"
        stroke="currentColor"
        strokeWidth="1.3"
      />
      <path d="m10 27 10-16 10 16h-7l-3-6-3 6h-7Z" fill="currentColor" />
      <path d="M20 30v5m-3-2h6" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function SectorMap() {
  return (
    <svg
      viewBox="0 0 160 108"
      fill="none"
      className="sector-map"
      aria-hidden="true"
    >
      <path
        d="M0 18h160M0 45h160M0 72h160M25 0v108M57 0v108M89 0v108M121 0v108M153 0v108"
        stroke="#c3cbb3"
        opacity=".07"
      />
      <path
        d="m9 19 34-6 7 28-35 8-6-30ZM104 9l37 5-2 36-37-5 2-36ZM18 70l39-5 3 30-39 6-3-31ZM104 68l31-5 6 29-34 7-3-31Z"
        fill="#9da88b"
        fillOpacity=".15"
        stroke="#9da88b"
        strokeOpacity=".35"
      />
      <path d="m70 16 12-3 9 80-13 2-8-79Z" fill="#9da88b" fillOpacity=".1" />
      <path
        d="m71 54 10-13 11 13-11 14-10-14Z"
        stroke="#cee3a6"
        strokeWidth="1.3"
      />
      <circle cx="81" cy="54" r="3" fill="#cee3a6" />
      <path
        d="M81 24v9m0 43v9M52 54h10m39 0h10"
        stroke="#cee3a6"
        opacity=".6"
      />
      <path
        d="M4 4h10M4 4v10m152-10h-10m10 0v10M4 104h10m-10 0V94m152 10h-10m10 0V94"
        stroke="#a8b397"
      />
    </svg>
  );
}

const time = (seconds: number) =>
  `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;

export default function Nightfall() {
  const host = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLElement>(null);
  const engine = useRef<NightfallEngine | null>(null);
  const settingsRef = useRef(DEFAULT_SETTINGS);
  const [state, setState] = useState<Snapshot>(INITIAL);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [panel, setPanel] = useState<"settings" | "guide" | null>(null);
  const [best, setBest] = useState(0);
  const [difficultyOpen, setDifficultyOpen] = useState(false);
  const [muted, setMuted] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [notice, setNotice] = useState("");
  const lookTouch = useRef<{ x: number; y: number; id: number } | null>(null);
  const joystick = useRef<HTMLDivElement>(null);
  const panelTrigger = useRef<HTMLElement | null>(null);
  const [stick, setStick] = useState({ x: 0, y: 0 });
  const [selectedCharacter, setSelectedCharacter] = useState<CharacterId>("vanguard");
  const [roomPanel, setRoomPanel] = useState<"room" | "character" | null>(null);
  const bestRef = useRef(0);
  const status = state.status;
  const onRoomStarted = useCallback(() => {
    setRoomPanel(null);
    setPanel(null);
    setStick({ x: 0, y: 0 });
    lookTouch.current = null;
  }, []);
  const multiplayer = useNightfallRoom(engine, onRoomStarted, setNotice);
  const canReplayRoom = multiplayer.room?.status === "ended" &&
    multiplayer.room.hostId === multiplayer.session?.playerId;
  const ownerLeftRoom = multiplayer.room?.status === "ended" &&
    !multiplayer.room.players.some((player) => player.id === multiplayer.room?.hostId);

  const onSnapshot = useCallback((snapshot: Snapshot) => {
    setState(snapshot);
    if (snapshot.status === "dead" && snapshot.kills > bestRef.current) {
      bestRef.current = snapshot.kills;
      setBest(snapshot.kills);
      try {
        localStorage.setItem("nightfall-best", String(snapshot.kills));
      } catch {
        /* Storage is optional. */
      }
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    import("../../lib/nightfall/engine")
      .then(({ NightfallEngine }) => {
        if (cancelled || !host.current) return;
        try {
          const saved = Number(localStorage.getItem("nightfall-best")) || 0;
          bestRef.current = saved;
          setBest(saved);
        } catch {
          /* Storage is optional. */
        }
        try {
          engine.current = new NightfallEngine(host.current, onSnapshot);
          engine.current.configure(settingsRef.current);
          setReady(true);
        } catch {
          setError(
            "อุปกรณ์นี้เปิดฉาก 3 มิติไม่ได้ ลองเปิดด้วย Chrome หรือ Edge ที่รองรับ WebGL",
          );
        }
      })
      .catch(() => {
        if (!cancelled) setError("โหลดเกมไม่สำเร็จ กรุณารีเฟรชแล้วลองอีกครั้ง");
      });
    return () => {
      cancelled = true;
      engine.current?.dispose();
      engine.current = null;
    };
  }, [onSnapshot]);

  useEffect(() => {
    settingsRef.current = settings;
    engine.current?.configure({
      ...settings,
      volume: muted ? 0 : settings.volume,
    });
  }, [settings, muted]);

  useEffect(() => {
    const sync = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 4000);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (!panel) return;
    const escape = (e: KeyboardEvent) => {
      if (e.code === "Escape") setPanel(null);
      if (e.code === "Tab") {
        const controls = Array.from(
          document.querySelectorAll<HTMLElement>(
            ".utility-panel button, .utility-panel input",
          ),
        );
        const first = controls[0],
          last = controls[controls.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("keydown", escape);
      panelTrigger.current?.focus();
    };
  }, [panel]);

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await root.current?.requestFullscreen();
    } catch {
      setNotice("เบราว์เซอร์นี้ไม่อนุญาตโหมดเต็มหน้าจอ");
    }
  };
  const start = () => {
    setStick({ x: 0, y: 0 });
    lookTouch.current = null;
    setPanel(null);
    setDifficultyOpen(false);
    engine.current?.setCharacter(selectedCharacter);
    engine.current?.start();
  };
  const openPanel = (which: "settings" | "guide") => {
    panelTrigger.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    if (status === "playing") engine.current?.pause();
    setPanel(which);
  };
  const moveStick = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!joystick.current) return;
    const rect = joystick.current.getBoundingClientRect();
    let x = (e.clientX - rect.left - rect.width / 2) / 40;
    let y = (e.clientY - rect.top - rect.height / 2) / 40;
    const length = Math.hypot(x, y);
    if (length > 1) {
      x /= length;
      y /= length;
    }
    setStick({ x, y });
    engine.current?.setTouchMove(x, y);
  };

  return (
    <main
      ref={root}
      className={`nightfall ${status !== "menu" ? "is-playing" : ""}`}
    >
      <div ref={host} className="game-viewport" />
      <div className="scene-shade" />
      <div className="scene-vignette" />
      <div className="film-grain" />
      {status === "menu" && (
        <>
          <header className="nf-header">
            <div className="nf-brand">
              <Emblem />
              <span>
                NIGHTFALL<span className="brand-sub">OUTBREAK PROTOCOL</span>
              </span>
            </div>
            <nav aria-label="เมนูหลัก" className="nf-nav">
              <button
                className={!panel ? "nav-active" : ""}
                onClick={() => setPanel(null)}
              >
                PLAY<span>เล่นเกม</span>
              </button>
              <button
                className={panel === "guide" ? "nav-active" : ""}
                onClick={() => openPanel("guide")}
              >
                FIELD GUIDE<span>วิธีเล่น</span>
              </button>
              <button
                className={panel === "settings" ? "nav-active" : ""}
                onClick={() => openPanel("settings")}
              >
                SETTINGS<span>ตั้งค่า</span>
              </button>
            </nav>
            <div className="header-tools">
              <button
                className="icon-button mobile-settings"
                onClick={() => openPanel("settings")}
                aria-label="ตั้งค่าเกม"
              >
                <Icon name="settings" />
              </button>
              <span className="connection">
                <i />
                {multiplayer.room ? `ROOM ${multiplayer.room.code}` : "LOCAL SESSION"}
              </span>
              <button
                className="icon-button"
                onClick={() => setMuted(!muted)}
                aria-label={muted ? "เปิดเสียง" : "ปิดเสียง"}
                title={muted ? "เปิดเสียง" : "ปิดเสียง"}
              >
                <Icon name={muted ? "mute" : "sound"} />
              </button>
              <button
                className="icon-button"
                onClick={toggleFullscreen}
                aria-label={fullscreen ? "ออกจากเต็มหน้าจอ" : "เต็มหน้าจอ"}
                title="เต็มหน้าจอ"
              >
                <Icon name="fullscreen" />
              </button>
            </div>
          </header>
          <div className="menu-main">
            <section className="menu-intro">
              <div className="outbreak-status">
                <span className="status-dash" />
                <span>THE WORLD WENT QUIET.</span>
                <span className="status-dot" />
                YOU DIDN&apos;T.
              </div>
              <h1>
                NIGHTFALL<span className="title-period">.</span>
              </h1>
              <div className="title-subline">
                <span>SURVIVE THE SILENCE</span>
                <span className="title-rule" />
              </div>
              <p className="intro-copy">
                เมื่อความเงียบไม่ใช่ความปลอดภัย
                <br />
                ทุกนัดมีความหมาย ทุกวินาทีคือการเอาชีวิตรอด
              </p>
              <div className="start-block">
                <div className="mode-line">
                  <span>
                    <Icon name="shield" size={14} /> SOLO SURVIVAL
                  </span>
                  <span>ผู้เล่นเดี่ยว</span>
                </div>
                <button
                  className="deploy-button"
                  onClick={() => multiplayer.session ? setRoomPanel("room") : start()}
                  disabled={!ready || !!error}
                >
                  <span className="deploy-icon">
                    <Icon name="cross" size={23} />
                  </span>
                  <span>
                    {error
                      ? "ไม่สามารถเริ่มเกมได้"
                      : ready
                        ? multiplayer.session ? "กลับไปห้องของคุณ" : "เริ่มภารกิจ"
                        : "กำลังเตรียมสนาม…"}
                    <small>
                      {ready
                        ? "DEPLOY INTO THE DEAD ZONE"
                        : "INITIALIZING ENVIRONMENT"}
                    </small>
                  </span>
                  <Icon name="arrow" size={24} />
                </button>
                <div className="difficulty-wrap">
                  <button
                    className="difficulty-button"
                    onClick={() => setDifficultyOpen(!difficultyOpen)}
                    aria-expanded={difficultyOpen}
                  >
                    <span>
                      ความยาก{" "}
                      <strong>
                        {
                          DIFFICULTIES.find((d) => d.id === settings.difficulty)
                            ?.label
                        }
                      </strong>
                    </span>
                    <Icon name="chevrondown" size={15} />
                  </button>
                  {difficultyOpen && (
                    <div className="difficulty-options">
                      {DIFFICULTIES.map((d) => (
                        <button
                          key={d.id}
                          className={
                            settings.difficulty === d.id ? "selected" : ""
                          }
                          onClick={() => {
                            setSettings({ ...settings, difficulty: d.id });
                            setDifficultyOpen(false);
                          }}
                        >
                          <span>{d.label}</span>
                          <span>{d.thai}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="room-launchers">
                  <button onClick={() => setRoomPanel("room")} disabled={!ready}>เล่นกับเพื่อน</button>
                  <button onClick={() => setRoomPanel(multiplayer.session ? "room" : "character")}>
                    เลือกตัวละคร · {characters[selectedCharacter].name}
                  </button>
                </div>
                {error && (
                  <p role="alert" className="game-error">
                    {error}
                  </p>
                )}
              </div>
              <button className="guide-link" onClick={() => openPanel("guide")}>
                <Icon name="book" size={16} />
                <span>เตรียมพร้อมก่อนลงสนาม</span>
                <Icon name="arrow" size={15} />
              </button>
            </section>
            <div className="scene-marker" aria-hidden="true">
              <span className="marker-cross">+</span>
              <span>07 / RESTRICTED AREA</span>
              <span className="marker-line" />
            </div>
            <aside className="mission-intel">
              <div className="intel-head">
                <span className="alert-square" />
                LIVE THREAT ASSESSMENT
                <span className="intel-bars">
                  <i />
                  <i />
                  <i />
                  <i />
                </span>
              </div>
              <div className="threat-level">
                <span>ภัยคุกคามในพื้นที่</span>
                <strong>
                  CRITICAL
                  <Icon name="skull" size={17} />
                </strong>
              </div>
              <div className="intel-divider" />
              <h2>
                ไม่มีหน่วยสนับสนุน
                <br />
                มีเพียงคุณที่ยังยืนอยู่
              </h2>
              <p>
                ผู้ติดเชื้อกำลังเข้ามาเป็นระลอก
                <br />
                เล็งให้แม่น จัดการกระสุน แล้วรอดให้นานที่สุด
              </p>
              <div className="intel-details">
                <span>
                  กติกา<span>ด่านจับเวลา</span>
                </span>
                <span>
                  อาวุธประจำกาย<span>M4A1 · 5.56 MM</span>
                </span>
              </div>
              <div className="personal-best">
                <Icon name="cross" size={15} />
                <span>สถิติการกำจัดสูงสุด</span>
                <strong>{String(best).padStart(3, "0")}</strong>
              </div>
            </aside>
          </div>
          <section
            className="deployment-strip"
            aria-label="ข้อมูลสนามและการควบคุม"
          >
            <div className="location-preview">
              <SectorMap />
              <div className="location-preview-shade" />
            </div>
            <div className="location-info">
              <span className="small-label">YOUR DEPLOYMENT</span>
              <h2>
                เขตกักกันร้าง <span>SECTOR 07</span>
              </h2>
              <p>
                <span className="tiny-dot" />
                ลานอุตสาหกรรม · ก่อนฟ้าสาง
              </p>
            </div>
            <div className="location-coordinates">
              35° 41&apos; 22.8&quot; N<br />
              139° 41&apos; 30.1&quot; E
            </div>
            <div className="strip-divider" />
            <div className="control-preview">
              <div>
                <span className="key-group">
                  <kbd>W</kbd>
                  <span>
                    <kbd>A</kbd>
                    <kbd>S</kbd>
                    <kbd>D</kbd>
                  </span>
                </span>
                <span>เคลื่อนที่</span>
              </div>
              <div>
                <span className="mouse-outline">
                  <i />
                </span>
                <span>เล็ง / ยิง</span>
              </div>
              <div>
                <kbd>R</kbd>
                <span>รีโหลด</span>
              </div>
              <div>
                <kbd>SHIFT</kbd>
                <span>วิ่ง</span>
              </div>
            </div>
            <button
              className="all-controls"
              onClick={() => openPanel("guide")}
              aria-label="ดูการควบคุมทั้งหมด"
            >
              <Icon name="arrow" size={21} />
            </button>
          </section>
          <footer className="nf-footer">
            <span>
              <i />
              BROWSER-BASED FPS EXPERIENCE
            </span>
            <span className="footer-quote">ONE LIFE. EVERY SHOT COUNTS.</span>
            <span>
              NIGHTFALL <span className="version">/ V.1.0</span>
            </span>
          </footer>
        </>
      )}
      {roomPanel && status === "menu" && (
        <RoomLobby
          mode={roomPanel}
          ready={ready}
          selected={selectedCharacter}
          multiplayer={multiplayer}
          onSelect={(id) => {
            setSelectedCharacter(id);
            engine.current?.setCharacter(id);
          }}
          onClose={() => setRoomPanel(null)}
        />
      )}

      {status !== "menu" && (
        <>
          <header className="game-top">
            <div className="game-logo">
              <Emblem size={27} />
              <span>NIGHTFALL</span>
            </div>
            <div className="wave-display">
              <span>ด่าน</span>
              <strong>{String(state.wave).padStart(2, "0")}</strong>
              <span className="wave-separator" />
              <Icon name="skull" size={17} />
              <span>
                <b>{state.remaining}</b>
              </span>
              <span
                className={
                  !state.gateOpen && state.timeLeft <= 10
                    ? "stage-clock urgent"
                    : "stage-clock"
                }
                aria-label={state.gateOpen ? "ประตูเปิดแล้ว" : "เวลาที่เหลือ"}
              >
                {state.gateOpen ? "ประตูเปิด" : time(state.timeLeft)}
              </span>
            </div>
            <div className="game-top-actions">
              <button
                className="icon-button"
                onClick={() => engine.current?.pause()}
                aria-label="พักเกม"
              >
                <Icon name="pause" />
              </button>
              {status === "playing" && (
                <div className="fps-counter">{state.fps ?? "–"} FPS</div>
              )}
            </div>
          </header>
          {multiplayer.room && (
            <div className="room-hud">
              <span>ห้อง {multiplayer.room.code} · ทีม {multiplayer.room.players.filter((player) => player.pose?.alive !== false).length}/{multiplayer.room.players.length}</span>
              {multiplayer.error && <span role="status">{multiplayer.error}</span>}
            </div>
          )}
          <div
            className={`crosshair ${state.aiming || state.reloading || state.heldItem === "medkit" || state.heldItem === "energy" ? "is-aiming" : ""}`}
            aria-hidden="true"
          >
            <i />
            <i />
            <i />
            <i />
          </div>
          {status === "playing" &&
            state.aiming &&
            state.weaponId === "marksman" && (
              <div className="optic-lens" aria-hidden="true">
                <i className="optic-horizontal" />
                <i className="optic-vertical" />
                <i className="optic-ticks" />
                <i className="optic-dot" />
              </div>
            )}
          {status === "playing" && state.reloadProgress !== null && (
            <div className="equipment-progress">
              <span>
                {state.weaponId === "shotgun"
                  ? "กำลังเติมกระสุนลูกซองทีละนัด"
                  : "กำลังเปลี่ยนแม็กกาซีน"}
              </span>
              <progress
                aria-label="ความคืบหน้าการรีโหลด"
                max={1}
                value={state.reloadProgress}
              />
            </div>
          )}
          {(state.healProgress !== null ||
            state.throwProgress !== null ||
            state.drinkProgress !== null) && (
            <div className="equipment-progress">
              <span>
                {state.healProgress !== null
                  ? "กำลังฉีดยา"
                  : state.drinkProgress !== null
                    ? state.drinkProgress * drinkingSeconds <
                      drinkOpeningSeconds
                      ? "กำลังเปิดกระป๋อง"
                      : "กำลังดื่ม"
                    : "เตรียมโยน · ปล่อยเพื่อขว้าง"}
              </span>
              <progress
                aria-label={
                  state.healProgress !== null
                    ? "ความคืบหน้าการฉีดยา"
                    : state.drinkProgress !== null
                      ? "ความคืบหน้าการดื่ม"
                      : "แรงโยนระเบิด"
                }
                max={1}
                value={
                  state.healProgress ??
                  state.drinkProgress ??
                  state.throwProgress ??
                  0
                }
              />
            </div>
          )}
          {state.hit > 0 && (
            <div
              className={`hit-marker ${state.hit > 1 ? "headshot" : ""}`}
              aria-hidden="true"
            >
              ×
            </div>
          )}
          <div
            className="damage-vignette"
            style={{ opacity: state.hurt * 0.8 }}
          />
          <div className="game-notification" key={state.message}>
            {state.message}
          </div>
          {status === "playing" && state.spitWarning && (
            <div className="spitter-warning" role="status">
              ตัวพ่นกำลังเตรียมโจมตี · หลบเข้าที่กำบัง
            </div>
          )}
          {state.boss && (
            <section className="boss-hud" aria-label="พลังชีวิตบอส">
              <div className="boss-heading">
                <Icon name="skull" size={15} />
                <strong>{bosses[state.boss.kind].name}</strong>
                <span>
                  {Math.ceil((100 * state.boss.health) / state.boss.maxHealth)}%
                </span>
              </div>
              <div
                className="boss-health"
                role="progressbar"
                aria-label="พลังชีวิตบอส"
                aria-valuenow={Math.ceil(
                  (100 * state.boss.health) / state.boss.maxHealth,
                )}
              >
                <i
                  style={{
                    width: `${(100 * state.boss.health) / state.boss.maxHealth}%`,
                    backgroundColor: bosses[state.boss.kind].color,
                  }}
                />
              </div>
              {state.boss.warning && (
                <p className={`boss-warning${state.boss.ultimate ? " boss-warning-ultimate" : ""}`}>
                  {(state.boss.ultimate ? bossUltimates : state.boss.followup ? bossCombos : bosses)[state.boss.kind].warning}
                </p>
              )}
            </section>
          )}
          {state.checkpointDistance !== null && (
            <div className="checkpoint-hud">
              <span
                className="checkpoint-arrow"
                style={{
                  transform: `rotate(${state.checkpointAngle - 90}deg)`,
                }}
              >
                <Icon name="arrow" size={19} />
              </span>
              {state.gateOpen ? "ผ่านประตู" : "จุดเปิดประตู"} ·{" "}
              {state.checkpointDistance} ม.
            </div>
          )}
          <div className="in-game-location">
            <span className="tiny-dot" />
            {zoneForStage(state.wave).code} <span>/</span>{" "}
            {zoneForStage(state.wave).name}
          </div>
          {status === "playing" && state.weaponPickup && (
            <div className="weapon-pickup-hint">
              <Icon name="cross" size={14} />
              กล่อง{weapons[state.weaponPickup.id].name} ·{" "}
              {state.weaponPickup.distance} ม.
            </div>
          )}
          {status === "playing" && (
            <div className="weapon-slots" aria-label="สลับอาวุธ">
              {state.inventory.map(({ id, total }) => (
                <button
                  key={id}
                  className="weapon-slot"
                  aria-label={`${weapons[id].name} กระสุนรวม ${total} นัด`}
                  aria-pressed={state.weaponId === id}
                  onClick={() => engine.current?.switchWeapon(id)}
                >
                  <kbd>{weaponSlots.indexOf(id) + 1}</kbd>
                  <span className="weapon-slot-name">{weapons[id].name}</span>
                  <strong>{total}</strong>
                </button>
              ))}
            </div>
          )}
          <div className="game-hud">
            <div className="supplies-hud">
              <span>
                <kbd>Q</kbd>
                <span
                  className={
                    state.heldItem === "grenade" ? "selected-supply" : ""
                  }
                >
                  ระเบิด <strong>{state.grenades}</strong>
                </span>
                <span
                  className={
                    state.heldItem === "medkit" ? "selected-supply" : ""
                  }
                >
                  ยา <strong>{state.medkits}</strong>
                </span>
                <span
                  className={
                    state.heldItem === "energy" ? "selected-supply" : ""
                  }
                >
                  ชูกำลัง <strong>{state.energy}</strong>
                </span>
              </span>
              {state.boost > 0 && (
                <span className="energy-status">
                  เพิ่มความเร็ว {Math.ceil(state.boost)} วิ.
                </span>
              )}
            </div>
            <div className="health-hud">
              <div>
                <Icon name="heart" size={20} />
                <strong>{Math.ceil(state.health)}</strong>
                <span>HEALTH</span>
              </div>
              <div className="health-track">
                <i
                  style={{
                    width: `${state.health}%`,
                    background: state.health <= 30 ? "#e1886a" : undefined,
                  }}
                />
              </div>
              <div className="stamina-track">
                <i style={{ width: `${state.stamina}%` }} />
              </div>
            </div>
            <div className="kills-hud">
              <Icon name="skull" size={17} />
              <strong>{String(state.kills).padStart(2, "0")}</strong>
              <span>ELIMINATED</span>
              <span className="hud-time">
                <Icon name="clock" size={13} />
                {time(state.seconds)}
              </span>
            </div>
            {state.heldItem === "gun" ? (
              <div className="ammo-hud">
                <span className="weapon-name">
                  {weapons[state.weaponId].name}{" "}
                  <span>{weapons[state.weaponId].caliber}</span>
                </span>
                <div>
                  <strong
                    className={
                      state.ammo <=
                      Math.ceil(weapons[state.weaponId].capacity / 6)
                        ? "low-ammo"
                        : ""
                    }
                  >
                    {String(state.ammo).padStart(2, "0")}
                  </strong>
                  <span>/ {state.reserve}</span>
                  <span className="bullet-stack">
                    {Array.from({ length: 5 }, (_, i) => (
                      <i
                        key={i}
                        style={{
                          opacity:
                            state.ammo >
                            (i * weapons[state.weaponId].capacity) / 5
                              ? 1
                              : 0.18,
                        }}
                      />
                    ))}
                  </span>
                </div>
                <span className="ammo-help">
                  {state.reloading
                    ? "กำลังรีโหลด…"
                    : state.ammo === 0 && state.reserve === 0
                      ? "กระสุนหมด · ฟันด้วยคาตานะ [V]"
                      : "กด R เพื่อรีโหลด"}
                </span>
              </div>
            ) : (
              <div className="ammo-hud held-item-hud">
                <span className="weapon-name">
                  {heldLabels[state.heldItem].name}
                </span>
                {state.heldItem !== "katana" && (
                  <div>
                    <strong>
                      {state.heldItem === "grenade"
                        ? state.grenades
                        : state.heldItem === "medkit"
                          ? state.medkits
                          : state.energy}
                    </strong>
                  </div>
                )}
                <span className="ammo-help">
                  {heldLabels[state.heldItem].action}
                </span>
              </div>
            )}
          </div>
          {status === "playing" && (
            <div className="touch-controls">
              <div
                className="touch-look"
                onPointerDown={(e) => {
                  e.currentTarget.setPointerCapture(e.pointerId);
                  lookTouch.current = {
                    x: e.clientX,
                    y: e.clientY,
                    id: e.pointerId,
                  };
                }}
                onPointerMove={(e) => {
                  if (lookTouch.current?.id !== e.pointerId) return;
                  engine.current?.look(
                    (e.clientX - lookTouch.current.x) * 1.7,
                    (e.clientY - lookTouch.current.y) * 1.7,
                  );
                  lookTouch.current = {
                    x: e.clientX,
                    y: e.clientY,
                    id: e.pointerId,
                  };
                }}
                onPointerUp={() => {
                  lookTouch.current = null;
                }}
                onPointerCancel={() => {
                  lookTouch.current = null;
                }}
              />
              <div
                className="touch-joystick"
                ref={joystick}
                onPointerDown={(e) => {
                  e.currentTarget.setPointerCapture(e.pointerId);
                  moveStick(e);
                }}
                onPointerMove={(e) => {
                  if (e.currentTarget.hasPointerCapture(e.pointerId))
                    moveStick(e);
                }}
                onPointerUp={() => {
                  setStick({ x: 0, y: 0 });
                  engine.current?.setTouchMove(0, 0);
                }}
                onPointerCancel={() => {
                  setStick({ x: 0, y: 0 });
                  engine.current?.setTouchMove(0, 0);
                }}
              >
                <span
                  style={{
                    transform: `translate(${stick.x * 34}px, ${stick.y * 34}px)`,
                  }}
                />
              </div>
              <button
                className="touch-fire"
                aria-label={
                  state.heldItem === "gun"
                    ? "ยิง"
                    : heldLabels[state.heldItem].action
                }
                onPointerDown={(e) => {
                  e.currentTarget.setPointerCapture(e.pointerId);
                  engine.current?.setFire(true);
                }}
                onPointerUp={() => engine.current?.setFire(false)}
                onPointerCancel={() => engine.current?.cancelUse()}
              >
                <Icon name="cross" size={32} />
              </button>
              <button
                className="touch-grenade"
                onClick={() => engine.current?.cycleItem()}
                aria-label="สลับของ"
              >
                เลือกของ
              </button>
              <button
                className="touch-sprint"
                onPointerDown={() => engine.current?.sprintBurst()}
                aria-label="วิ่งเร็ว"
              >
                วิ่ง
              </button>
              <button
                className="touch-knife"
                onClick={() => engine.current?.swingKnife()}
                aria-label="ฟันด้วยคาตานะ"
              >
                ดาบ
              </button>
              <button
                className="touch-dodge"
                onPointerDown={(event) => {
                  event.preventDefault();
                  engine.current?.dodgeBurst();
                }}
                aria-label="พุ่งหลบตามทิศจอย"
              >
                พุ่งหลบ
              </button>
              <button
                className="touch-reload"
                aria-label="รีโหลด"
                onClick={() => engine.current?.reload()}
              >
                <Icon name="reload" size={22} />
              </button>
              <button
                className="touch-aim"
                aria-label="เล็งผ่านศูนย์ปืน"
                onPointerDown={(e) => {
                  e.currentTarget.setPointerCapture(e.pointerId);
                  engine.current?.setAim(true);
                }}
                onPointerUp={() => engine.current?.setAim(false)}
                onPointerCancel={() => engine.current?.setAim(false)}
              >
                <Icon name="cross" size={20} />
                ADS
              </button>
            </div>
          )}
        </>
      )}

      {(status === "paused" || status === "dead") && !panel && (
        <div className="session-overlay">
          <section
            className="session-panel"
            aria-label={status === "dead" ? "จบภารกิจ" : "พักเกม"}
          >
            <Emblem size={45} />
            <span className="session-status">
              {status === "dead" ? "SIGNAL LOST" : "MISSION ON HOLD"}
            </span>
            <h2>
              {state.timedOut
                ? "หมดเวลา"
                : status === "dead"
                  ? "คุณสู้จนถึงนัดสุดท้าย"
                  : "พักหายใจ แล้วไปต่อ"}
            </h2>
            <p>
              {state.timedOut
                ? state.boss
                  ? "กำจัดบอสไม่ทันเวลา"
                  : state.remaining
                    ? "กำจัดซอมบี้ไม่ทันเวลา"
                    : "ไปถึงจุดเริ่มด่านถัดไปไม่ทันเวลา"
                : status === "dead"
                    ? multiplayer.session
                      ? canReplayRoom ? "เริ่มรอบใหม่ด้วยรหัสห้องเดิมได้เลย"
                        : ownerLeftRoom ? "เจ้าของห้องออกแล้ว กดออกจากห้องเพื่อกลับเมนู"
                        : "รอเจ้าของห้องเริ่มรอบใหม่ หรือกดออกจากห้อง"
                      : "ในความเงียบ ยังมีเรื่องราวของคนที่ไม่ยอมแพ้"
                    : multiplayer.session ? "เพื่อนในห้องยังอยู่ในสนาม" : "สนามจะรอคุณ ทุกวินาทียังคงมีความหมาย"}
            </p>
            <div className="session-stats">
              <div>
                <strong>{String(state.kills).padStart(2, "0")}</strong>
                <span>กำจัดซอมบี้</span>
              </div>
              <div>
                <strong>{String(state.wave).padStart(2, "0")}</strong>
                <span>ด่าน</span>
              </div>
              <div>
                <strong>{time(state.seconds)}</strong>
                <span>เวลารอดชีวิต</span>
              </div>
            </div>
            <button
              className="deploy-button"
              disabled={canReplayRoom && multiplayer.pending}
              onClick={
                status === "dead"
                  ? canReplayRoom ? () => void multiplayer.command("start")
                    : multiplayer.session ? multiplayer.leave : start
                  : () => engine.current?.resume()
              }
            >
              <Icon name={status === "dead" ? "reload" : "arrow"} />
              <span>{status === "dead" ? canReplayRoom ? "เริ่มรอบใหม่ในห้องเดิม"
                : multiplayer.session ? "ออกจากห้อง" : "เริ่มภารกิจใหม่" : "กลับเข้าสนาม"}</span>
              <Icon name="arrow" />
            </button>
            <div className="session-actions">
              <button onClick={() => openPanel("settings")}>ตั้งค่า</button>
              {(canReplayRoom || !(status === "dead" && multiplayer.session)) && (
                <button onClick={multiplayer.session ? multiplayer.leave : () => engine.current?.menu()}>
                  {multiplayer.session ? "ออกจากห้อง" : "กลับเมนูหลัก"}
                </button>
              )}
            </div>
            <span className="personal-record">สถิติสูงสุด: {best} ตัว</span>
          </section>
        </div>
      )}
      {panel && (
        <div
          className="panel-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) setPanel(null);
          }}
        >
          <section
            className="utility-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="panel-title"
          >
            <div className="panel-heading">
              <Icon
                name={panel === "settings" ? "settings" : "book"}
                size={24}
              />
              <span>
                {panel === "settings"
                  ? "SYSTEM CONFIGURATION"
                  : "SURVIVAL MANUAL"}
              </span>
              <button
                autoFocus
                className="icon-button"
                onClick={() => setPanel(null)}
                aria-label="ปิด"
              >
                <Icon name="close" />
              </button>
            </div>
            <h2 id="panel-title">
              {panel === "settings" ? "เตรียมอุปกรณ์ให้พร้อม" : "รู้ก่อนลงสนาม"}
            </h2>
            {panel === "settings" ? (
              <div className="settings-content">
                <label className="range-setting">
                  <span>
                    ความไวเมาส์
                    <strong>{settings.sensitivity.toFixed(1)}×</strong>
                  </span>
                  <input
                    type="range"
                    min="0.3"
                    max="2.5"
                    step="0.1"
                    value={settings.sensitivity}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        sensitivity: Number(e.target.value),
                      })
                    }
                  />
                </label>
                <label className="range-setting">
                  <span>
                    ระดับเสียง<strong>{settings.volume}%</strong>
                  </span>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={settings.volume}
                    onChange={(e) => {
                      setMuted(false);
                      setSettings({
                        ...settings,
                        volume: Number(e.target.value),
                      });
                    }}
                  />
                </label>
                <div className="toggle-setting">
                  <div>
                    <strong>เน้น 120 FPS</strong>
                    <span>ยอมลดความละเอียดเร็วขึ้นเพื่อให้เฟรมนิ่งบนจอ 120 Hz ขึ้นไป</span>
                  </div>
                  <button
                    role="switch"
                    aria-checked={settings.prefer120}
                    aria-label="เน้น 120 FPS"
                    className={`toggle ${settings.prefer120 ? "on" : ""}`}
                    onClick={() => setSettings({ ...settings, prefer120: !settings.prefer120 })}
                  >
                    <i />
                  </button>
                </div>
                <div className="toggle-setting">
                  <div>
                    <strong>เงาและรายละเอียดสูง</strong>
                    <span>เกมปรับความละเอียดอัตโนมัติ ปิดตัวเลือกนี้เพื่อลดภาระเครื่องอีกขั้น</span>
                  </div>
                  <button
                    role="switch"
                    aria-checked={settings.quality}
                    aria-label="เงาและรายละเอียดสูง"
                    className={`toggle ${settings.quality ? "on" : ""}`}
                    onClick={() =>
                      setSettings({ ...settings, quality: !settings.quality })
                    }
                  >
                    <i />
                  </button>
                </div>
                <div className="settings-difficulty">
                  <span>ระดับความยาก</span>
                  <div>
                    {DIFFICULTIES.map((d) => (
                      <button
                        key={d.id}
                        className={
                          settings.difficulty === d.id ? "selected" : ""
                        }
                        onClick={() =>
                          setSettings({ ...settings, difficulty: d.id })
                        }
                      >
                        {d.label}
                        <span>{d.thai}</span>
                      </button>
                    ))}
                  </div>
                </div>
                <p className="settings-note">การตั้งค่ามีผลทันที · ไม่ต้องเริ่มเกมใหม่</p>
              </div>
            ) : (
              <div className="guide-content">
                <p>
                  กำจัดฝูงซอมบี้แล้วชนะบอสประจำโซนก่อนหมดเวลา หลบพื้นที่เตือนบนพื้น
                  แล้วเข้าวงสีเขียวภายใน 25 วินาทีเพื่อเปิดประตู เดินผ่านประตูเพื่อเข้าโซนถัดไป
                  ด่านต่อไปจะมีตัววิ่งเร็ว ตัวบินโฉบ และตัวพ่นกระสุนจากระยะไกล
                  ใช้ที่กำบังหลบกระสุนพ่น
                </p>
                <div className="guide-keys">
                  {[
                    ["W A S D", "เคลื่อนที่"],
                    ["MOUSE", "มองรอบตัว"],
                    ["คลิกซ้าย", "ยิงหรือใช้ของที่ถือ"],
                    ["คลิกขวา", "เล็งผ่านศูนย์ปืน"],
                    ["R", "รีโหลด · ลูกซองเติมทีละนัด"],
                    ["1–5", "สลับปืนที่เก็บแล้ว"],
                    ["SHIFT", "แตะเพื่อเร่งสั้น ๆ หรือกดค้างเพื่อวิ่ง"],
                    ["ALT + WASD", "พุ่งตามทิศที่กดเดิน · ใช้พละกำลัง 14 หน่วย"],
                    ["V", `ฟันด้วยคาตานะทันที · ใช้พละกำลัง ${knifeTuning.staminaCost} หน่วย`],
                    ["Q", "วนเลือกปืน คาตานะ ระเบิด ยา และเครื่องดื่ม"],
                    ["G", "เลือกถือระเบิดทันที"],
                    ["SPACE", "กระโดด"],
                    ["ESC / P", "พักเกม / ปล่อยเมาส์"],
                  ].map(([key, description]) => (
                    <div key={key}>
                      <kbd>{key}</kbd>
                      <span>{description}</span>
                    </div>
                  ))}
                </div>
                <div className="survival-tip">
                  <Icon name="shield" size={21} />
                  <p>
                    เดินเก็บปืนจากกล่องสีฟ้าใกล้ทางเข้าของแต่ละโซน
                    กระสุนแยกตามปืนและมีจำนวนจำกัด ซอมบี้อาจดรอปกล่องกระสุน 1–4
                    นัดตามชนิดปืน เดินผ่านของดรอปเพื่อเก็บยา ระเบิด หรือเครื่องดื่มชูกำลัง
                    เลือกระเบิดแล้วคลิกค้างก่อนปล่อยเพื่อโยน เลือกยาแล้วคลิกเพื่อฉีดยา 1.5
                    วินาที หรือเลือกเครื่องดื่มแล้วคลิก เมื่อดื่มเสร็จจะเพิ่มความเร็ว 10 วินาที
                  </p>
                </div>
                <p className="mobile-guide">
                  มือถือ: ใช้จอยด้านซ้ายเคลื่อนที่ ลากด้านขวาเพื่อมอง แล้วกดปุ่มเป้าเพื่อยิง
                  แนะนำให้เล่นแนวนอน
                </p>
              </div>
            )}
            <button className="panel-done" onClick={() => setPanel(null)}>
              พร้อมแล้ว
              <Icon name="arrow" size={18} />
            </button>
          </section>
        </div>
      )}
      {notice && (
        <div className="toast" role="status">
          {notice}
        </div>
      )}
    </main>
  );
}
