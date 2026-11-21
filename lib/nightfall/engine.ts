import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { dodgeDistanceAt, dodgeTuning, movementInWorld } from "./movement";
import { impactSurfaceOf, SurfaceEffects, type ImpactSurface } from "./surface-effects";
import { ZombieModels, zombieRigHeight } from "./zombie-models";
import {
  advanceZombieGait, blendZombieMotion, steerZombieVelocity, turnZombieToward, zombieFallMotion,
  zombieCrawl, zombieCrawlThreshold, zombieCrawlTransition, zombieGaitPose, zombieGaits,
  zombieImpactDirection, zombieImpactMotion, zombieLocalImpact, type ZombieMotion,
} from "./zombie-motion";
import { hunterPounce, hunterPounceHits, hunterPounceMotion, zombieMelee } from "./zombie-attack";
import { InjectorView } from "./injector-view";
import { WeaponHands } from "./weapon-hands";
import { magazineReloadPose, shellReloadPose } from "./reload-motion";
import { RoomAvatars } from "./room-avatars";
import { RenderBudget, renderPixelLimit } from "./render-quality";
import { characters, type CharacterId, type RoomCommand, type RoomCommandPayload, type RoomEvent, type RoomView, type RoomWorld, type RoomZombie, type ZombieGunImpact, type ZombieHitZone } from "./room-protocol";
import {
  boostSeconds,
  drinkingSeconds,
  drinkOpeningSeconds,
  equipmentLimits,
  healAmount,
  healingSeconds,
  injectionTiming,
  knifeTuning,
  nextHeldItem,
  throwCharge,
  type Equipment,
  type HeldItem,
} from "./equipment";
import {
  collectWeapon,
  loadShotgunShell,
  shotgunShellSeconds,
  collectAmmoDrop,
  rollAmmoDrop,
  weapons,
  weaponSlots,
  type Ammo,
  type AmmoDrop,
  type Arsenal,
  type WeaponId,
} from "./weapons";
import {
  canOccupy,
  buildNavigationField,
  chaseWaypoint,
  reloadAmmo,
  stagePlan,
  bosses,
  bossAttackHits,
  nextStagePhase,
  clearSegment,
  type BossKind,
  type BossStrike,
  stageLoadout,
  nextCheckpoint,
  crossedGate,
  zoneForStage,
  GATE_Z,
  objectiveAt,
  enemyTypes,
  spitterWindupSeconds,
  meleeWindupSeconds,
  meleeRecoverySeconds,
  meleeStrikeHits,
  zombieHitAmount,
  type EnemyType,
  type Difficulty,
  type Obstacle,
  type NavigationField,
} from "./rules";

export type GameStatus = "menu" | "playing" | "paused" | "dead";
export type { Difficulty } from "./rules";
export type Settings = {
  sensitivity: number;
  volume: number;
  quality: boolean;
  prefer120: boolean;
  difficulty: Difficulty;
};
export type Snapshot = {
  status: GameStatus;
  fps: number | null;
  health: number;
  ammo: number;
  reserve: number;
  weaponId: WeaponId;
  inventory: { id: WeaponId; total: number }[];
  weaponPickup: { id: WeaponId; distance: number } | null;
  kills: number;
  wave: number;
  remaining: number;
  seconds: number;
  reloading: boolean;
  reloadProgress: number | null;
  stamina: number;
  aiming: boolean;
  message: string;
  hit: number;
  hurt: number;
  timeLeft: number;
  checkpointDistance: number | null;
  checkpointAngle: number;
  grenades: number;
  medkits: number;
  energy: number;
  heldItem: HeldItem;
  healProgress: number | null;
  drinkProgress: number | null;
  throwProgress: number | null;
  boost: number;
  timedOut: boolean;
  gateOpen: boolean;
  spitWarning: boolean;
  boss: {
    kind: BossKind;
    health: number;
    maxHealth: number;
    warning: boolean;
  } | null;
};
type LootKind = "grenade" | "medkit" | "energy";
type Pickup =
  | { kind: LootKind; mesh: THREE.Group }
  | { kind: "ammo"; mesh: THREE.Group; drop: AmmoDrop };
const loot = {
  grenade: {
    color: "#e8aa65",
    label: "GRENADE",
    message: "เก็บระเบิด +1 · กด Q เพื่อเลือก",
  },
  medkit: {
    color: "#f39595",
    label: "INJECTOR",
    message: "เก็บยาฉีด +1 · กด Q เพื่อเลือก",
  },
  energy: {
    color: "#b7ed83",
    label: "ENERGY",
    message: "เก็บเครื่องดื่มชูกำลัง +1 · กด Q เพื่อเลือก",
  },
};
type ZombieMelee = {
  startedAt: number;
  yaw: number;
  side: 0 | 1;
  resolved: boolean;
  lunge?: { distance: number; advanced: number; blocked: boolean };
};

type Zombie = {
  networkId: number;
  group: THREE.Group;
  health: number;
  phase: number;
  arms: THREE.Group[];
  legs: THREE.Group[];
  head: THREE.Group;
  rig: THREE.Group;
  gait: { phase: number; travel: number; weight: number; vx: number; vz: number; heading?: number };
  speed: number;
  attack: number;
  dead: number;
  kind: EnemyType;
  wings?: THREE.Group[];
  throat?: THREE.Mesh;
  spitAt?: number;
  spitReleasedAt?: number;
  death?: { start: ZombieMotion; fallSpeed: number; landed: boolean };
  hitAt?: number;
  hitForce?: number;
  hitLean?: number;
  hitRoll?: number;
  hitPitch?: number;
  hitTwist?: number;
  lastImpact?: ZombieGunImpact;
  hitLocal?: ReturnType<typeof zombieLocalImpact>;
  injuredLeg?: -1 | 1;
  limp?: number;
  legHits?: number;
  crawl?: { fall: { pose: ZombieMotion; startedAt: number } | null };
  tumbleSign?: number;
  airFallSpeed?: number;
  airFallAt?: number;
  groundedUntil?: number;
  knifeStagger?: { until: number; x: number; z: number };
  melee?: ZombieMelee;
};
type Boss = {
  zombie: Zombie;
  kind: BossKind;
  maxHealth: number;
  readyAt: number;
  dash: { strike: BossStrike; startedAt: number } | null;
  attack: {
    strike: BossStrike;
    resolvesAt: number;
    marker: THREE.Group;
  } | null;
};

const initial: Snapshot = {
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
export const INITIAL_SNAPSHOT = { ...initial };

export class NightfallEngine {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(68, 1, 0.08, 180);
  private world = new THREE.Group();
  private arenaStage = 1;
  private gatePanels: THREE.Mesh[] = [];
  private gateLock: Obstacle | null = null;
  private gateProgress = 0;
  private weapon = new THREE.Group();
  private knifeView = new THREE.Group();
  private knifeSwing: { startedAt: number; resolved: boolean } | null = null;
  private weaponModels = new Map<WeaponId, THREE.Group>();
  private arsenal: Arsenal = {
    rifle: { ammo: weapons.rifle.capacity, reserve: 0 },
  };
  private weaponCrate: {
    id: Exclude<WeaponId, "rifle">;
    group: THREE.Group;
  } | null = null;
  private muzzle = new THREE.Group();
  private flashLight = new THREE.PointLight(0xffb459, 0, 8);
  private flashTime = 0;
  private flashPower = 0;
  private pendingShot: WeaponId | null = null;
  private zombies: Zombie[] = [];
  private nextZombieId = 1;
  private room: { code: string; id: string; host: boolean; slot: number; round: number } | null = null;
  private roomConnected = true;
  private roomAvatars = new RoomAvatars();
  private roomCommands: RoomCommand[] = [];
  private roomCommandId = 0;
  private roomShot = 0;
  private roomZombieTargets = new Map<number, { from: ZombieMotion; to: ZombieMotion; age: number; duration: number }>();
  private lastRoomMotion: { stamp?: number; received: number } | null = null;
  private roomNavigation = new Map<string, NavigationField>();
  private combatTarget: { id: string; eye: THREE.Vector3 } | null = null;
  private roomBossMarker: { key: string; mesh: THREE.Group } | null = null;
  private roomBolts: THREE.Mesh[] = [];
  private zombieModels = new ZombieModels();
  private boss: Boss | null = null;
  private stageBoss: Pick<
    ReturnType<typeof stagePlan>,
    "bossKind" | "bossHealth" | "bossTime"
  > | null = null;
  private obstacles: Obstacle[] = [];
  private navigation: NavigationField | null = null;
  private navigateAt = 0;
  private solidMeshes: THREE.Object3D[] = [];
  private bulletGround?: THREE.Mesh;
  private keys = new Set<string>();
  private raycaster = new THREE.Raycaster();
  private state: Snapshot = { ...initial };
  private settings: Settings = {
    sensitivity: 1,
    volume: 65,
    quality: true,
    prefer120: false,
    difficulty: "survivor",
  };
  private yaw = 0;
  private pitch = 0;
  private recoil = 0;
  private recoilSway = 0;
  private recoilTravel = 0;
  private trigger = false;
  private shotQueued = false;
  private grenadeHeldAt: number | null = null;
  private healStartedAt: number | null = null;
  private drinkStartedAt: number | null = null;
  private canOpeningHand: THREE.Group | null = null;
  private canTab: THREE.Mesh | null = null;
  private equipmentModels = new Map<Equipment, THREE.Group>();
  private throwHand: THREE.Group | null = null;
  private grenadeInHand: THREE.Group | null = null;
  private injectorView = new InjectorView();
  private throwFollowThroughUntil = 0;
  private thrownGrenades: {
    model: THREE.Group;
    velocity: THREE.Vector3;
    burstAt: number;
  }[] = [];
  private sprintPose = 0;
  private spitBolts: {
    mesh: THREE.Mesh;
    velocity: THREE.Vector3;
    expires: number;
  }[] = [];
  private sprinting = false;
  private dodge: {
    startedAt: number;
    x: number;
    z: number;
    lean: number;
    plannedTravel: number;
  } | null = null;
  private dodgeReadyAt = 0;
  private staminaResumeAt = 0;
  private dodgeLean = 0;
  private movement = new THREE.Vector2();
  private stepPhase = 0;
  private ads = false;
  private jump = 0;
  private verticalVelocity = 0;
  private fireAt = 0;
  private reloadAt = 0;
  private weaponHands = new WeaponHands();
  private reloadShell = new THREE.Group();
  private reloadPose = 0;
  private deadline = 0;
  private activeTime = 0;
  private sprintUntil = 0;
  private boostUntil = 0;
  private sprintExhausted = false;
  private checkpoint: THREE.Group | null = null;
  private pickups: Pickup[] = [];
  private elapsed = 0;
  private lastTime = 0;
  private lastSnapshot = 0;
  private fpsWindowStart: number | null = null;
  private fpsFrameCount = 0;
  private frame = 0;
  private destroyed = false;
  private audio: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private observer: ResizeObserver;
  private coarse = false;
  private freeLook = false;
  private touchMove = { x: 0, y: 0 };
  private casings: {
    mesh: THREE.Mesh;
    velocity: THREE.Vector3;
    spin: number;
    life: number;
  }[] = [];
  private shotSmoke: { sprite: THREE.Sprite; velocity: THREE.Vector3; life: number }[] = [];
  private shotSmokeTexture?: THREE.DataTexture;
  private surfaceEffects = new SurfaceEffects(
    this.world,
    () => this.shotSmokeTexture ??= this.createShotSmokeTexture(),
  );
  private impacts: { mesh: THREE.Mesh; life: number }[] = [];
  private dust!: THREE.Points;
  private materials = new Map<string, THREE.MeshStandardMaterial>();
  private renderBudget = new RenderBudget();
  private lastShadow = -Infinity;
  private shadowFrame = false;
  private staticShadows = false;
  private viewport = { width: 1, height: 1 };
  private contactShadows: THREE.InstancedMesh<
    THREE.PlaneGeometry, THREE.MeshBasicMaterial
  >;
  private contactTransform = new THREE.Matrix4();

  private applyRenderScale() {
    const { width, height } = this.viewport;
    const target = renderPixelLimit(width, height, window.devicePixelRatio, this.coarse, this.settings.quality);
    const ratio = Math.max(0.3, target * this.renderBudget.scale);
    if (Math.abs(ratio - this.renderer.getPixelRatio()) > 0.01) this.renderer.setPixelRatio(ratio);
  }

  private resize = () => {
    const { width, height } = this.host.getBoundingClientRect();
    if (width < 1 || height < 1 || (this.viewport.width === width && this.viewport.height === height)) return;
    this.viewport = { width, height };
    this.renderBudget.reset();
    this.applyRenderScale();
    this.renderer.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  };

  constructor(
    private host: HTMLDivElement,
    private onSnapshot: (state: Snapshot) => void,
  ) {
    this.coarse = matchMedia("(pointer: coarse)").matches;
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: "high-performance",
    });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.shadowMap.needsUpdate = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.domElement.setAttribute(
      "aria-label",
      "สนามเอาตัวรอดจากซอมบี้สามมิติ",
    );
    host.appendChild(this.renderer.domElement);
    this.scene.background = new THREE.Color("#737e7a");
    this.scene.fog = new THREE.FogExp2("#737e7a", 0.024);
    this.scene.add(this.world);
    this.scene.add(this.roomAvatars.root);
    this.contactShadows = this.createContactShadows();
    this.scene.add(this.contactShadows);
    this.scene.add(this.camera);
    this.scene.add(new THREE.HemisphereLight("#cad5cf", "#34372c", 2.2));
    this.camera.rotation.order = "YXZ";
    this.createWorld();
    this.createWeapon();
    this.camera.add(this.weapon, this.knifeView);
    this.preview();
    this.observer = new ResizeObserver(this.resize);
    this.observer.observe(host);
    this.resize();
    window.addEventListener("keydown", this.keydown);
    window.addEventListener("keyup", this.keyup);
    window.addEventListener("mousemove", this.mousemove);
    window.addEventListener("mousedown", this.mousedown);
    window.addEventListener("mouseup", this.mouseup);
    window.addEventListener("blur", this.blur);
    document.addEventListener("pointerlockchange", this.pointerlock);
    document.addEventListener("visibilitychange", this.visibility);
    host.addEventListener("contextmenu", this.contextmenu);
    this.frame = requestAnimationFrame(this.animate);
  }

  private material(color: string, roughness = 0.8, metalness = 0) {
    const key = `${color}/${roughness}/${metalness}`;
    if (!this.materials.has(key))
      this.materials.set(
        key,
        new THREE.MeshStandardMaterial({ color, roughness, metalness }),
      );
    return this.materials.get(key)!;
  }

  private box(
    w: number,
    h: number,
    d: number,
    color: string,
    x: number,
    y: number,
    z: number,
    parent: THREE.Object3D = this.world,
    metal = 0,
  ) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      this.material(color, metal ? 0.48 : 0.88, metal),
    );
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  private cylinder(
    r: number,
    h: number,
    color: string,
    x: number,
    y: number,
    z: number,
    parent: THREE.Object3D = this.world,
    sides = 12,
  ) {
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(r, r, h, sides),
      this.material(color, 0.68, 0.3),
    );
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  private label(
    text: string,
    color: string,
    bg: string,
    w: number,
    h: number,
    x: number,
    y: number,
    z: number,
    parent: THREE.Object3D = this.world,
  ) {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 128;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 512, 128);
    ctx.fillStyle = color;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "bold 50px Arial";
    ctx.fillText(text, 256, 68, 480);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshStandardMaterial({ map: texture, roughness: 1 }),
    );
    plane.position.set(x, y, z);
    parent.add(plane);
    return plane;
  }

  private createContactShadows() {
    const size = 32;
    const pixels = new Uint8Array(size * size * 4).fill(255);
    for (let z = 0; z < size; z++) {
      for (let x = 0; x < size; x++) {
        const dx = ((x + 0.5) / size) * 2 - 1;
        const dz = ((z + 0.5) / size) * 2 - 1;
        pixels[(z * size + x) * 4 + 3] = Math.round(255 * Math.max(0, 1 - dx * dx - dz * dz) ** 2);
      }
    }
    const map = new THREE.DataTexture(pixels, size, size);
    map.magFilter = map.minFilter = THREE.LinearFilter;
    map.needsUpdate = true;
    const geometry = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const material = new THREE.MeshBasicMaterial({
      color: "#171b18", map, transparent: true, opacity: 0.4, depthWrite: false,
    });
    const mesh = new THREE.InstancedMesh(geometry, material, 32);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.count = 0;
    return mesh;
  }

  private setStaticShadows(enabled: boolean) {
    if (enabled === this.staticShadows) return;
    this.staticShadows = enabled;
    for (const zombie of this.zombies) {
      zombie.group.traverse((part) => {
        if (part instanceof THREE.Mesh) part.castShadow = !enabled;
      });
    }
    this.renderer.shadowMap.needsUpdate = true;
  }

  private updateContactShadows() {
    let count = 0;
    for (const zombie of this.zombies) {
      const { position, visible, scale } = zombie.group;
      if (!visible || position.y > 0.85) continue;
      const size = 1 - Math.max(0, position.y) * 0.85;
      const down = zombie.health <= 0 || zombie.crawl;
      this.contactTransform.makeScale(scale.x * size * 1.25, 1, scale.z * size * (down ? 1.7 : 1));
      this.contactTransform.setPosition(position.x, 0.029, position.z);
      this.contactShadows.setMatrixAt(count++, this.contactTransform);
      if (count === this.contactShadows.instanceMatrix.count) break;
    }
    this.contactShadows.count = count;
    if (count) this.contactShadows.instanceMatrix.needsUpdate = true;
  }

  private createWorld() {
    const zone = zoneForStage(this.arenaStage);
    this.scene.background = new THREE.Color(zone.sky);
    this.scene.fog = new THREE.FogExp2(zone.sky, 0.024);
    this.renderer.shadowMap.needsUpdate = true;
    const sun = new THREE.DirectionalLight(zone.light, 3.2);
    sun.position.set(-22, 32, -24);
    sun.castShadow = true;
    sun.shadow.mapSize.setScalar(this.coarse ? 1024 : 1536);
    sun.shadow.camera.left = -38;
    sun.shadow.camera.right = 38;
    sun.shadow.camera.top = 38;
    sun.shadow.camera.bottom = -38;
    sun.shadow.normalBias = 0.035;
    this.world.add(sun);

    // Weathered asphalt is made locally so the game has no runtime asset dependencies.
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 512;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = zone.ground;
    ctx.fillRect(0, 0, 512, 512);
    const wear = ctx.createRadialGradient(245, 268, 28, 245, 268, 345);
    wear.addColorStop(0, "#cebfae48");
    wear.addColorStop(0.56, "#8c826b14");
    wear.addColorStop(1, "#221f1b45");
    ctx.fillStyle = wear;
    ctx.fillRect(0, 0, 512, 512);
    let seed = 137 + this.arenaStage * 7919;
    const random = () => {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };
    for (let i = 0; i < 14000; i++) {
      const shade = 35 + random() * 65;
      ctx.fillStyle = `rgba(${shade},${shade + 3},${shade},${random() * 0.6})`;
      ctx.fillRect(
        random() * 512,
        random() * 512,
        1 + random() * 3,
        1 + random() * 2,
      );
    }
    for (let i = 0; i < 20; i++) {
      ctx.strokeStyle = "#32352f";
      ctx.lineWidth = random() * 2;
      ctx.beginPath();
      let x = random() * 512,
        y = random() * 512;
      ctx.moveTo(x, y);
      for (let j = 0; j < 8; j++) {
        x += random() * 40 - 20;
        y += random() * 40;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    const groundTexture = new THREE.CanvasTexture(canvas);
    groundTexture.wrapS = groundTexture.wrapT = THREE.RepeatWrapping;
    groundTexture.repeat.set(18, 18);
    groundTexture.colorSpace = THREE.SRGBColorSpace;
    groundTexture.anisotropy = Math.min(4, this.renderer.capabilities.getMaxAnisotropy());
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(220, 220),
      new THREE.MeshStandardMaterial({ map: groundTexture, roughness: 0.87 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.bulletGround = ground;
    this.world.add(ground);

    if (zone.code === "QUARANTINE") {
      for (let i = 0; i < 9; i++) {
        const line = this.box(
          0.13,
          0.012,
          3,
          "#b5ad78",
          -2.9,
          0.014,
          17 - i * 5.5,
        );
        line.castShadow = false;
      }
      const puddleMaterial = new THREE.MeshStandardMaterial({
        color: "#697a79", metalness: 0.65, roughness: 0.17, transparent: true, opacity: 0.38,
      });
      const puddles = new THREE.InstancedMesh(new THREE.CircleGeometry(1, 24), puddleMaterial, 30);
      const puddle = new THREE.Object3D();
      puddle.rotation.x = -Math.PI / 2;
      for (let i = 0; i < puddles.count; i++) {
        const radius = 0.7 + random() * 2;
        puddle.rotation.z = random() * 6;
        puddle.scale.set(radius, radius * (0.25 + random() * 0.3), 1);
        puddle.position.set(random() * 52 - 26, 0.016, random() * 52 - 26);
        puddle.updateMatrix();
        puddles.setMatrixAt(i, puddle.matrix);
      }
      this.world.add(puddles);

      this.building(-20, -8, 11, 11, 34, "#737970");
      this.building(20, -16, 11, 15, 24, "#6d736b");
      this.building(1, -33, 38, 8, 8, "#72786c");
      this.label(
        "QUARANTINE  /  SECTOR 07",
        "#c3c2a5",
        "#343d34",
        10,
        1.15,
        0,
        5.4,
        -28.92,
      );
      this.box(11, 4.3, 0.15, "#373e37", 0, 2.15, -28.8);
      for (let x = -5; x < 5.5; x += 0.35)
        this.box(0.05, 4.2, 0.08, "#555f50", x, 2.2, -28.68, this.world, 0.65);
      this.label("KEEP OUT", "#c7bd8f", "#4b4b36", 2.4, 0.65, -1, 2.8, -28.54);

      this.container(9, -9, 0, "#53615a", "NORTHLINE");
      this.container(-10, -16, 0, "#7c6350", "N-07 / STORAGE");
      this.container(11, 11, Math.PI / 2, "#63716b", "CARGO  041");
      this.container(-17, 18, 0, "#77705d", "RESTRICTED");
      this.container(10, -9, 0, "#4c5750", "ZONE 07", 3.05);

      this.obstacles.push(
        { x: -20, z: -8, w: 11, d: 34 },
        { x: 20, z: -16, w: 11, d: 24 },
      );
      for (const [x, z] of [
        [-6, -5],
        [4, 5],
        [3, -19],
        [-11, 9],
        [16, 21],
      ]) {
        const variation =
          this.arenaStage === 1 ? 0 : ((this.arenaStage * 3 + x + 29) % 5) - 2;
        this.barricade(x, z + variation);
      }
      for (const [x, z] of [
        [-10, -4],
        [-11, -4],
        [3, -21],
        [14, -4],
        [-13, 8],
      ]) {
        this.cylinder(0.42, 1.2, "#6d5a3d", x, 0.6, z);
        this.cylinder(0.435, 0.045, "#3d4238", x, 0.3, z);
        this.cylinder(0.435, 0.045, "#3d4238", x, 0.9, z);
        this.obstacles.push({ x, z, w: 0.85, d: 0.85 });
      }
      for (const [x, z] of [
        [-7, 14],
        [-5.8, 14],
        [13, -21],
      ]) {
        this.box(1.1, 1.05, 1.1, "#6a6349", x, 0.525, z);
        for (const y of [0.13, 0.9])
          this.box(1.13, 0.1, 1.13, "#444b38", x, y, z);
        this.obstacles.push({ x, z, w: 1.1, d: 1.1 });
      }
    } else {
      this.buildAlternateZone(zone.code);
    }

    // Chain-link fence, perimeter lights, power lines and distant skyline.
    const fencePositions: number[] = [];
    for (let x = -28; x <= 28; x += 4) {
      this.cylinder(0.055, 3.8, "#555e52", x, 1.9, 27);
      if (x < 28) {
        for (let y = 0.3; y < 3.5; y += 0.28) {
          fencePositions.push(x, y, 27, x + 4, y + 1.1, 27);
        }
        this.box(4, 0.035, 0.04, "#555e52", x + 2, 3.4, 27);
      }
    }
    const fence = new THREE.BufferGeometry();
    fence.setAttribute("position", new THREE.Float32BufferAttribute(fencePositions, 3));
    this.world.add(new THREE.LineSegments(
      fence, new THREE.LineBasicMaterial({ color: "#5d6659", transparent: true, opacity: 0.65 }),
    ));
    for (const [x, z] of [
      [-13, -24],
      [14, 2],
      [-13, 23],
    ]) {
      this.cylinder(0.1, 8, "#414b42", x, 4, z);
      this.box(2.2, 0.08, 0.1, "#414b42", x + 0.7, 7.7, z);
      const lamp = this.box(0.75, 0.12, 0.35, "#c9c4a4", x + 1.5, 7.65, z);
      lamp.material = new THREE.MeshStandardMaterial({
        color: "#ffe6ac",
        emissive: "#ffe6ac",
        emissiveIntensity: 2,
      });
      const light = new THREE.PointLight("#ffe2ad", 24, 15, 2);
      light.position.set(x + 1.5, 7.2, z);
      this.world.add(light);
    }
    for (let i = 0; i < (zone.code === "QUARANTINE" ? 12 : 5); i++) {
      const x = -70 + i * 13,
        z = -55 - random() * 15,
        h = 10 + random() * 17;
      this.box(8 + random() * 7, h, 9, "#626d65", x, h / 2, z);
      if (i % 3 === 0) {
        this.cylinder(1.1, h + 9, "#5c655b", x + 3, (h + 9) / 2, z);
        for (let j = 0; j < 5; j++) {
          const smoke = new THREE.Mesh(
            new THREE.SphereGeometry(2 + j * 1.2, 8, 6),
            new THREE.MeshBasicMaterial({
              color: "#64726b",
              transparent: true,
              opacity: 0.11 - j * 0.015,
              depthWrite: false,
            }),
          );
          smoke.position.set(x + 3 + j * 2, h + 10 + j * 2.4, z);
          smoke.scale.y = 0.6;
          this.world.add(smoke);
        }
      }
    }
    for (let i = 0; i < 80; i++) {
      const x = random() * 50 - 25,
        z = random() * 50 - 25;
      if (i % 3 === 0) {
        const paper = this.box(
          0.2 + random() * 0.25,
          0.008,
          0.25,
          "#96957c",
          x,
          0.025,
          z,
        );
        paper.rotation.y = random() * 6;
        paper.castShadow = false;
      } else {
        const rock = this.box(
          0.04 + random() * 0.12,
          0.05 + random() * 0.1,
          0.1,
          "#73766a",
          x,
          0.04,
          z,
        );
        rock.rotation.y = random() * 6;
        rock.castShadow = false;
      }
    }
    const dustPositions = new Float32Array(250 * 3);
    for (let i = 0; i < 250; i++) {
      dustPositions[i * 3] = random() * 65 - 32;
      dustPositions[i * 3 + 1] = random() * 10;
      dustPositions[i * 3 + 2] = random() * 65 - 32;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(dustPositions, 3),
    );
    this.dust = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({
        color: "#e4debd",
        size: 0.035,
        transparent: true,
        opacity: 0.4,
        depthWrite: false,
      }),
    );
    this.world.add(this.dust);
    this.batchScenery();
    this.solidMeshes = this.world.children.filter(
      (obj) =>
        obj instanceof THREE.Mesh &&
        !(obj.geometry instanceof THREE.PlaneGeometry) &&
        !(obj.geometry instanceof THREE.CircleGeometry),
    );
    const firstGatePart = this.world.children.length;
    this.createGate(zone.exitX);
    this.solidMeshes.push(
      ...this.world.children
        .slice(firstGatePart)
        .filter(
          (part) =>
            part instanceof THREE.Mesh &&
            !(part.geometry instanceof THREE.PlaneGeometry),
        ),
    );
  }

  private addCover(
    x: number,
    z: number,
    w: number,
    d: number,
    h: number,
    color: string,
    surface: ImpactSurface = "concrete",
  ) {
    this.box(w, h, d, color, x, h / 2, z, this.world, surface === "metal" ? 0.36 : 0);
    this.obstacles.push({ x, z, w, d });
  }

  private buildAlternateZone(code: "RAIL DEPOT" | "FOUNDRY" | "CONSERVATORY") {
    // Revisited districts get shifted cover while keeping the entrance and exit lanes open.
    const laneShift = (Math.floor((this.arenaStage - 1) / 4) % 5) * 0.7;
    if (code === "RAIL DEPOT") {
      for (const z of [-13, 1, 14]) {
        const x = z === 1 ? 9 + laneShift : -13 + laneShift;
        this.addCover(x, z, 12, 3.1, 3.1, "#435d6e", "metal");
        this.box(11.7, 0.13, 3.15, "#a79761", x, 2.35, z, this.world, 0.4);
        for (const offset of [-4, -2, 0, 2, 4]) {
          this.box(1.05, 0.57, 0.06, "#253744", x + offset, 1.97, z + 1.57);
          this.cylinder(
            0.33,
            0.18,
            "#30383b",
            x + offset,
            0.32,
            z + 1.58,
          ).rotation.x = Math.PI / 2;
        }
      }
      for (const z of [-13, 1, 14]) {
        for (const rail of [-1, 1])
          this.box(
            51,
            0.045,
            0.07,
            "#7c837c",
            0,
            0.03,
            z + rail,
            this.world,
            0.45,
          );
        for (let x = -24; x <= 24; x += 1.4)
          this.box(0.22, 0.037, 2.55, "#594e42", x, 0.025, z);
      }
      this.building(29, -4, 7, 9, 44, "#596b77");
      this.building(-27, -30, 20, 5, 7, "#61777f");
    } else if (code === "FOUNDRY") {
      for (const [x, z] of [
        [-12, -13],
        [12, -10],
        [-8, 7],
        [13, 13],
      ]) {
        const tx = x + laneShift;
        this.cylinder(2.35, 6, "#695448", tx, 3, z).userData.impactSurface = "metal";
        for (const y of [0.5, 3.9, 5.8])
          this.cylinder(2.42, 0.15, "#9b7753", tx, y, z).userData.impactSurface = "metal";
        this.cylinder(0.6, 2.3, "#4b3c36", tx, 7, z).userData.impactSurface = "metal";
        this.obstacles.push({ x: tx, z, w: 4.7, d: 4.7 });
      }
      this.addCover(0, -5, 8, 1.65, 1.75, "#754e38");
      this.addCover(4 + laneShift, 9, 1.8, 6, 1.3, "#654a3e");
      for (const z of [-15, 7]) {
        for (const x of [-23, 23]) this.box(0.75, 10, 0.75, "#4e4038", x, 5, z);
        this.box(46, 0.65, 0.65, "#8c663e", 0, 9, z);
        this.box(46, 0.24, 0.28, "#c1844f", 0, 8.5, z);
      }
    } else {
      for (const [x, z, w, d] of [
        [-10, 11, 9, 4],
        [11, 9, 5, 8],
        [-9, -8, 5, 8],
        [10, -9, 10, 4],
        [0, -1, 4, 3],
      ]) {
        const px = x + laneShift;
        this.addCover(px, z, w, d, 0.82, "#626b52");
        this.box(w - 0.3, 0.075, d - 0.3, "#3e4132", px, 0.86, z);
        for (let offset = -w / 2 + 1; offset < w / 2; offset += 1.5) {
          const tree = this.cylinder(
            0.09,
            1.8,
            "#62543a",
            px + offset,
            1.77,
            z,
          );
          tree.rotation.z = offset * 0.04;
          for (const [sx, sz] of [
            [-0.29, 0.1],
            [0.3, 0],
            [0, -0.32],
          ]) {
            const leaves = new THREE.Mesh(
              new THREE.IcosahedronGeometry(0.65, 0),
              this.material("#527649"),
            );
            leaves.position.set(px + offset + sx, 2.4 + sx, z + sz);
            leaves.scale.set(1.12, 0.75, 1);
            this.world.add(leaves);
          }
        }
      }
      for (const z of [-18, -9, 0, 9, 18]) {
        for (const direction of [-1, 1]) {
          this.box(0.1, 5.5, 0.14, "#7e8c7d", direction * 19, 2.75, z, this.world, 0.36);
          const beam = this.box(
            20.4,
            0.1,
            0.12,
            "#8a9d88",
            direction * 9.5,
            8.2,
            z,
            this.world,
            0.36,
          );
          beam.rotation.z = direction * -0.34;
        }
      }
    }
  }

  private createGate(x: number) {
    for (const side of [-1, 1]) {
      this.addCover(x + side * 3.15, GATE_Z, 2.1, 1.05, 3.7, "#38433e");
    }
    this.box(8.4, 0.5, 1.1, "#46544d", x, 3.65, GATE_Z);
    this.label(
      "ZONE EXIT",
      "#d4e0b9",
      "#263a31",
      2.85,
      0.38,
      x,
      3.64,
      GATE_Z + 0.56,
    );
    this.gateLock = { x, z: GATE_Z, w: 4.2, d: 0.32 };
    this.obstacles.push(this.gateLock);
    this.gatePanels = [-1, 1].map((side) =>
      this.box(
        2.07,
        3.3,
        0.28,
        "#545e53",
        x + side * 1.05,
        1.65,
        GATE_Z,
        this.world,
        0.56,
      ),
    );
    this.gateProgress = 0;
  }

  private loadArena(stage: number) {
    this.clearZombies();
    this.clearObjectives();
    this.clearShotEffects();
    this.surfaceEffects.clear();
    const shared = new Set(this.materials.values());
    this.world.traverse((object) => {
      if (object instanceof THREE.DirectionalLight) object.shadow.dispose();
      if (object instanceof THREE.InstancedMesh) object.dispose();
      if (!(
        object instanceof THREE.Mesh ||
        object instanceof THREE.Line ||
        object instanceof THREE.Points
      ))
        return;
      object.geometry.dispose();
      const material = object.material;
      if (shared.has(material)) return;
      if (material.map instanceof THREE.Texture) material.map.dispose();
      material.dispose();
    });
    this.world.clear();
    this.impacts = [];
    this.obstacles = [];
    this.navigation = null;
    this.arenaStage = stage;
    this.createWorld();
  }

  private batchScenery() {
    this.world.updateMatrixWorld(true);
    const batches = new Map<string, { material: THREE.Material; surface: ImpactSurface; meshes: THREE.Mesh[] }>();
    this.world.traverse((object) => {
      if (
        !(object instanceof THREE.Mesh) ||
        !(object.material instanceof THREE.MeshStandardMaterial) ||
        object.material.map ||
        object.material.transparent
      )
        return;
      const material = object.material;
      const surface = impactSurfaceOf(object);
      const key = `${material.uuid}:${surface}:${object.castShadow}`;
      const batch = batches.get(key) ?? { material, surface, meshes: [] };
      batch.meshes.push(object);
      batches.set(key, batch);
    });
    for (const { material, surface, meshes } of batches.values()) {
      const geometries = meshes.map((mesh) =>
        mesh.geometry.clone().applyMatrix4(mesh.matrixWorld),
      );
      const merged = mergeGeometries(geometries);
      if (merged) {
        const combined = new THREE.Mesh(merged, material);
        combined.userData.impactSurface = surface;
        combined.castShadow = meshes[0].castShadow;
        combined.receiveShadow = true;
        this.world.add(combined);
        for (const mesh of meshes) {
          mesh.removeFromParent();
          mesh.geometry.dispose();
        }
      }
      for (const geometry of geometries) geometry.dispose();
    }
  }

  private building(
    x: number,
    z: number,
    w: number,
    h: number,
    d: number,
    color: string,
  ) {
    this.box(w, h, d, color, x, h / 2, z);
    this.box(w + 0.25, 0.3, d + 0.25, "#485248", x, h, z);
    const front = z + d / 2 + 0.015;
    for (let y = 2.4; y < h - 1; y += 2.4) {
      for (let wx = x - w / 2 + 1.2; wx < x + w / 2 - 0.5; wx += 2) {
        this.box(1.15, 1.4, 0.035, "#303e38", wx, y, front);
        this.box(0.045, 1.4, 0.05, "#7d8271", wx, y, front + 0.03);
        this.box(1.15, 0.05, 0.05, "#7d8271", wx, y, front + 0.03);
      }
    }
    const side = x > 0 ? x - w / 2 - 0.01 : x + w / 2 + 0.01;
    for (let sz = z - d / 2 + 1.2; sz < z + d / 2 - 0.3; sz += 2.4) {
      for (let y = 2.2; y < h - 1; y += 2.5) {
        this.box(0.04, 1.3, 1.3, "#35433b", side, y, sz);
        this.box(0.055, 1.3, 0.04, "#7a8270", side, y, sz);
      }
    }
    for (let y = 0.5; y < h; y += 0.8)
      this.box(w, 0.018, 0.018, "#646e61", x, y, front + 0.01);
  }

  private container(
    x: number,
    z: number,
    rotation: number,
    color: string,
    text: string,
    base = 0,
  ) {
    const group = new THREE.Group();
    group.position.set(x, base, z);
    group.rotation.y = rotation;
    this.world.add(group);
    this.box(3.1, 3, 8, color, 0, 1.5, 0, group, 0.35);
    for (let s = -3.8; s <= 3.8; s += 0.28) {
      this.box(0.08, 2.8, 0.07, color, -1.58, 1.5, s, group, 0.4);
      this.box(0.08, 2.8, 0.07, color, 1.58, 1.5, s, group, 0.4);
      this.box(3.05, 0.06, 0.07, color, 0, 3.03, s, group, 0.4);
    }
    for (const sign of [-1, 1]) {
      for (const edge of [-1.45, 1.45])
        this.box(
          0.12,
          3.05,
          0.12,
          "#3d4940",
          edge,
          1.5,
          sign * 3.95,
          group,
          0.6,
        );
      this.box(3.15, 0.12, 0.12, "#3d4940", 0, 0.07, sign * 4, group, 0.6);
      this.box(3.15, 0.12, 0.12, "#3d4940", 0, 2.95, sign * 4, group, 0.6);
    }
    for (const dx of [-0.65, 0.65])
      this.cylinder(0.035, 2.7, "#b1af93", dx, 1.5, 4.04, group);
    this.label(text, "#d4d1b7", color, 2.6, 0.55, 0, 2.15, 4.07, group);
    if (base === 0)
      this.obstacles.push({
        x,
        z,
        w: rotation === 0 ? 3.3 : 8.2,
        d: rotation === 0 ? 8.2 : 3.3,
      });
  }

  private barricade(x: number, z: number) {
    const block = this.box(3.3, 1.05, 0.8, "#8e907b", x, 0.525, z);
    const pos = block.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++)
      if (pos.getY(i) > 0) pos.setZ(i, pos.getZ(i) * 0.55);
    block.geometry.computeVertexNormals();
    for (let i = -1; i <= 1; i++) {
      const stripe = this.box(
        0.35,
        0.7,
        0.025,
        "#b3a25c",
        x + i * 0.95,
        0.55,
        z + 0.35,
      );
      stripe.rotation.z = -0.45;
    }
    this.obstacles.push({ x, z, w: 3.3, d: 0.85 });
  }

  private createWeapon() {
    this.createKnifeView();
    const g = new THREE.Group();
    this.weapon.add(g);
    this.weaponModels.set("rifle", g);
    this.chamferedShell(0.115, 0.13, 0.38, 0.017, "#485453", 0, 0, -0.05, g);
    this.chamferedShell(0.09, 0.105, 0.43, 0.018, "#817654", 0, 0, -0.4, g);
    this.box(0.12, 0.015, 0.31, "#626c65", 0, 0.025, -0.055, g, 0.32);
    this.box(0.004, 0.035, 0.14, "#242c2b", 0.06, 0.026, -0.11, g);
    this.box(0.006, 0.014, 0.1, "#a0a498", 0.062, 0.027, -0.12, g, 0.3);
    for (const z of [-0.19, 0.025, 0.1]) {
      this.cylinder(0.008, 0.124, "#222a28", 0, 0.012, z, g, 6).rotation.z =
        Math.PI / 2;
    }
    this.box(0.07, 0.065, 0.22, "#252c29", 0, -0.005, -0.7, g, 0.9);
    const barrel = this.cylinder(0.023, 0.28, "#282e2c", 0, 0, -0.83, g);
    barrel.rotation.x = Math.PI / 2;
    const suppressor = this.cylinder(0.034, 0.19, "#454e49", 0, 0, -1.01, g);
    suppressor.rotation.x = Math.PI / 2;
    for (const z of [-1.1, -1.065, -0.95])
      this.cylinder(0.036, 0.012, "#26312f", 0, 0, z, g).rotation.x =
        Math.PI / 2;
    for (let z = -0.57; z < -0.2; z += 0.035) {
      this.box(0.11, 0.025, 0.013, "#282f2a", 0, 0.063, z, g, 0.8);
      this.box(0.009, 0.035, 0.018, "#232a25", 0.049, 0, z, g);
    }
    this.box(0.085, 0.04, 0.47, "#202722", 0, 0.075, -0.12, g, 0.7);
    for (const side of [-1, 1]) {
      this.box(0.005, 0.012, 0.31, "#9f9471", side * 0.046, 0.031, -0.408, g, 0.3);
      this.box(0.004, 0.009, 0.235, "#818f88", side * 0.058, 0.047, -0.035, g, 0.44);
    }
    const grip = this.box(0.07, 0.17, 0.075, "#343b30", 0, -0.13, 0.035, g);
    grip.rotation.x = -0.22;
    const magazine = new THREE.Group();
    magazine.name = "reload-magazine";
    magazine.position.set(0, -0.15, -0.11);
    magazine.rotation.x = 0.12;
    g.add(magazine);
    this.box(0.067, 0.21, 0.105, "#555b45", 0, 0, 0, magazine, 0.5);
    for (let i = 0; i < 5; i++)
      this.box(
        0.071,
        0.009,
        0.109,
        "#3e4638",
        0,
        0.07 - i * 0.028,
        0.01 + i * 0.003,
        magazine,
      );
    this.box(0.07, 0.08, 0.19, "#424b3b", 0, 0.01, 0.22, g);
    this.chamferedShell(0.1, 0.19, 0.06, 0.018, "#29332a", 0, -0.01, 0.34, g);
    this.box(0.091, 0.16, 0.015, "#536056", 0, -0.012, 0.376, g);
    // Open holographic sight with an unobstructed center.
    this.box(0.085, 0.025, 0.095, "#1e2723", 0, 0.11, -0.13, g, 0.8);
    for (const x of [-0.038, 0.038])
      this.box(0.012, 0.075, 0.04, "#28312b", x, 0.153, -0.13, g, 0.8);
    this.box(0.085, 0.012, 0.04, "#28312b", 0, 0.19, -0.13, g, 0.8);
    this.chamferedShell(0.088, 0.012, 0.048, 0.003, "#84928b", 0, 0.197, -0.13, g);
    this.cylinder(0.013, 0.014, "#64716a", 0.051, 0.134, -0.13, g, 8).rotation.z =
      Math.PI / 2;
    const reticle = new THREE.Mesh(
      new THREE.SphereGeometry(0.003, 6, 6),
      new THREE.MeshBasicMaterial({ color: "#e66e44", depthTest: false }),
    );
    reticle.position.set(0, 0.151, -0.15);
    g.add(reticle);
    this.weaponHands.addGrip(g, [0, -0.132, 0.034]);
    this.muzzle.position.set(0, 0, weapons.rifle.muzzle);
    const flash = new THREE.Mesh(
      new THREE.ConeGeometry(0.075, 0.28, 5),
      new THREE.MeshBasicMaterial({
        color: "#ffdf9d",
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
      }),
    );
    flash.rotation.x = -Math.PI / 2;
    flash.position.z = -0.14;
    this.muzzle.add(flash);
    const core = new THREE.Mesh(
      new THREE.SphereGeometry(0.047, 8, 5),
      new THREE.MeshBasicMaterial({ color: "#fff1cb", toneMapped: false }),
    );
    core.scale.set(1, 1, 1.55);
    core.position.z = -0.027;
    this.muzzle.add(core);
    this.muzzle.visible = false;
    this.weapon.add(this.muzzle);
    this.flashLight.position.set(0, 0.05, -1);
    this.weapon.add(this.flashLight);
    this.weapon.add(this.weaponHands.support);
    const shell = this.cylinder(
      0.017,
      0.084,
      "#c35b47",
      0,
      0.019,
      0,
      this.reloadShell,
      8,
    );
    shell.rotation.x = Math.PI / 2;
    this.cylinder(
      0.018,
      0.018,
      "#c9ac70",
      0,
      0.019,
      0.043,
      this.reloadShell,
      8,
    ).rotation.x = Math.PI / 2;
    this.reloadShell.position.set(-0.012, 0.009, -0.015);
    this.weaponHands.support.add(this.reloadShell);
    this.weaponHands.support.visible = false;
    this.reloadShell.visible = false;
    for (const id of weaponSlots.slice(1)) {
      const model = this.createAlternateWeapon(id);
      model.visible = false;
      this.weaponModels.set(id, model);
      this.weapon.add(model);
    }
    this.equipmentModels.set("medkit", this.injectorView.model);
    this.weapon.add(this.injectorView.model);
    for (const item of ["grenade", "energy"] as const) {
      const model = new THREE.Group();
      const body = this.equipmentModel(item);
      body.scale.setScalar(0.58);
      model.add(body);
      model.position.set(-0.06, 0.04, -0.25);
      model.rotation.z = -0.13;
      this.box(0.15, 0.12, 0.23, "#424b39", 0.1, -0.12, 0.07, model);
      if (item === "grenade") {
        this.grenadeInHand = body;
        const hand = new THREE.Group();
        this.box(0.105, 0.08, 0.13, "#4e5547", 0, 0, 0, hand);
        this.box(0.13, 0.12, 0.24, "#62654e", 0.085, -0.05, 0.13, hand);
        for (let i = 0; i < 3; i++)
          this.box(
            0.026,
            0.034,
            0.07,
            "#666a57",
            -0.044 + i * 0.032,
            0.024,
            -0.062,
            hand,
          );
        model.add(hand);
        this.throwHand = hand;
      }
      if (item === "energy") {
        this.canTab = body.getObjectByName("can-tab") as THREE.Mesh;
        const hand = new THREE.Group();
        this.box(0.105, 0.082, 0.12, "#4e5547", 0, 0, 0, hand);
        this.box(0.115, 0.108, 0.26, "#62654e", -0.05, -0.035, 0.145, hand);
        this.box(0.027, 0.033, 0.082, "#727560", 0.026, -0.014, -0.068, hand);
        this.box(0.026, 0.034, 0.054, "#616754", -0.01, 0.018, -0.05, hand);
        hand.visible = false;
        this.canOpeningHand = hand;
        model.add(hand);
      }
      model.visible = false;
      this.equipmentModels.set(item, model);
      this.weapon.add(model);
    }
    this.weapon.position.set(0.26, -0.27, -0.42);
    this.weapon.traverse((o) => {
      if (o.name === "reload-magazine") {
        o.userData.restPosition = o.position.clone();
        o.userData.restRotation = o.rotation.clone();
      }
      if (o instanceof THREE.Mesh) {
        o.frustumCulled = false;
        o.castShadow = false;
      }
    });
  }

  private createKnifeView() {
    const rig = this.knifeView;
    const blade = new THREE.Shape();
    blade.moveTo(-0.025, 0);
    blade.lineTo(0.029, 0);
    blade.lineTo(0.032, 0.20);
    blade.lineTo(-0.012, 0.285);
    blade.lineTo(-0.025, 0.19);
    blade.closePath();
    const mesh = new THREE.Mesh(
      new THREE.ExtrudeGeometry(blade, { depth: 0.009, bevelEnabled: false, curveSegments: 1 }),
      this.material("#c4cdc9", 0.42, 0.35),
    );
    mesh.position.set(0, 0.06, -0.13);
    rig.add(mesh);
    this.box(0.096, 0.018, 0.041, "#7c8377", 0, 0.06, -0.124, rig);
    this.box(0.043, 0.105, 0.038, "#29322a", 0, 0.009, -0.125, rig);
    const grip = this.box(0.112, 0.093, 0.114, "#495044", 0.034, -0.007, -0.075, rig);
    grip.rotation.z = 0.2;
    for (let i = 0; i < 3; i++)
      this.box(0.023, 0.043, 0.059, "#6b6e59", 0.006 + i * 0.032, 0.037, -0.108, rig);
    const sleeve = this.box(0.139, 0.12, 0.36, "#686a52", 0.095, -0.059, 0.12, rig);
    sleeve.rotation.y = 0.24;
    rig.traverse(part => { if (part instanceof THREE.Mesh) part.castShadow = false; });
    rig.visible = false;
  }

  private equipmentModel(kind: Equipment) {
    const group = new THREE.Group();
    const add = (
      geometry: THREE.BufferGeometry,
      color: string,
      x = 0,
      y = 0,
      z = 0,
      metalness = 0,
    ) => {
      const mesh = new THREE.Mesh(
        geometry,
        new THREE.MeshStandardMaterial({ color, metalness, roughness: 0.68 }),
      );
      mesh.position.set(x, y, z);
      group.add(mesh);
      return mesh;
    };
    const box = (
      w: number,
      h: number,
      d: number,
      color: string,
      x = 0,
      y = 0,
      z = 0,
    ) => add(new THREE.BoxGeometry(w, h, d), color, x, y, z);
    if (kind === "grenade") {
      add(
        new THREE.CapsuleGeometry(0.105, 0.14, 4, 9),
        "#566047",
        0,
        -0.035,
        0,
        0.18,
      );
      add(
        new THREE.CylinderGeometry(0.106, 0.106, 0.035, 9),
        "#b8a879",
        0,
        0.019,
        0,
      );
      box(0.105, 0.044, 0.09, "#384242", 0, 0.137, 0);
      box(0.032, 0.19, 0.057, "#79817e", 0.083, 0.054, 0).rotation.z = 0.19;
      add(
        new THREE.TorusGeometry(0.031, 0.006, 5, 12),
        "#a9b1aa",
        -0.073,
        0.145,
        0.045,
        0.3,
      );
    } else if (kind === "medkit") {
      box(0.46, 0.29, 0.19, "#9b4742");
      box(0.46, 0.02, 0.195, "#73322e", 0, -0.08);
      box(0.16, 0.034, 0.06, "#3e3d35", 0, 0.166, 0);
      box(0.05, 0.18, 0.009, "#e9e4c9", 0, 0, 0.098);
      box(0.17, 0.05, 0.009, "#e9e4c9", 0, 0, 0.098);
    } else {
      add(
        new THREE.CylinderGeometry(0.092, 0.085, 0.3, 13),
        "#697e40",
        0,
        0,
        0,
        0.35,
      );
      add(
        new THREE.CylinderGeometry(0.094, 0.094, 0.017, 13),
        "#bbc0aa",
        0,
        0.151,
        0,
        0.4,
      );
      const tab = add(
        new THREE.TorusGeometry(0.027, 0.006, 5, 10),
        "#d4d9cd",
        0,
        0.163,
        0.015,
        0.42,
      );
      tab.rotation.x = -Math.PI / 2;
      tab.scale.set(0.72, 1.18, 1);
      tab.name = "can-tab";
      add(
        new THREE.CylinderGeometry(0.087, 0.087, 0.013, 13),
        "#bbc0aa",
        0,
        -0.15,
        0,
        0.4,
      );
      box(0.09, 0.11, 0.02, "#d6c27b", 0, 0.015, 0.083).rotation.z = -0.3;
    }
    return group;
  }

  private createAlternateWeapon(id: WeaponId) {
    const model = new THREE.Group();
    const compact = id === "sidearm";
    const wood = id === "shotgun";
    const heavy = id === "lmg";
    const accent = wood
      ? "#93613e"
      : heavy
        ? "#6c795c"
        : compact
          ? "#536168"
          : "#777264";
    const end = weapons[id].muzzle;
    const receiverWidth = heavy ? 0.15 : 0.092;
    this.chamferedShell(
      receiverWidth,
      0.103,
      compact ? 0.38 : 0.48,
      0.013,
      compact ? "#626f75" : "#4e5a58",
      0,
      0.018,
      -0.19,
      model,
    );
    for (const side of [-1, 1]) {
      const x = side * (receiverWidth / 2 + 0.002);
      this.box(0.005, 0.009, compact ? 0.27 : 0.32, "#84908c", x, 0.051, -0.206, model, 0.52);
      this.box(0.008, 0.037, heavy ? 0.17 : 0.115, "#252f30", x, 0.024, -0.225, model);
      this.box(0.01, 0.011, heavy ? 0.125 : 0.076, "#6d7977", x, 0.025, -0.23, model, 0.46);
    }
    this.chamferedShell(
      0.075,
      0.16,
      0.086,
      0.009,
      "#343b36",
      0,
      -0.095,
      -0.05,
      model,
    );
    if (!compact) {
      this.chamferedShell(
        heavy ? 0.14 : 0.1,
        0.095,
        0.41,
        0.014,
        accent,
        0,
        -0.006,
        -0.56,
        model,
      );
      this.chamferedShell(
        0.096,
        0.13,
        0.25,
        0.015,
        accent,
        0,
        -0.03,
        0.21,
        model,
      );
      this.cylinder(
        wood ? 0.027 : 0.019,
        -end - 0.42,
        "#485150",
        0,
        0.035,
        (end - 0.42) / 2,
        model,
      ).rotation.x = Math.PI / 2;
      if (wood) {
        this.box(0.066, 0.011, 0.106, "#222a27", 0, -0.043, -0.31, model);
        for (let z = -0.68; z < -0.42; z += 0.041)
          this.box(0.105, 0.056, 0.009, "#423024", 0, -0.02, z, model);
        this.cylinder(0.021, 0.51, "#414b48", 0, -0.026, -0.826, model).rotation.x =
          Math.PI / 2;
        for (const side of [-1, 1])
          this.box(0.005, 0.012, 0.188, "#ac774f", side * 0.048, -0.013, 0.21, model);
        this.box(0.014, 0.015, 0.025, "#ccb477", 0, 0.066, -1.067, model, 0.42);
      } else {
        const magazine = new THREE.Group();
        magazine.name = "reload-magazine";
        magazine.position.set(0, -0.098, -0.25);
        model.add(magazine);
        this.chamferedShell(
          heavy ? 0.18 : 0.083,
          heavy ? 0.15 : 0.11,
          0.14,
          0.012,
          accent,
          0,
          0,
          0,
          magazine,
        );
        this.box(heavy ? 0.176 : 0.088, 0.014, 0.148, "#333e36", 0, heavy ? -0.068 : -0.05, 0, magazine);
        if (heavy) {
          this.box(0.073, 0.064, 0.26, "#303a37", 0, 0.08, -0.23, model, 0.4);
          this.box(0.038, 0.029, 0.138, "#899174", 0, 0.142, -0.38, model);
          for (const z of [-0.423, -0.334])
            this.box(0.025, 0.061, 0.017, "#606c5a", 0, 0.117, z, model, 0.32);
          for (const z of [-0.043, 0, 0.043])
            this.box(0.01, 0.097, 0.014, "#424e40", -0.089, 0, z, magazine);
        }
        for (let z = -0.69; z < -0.43; z += 0.044)
          this.box(0.105, 0.02, 0.013, "#343d3a", 0, 0.058, z, model);
      }
    } else {
      this.box(0.062, 0.095, 0.074, "#303535", 0, -0.139, -0.05, model).name =
        "reload-magazine";
      for (let z = -0.17; z < -0.075; z += 0.023)
        this.box(0.096, 0.035, 0.007, accent, 0, 0.043, z, model);
      for (const side of [-1, 1]) {
        this.box(0.012, 0.066, 0.066, "#42494b", side * 0.034, -0.109, -0.046, model);
        this.box(0.013, 0.031, 0.015, "#9caaa4", side * 0.028, 0.061, -0.356, model, 0.5);
      }
      this.cylinder(
        0.019,
        0.13,
        "#343e3e",
        0,
        0.024,
        -0.414,
        model,
      ).rotation.x = Math.PI / 2;
    }
    if (id === "marksman") {
      this.cylinder(0.043, 0.23, "#303c3e", 0, 0.151, -0.24, model).rotation.x =
        Math.PI / 2;
      this.cylinder(
        0.061,
        0.05,
        "#475353",
        0,
        0.151,
        -0.397,
        model,
      ).rotation.x = Math.PI / 2;
      this.box(0.066, 0.09, 0.095, "#3a4546", 0, 0.09, -0.24, model);
      this.cylinder(0.025, 0.038, "#65716d", 0, 0.194, -0.246, model, 12);
      this.cylinder(0.024, 0.022, "#89928a", 0.043, 0.151, -0.245, model, 12).rotation.z =
        Math.PI / 2;
      const lensShade = this.cylinder(0.055, 0.055, "#354345", 0, 0.151, -0.442, model, 16);
      lensShade.rotation.x = Math.PI / 2;
      for (const z of [-0.35, -0.163])
        this.cylinder(0.047, 0.016, "#62716d", 0, 0.151, z, model, 16).rotation.x =
          Math.PI / 2;
      const rearRing = new THREE.Mesh(
        new THREE.TorusGeometry(0.047, 0.008, 8, 20),
        this.material("#617472", 0.42, 0.5),
      );
      rearRing.position.set(0, 0.151, -0.118);
      model.add(rearRing);
      const glass = new THREE.Mesh(
        new THREE.CircleGeometry(0.039, 20),
        new THREE.MeshBasicMaterial({
          color: "#89adb1",
          transparent: true,
          opacity: 0.31,
          depthWrite: false,
        }),
      );
      glass.position.set(0, 0.151, -0.117);
      model.add(glass);
    } else {
      this.box(0.079, 0.035, 0.034, "#414b46", 0, 0.107, -0.15, model);
      for (const side of [-1, 1])
        this.box(
          0.013,
          0.042,
          0.027,
          "#414b46",
          side * 0.031,
          0.139,
          -0.15,
          model,
        );
    }
    const reticle = new THREE.Mesh(
      new THREE.SphereGeometry(0.003, 5, 4),
      new THREE.MeshBasicMaterial({ color: "#ef985f", depthTest: false }),
    );
    reticle.position.set(0, 0.151, -0.094);
    model.add(reticle);
    this.weaponHands.addGrip(model, [0, -0.136, -0.052]);
    return model;
  }

  private chamferedShell(
    w: number,
    h: number,
    d: number,
    corner: number,
    color: string,
    x: number,
    y: number,
    z: number,
    parent: THREE.Object3D,
  ) {
    const a = w / 2,
      b = h / 2;
    const shape = new THREE.Shape();
    const outline = [
      [-a + corner, -b],
      [a - corner, -b],
      [a, -b + corner],
      [a, b - corner],
      [a - corner, b],
      [-a + corner, b],
      [-a, b - corner],
      [-a, -b + corner],
    ];
    outline.forEach(([px, py], i) =>
      i ? shape.lineTo(px, py) : shape.moveTo(px, py),
    );
    shape.closePath();
    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth: d,
      bevelEnabled: false,
      curveSegments: 1,
    });
    geometry.translate(0, 0, -d / 2);
    const mesh = new THREE.Mesh(geometry, this.material(color, 0.53, 0.32));
    mesh.position.set(x, y, z);
    parent.add(mesh);
  }

  private zombie(x: number, z: number, kind: EnemyType = "standard", networkId = this.nextZombieId++) {
    const stats = enemyTypes[kind];
    const model = this.zombieModels.create(kind, networkId % 2);
    const { group } = model;
    if (this.staticShadows) {
      group.traverse((part) => {
        if (part instanceof THREE.Mesh) part.castShadow = false;
      });
    }
    group.scale.set(stats.scale * stats.width, stats.scale, stats.scale * stats.width);
    group.position.set(x, kind === "flier" ? 2.65 : 0, z);
    this.world.add(group);
    const phase = Math.random() * Math.PI * 2;
    const zombie: Zombie = {
      ...model,
      networkId,
      health: stats.health,
      phase,
      gait: { phase: phase / (Math.PI * 2), travel: 0, weight: 0, vx: 0, vz: 0 },
      speed: stats.speed * (0.9 + Math.random() * 0.2),
      attack: 0,
      dead: 0,
      kind,
    };
    this.zombies.push(zombie);
    return zombie;
  }

  private preview() {
    this.camera.position.set(-2, 2.1, 18);
    this.yaw = -0.12;
    this.pitch = -0.015;
    this.zombie(1, -1);
    this.zombie(-5, -11);
    this.zombie(5, -17);
    this.zombie(-1, -22);
  }

  configure(settings: Settings) {
    const qualityChanged = settings.quality !== this.settings.quality;
    if (qualityChanged || settings.prefer120 !== this.settings.prefer120) this.renderBudget.reset();
    this.settings = settings;
    if (this.master) this.master.gain.value = settings.volume / 100;
    if (qualityChanged) {
      this.renderer.shadowMap.enabled = settings.quality;
      this.renderer.shadowMap.needsUpdate = true;
      this.applyRenderScale();
    }
  }

  start() {
    if (this.arenaStage !== 1 || this.state.gateOpen) this.loadArena(1);
    else {
      this.clearShotEffects();
      this.surfaceEffects.clear();
    }
    this.clearZombies();
    this.clearObjectives();
    this.state = { ...initial, status: "playing" };
    this.resetArsenal();
    this.camera.position.set(this.room ? (this.room.slot - 1.5) * 1.2 : 0, 1.7, 17);
    this.yaw = 0;
    this.pitch = 0;
    this.freeLook = false;
    this.jump = 0;
    this.verticalVelocity = 0;
    this.ads = false;
    this.trigger = false;
    this.keys.clear();
    this.touchMove = { x: 0, y: 0 };
    this.navigation = null;
    this.navigateAt = 0;
    this.reloadAt = 0;
    this.activeTime = 0;
    this.sprintUntil = 0;
    this.boostUntil = 0;
    this.sprintExhausted = false;
    this.sprinting = false;
    this.sprintPose = 0;
    this.dodge = null;
    this.dodgeReadyAt = this.staminaResumeAt = this.dodgeLean = 0;
    this.movement.set(0, 0);
    this.stepPhase = 0;
    this.fireAt = 0;
    this.elapsed = 0;
    this.spawnWave(!this.room || this.room.host);
    this.initAudio();
    if (!this.room) this.lock();
    this.publish();
  }

  setCharacter(id: CharacterId) {
    this.weaponHands.setSleeve(characters[id].color);
  }

  roomUpdate() {
    if (!this.room) return { pose: null, commands: [] };
    const { x, y, z } = this.camera.position;
    return {
      round: this.room.round,
      pose: { x, y, z, yaw: this.yaw % (Math.PI * 2), pitch: this.pitch, alive: this.state.status !== "dead", shot: this.roomShot, wave: this.state.wave },
      world: this.room.host ? this.roomWorld() : undefined,
      commands: this.roomCommands.slice(),
    };
  }

  acknowledgeRoomCommands(throughId: number) {
    this.roomCommands = this.roomCommands.filter((command) => command.id > throughId);
  }

  setRoomConnected(connected: boolean) {
    if (!this.room) return;
    this.roomConnected = connected;
    if (!connected) this.trigger = this.shotQueued = false;
  }

  leaveRoom() {
    if (!this.room) return;
    this.room = null;
    this.roomConnected = true;
    this.roomCommands = [];
    this.roomCommandId = this.roomShot = 0;
    this.roomAvatars.clear();
    this.roomZombieTargets.clear();
    this.roomNavigation.clear();
    this.combatTarget = null;
    this.menu();
  }

  applyRoomFrame(room: RoomView, playerId: string, events: RoomEvent[]) {
    if (room.status === "lobby") return;
    const member = room.players.find((player) => player.id === playerId);
    if (!member) return;
    this.roomConnected = true;
    if (room.status === "playing" && (!this.room || this.room.round !== room.round)) {
      this.room = { code: room.code, id: playerId, host: room.hostId === playerId, slot: member.slot, round: room.round };
      this.roomCommands = [];
      this.roomAvatars.clear();
      this.setCharacter(member.character);
      this.start();
    }
    if (this.room?.code !== room.code) return;
    if (!this.room.host && room.world) this.applyRoomWorld(room.world);
    this.roomAvatars.sync(room.players.filter((player) => !player.pose?.wave || player.pose.wave === this.state.wave), playerId);
    for (const event of events) {
      if (this.state.status === "dead") break;
      if (event.type === "damage") {
        this.hurtPlayer(event.amount);
        if (event.source) this.state.message = "โดนยิงโดยผู้เล่นในห้อง";
      } else if (this.room.host) {
        const zombie = this.zombies.find((candidate) => candidate.networkId === event.target);
        if (!zombie || zombie.health <= 0) continue;
        const origin = this.roomAvatars.players.get(event.source)?.eye ?? this.camera.position;
        this.hitZombie(zombie, event.amount, event.impact?.zone === "head", origin, event.impact);
        if (zombie.health <= 0) this.defeat(zombie);
      }
    }
    if (room.status === "ended" && this.state.status !== "dead")
      this.endRun(room.world?.timedOut ?? false);
    this.publish();
  }

  private roomWorld(): RoomWorld {
    const { wave, timeLeft, seconds, kills, remaining, gateOpen, timedOut, boss } = this.state;
    const round = (n: number) => Math.round(n * 1000) / 1000;
    return {
      motionTime: round(this.elapsed),
      wave, timeLeft, seconds, kills, remaining, gateOpen, timedOut,
      checkpoint: !!this.checkpoint,
      finished: this.state.status === "dead",
      boss: this.boss ? {
        kind: this.boss.kind, health: Math.max(0, this.boss.zombie.health),
        maxHealth: this.boss.maxHealth, warning: !!this.boss.attack,
      } : boss,
      bossStrike: this.boss?.attack?.strike,
      bolts: this.spitBolts.map(({ mesh: { position: p } }) => ({ x: round(p.x), y: round(p.y), z: round(p.z) })),
      zombies: this.zombies.filter((z) => z.group.visible).map((z) => ({
        id: z.networkId, kind: z.kind, health: Math.max(0, round(z.health)),
        scale: round(z.group.scale.y), ...this.captureZombieMotion(z, round),
      })),
    };
  }

  private captureZombieMotion(z: Zombie, round?: (value: number) => number): ZombieMotion {
    const { x, y, z: depth } = z.group.position;
    const pose = [
      z.group.rotation.x, z.group.rotation.z,
      z.rig.rotation.x, z.rig.rotation.y, z.rig.rotation.z, z.rig.position.y,
      z.head.rotation.x, z.head.rotation.y, z.head.rotation.z,
      z.arms[0].rotation.x, z.arms[0].rotation.z, z.arms[1].rotation.x, z.arms[1].rotation.z,
      z.legs[0].rotation.x, z.legs[1].rotation.x,
      z.wings?.[0]?.rotation.z ?? 0, z.wings?.[1]?.rotation.z ?? 0, z.throat?.scale.x ?? 1,
    ];
    const yaw = z.group.rotation.y % (Math.PI * 2);
    return round
      ? { x: round(x), y: round(y), z: round(depth), yaw: round(yaw), pose: pose.map(round) }
      : { x, y, z: depth, yaw, pose };
  }

  private applyRoomWorld(world: RoomWorld) {
    if (world.wave < this.state.wave) return;
    if (world.wave !== this.state.wave) {
      this.state.wave = world.wave;
      this.loadArena(world.wave);
      this.roomAvatars.clear();
      this.camera.position.set((this.room!.slot - 1.5) * 1.2, 1.7, 21);
      this.yaw = this.pitch = this.jump = this.verticalVelocity = 0;
      this.cancelUse();
      this.state.reloading = false;
      this.state.reloadProgress = null;
      this.spawnWave(false);
    }
    const { remaining, kills, timeLeft, seconds, gateOpen, boss } = world;
    Object.assign(this.state, { remaining, kills, timeLeft, seconds, gateOpen, boss });
    if (world.checkpoint && !this.checkpoint) this.showCheckpoint();
    if (this.checkpoint) this.checkpoint.visible = !gateOpen;
    this.syncRoomBossMarker(boss?.kind, world.bossStrike);
    this.syncRoomBolts(world.bolts ?? []);
    const last = this.lastRoomMotion;
    if (!world.finished && world.motionTime !== undefined && last?.stamp === world.motionTime) return;
    const received = performance.now();
    const duration = last ? THREE.MathUtils.clamp((received - last.received) / 1000, 0.08, 0.24) : 0.12;
    this.lastRoomMotion = { stamp: world.motionTime, received };
    const incoming = new Set(world.zombies.map((z) => z.id));
    this.zombies = this.zombies.filter((z) => {
      if (incoming.has(z.networkId)) return true;
      z.group.removeFromParent();
      this.roomZombieTargets.delete(z.networkId);
      return false;
    });
    const existing = new Map(this.zombies.map((z) => [z.networkId, z]));
    this.state.spitWarning = false;
    for (const frame of world.zombies) this.applyRoomZombie(frame, existing.get(frame.id), duration);
  }

  private syncRoomBossMarker(kind?: BossKind, strike?: BossStrike) {
    const key = kind && strike ? JSON.stringify([kind, strike]) : "";
    if (this.roomBossMarker?.key === key) return;
    if (this.roomBossMarker) this.removeMarker(this.roomBossMarker.mesh);
    this.roomBossMarker = null;
    if (kind && strike) this.roomBossMarker = { key, mesh: this.bossMarker(kind, strike) };
  }

  private syncRoomBolts(bolts: NonNullable<RoomWorld["bolts"]>) {
    while (this.roomBolts.length > bolts.length) this.removeSpit(this.roomBolts.pop()!);
    bolts.forEach(({ x, y, z }, index) => {
      const mesh = this.roomBolts[index] ?? this.makeSpitMesh();
      if (!this.roomBolts[index]) this.roomBolts.push(mesh);
      mesh.position.set(x, y, z);
    });
  }

  private queueRoomCommand(command: RoomCommandPayload) {
    if (this.roomCommands.length < 64)
      this.roomCommands.push({ ...command, id: ++this.roomCommandId });
  }

  private playerDamageZombie(zombie: Zombie, damage: number, headshot: boolean, origin: THREE.Vector3, weapon: WeaponId | "knife" | "grenade", impact?: ZombieGunImpact) {
    if (this.room && !this.room.host) {
      this.queueRoomCommand({ type: "hit-zombie", target: zombie.networkId, weapon, amount: damage, impact });
    } else {
      this.hitZombie(zombie, damage, headshot, origin, impact);
    }
  }

  private applyRoomZombie(frame: RoomZombie, previous: Zombie | undefined, duration: number) {
    const zombie = previous ?? this.zombie(frame.x, frame.z, frame.kind, frame.id);
    if (previous && zombie.health > 0 && frame.health <= 0) {
      this.dropAmmo(zombie.group.position);
      this.dropLoot(zombie.group.position);
    }
    zombie.health = frame.health;
    zombie.group.scale.set(frame.scale * enemyTypes[frame.kind].width, frame.scale, frame.scale * enemyTypes[frame.kind].width);
    if (previous) {
      this.roomZombieTargets.set(frame.id, { from: this.captureZombieMotion(zombie), to: frame, age: 0, duration });
    } else this.renderZombieMotion(zombie, frame);
    if (frame.pose[17] > 1.2 && zombie.health > 0 &&
      zombie.group.position.distanceToSquared(this.camera.position) <= 18 ** 2)
      this.state.spitWarning = true;
  }

  private renderZombieMotion(zombie: Zombie, frame: ZombieMotion) {
    zombie.group.position.set(frame.x, frame.y, frame.z);
    const [rx, rz, rigX, rigY, rigZ, rigHeight, hx, hy, hz, a0, az0, a1, az1, l0, l1, w0, w1, throat] = frame.pose;
    zombie.group.rotation.set(rx, frame.yaw, rz);
    zombie.rig.rotation.set(rigX, rigY, rigZ);
    zombie.rig.position.y = rigHeight;
    zombie.head.rotation.set(hx, hy, hz);
    zombie.arms[0].rotation.set(a0, 0, az0);
    zombie.arms[1].rotation.set(a1, 0, az1);
    zombie.legs[0].rotation.x = l0;
    zombie.legs[1].rotation.x = l1;
    if (zombie.wings?.length === 2) {
      zombie.wings[0].rotation.z = w0;
      zombie.wings[1].rotation.z = w1;
    }
    zombie.throat?.scale.setScalar(throat);
  }

  resume() {
    if (this.state.status !== "paused") return;
    this.state.status = "playing";
    this.initAudio();
    this.lock();
    this.publish();
  }

  pause() {
    if (this.state.status !== "playing") return;
    this.state.status = "paused";
    this.resetFps();
    this.trigger = false;
    this.shotQueued = false;
    this.cancelUse();
    this.sprinting = false;
    this.dodge = null;
    this.movement.set(0, 0);
    this.ads = false;
    this.keys.clear();
    this.sprintUntil = 0;
    this.touchMove = { x: 0, y: 0 };
    if (document.pointerLockElement === this.renderer.domElement)
      document.exitPointerLock();
    this.publish();
  }

  menu() {
    if (this.arenaStage !== 1 || this.state.gateOpen) this.loadArena(1);
    this.state = { ...initial };
    this.resetArsenal();
    this.clearZombies();
    this.clearObjectives();
    this.preview();
    this.trigger = false;
    this.dodge = null;
    this.ads = false;
    this.keys.clear();
    this.touchMove = { x: 0, y: 0 };
    if (document.pointerLockElement === this.renderer.domElement)
      document.exitPointerLock();
    this.publish();
  }

  private lock() {
    if (this.coarse) return;
    try {
      const request = this.renderer.domElement.requestPointerLock();
      if (request)
        request
          .then(() => {
            this.freeLook = false;
          })
          .catch(() => {
            this.enableFreeLook();
          });
    } catch {
      this.enableFreeLook();
    }
  }

  private enableFreeLook() {
    if (this.destroyed || this.state.status !== "playing") return;
    this.freeLook = true;
    this.state.message = "โหมดเมาส์สำรอง · ลากเพื่อมอง คลิกซ้ายยิง / คลิกขวาเล็ง";
    this.publish();
  }

  reload() {
    const { ammo, reserve } = this.currentAmmo;
    const weapon = weapons[this.state.weaponId];
    if (
      this.state.status !== "playing" ||
      this.state.heldItem !== "gun" ||
      this.dodge !== null ||
      this.knifeSwing !== null ||
      this.sprinting ||
      this.state.reloading ||
      ammo >= weapon.capacity ||
      reserve === 0
    )
      return;
    this.state.reloading = true;
    this.state.reloadProgress = 0;
    this.ads = this.shotQueued = false;
    this.reloadAt = this.elapsed + this.reloadInterval();
    this.sound("gear");
    this.publish();
  }

  private get currentAmmo(): Ammo {
    return this.arsenal[this.state.weaponId]!;
  }

  private reloadInterval() {
    return weapons[this.state.weaponId].reload;
  }

  private resetArsenal() {
    this.arsenal = { rifle: { ammo: weapons.rifle.capacity, reserve: 0 } };
    this.equip("rifle");
  }

  private equip(id: WeaponId) {
    this.state.weaponId = id;
    this.holdItem("gun");
    const { muzzle, fireFx } = weapons[id];
    this.muzzle.position.set(0, fireFx.muzzleY, muzzle);
    this.flashLight.position.set(0, fireFx.muzzleY + 0.05, muzzle + 0.13);
  }

  switchWeapon(id: WeaponId) {
    if (
      this.state.status !== "playing" ||
      !this.arsenal[id] ||
      (this.state.weaponId === id && this.state.heldItem === "gun")
    )
      return;
    this.equip(id);
    this.fireAt = this.elapsed + 0.22;
    this.publish();
  }

  private holdItem(item: HeldItem) {
    this.cancelUse();
    this.pendingShot = null;
    this.flashTime = 0;
    this.recoil = 0;
    this.recoilSway = 0;
    this.trigger = this.shotQueued = this.ads = this.state.reloading = false;
    this.state.reloadProgress = null;
    this.state.heldItem = item;
    for (const [id, model] of this.weaponModels)
      model.visible = item === "gun" && this.state.weaponId === id;
    for (const [id, model] of this.equipmentModels) model.visible = item === id;
  }

  cycleItem() {
    if (this.state.status !== "playing") return;
    const item = nextHeldItem(this.state.heldItem, {
      grenade: this.state.grenades,
      medkit: this.state.medkits,
      energy: this.state.energy,
    });
    if (item === this.state.heldItem) return;
    this.holdItem(item);
    this.fireAt = this.elapsed + 0.2;
    this.publish();
  }

  cancelUse() {
    this.grenadeHeldAt = this.healStartedAt = null;
    this.state.throwProgress = this.state.healProgress = null;
    this.drinkStartedAt = this.state.drinkProgress = null;
    this.throwFollowThroughUntil = 0;
    this.knifeSwing = null;
    this.trigger = this.shotQueued = false;
  }

  setTouchMove(x: number, y: number) {
    this.touchMove = { x, y };
  }
  look(dx: number, dy: number) {
    if (this.state.status !== "playing") return;
    this.yaw -= dx * 0.0022 * this.settings.sensitivity * (this.ads ? 0.55 : 1);
    this.pitch = THREE.MathUtils.clamp(
      this.pitch -
        dy * 0.0022 * this.settings.sensitivity * (this.ads ? 0.55 : 1),
      -1.35,
      1.35,
    );
  }
  setFire(value: boolean) {
    if (this.state.status !== "playing" || !this.roomConnected || this.activeTime >= this.deadline)
      return;
    if (value && (this.dodge || this.knifeSwing)) return;
    const item = this.state.heldItem;
    if (item === "gun") {
      if (value && this.state.reloading) return;
      if (value && !this.trigger) {
        this.shotQueued = true;
        if (this.sprinting)
          this.fireAt = Math.max(this.fireAt, this.elapsed + 0.19);
      }
      this.trigger = value;
    } else if (item === "grenade") {
      if (value && this.state.grenades > 0 && this.grenadeHeldAt === null) {
        this.grenadeHeldAt = this.elapsed;
        this.state.throwProgress = 0;
        this.sound("gear");
      } else if (!value && this.grenadeHeldAt !== null) {
        this.throwGrenade(throwCharge(this.elapsed - this.grenadeHeldAt));
        this.grenadeHeldAt = this.state.throwProgress = null;
      }
    } else if (
      value &&
      item === "medkit" &&
      this.state.medkits > 0 &&
      this.healStartedAt === null &&
      this.state.health < 100
    ) {
      this.healStartedAt = this.elapsed;
      this.state.healProgress = 0;
      this.sound("gear");
      this.publish();
    } else if (
      value &&
      item === "energy" &&
      this.state.energy > 0 &&
      this.state.boost === 0 &&
      this.drinkStartedAt === null
    ) {
      this.drinkStartedAt = this.elapsed;
      this.state.drinkProgress = 0;
      this.publish();
    }
  }
  setAim(value: boolean) {
    this.ads =
      value &&
      this.state.heldItem === "gun" &&
      !this.state.reloading &&
      !this.knifeSwing &&
      !this.dodge;
  }

  sprintBurst() {
    if (this.state.status === "playing") this.sprintUntil = this.elapsed + 0.8;
  }

  private moveInput() {
    return {
      forward:
        Number(this.keys.has("KeyW")) -
        Number(this.keys.has("KeyS")) -
        this.touchMove.y,
      right:
        Number(this.keys.has("KeyD")) -
        Number(this.keys.has("KeyA")) +
        this.touchMove.x,
    };
  }

  swingKnife() {
    if (this.state.status !== "playing" || this.activeTime >= this.deadline || this.dodge || this.knifeSwing ||
        this.state.stamina < knifeTuning.staminaCost) return;
    this.cancelUse();
    this.state.reloading = false;
    this.state.reloadProgress = null;
    this.ads = this.sprinting = false;
    this.sprintUntil = 0;
    this.state.stamina -= knifeTuning.staminaCost;
    this.staminaResumeAt = Math.max(this.staminaResumeAt, this.elapsed + knifeTuning.swingSeconds);
    this.knifeSwing = { startedAt: this.elapsed, resolved: false };
    this.publish();
  }

  private updateKnife() {
    const swing = this.knifeSwing;
    if (!swing) return;
    if (!swing.resolved && this.elapsed >= swing.startedAt + knifeTuning.hitSeconds) {
      swing.resolved = true;
      const origin = this.camera.position;
      let nearest: { zombie: Zombie; point: THREE.Vector3; distance: number } | null = null;
      this.world.updateMatrixWorld(true);
      for (const zombie of this.zombies) {
        if (zombie.health <= 0) continue;
        const position = zombie.group.position;
        const dx = position.x - origin.x, dz = position.z - origin.z;
        if (!meleeStrikeHits(this.yaw + Math.PI, dx, dz, knifeTuning.reach)) continue;
        const height = Math.min(1.12, zombie.rig.position.y + 0.32);
        const point = position.clone().add(new THREE.Vector3(0, height * zombie.group.scale.y, 0));
        const direction = point.clone().sub(origin);
        const distance = direction.length();
        if (distance > knifeTuning.reach + 0.1 || distance < 0.001 ||
            (nearest && distance >= nearest.distance)) continue;
        this.raycaster.set(origin, direction.normalize());
        const cover = this.raycaster.intersectObjects(this.solidMeshes, true)[0];
        if (!cover || cover.distance >= distance) nearest = { zombie, point, distance };
      }
      if (nearest) {
        const { zombie, point } = nearest;
        this.playerDamageZombie(zombie, knifeTuning.damage, false, origin, "knife");
        this.impact(point, "#8a6950", 0.08);
        this.state.hit = Math.max(1, this.state.hit);
        this.sound("knife-hit");
        if (zombie.health <= 0) {
          this.state.message = "กำจัดซอมบี้ด้วยมีด";
          this.defeat(zombie);
        } else if ((!this.room || this.room.host) && this.boss?.zombie !== zombie) {
          const p = zombie.group.position;
          const dx = p.x - origin.x;
          const dz = p.z - origin.z;
          const distance = Math.max(Math.hypot(dx, dz), 0.001);
          const push = knifeTuning.pushback / Math.max(1, enemyTypes[zombie.kind].scale);
          zombie.knifeStagger = {
            until: this.elapsed + knifeTuning.staggerSeconds,
            x: dx / distance * push,
            z: dz / distance * push,
          };
          zombie.hitForce = 1.35;
          zombie.melee = undefined;
          zombie.spitAt = undefined;
          zombie.throat?.scale.setScalar(1);
        }
        this.publish();
      } else {
        this.sound("knife-swing");
      }
    }
    if (this.elapsed >= swing.startedAt + knifeTuning.swingSeconds) this.knifeSwing = null;
  }

  dodgeBurst() {
    if (
      this.state.status !== "playing" ||
      this.activeTime >= this.deadline ||
      this.dodge ||
      this.elapsed < this.dodgeReadyAt ||
      this.jump > 0 ||
      this.verticalVelocity > 0 ||
      this.state.stamina < dodgeTuning.staminaCost
    )
      return;
    const { forward, right } = this.moveInput();
    const length = Math.hypot(forward, right);
    if (length <= 0.12) return;
    const direction = movementInWorld(
      forward / length,
      right / length,
      this.yaw,
    );
    this.dodge = {
      ...direction,
      startedAt: this.elapsed,
      lean: right / length,
      plannedTravel: 0,
    };
    this.dodgeReadyAt = this.elapsed + dodgeTuning.cooldownSeconds;
    this.staminaResumeAt = this.elapsed + dodgeTuning.recoveryDelay;
    this.state.stamina -= dodgeTuning.staminaCost;
    this.cancelUse();
    this.ads = this.sprinting = false;
    this.sprintUntil = 0;
    this.movement.set(0, 0);
    this.sound("dodge");
    this.publish();
  }

  private advanceDodge() {
    const dodge = this.dodge!;
    const seconds = this.elapsed - dodge.startedAt;
    const finished = this.elapsed >= dodge.startedAt + dodgeTuning.seconds;
    const total = finished ? dodgeTuning.distance : dodgeDistanceAt(seconds);
    const travel = total - dodge.plannedTravel;
    dodge.plannedTravel = total;
    const steps = Math.max(1, Math.ceil(travel / 0.16));
    const dx = (dodge.x * travel) / steps;
    const dz = (dodge.z * travel) / steps;
    const p = this.camera.position;
    for (let i = 0; i < steps; i++) {
      if (canOccupy(p.x + dx, p.z, this.obstacles)) p.x += dx;
      if (canOccupy(p.x, p.z + dz, this.obstacles)) p.z += dz;
    }
    if (finished) this.dodge = null;
  }

  private keydown = (e: KeyboardEvent) => {
    if (this.state.status !== "playing") return;
    if (e.code === "AltLeft" || e.code === "AltRight") {
      e.preventDefault();
      if (!e.repeat) this.dodgeBurst();
      return;
    }
    if (
      [
        "Space",
        "KeyW",
        "KeyA",
        "KeyS",
        "KeyD",
        "KeyV",
        "ArrowUp",
        "ArrowDown",
      ].includes(e.code)
    )
      e.preventDefault();
    this.keys.add(e.code);
    if (!e.repeat && (e.code === "ShiftLeft" || e.code === "ShiftRight"))
      this.sprintBurst();
    if (!e.repeat && e.code === "KeyQ") this.cycleItem();
    if (!e.repeat && e.code === "KeyV") this.swingKnife();
    if (
      !e.repeat &&
      e.code === "KeyG" &&
      this.state.grenades &&
      this.state.heldItem !== "grenade"
    ) {
      this.holdItem("grenade");
      this.publish();
    }
    if (!e.repeat) {
      const slot = weaponSlots.find((_, i) => e.code === `Digit${i + 1}`);
      if (slot) this.switchWeapon(slot);
    }
    if (e.code === "KeyR") this.reload();
    if (e.code === "Escape" || e.code === "KeyP") this.pause();
    if (e.code === "Space" && this.jump === 0 && !this.dodge)
      this.verticalVelocity = 4.6;
  };
  private keyup = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };
  private mousemove = (e: MouseEvent) => {
    if (
      document.pointerLockElement === this.renderer.domElement ||
      (this.freeLook &&
        e.buttons !== 0 &&
        e.target === this.renderer.domElement)
    )
      this.look(e.movementX, e.movementY);
  };
  private mousedown = (e: MouseEvent) => {
    if (
      e.target !== this.renderer.domElement ||
      this.state.status !== "playing"
    )
      return;
    if (
      !this.coarse &&
      !this.freeLook &&
      document.pointerLockElement !== this.renderer.domElement
    ) {
      this.lock();
      return;
    }
    if (e.button === 0) this.setFire(true);
    if (e.button === 2) this.setAim(true);
  };
  private mouseup = (e: MouseEvent) => {
    if (e.button === 0) this.setFire(false);
    if (e.button === 2) this.ads = false;
  };
  private pointerlock = () => {
    if (!document.pointerLockElement && !this.coarse) this.pause();
  };
  private contextmenu = (e: Event) => {
    e.preventDefault();
  };
  private blur = () => {
    this.keys.clear();
    this.pause();
  };
  private visibility = () => {
    if (document.hidden) this.pause();
  };

  private spawnWave(spawnEnemies = true) {
    this.clearZombies();
    this.clearObjectives();
    const plan = stagePlan(this.state.wave, this.settings.difficulty);
    this.stageBoss = plan;
    const count = plan.enemies.length;
    const rifle = this.arsenal.rifle!;
    this.arsenal.rifle = stageLoadout(rifle.ammo, rifle.reserve, plan.ammo);
    this.placeWeaponCrate(zoneForStage(this.state.wave).weapon);
    this.deadline = spawnEnemies ? this.activeTime + plan.time : Infinity;
    this.state.timeLeft = plan.time;
    this.state.checkpointDistance = null;
    this.state.gateOpen = false;
    this.state.remaining = count;
    for (const kind of spawnEnemies ? plan.enemies : []) {
      let x = 0,
        z = 0;
      for (let tries = 0; tries < 100; tries++) {
        x = Math.random() * 44 - 22;
        z = Math.random() * 44 - 22;
        if (
          canOccupy(x, z, this.obstacles) &&
          Math.hypot(x - this.camera.position.x, z - this.camera.position.z) >
            11
        )
          break;
      }
      this.zombie(x, z, kind);
    }
    this.state.message = `ด่าน ${this.state.wave} · ${zoneForStage(this.state.wave).name} · ซอมบี้ ${count} ตัว`;
  }

  private removeMarker(marker: THREE.Group) {
    marker.removeFromParent();
    marker.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.geometry.dispose();
      const material = object.material as THREE.MeshBasicMaterial;
      material.map?.dispose();
      material.dispose();
    });
  }

  private clearObjectives() {
    this.syncRoomBossMarker();
    this.syncRoomBolts([]);
    for (const grenade of this.thrownGrenades) this.removeMarker(grenade.model);
    this.thrownGrenades = [];
    for (const bolt of this.spitBolts) this.removeSpit(bolt.mesh);
    this.spitBolts = [];
    if (this.weaponCrate) this.removeMarker(this.weaponCrate.group);
    this.weaponCrate = null;
    this.state.weaponPickup = null;
    if (this.checkpoint) this.removeMarker(this.checkpoint);
    this.checkpoint = null;
    for (const pickup of this.pickups) this.removeMarker(pickup.mesh);
    this.pickups = [];
  }

  private placeWeaponCrate(id: Exclude<WeaponId, "rifle">) {
    const group = new THREE.Group();
    const gear = new THREE.MeshBasicMaterial({ color: "#9eafd0" });
    group.position.set(2.8, 0, this.state.wave === 1 ? 14 : 17);
    const crate = new THREE.Mesh(
      new THREE.BoxGeometry(0.94, 0.27, 0.53),
      new THREE.MeshBasicMaterial({ color: "#38495b" }),
    );
    crate.position.y = 0.14;
    group.add(crate);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.96, 1.1, 20), gear);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.045;
    group.add(ring);
    group.add(new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.05, 0.08), gear));
    group.children[2].position.y = 0.31;
    const label = this.label(
      weapons[id].caliber,
      "#e1ebff",
      "#223346",
      1.18,
      0.3,
      0,
      0.88,
      0,
      group,
    );
    label.userData.billboard = true;
    this.world.add(group);
    this.weaponCrate = { id, group };
  }

  private updateWeaponCrate() {
    if (!this.weaponCrate) return;
    const { group, id } = this.weaponCrate;
    const player = this.camera.position;
    const distance = Math.hypot(
      player.x - group.position.x,
      player.z - group.position.z,
    );
    const label = group.children.find((child) => child.userData.billboard);
    if (label) label.rotation.y = this.yaw;
    this.state.weaponPickup = { id, distance: Math.ceil(distance) };
    if (distance > 1.25) return;
    const result = collectWeapon(this.arsenal, id);
    if (!result.unlocked && result.added === 0) return;
    if (result.unlocked) this.switchWeapon(id);
    this.state.message = result.unlocked
      ? `เก็บ${weapons[id].name}แล้ว · กด ${weaponSlots.indexOf(id) + 1} เพื่อสลับ`
      : `กระสุน${weapons[id].name} +${result.added}`;
    this.removeMarker(group);
    this.weaponCrate = null;
    this.state.weaponPickup = null;
    this.publish();
  }

  private dropLoot(position: THREE.Vector3) {
    // Rotate through all three pickups so consecutive kills guarantee variety.
    if (this.state.kills % 2 === 0 && this.state.remaining > 0) return;
    const kinds: LootKind[] = ["grenade", "medkit", "energy"];
    const kind = kinds[Math.floor((this.state.kills - 1) / 2) % kinds.length];
    const mesh = new THREE.Group();
    mesh.position.set(position.x, 0.35, position.z);
    mesh.add(this.equipmentModel(kind));
    this.label(
      loot[kind].label,
      "#f7f7ec",
      "#172119",
      1.05,
      0.26,
      0,
      0.48,
      0,
      mesh,
    );
    this.world.add(mesh);
    this.pickups.push({ kind, mesh });
  }

  private dropAmmo(position: THREE.Vector3) {
    const drop = rollAmmoDrop(this.arsenal);
    if (!drop) return;
    const mesh = new THREE.Group();
    const { x, z } = position;
    const spot = [
      [x + 1.25, z],
      [x - 1.25, z],
      [x, z + 1.25],
      [x, z - 1.25],
    ].find(([px, pz]) => canOccupy(px, pz, this.obstacles));
    mesh.position.set(spot?.[0] ?? x, 0.35, spot?.[1] ?? z);
    const box = new THREE.Mesh(
      new THREE.BoxGeometry(0.38, 0.18, 0.26),
      new THREE.MeshBasicMaterial({ color: "#77acd2" }),
    );
    mesh.add(box);
    this.label(
      `+${drop.rounds}  ${weapons[drop.weaponId].caliber}`,
      "#e8f7ff",
      "#213d53",
      1.18,
      0.28,
      0,
      0.39,
      0,
      mesh,
    );
    this.world.add(mesh);
    this.pickups.push({ kind: "ammo", mesh, drop });
  }

  private defeat(zombie: Zombie) {
    const defeatedBoss = this.boss?.zombie === zombie;
    zombie.dead = this.elapsed;
    zombie.death = {
      start: this.captureZombieMotion(zombie),
      fallSpeed: zombie.airFallSpeed ?? 0,
      landed: false,
    };
    zombie.spitAt = undefined;
    zombie.melee = undefined;
    this.state.kills++;
    this.state.remaining--;
    this.dropAmmo(zombie.group.position);
    this.dropLoot(zombie.group.position);
    const phase = nextStagePhase(this.state.remaining, defeatedBoss);
    if (phase === "combat") return;
    if (phase === "boss") {
      this.spawnBoss();
      return;
    }
    this.clearBoss();
    this.showCheckpoint();
    this.deadline = this.activeTime + 25;
    this.state.timeLeft = 25;
    this.state.message = "ชนะบอสแล้ว · ไปวงสีเขียวเพื่อเปิดประตู";
  }

  private showCheckpoint() {
    const target = nextCheckpoint(this.state.wave);
    const marker = new THREE.Group();
    marker.position.set(target.x, 0, target.z);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(1.75, 2, 40),
      new THREE.MeshBasicMaterial({ color: "#c8fb8f", side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.08;
    marker.add(ring);
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18, 0.28, 4, 12),
      new THREE.MeshBasicMaterial({
        color: "#c8fb8f",
        transparent: true,
        opacity: 0.54,
        depthWrite: false,
      }),
    );
    beam.position.y = 2;
    marker.add(beam);
    this.world.add(marker);
    this.checkpoint = marker;
  }

  private spawnBoss() {
    const plan = this.stageBoss!;
    const kind = plan.bossKind;
    const spec = bosses[kind];
    const player = this.camera.position;
    const field = buildNavigationField(player.x, player.z, this.obstacles);
    let spawn = { x: player.x, z: player.z };
    let best = Infinity;
    for (let z = -22; z <= 22; z += 2) {
      for (let x = -22; x <= 22; x += 2) {
        if (!canOccupy(x, z, this.obstacles)) continue;
        const route = chaseWaypoint(
          x,
          z,
          player.x,
          player.z,
          this.obstacles,
          field,
        );
        if (route.x === x && route.z === z) continue;
        const cost =
          Math.abs(Math.hypot(x - player.x, z - player.z) - 12) +
          (clearSegment(x, z, player.x, player.z, this.obstacles) ? 0 : 4);
        if (cost < best) {
          best = cost;
          spawn = { x, z };
        }
      }
    }
    const zombie = this.zombie(spawn.x, spawn.z, spec.body);
    zombie.group.scale.multiplyScalar(1.23);
    for (const side of [-1, 1]) {
      const plate = this.box(
        0.16,
        0.27,
        0.15,
        spec.color,
        side * 0.2,
        1.23,
        0.13,
        zombie.group,
      );
      plate.rotation.z = side * 0.28;
      plate.userData.zombie = zombie.group.id;
    }
    zombie.health = plan.bossHealth;
    this.boss = {
      zombie,
      kind,
      maxHealth: plan.bossHealth,
      readyAt: this.elapsed + 1.4,
      dash: null,
      attack: null,
    };
    this.state.remaining = 1;
    this.deadline = this.activeTime + plan.bossTime;
    this.state.timeLeft = plan.bossTime;
    this.state.message = `บอสปรากฏตัว · ${spec.name}`;
  }

  private clearBoss() {
    if (this.boss?.attack) this.removeMarker(this.boss.attack.marker);
    this.boss = null;
  }

  private bossMarker(kind: BossKind, strike: BossStrike) {
    const spec = bosses[kind];
    const marker = new THREE.Group();
    marker.position.set(strike.x, 0.115, strike.z);
    const shape = new THREE.Shape();
    const angle = Math.atan2(strike.dz, strike.dx);
    if (kind === "charge") {
      const sideX = -strike.dz * spec.width,
        sideZ = strike.dx * spec.width;
      const endX = strike.dx * strike.length,
        endZ = strike.dz * strike.length;
      shape.moveTo(sideX, -sideZ);
      shape.lineTo(endX + sideX, -(endZ + sideZ));
      shape.lineTo(endX - sideX, -(endZ - sideZ));
      shape.lineTo(-sideX, sideZ);
    } else if (kind === "spores") {
      shape.moveTo(0, 0);
      for (let i = 0; i <= 24; i++) {
        const a = angle - spec.width + (2 * spec.width * i) / 24;
        shape.lineTo(Math.cos(a) * strike.length, -Math.sin(a) * strike.length);
      }
    } else {
      shape.absarc(0, 0, spec.width, 0, Math.PI * 2, false);
    }
    shape.closePath();
    const mesh = new THREE.Mesh(
      new THREE.ShapeGeometry(shape),
      new THREE.MeshBasicMaterial({
        color: spec.color,
        transparent: true,
        opacity: 0.4,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    mesh.rotation.x = -Math.PI / 2;
    marker.add(mesh);
    if (kind === "mortar") {
      const ember = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.35, 1),
        new THREE.MeshBasicMaterial({ color: "#ffb65f" }),
      );
      ember.position.y = 6;
      marker.add(ember);
    }
    this.world.add(marker);
    return marker;
  }

  private updateBoss(boss: Boss, dt: number) {
    const { zombie, kind } = boss;
    const spec = bosses[kind];
    const p = zombie.group.position,
      player = this.combatTarget?.eye ?? this.camera.position;
    if (boss.dash) {
      const { strike, startedAt } = boss.dash;
      const fraction = Math.min(1, (this.elapsed - startedAt) / 0.3);
      p.x = strike.x + strike.dx * strike.length * fraction;
      p.z = strike.z + strike.dz * strike.length * fraction;
      zombie.gait.heading = Math.atan2(strike.dx, strike.dz);
      if (fraction === 1) {
        this.impact(p.clone().setY(0.27), spec.color, 0.55);
        boss.dash = null;
      }
      return;
    }
    if (boss.attack) {
      const { strike, marker, resolvesAt } = boss.attack;
      const progress = 1 - (resolvesAt - this.elapsed) / spec.windup;
      (
        marker.children[0] as THREE.Mesh<
          THREE.ShapeGeometry,
          THREE.MeshBasicMaterial
        >
      ).material.opacity = 0.32 + Math.max(0, progress) * 0.36;
      if (kind === "mortar")
        marker.children[1].position.y = 0.2 + 5.8 * Math.max(0, 1 - progress);
      zombie.gait.heading = Math.atan2(strike.dx, strike.dz);
      if (this.elapsed < resolvesAt) return;
      this.removeMarker(marker);
      boss.attack = null;
      boss.readyAt = this.elapsed + spec.cooldown;
      if (kind === "charge") {
        boss.dash = { strike, startedAt: resolvesAt };
      } else {
        this.impact(
          new THREE.Vector3(strike.x, 0.27, strike.z),
          spec.color,
          0.55,
        );
      }
      const multiplier = this.settings.difficulty === "recruit"
        ? 0.72 : this.settings.difficulty === "veteran" ? 1.28 : 1;
      for (const target of this.combatPlayers()) {
        if (bossAttackHits(kind, strike, target.eye.x, target.eye.z) &&
          (kind === "mortar" || clearSegment(strike.x, strike.z, target.eye.x, target.eye.z, this.obstacles)))
          this.enemyDamagePlayer(Math.round(spec.damage * multiplier), target.id);
      }
      return;
    }
    const dx = player.x - p.x,
      dz = player.z - p.z;
    const distance = Math.hypot(dx, dz);
    const inRange =
      distance <= spec.reach &&
      (kind === "mortar" ||
        clearSegment(p.x, p.z, player.x, player.z, this.obstacles));
    if (inRange && distance > 0.001 && this.elapsed >= boss.readyAt) {
      const strike: BossStrike = {
        x: p.x,
        z: p.z,
        dx: dx / distance,
        dz: dz / distance,
        length: spec.reach,
      };
      if (kind === "mortar") {
        strike.x = player.x;
        strike.z = player.z;
      }
      if (kind === "charge") {
        strike.length = 0;
        while (
          strike.length < spec.reach &&
          canOccupy(
            p.x + strike.dx * (strike.length + 0.25),
            p.z + strike.dz * (strike.length + 0.25),
            this.obstacles,
          )
        ) {
          strike.length += 0.25;
        }
      }
      boss.attack = {
        strike,
        resolvesAt: this.elapsed + spec.windup,
        marker: this.bossMarker(kind, strike),
      };
      return;
    }
    if (!inRange || (distance > 2.2 && kind !== "mortar"))
      this.moveZombie(zombie, kind === "charge" ? 1.45 : 1.06, dt);
  }

  private hurtPlayer(damage: number) {
    this.state.health = Math.max(0, this.state.health - damage);
    this.state.hurt = 1;
    this.sound("hurt");
    if (this.state.health === 0) this.endRun(false);
    else this.publish();
  }

  private combatPlayers() {
    const players: { id: string | null; eye: THREE.Vector3 }[] = [{ id: null, eye: this.camera.position }];
    if (this.room?.host) {
      for (const [id, remote] of this.roomAvatars.players) {
        if (remote.pose.alive) players.push({ id, eye: remote.eye });
      }
    }
    return players;
  }

  private enemyDamagePlayer(damage: number, id: string | null = this.combatTarget?.id ?? null) {
    if (id) this.queueRoomCommand({ type: "enemy-damage", target: id, amount: damage });
    else if (this.state.status !== "dead") this.hurtPlayer(damage);
  }

  private throwGrenade(charge: number) {
    this.state.grenades--;
    this.throwFollowThroughUntil = this.elapsed + 0.34;
    const model = this.equipmentModel("grenade");
    model.position.copy(this.camera.position);
    model.position.y -= 0.25;
    this.world.add(model);
    const speed = 4.4 + charge * 5.8;
    const velocity = new THREE.Vector3(
      -Math.sin(this.yaw) * speed,
      2.5 + charge * 1.7 + this.pitch * 2.4,
      -Math.cos(this.yaw) * speed,
    );
    this.thrownGrenades.push({ model, velocity, burstAt: this.elapsed + 1.6 });
    this.state.message = "โยนระเบิดแล้ว";
    this.sound("gear");
    this.publish();
  }

  private updateGrenades(dt: number) {
    for (let i = this.thrownGrenades.length - 1; i >= 0; i--) {
      const { model, velocity, burstAt } = this.thrownGrenades[i];
      if (this.elapsed >= burstAt) {
        const landing = model.position.clone();
        landing.y = Math.max(0.25, landing.y);
        this.removeMarker(model);
        this.thrownGrenades.splice(i, 1);
        this.burstGrenade(landing);
        continue;
      }
      velocity.y -= 10 * dt;
      const travel = velocity.clone().multiplyScalar(dt);
      const distance = travel.length();
      if (distance > 0) {
        this.raycaster.set(model.position, travel.clone().normalize());
        const hit = this.raycaster.intersectObjects(this.solidMeshes, true)[0];
        if (hit?.face && hit.distance <= distance + 0.08) {
          const normal = hit.face.normal
            .clone()
            .applyNormalMatrix(
              new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld),
            );
          if (normal.dot(velocity) > 0) normal.negate();
          model.position.copy(hit.point).addScaledVector(normal, 0.09);
          velocity.reflect(normal).multiplyScalar(0.48);
          this.sound("bounce");
        } else model.position.add(travel);
      }
      if (model.position.y < 0.12) {
        model.position.y = 0.12;
        if (velocity.y < -1.8) this.sound("bounce");
        velocity.y = velocity.y < -0.7 ? -velocity.y * 0.36 : 0;
        velocity.x *= Math.exp(-dt * 13);
        velocity.z *= Math.exp(-dt * 13);
      }
      for (const axis of ["x", "z"] as const) {
        if (Math.abs(model.position[axis]) <= 26) continue;
        model.position[axis] = THREE.MathUtils.clamp(
          model.position[axis],
          -26,
          26,
        );
        velocity[axis] *= -0.42;
      }
      model.rotation.x += velocity.length() * dt * 1.6;
      model.rotation.z += velocity.x * dt;
    }
  }

  private burstGrenade(landing: THREE.Vector3) {
    this.impact(landing, "#ffbe75", 0.9);
    this.sound("blast", landing.distanceTo(this.camera.position));
    this.state.message = "ระเบิดทำงาน";
    for (const zombie of this.zombies.slice()) {
      if (zombie.health <= 0 || zombie.group.position.distanceTo(landing) > 4)
        continue;
      const toward = zombie.group.position.clone().setY(landing.y).sub(landing);
      this.raycaster.set(landing, toward.clone().normalize());
      const cover = this.raycaster.intersectObjects(this.solidMeshes, true)[0];
      if (cover && cover.distance < toward.length()) continue;
      this.playerDamageZombie(zombie, 210, false, landing, "grenade");
      if (zombie.health <= 0) this.defeat(zombie);
    }
    this.publish();
  }

  private updateObjectives(dt: number) {
    this.updateWeaponCrate();
    const player = this.camera.position;
    const guest = this.room && !this.room.host;
    const distance = this.checkpoint
      ? Math.hypot(
          player.x - this.checkpoint.position.x,
          player.z - this.checkpoint.position.z,
        )
      : Infinity;
    if (!guest) this.state.timeLeft = Math.max(
      0,
      this.state.gateOpen ? 0 : Math.ceil(this.deadline - this.activeTime),
    );
    this.state.checkpointDistance = this.checkpoint
      ? Math.ceil(distance)
      : null;
    if (this.checkpoint) {
      const target = this.checkpoint.position;
      const bearing = Math.atan2(target.x - player.x, player.z - target.z);
      this.state.checkpointAngle = THREE.MathUtils.radToDeg(bearing + this.yaw);
    }
    const nearestCheckpoint = this.checkpoint && this.room?.host
      ? Math.min(...this.combatPlayers().map(({ eye }) => Math.hypot(eye.x - this.checkpoint!.position.x, eye.z - this.checkpoint!.position.z)))
      : distance;
    const objective = guest ? "continue" : objectiveAt(
      this.state.remaining,
      this.deadline - this.activeTime,
      nearestCheckpoint,
    );
    if (objective === "timeout") {
      this.endRun(true);
      return;
    }
    if (
      objective === "advance" &&
      this.checkpoint &&
      !this.boss &&
      !this.state.gateOpen
    ) {
      this.state.gateOpen = true;
      this.deadline = Infinity;
      this.state.timeLeft = 0;
      if (this.checkpoint) this.checkpoint.visible = false;
      this.state.message = "ประตูเปิดแล้ว · เดินผ่านประตูเพื่อเข้าโซนใหม่";
      this.publish();
    }
    if (this.state.gateOpen) {
      const zone = zoneForStage(this.state.wave);
      this.gateProgress = Math.min(1, this.gateProgress + dt * 1.8);
      const eased = THREE.MathUtils.smoothstep(this.gateProgress, 0, 1);
      this.gatePanels.forEach((panel, index) => {
        panel.position.x =
          zone.exitX + (index === 0 ? -1 : 1) * (1.05 + eased * 2.12);
      });
      if (this.gateProgress === 1 && this.gateLock) {
        this.obstacles = this.obstacles.filter(
          (obstacle) => obstacle !== this.gateLock,
        );
        this.gateLock = null;
        this.renderer.shadowMap.needsUpdate = true;
      }
      this.state.checkpointDistance = Math.ceil(
        Math.hypot(player.x - zone.exitX, player.z - GATE_Z),
      );
      this.state.checkpointAngle = THREE.MathUtils.radToDeg(
        Math.atan2(zone.exitX - player.x, player.z - GATE_Z) + this.yaw,
      );
    }
    if (
      !guest && this.combatPlayers().some(({ eye }) => crossedGate(
        this.state.wave,
        eye.x,
        eye.z,
        this.state.gateOpen && this.gateProgress === 1,
      ))
    ) {
      this.state.wave++;
      this.loadArena(this.state.wave);
      player.set(this.room ? (this.room.slot - 1.5) * 1.2 : 0, 1.7, 21);
      this.roomAvatars.clear();
      this.dodge = null;
      this.knifeSwing = null;
      this.movement.set(0, 0);
      this.yaw = this.pitch = this.jump = this.verticalVelocity = 0;
      this.spawnWave();
      this.publish();
      return;
    }
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const pickup = this.pickups[i];
      const { kind, mesh } = pickup;
      mesh.position.y = 0.35 + 0.12 * Math.sin(this.elapsed * 4);
      mesh.rotation.y = this.yaw;
      if (
        Math.hypot(player.x - mesh.position.x, player.z - mesh.position.z) > 1.4
      )
        continue;
      if (kind === "ammo") {
        const { drop } = pickup;
        if (!collectAmmoDrop(this.arsenal, drop)) continue;
        this.state.message = `กระสุนสำรอง ${weapons[drop.weaponId].name} +${drop.rounds} นัด`;
      } else {
        if (kind === "grenade") {
          if (this.state.grenades >= equipmentLimits.grenade) continue;
          this.state.grenades++;
        } else if (kind === "medkit") {
          if (this.state.medkits >= equipmentLimits.medkit) continue;
          this.state.medkits++;
        } else {
          if (this.state.energy >= equipmentLimits.energy) continue;
          this.state.energy++;
        }
        this.state.message = loot[kind].message;
      }
      this.removeMarker(mesh);
      this.pickups.splice(i, 1);
    }
  }

  private endRun(timedOut: boolean) {
    this.state.status = "dead";
    this.state.timedOut = timedOut;
    this.touchMove = { x: 0, y: 0 };
    this.trigger = false;
    this.cancelUse();
    this.sprinting = false;
    this.dodge = null;
    this.ads = false;
    this.keys.clear();
    if (document.pointerLockElement === this.renderer.domElement)
      document.exitPointerLock();
    this.publish();
  }

  private clearZombies() {
    this.clearBoss();
    for (const z of this.zombies) this.world.remove(z.group);
    this.zombies = [];
    this.roomZombieTargets.clear();
    this.lastRoomMotion = null;
  }

  private shoot() {
    const weapon = weapons[this.state.weaponId];
    const rounds = this.currentAmmo;
    if (rounds.ammo <= 0) {
      this.reload();
      this.fireAt = this.elapsed + 0.25;
      return;
    }
    rounds.ammo--;
    this.fireAt = this.elapsed + weapon.delay;
    this.recoil = Math.min(2.3, this.recoil + weapon.kick * 45);
    this.recoilSway = THREE.MathUtils.clamp(
      this.recoilSway + (Math.random() - 0.45) * weapon.kick * (this.ads ? 0.24 : 0.5),
      -0.025,
      0.025,
    );
    this.pendingShot = this.state.weaponId;
    if (this.room) this.roomShot++;
    this.sound("shot");
    this.camera.updateMatrixWorld();
    const spread =
      weapon.spread * (this.ads ? (weapon.pellets > 1 ? 0.72 : 0.28) : 1);
    const living = new Map(
      this.zombies.filter((z) => z.health > 0).map((z) => [z.group.id, z]),
    );
    const targets = [
      ...Array.from(living.values(), (z) => z.group),
      ...Array.from(this.roomAvatars.players.values()).filter((player) => player.pose.alive).map((player) => player.group),
      ...this.solidMeshes,
      ...(this.bulletGround ? [this.bulletGround] : []),
    ];
    this.world.updateMatrixWorld(true);
    this.roomAvatars.root.updateMatrixWorld(true);
    const damage = new Map<Zombie, { amount: number; headshot: boolean; strongest: number; impact: ZombieGunImpact }>();
    const friendlyDamage = new Map<string, number>();
    const surfaceCues = new Set<ImpactSurface>();
    for (let pellet = 0; pellet < weapon.pellets; pellet++) {
      const centered = pellet === 0 && weapon.pellets > 1;
      this.raycaster.setFromCamera(
        new THREE.Vector2(
          centered ? 0 : (Math.random() - 0.5) * spread,
          centered ? 0 : (Math.random() - 0.5) * spread,
        ),
        this.camera,
      );
      const hit = this.raycaster.intersectObjects(targets, true)[0];
      if (!hit || hit.distance > weapon.range) continue;
      const roomPlayer = hit.object.userData.roomPlayer as string | undefined;
      const headshot = !!hit.object.userData.head;
      const factor = weapon.pellets > 1 ? 1 - 0.55 * Math.min(1, hit.distance / weapon.range) : 1;
      const dealt = (headshot ? weapon.head : weapon.damage) * factor;
      if (roomPlayer) {
        friendlyDamage.set(roomPlayer, (friendlyDamage.get(roomPlayer) ?? 0) + dealt);
        continue;
      }
      const zombie = living.get(hit.object.userData.zombie);
      if (!zombie) {
        if (pellet < 3) {
          const surface = this.surfaceEffects.hit(hit, this.raycaster.ray.direction);
          if (!surfaceCues.has(surface)) {
            this.playSpatialCue(`impact-${surface}`, hit.point, hit.distance);
            surfaceCues.add(surface);
          }
        }
        continue;
      }
      if (pellet < 3) this.impact(hit.point, "#8a6950", 0.09);
      const previous = damage.get(zombie);
      const usePellet = !previous || dealt > previous.strongest;
      damage.set(zombie, {
        amount: (previous?.amount ?? 0) + dealt,
        headshot: headshot || !!previous?.headshot,
        strongest: usePellet ? dealt : previous.strongest,
        impact: usePellet ? this.zombieGunImpact(zombie, hit) : previous.impact,
      });
    }
    if (damage.size || friendlyDamage.size) this.sound("hit");
    for (const [target, amount] of friendlyDamage) {
      this.queueRoomCommand({ type: "hit-player", target, amount, weapon: this.state.weaponId });
      this.state.hit = Math.max(this.state.hit, 1);
      this.state.message = "ยิงโดนเพื่อนร่วมทีม";
    }
    for (const [zombie, hit] of damage) {
      this.playerDamageZombie(zombie, hit.amount, hit.headshot, this.camera.position, this.state.weaponId, hit.impact);
      this.state.hit = Math.max(this.state.hit, hit.headshot ? 2 : 1);
      if (zombie.health > 0) continue;
      this.state.message = hit.headshot
        ? "ยิงเข้าศีรษะ · กำจัดซอมบี้แล้ว"
        : "กำจัดซอมบี้แล้ว";
      this.defeat(zombie);
    }
    this.pitch = Math.min(
      1.35,
      this.pitch + weapon.kick * (this.ads ? 0.32 : 0.62),
    );
    this.publish();
  }

  private emitShotEffects(id: WeaponId) {
    const { fireFx, kick } = weapons[id];
    this.flashTime = fireFx.flash;
    this.flashPower = 4.5 + kick * 100;
    this.muzzle.rotation.z = Math.random() * Math.PI * 2;
    this.muzzle.scale.setScalar(0.72 + kick * 16);

    const rotation = this.weapon.getWorldQuaternion(new THREE.Quaternion());
    const smoke = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.shotSmokeTexture ??= this.createShotSmokeTexture(),
        color: "#cccac1",
        transparent: true,
        opacity: 0.38,
        depthWrite: false,
        rotation: Math.random() * Math.PI * 2,
      }),
    );
    this.muzzle.getWorldPosition(smoke.position);
    smoke.position.add(new THREE.Vector3(0, 0, -0.035).applyQuaternion(rotation));
    smoke.scale.setScalar(0.12 + kick * 2);
    this.world.add(smoke);
    this.shotSmoke.push({
      sprite: smoke,
      velocity: new THREE.Vector3(
        (Math.random() - 0.5) * 0.3, 0.26, -0.81,
      ).applyQuaternion(rotation),
      life: 1,
    });

    const r = fireFx.caseRadius;
    const half = fireFx.caseLength / 2;
    const casing = new THREE.Mesh(
      new THREE.LatheGeometry([
        new THREE.Vector2(0, -half),
        new THREE.Vector2(r, -half),
        new THREE.Vector2(r, -half + 0.005),
        new THREE.Vector2(r * 0.84, -half + 0.008),
        new THREE.Vector2(r * 0.91, half),
        new THREE.Vector2(r * 0.68, half),
        new THREE.Vector2(r * 0.62, half - 0.012),
        new THREE.Vector2(0, half - 0.012),
      ], 8),
      id === "shotgun"
        ? this.material("#a65642", 0.54, 0.25)
        : this.material("#c29b58", 0.43, 0.58),
    );
    casing.position.copy(this.weapon.localToWorld(
      new THREE.Vector3(id === "lmg" ? 0.085 : 0.06, 0.043, fireFx.portZ),
    ));
    casing.quaternion.copy(rotation);
    casing.rotateX(Math.PI / 2);
    this.world.add(casing);
    this.casings.push({
      mesh: casing,
      velocity: new THREE.Vector3(1.35 + Math.random() * 0.35, 1.6, 0.35)
        .applyQuaternion(rotation),
      spin: 12 + Math.random() * 7,
      life: 1.45,
    });
  }

  private createShotSmokeTexture() {
    const size = 32;
    const pixels = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = (x + 0.5) / size * 2 - 1;
        const dy = (y + 0.5) / size * 2 - 1;
        const fade = Math.max(0, 1 - dx * dx - dy * dy);
        const cloud = 0.78 + 0.22 * Math.sin(dx * 11 + dy * 3) * Math.cos(dy * 9);
        const offset = (y * size + x) * 4;
        pixels.set([255, 255, 255, Math.round(255 * fade ** 2 * cloud)], offset);
      }
    }
    const texture = new THREE.DataTexture(pixels, size, size);
    texture.minFilter = texture.magFilter = THREE.LinearFilter;
    texture.needsUpdate = true;
    return texture;
  }

  private updateShotEffects(dt: number) {
    for (let i = this.casings.length - 1; i >= 0; i--) {
      const casing = this.casings[i];
      casing.life -= dt;
      casing.velocity.y -= dt * 8;
      const p = casing.mesh.position;
      p.addScaledVector(casing.velocity, dt);
      if (p.y < 0.017) {
        p.y = 0.017;
        casing.velocity.y *= -0.25;
        casing.velocity.x *= 0.6;
        casing.velocity.z *= 0.6;
        casing.spin *= 0.55;
      }
      casing.mesh.rotation.x += dt * casing.spin;
      casing.mesh.rotation.z += dt * casing.spin * 0.65;
      if (casing.life <= 0) {
        casing.mesh.removeFromParent();
        casing.mesh.geometry.dispose();
        this.casings.splice(i, 1);
      }
    }
    for (let i = this.shotSmoke.length - 1; i >= 0; i--) {
      const smoke = this.shotSmoke[i];
      smoke.life -= dt / 0.56;
      smoke.sprite.position.addScaledVector(smoke.velocity, dt);
      smoke.sprite.position.y += dt * 0.32;
      smoke.velocity.multiplyScalar(Math.exp(-dt * 4));
      smoke.sprite.scale.addScalar(dt * 0.62);
      smoke.sprite.material.opacity = 0.38 * Math.max(0, smoke.life) ** 1.4;
      if (smoke.life <= 0) {
        smoke.sprite.removeFromParent();
        smoke.sprite.material.dispose();
        this.shotSmoke.splice(i, 1);
      }
    }
    this.flashTime = Math.max(0, this.flashTime - dt);
    if (this.pendingShot) {
      this.emitShotEffects(this.pendingShot);
      this.pendingShot = null;
    }
    this.muzzle.visible = this.flashTime > 0;
    this.flashLight.intensity = this.flashPower * Math.min(1, this.flashTime * 30);
  }

  private clearShotEffects() {
    for (const { mesh } of this.casings) {
      mesh.removeFromParent();
      mesh.geometry.dispose();
    }
    for (const { sprite } of this.shotSmoke) {
      sprite.removeFromParent();
      sprite.material.dispose();
    }
    this.casings = [];
    this.shotSmoke = [];
    this.pendingShot = null;
    this.flashTime = this.flashLight.intensity = 0;
    this.muzzle.visible = false;
  }

  private zombieGunImpact(zombie: Zombie, hit: THREE.Intersection): ZombieGunImpact {
    const part = hit.object.userData.zombieZone as ZombieHitZone | undefined;
    let zone = part ?? "body";
    if (hit.object.userData.head) zone = "head";
    else if ((zone === "left-shoulder" || zone === "right-shoulder") &&
      hit.object.worldToLocal(hit.point.clone()).y < -0.25) zone = "body";
    const { x, z } = this.raycaster.ray.direction;
    return { zone, ...zombieImpactDirection(x, z, zombie.group.rotation.y) };
  }

  private hitZombie(
    zombie: Zombie,
    damage: number,
    headshot: boolean,
    origin: THREE.Vector3,
    impact?: ZombieGunImpact,
  ) {
    const { position, rotation } = zombie.group;
    const direction = zombie.lastImpact = impact ?? {
      zone: headshot ? "head" : "body",
      ...zombieImpactDirection(position.x - origin.x, position.z - origin.z, rotation.y),
    };
    const local = zombie.hitLocal = zombieLocalImpact(direction.x, direction.z, rotation.y);
    const lateral = -local.sideways;
    zombie.tumbleSign =
      Math.abs(lateral) > 0.1
        ? Math.sign(lateral)
        : Math.sin(zombie.phase) < 0
          ? -1
          : 1;
    zombie.hitAt = this.elapsed;
    zombie.hitForce = (headshot ? 1.36 : 0.95) / Math.sqrt(zombie.group.scale.y);
    if (direction.zone === "left-leg") zombie.injuredLeg = -1;
    else if (direction.zone === "right-leg") zombie.injuredLeg = 1;
    zombie.health -= damage;
    if ((direction.zone === "left-leg" || direction.zone === "right-leg") && zombie.health > 0 &&
      !zombie.crawl && this.boss?.zombie !== zombie) {
      zombie.legHits = (zombie.legHits ?? 0) + 1;
      if (zombie.legHits >= zombieCrawlThreshold(zombie.kind)) {
        const airborne = zombie.kind === "flier" && position.y > 0;
        zombie.crawl = { fall: airborne ? null : { pose: this.captureZombieMotion(zombie), startedAt: this.elapsed } };
        zombie.melee = undefined;
        zombie.spitAt = undefined;
        zombie.throat?.scale.setScalar(1);
      }
    }
    if (zombie.kind === "flier" && zombie.health > 0) {
      zombie.melee = undefined;
      if (position.y > 0 && zombie.airFallSpeed === undefined) {
        zombie.airFallAt = this.elapsed;
        zombie.airFallSpeed = 0.35;
        zombie.groundedUntil = undefined;
      } else if (zombie.groundedUntil !== undefined) {
        zombie.groundedUntil = this.elapsed + 0.8;
      }
    }
  }

  private impact(position: THREE.Vector3, color: string, radius: number) {
    const mesh = new THREE.Mesh(
      new THREE.IcosahedronGeometry(radius, 0),
      new THREE.MeshBasicMaterial({ color }),
    );
    mesh.position.copy(position);
    this.world.add(mesh);
    this.impacts.push({ mesh, life: 0.25 });
  }

  private initAudio() {
    if (!this.audio) {
      this.audio = new AudioContext();
      this.master = this.audio.createGain();
      this.master.gain.value = this.settings.volume / 100;
      this.master.connect(this.audio.destination);
      this.noise = this.audio.createBuffer(
        1,
        this.audio.sampleRate * 0.3,
        this.audio.sampleRate,
      );
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    void this.audio.resume().catch(() => {});
  }

  private sound(
    kind:
      | "shot"
      | "hit"
      | "reload"
      | "hurt"
      | "blast"
      | "gear"
      | "bounce"
      | "step"
      | "dodge"
      | "knife-swing"
      | "knife-hit"
      | "inject"
      | "can-open"
      | "sip"
      | "spit-warn"
      | "spit-release"
      | "enemy-step"
      | "enemy-swing"
      | "enemy-brace"
      | "enemy-crouch"
      | "enemy-slam"
      | "impact-concrete"
      | "impact-metal"
      | "fall",
    distance = 0,
    pan?: number,
    stepWeight = 1,
  ) {
    if (!this.audio || !this.master || !this.noise) return;
    const ctx = this.audio,
      now = ctx.currentTime;
    const panner = pan === undefined ? null : ctx.createStereoPanner();
    if (panner) {
      panner.pan.value = pan ?? 0;
      panner.connect(this.master);
    }
    const outlet = panner ?? this.master;
    let lastSoundEnd = now;
    const finish = (source: AudioScheduledSourceNode, end: number) => {
      if (end < lastSoundEnd) return;
      lastSoundEnd = end;
      source.onended = () => {
        if (end === lastSoundEnd) panner?.disconnect();
      };
    };
    const texture = (
      frequency: number,
      volume: number,
      duration: number,
      delay = 0,
      type: BiquadFilterType = "lowpass",
    ) => {
      const source = ctx.createBufferSource();
      const filter = ctx.createBiquadFilter();
      const gain = ctx.createGain();
      const start = now + delay;
      source.buffer = this.noise;
      source.connect(filter);
      filter.connect(gain);
      gain.connect(outlet);
      filter.type = type;
      filter.frequency.value = frequency;
      gain.gain.setValueAtTime(volume, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
      source.start(start, Math.random() * 0.02);
      source.stop(start + duration);
      if (panner) finish(source, start + duration);
    };
    const thump = (frequency: number, volume: number, duration: number) => {
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.connect(gain);
      gain.connect(outlet);
      oscillator.frequency.setValueAtTime(frequency, now);
      oscillator.frequency.exponentialRampToValueAtTime(
        Math.max(32, frequency * 0.4),
        now + duration,
      );
      gain.gain.setValueAtTime(volume, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
      oscillator.start(now);
      oscillator.stop(now + duration);
      if (panner) finish(oscillator, now + duration);
    };
    if (kind === "shot") {
      const profiles: Record<WeaponId, [number, number, number]> = {
        rifle: [4300, 114, 0.13],
        sidearm: [5200, 155, 0.09],
        shotgun: [3050, 83, 0.19],
        lmg: [3800, 107, 0.105],
        marksman: [4500, 94, 0.17],
      };
      const [crack, bass, tail] = profiles[this.state.weaponId];
      texture(crack, 0.32, 0.045);
      texture(1050, 0.18, tail);
      texture(900, 0.065, tail, 0.06);
      texture(3250, 0.055, 0.045, 0.072, "bandpass");
      thump(bass, 0.21, tail * 0.68);
    } else if (kind === "blast") {
      const attenuation = 1 / (1 + distance * 0.09);
      texture(850, 0.46 * attenuation, 0.27);
      texture(1900, 0.22 * attenuation, 0.1);
      thump(78, 0.42 * attenuation, 0.26);
    } else if (kind === "inject") {
      texture(2400, 0.095, 0.055, 0, "bandpass");
      texture(810, 0.064, 0.095, 0.04, "lowpass");
    } else if (kind === "can-open") {
      texture(3500, 0.21, 0.032, 0, "bandpass");
      texture(4400, 0.09, 0.17, 0.025, "highpass");
    } else if (kind === "sip") {
      texture(520, 0.069, 0.1, 0, "bandpass");
      texture(360, 0.047, 0.14, 0.14, "bandpass");
    } else if (kind === "spit-warn") {
      const proximity = 1 / (1 + distance * 0.055);
      thump(240, 0.22 * proximity, 0.43);
      texture(850, 0.23 * proximity, 0.19, 0.04, "bandpass");
      texture(1450, 0.17 * proximity, 0.22, 0.34, "bandpass");
    } else if (kind === "spit-release") {
      texture(1350, 0.16 / (1 + distance * 0.065), 0.18, 0, "bandpass");
    } else if (kind === "enemy-step") {
      const proximity = (1 - Math.min(distance / 16, 1)) ** 1.35;
      texture(
        430 / Math.sqrt(stepWeight) - Math.min(distance, 16) * 7,
        0.16 * proximity * Math.sqrt(stepWeight) + 0.002,
        0.095 * Math.sqrt(stepWeight),
        0,
        "bandpass",
      );
      thump(76 / Math.sqrt(stepWeight), 0.075 * proximity * stepWeight + 0.002, 0.09 * Math.sqrt(stepWeight));
    } else if (kind === "enemy-swing") {
      texture(1100, 0.12, 0.14, 0, "bandpass");
    } else if (kind === "enemy-brace") {
      const volume = 1 / (1 + distance * 0.11);
      thump(119, 0.18 * volume, 0.3);
      texture(510, 0.13 * volume, 0.31, 0.04, "bandpass");
    } else if (kind === "enemy-crouch") {
      texture(1850, 0.21 / (1 + distance * 0.1), 0.22, 0, "bandpass");
    } else if (kind === "enemy-slam") {
      const volume = 1 / (1 + distance * 0.08);
      thump(82, 0.3 * volume, 0.18);
      texture(950, 0.18 * volume, 0.16);
    } else if (kind === "dodge") {
      texture(780, 0.16, 0.16, 0, "bandpass");
      thump(88, 0.067, 0.13);
    } else if (kind === "knife-swing") {
      texture(1650, 0.13, 0.12, 0, "bandpass");
    } else if (kind === "knife-hit") {
      thump(128, 0.21, 0.13);
      texture(780, 0.24, 0.095, 0, "lowpass");
      texture(2700, 0.1, 0.055, 0, "bandpass");
    } else if (kind === "impact-concrete") {
      const proximity = 1 / (1 + distance * 0.08);
      thump(180, 0.16 * proximity, 0.068);
      texture(1250, 0.23 * proximity, 0.11, 0.012, "lowpass");
    } else if (kind === "impact-metal") {
      const proximity = 1 / (1 + distance * 0.08);
      texture(4600, 0.24 * proximity, 0.038, 0.008, "bandpass");
      const ring = ctx.createOscillator();
      const gain = ctx.createGain();
      ring.frequency.value = 1960 + Math.random() * 380;
      ring.connect(gain);
      gain.connect(outlet);
      gain.gain.setValueAtTime(0.12 * proximity, now + 0.014);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.19);
      ring.start(now + 0.014);
      ring.stop(now + 0.19);
      if (panner) finish(ring, now + 0.19);
    } else if (kind === "fall") {
      const proximity = 1 / (1 + distance * 0.12);
      thump(95 / Math.sqrt(stepWeight), 0.12 * proximity * stepWeight, 0.14 * Math.sqrt(stepWeight));
      texture(470, 0.16 * proximity * Math.sqrt(stepWeight), 0.13);
    } else if (kind === "reload" || kind === "gear") {
      texture(kind === "reload" ? 2300 : 1250, 0.13, 0.08, 0, "bandpass");
      texture(3200, 0.075, 0.07, 0.045, "bandpass");
    } else if (kind === "step" || kind === "bounce") {
      texture(kind === "step" ? 520 : 2500, 0.09, 0.09, 0, "bandpass");
      if (kind === "step") thump(76, 0.033, 0.075);
    } else {
      thump(kind === "hit" ? 720 : 100, 0.13, 0.15);
    }
  }

  private updatePlayer(dt: number) {
    if (this.activeTime >= this.deadline) {
      this.state.timeLeft = 0;
      this.endRun(true);
      return;
    }
    if (this.grenadeHeldAt !== null)
      this.state.throwProgress = throwCharge(this.elapsed - this.grenadeHeldAt);
    if (this.healStartedAt !== null) {
      const duration = this.elapsed - this.healStartedAt;
      const previous = (this.state.healProgress ?? 0) * healingSeconds;
      if (previous < injectionTiming.contact && duration >= injectionTiming.contact)
        this.sound("inject");
      const progress = duration / healingSeconds;
      this.state.healProgress = Math.min(1, progress);
      if (progress >= 1) {
        this.state.medkits--;
        this.state.health = Math.min(100, this.state.health + healAmount);
        this.healStartedAt = this.state.healProgress = null;
        this.state.message = "รักษาเสร็จแล้ว";
        this.sound("gear");
        this.publish();
      }
    }
    if (this.drinkStartedAt !== null) {
      const duration = this.elapsed - this.drinkStartedAt;
      const previous = (this.state.drinkProgress ?? 0) * drinkingSeconds;
      if (previous < drinkOpeningSeconds && duration >= drinkOpeningSeconds)
        this.sound("can-open");
      if (previous < 0.87 && duration >= 0.87) this.sound("sip");
      if (duration >= drinkingSeconds) {
        this.state.energy--;
        this.drinkStartedAt = this.state.drinkProgress = null;
        this.boostUntil = this.activeTime + boostSeconds;
        this.state.boost = boostSeconds;
        this.state.stamina = 100;
        this.state.message = "ดื่มเสร็จแล้ว · เพิ่มความเร็ว 10 วินาที";
        this.publish();
      } else {
        this.state.drinkProgress = duration / drinkingSeconds;
      }
    }
    let { forward, right } = this.moveInput();
    const dodging = this.dodge !== null;
    const length = Math.hypot(forward, right);
    if (length > 1) {
      forward /= length;
      right /= length;
    }
    const sprintRequested =
      this.keys.has("ShiftLeft") ||
      this.keys.has("ShiftRight") ||
      this.elapsed < this.sprintUntil;
    if (this.state.stamina <= 1) this.sprintExhausted = true;
    if (this.state.stamina >= 24) this.sprintExhausted = false;
    const sprint =
      sprintRequested &&
      !dodging &&
      !this.knifeSwing &&
      forward > 0 &&
      !this.ads &&
      !this.sprintExhausted &&
      !this.trigger &&
      !this.shotQueued &&
      !this.state.reloading &&
      this.healStartedAt === null &&
      this.drinkStartedAt === null &&
      this.grenadeHeldAt === null;
    this.sprinting = sprint;
    this.state.boost = Math.max(0, this.boostUntil - this.activeTime);
    this.state.stamina = THREE.MathUtils.clamp(
      this.state.stamina +
        (sprint ? -23 : this.elapsed >= this.staminaResumeAt ? 14 : 0) * dt,
      0,
      100,
    );
    const speed =
      (sprint
        ? 6.2
        : this.healStartedAt !== null || this.drinkStartedAt !== null
          ? 1.35
          : this.ads
            ? 2
            : 3.6) * (this.state.boost > 0 ? 1.4 : 1);
    const p = this.camera.position;
    const previousX = p.x,
      previousZ = p.z;
    if (dodging) {
      this.advanceDodge();
    } else {
      const { x, z } = movementInWorld(forward, right, this.yaw);
      const target = new THREE.Vector2(x * speed, z * speed);
      this.movement.lerp(target, 1 - Math.exp(-dt * (length ? 12 : 17)));
      const dx = this.movement.x * dt,
        dz = this.movement.y * dt;
      if (canOccupy(p.x + dx, p.z, this.obstacles)) p.x += dx;
      if (canOccupy(p.x, p.z + dz, this.obstacles)) p.z += dz;
    }
    this.verticalVelocity -= 12 * dt;
    this.jump = Math.max(0, this.jump + this.verticalVelocity * dt);
    if (this.jump === 0) this.verticalVelocity = 0;
    const distance = Math.hypot(p.x - previousX, p.z - previousZ);
    const beforeStep = Math.floor(this.stepPhase / Math.PI);
    if (!this.jump && !dodging)
      this.stepPhase += distance * (sprint ? 2.85 : 3.65);
    if (Math.floor(this.stepPhase / Math.PI) > beforeStep) this.sound("step");
    const stride = Math.min(1, distance / Math.max(dt * 2.5, 0.001));
    p.y =
      1.7 +
      this.jump +
      (!this.jump && !dodging
        ? Math.sin(this.stepPhase * 2) * stride * (sprint ? 0.034 : 0.019)
        : 0);
    const weapon = weapons[this.state.weaponId];
    if (
      this.state.heldItem === "gun" &&
      !dodging &&
      !this.knifeSwing &&
      !this.sprinting &&
      !this.state.reloading &&
      this.elapsed >= this.fireAt &&
      (this.shotQueued || (this.trigger && weapon.auto))
    ) {
      this.shotQueued = false;
      this.shoot();
    }
    if (this.state.reloading) {
      this.state.reloadProgress = THREE.MathUtils.clamp(
        1 - (this.reloadAt - this.elapsed) / this.reloadInterval(),
        0,
        1,
      );
    }
    if (this.state.reloading && this.elapsed >= this.reloadAt) {
      const rounds = this.currentAmmo;
      if (
        this.state.weaponId === "shotgun" &&
        loadShotgunShell(rounds, weapon.capacity)
      ) {
        this.reloadAt = this.elapsed + shotgunShellSeconds;
        this.state.reloadProgress = 0;
      } else {
        if (this.state.weaponId !== "shotgun")
          Object.assign(
            rounds,
            reloadAmmo(rounds.ammo, rounds.reserve, weapon.capacity),
          );
        this.state.reloading = false;
        this.state.reloadProgress = null;
      }
      this.sound("reload");
      this.publish();
    }
    this.updateKnife();
    this.updateGrenades(dt);
    this.updateSpit(dt);
    if (this.state.status !== "playing") return;
    this.updateObjectives(dt);
  }

  private updateZombies(dt: number, time: number, playing: boolean) {
    const players = this.combatPlayers();
    if (playing && (!this.navigation || this.elapsed >= this.navigateAt)) {
      this.navigation = buildNavigationField(
        this.camera.position.x,
        this.camera.position.z,
        this.obstacles,
      );
      this.navigateAt = this.elapsed + 0.65;
      this.roomNavigation.clear();
      for (const { id, eye } of players) {
        if (id) this.roomNavigation.set(id, buildNavigationField(eye.x, eye.z, this.obstacles));
      }
    }
    for (const z of this.zombies) {
      if (z.health <= 0) {
        this.animateZombieDeath(z);
        continue;
      }
      const p = z.group.position;
      let closest = players[0];
      for (const player of players.slice(1)) {
        if (player.eye.distanceToSquared(p) < closest.eye.distanceToSquared(p)) closest = player;
      }
      this.combatTarget = closest.id ? { id: closest.id, eye: closest.eye } : null;
      const player = closest.eye;
      const dx = player.x - p.x,
        dz = player.z - p.z,
        distance = Math.hypot(dx, dz);
      const gait = z.gait;
      z.group.rotation.y = turnZombieToward(
        z.group.rotation.y,
        z.melee?.yaw ?? gait.heading ?? (distance > 0.01 ? Math.atan2(dx, dz) : z.group.rotation.y),
        dt,
      );
      gait.heading = undefined;
      if (gait.travel < 0.001) {
        const resistance = Math.exp(-dt * 16);
        gait.vx *= resistance;
        gait.vz *= resistance;
      }
      const crawlSpeed = Math.min(zombieCrawl.maxSpeed, z.speed * zombieCrawl.speedRatio);
      gait.weight = THREE.MathUtils.lerp(
        gait.weight, Math.min(1, gait.travel / Math.max(0.001, dt * (z.crawl ? crawlSpeed : z.speed))),
        1 - Math.exp(-dt * 14),
      );
      gait.travel = 0;
      z.limp = THREE.MathUtils.lerp(z.limp ?? 0, z.injuredLeg ?? 0, 1 - Math.exp(-dt * 8));
      const pose = zombieGaitPose(z.kind, gait.phase, gait.weight, z.kind === "flier" ? 0 : z.limp);
      const idle = Math.sin(time * 2.4 + z.phase);
      z.rig.rotation.set(pose.lean, 0, pose.roll);
      z.rig.position.y = zombieRigHeight + pose.height;
      z.legs[0].rotation.x = pose.leftLeg;
      z.legs[1].rotation.x = pose.rightLeg;
      z.arms[0].rotation.x = pose.leftArm + idle * 0.06;
      z.arms[1].rotation.x = pose.rightArm - idle * 0.05;
      z.arms[0].rotation.z = z.arms[1].rotation.z = 0;
      const impact = zombieImpactMotion(time - (z.hitAt ?? -1)) * (z.hitForce ?? 1);
      const response = 1 - Math.exp(-dt * 21);
      const flinch = z.hitLean = THREE.MathUtils.lerp(z.hitLean ?? 0, impact, response);
      const direction = z.lastImpact;
      const local = z.hitLocal ?? { forward: -1, sideways: 0 };
      const shoulder = direction?.zone === "left-shoulder" ? -1 :
        direction?.zone === "right-shoulder" ? 1 : 0;
      const torque = shoulder * (local.forward > 0 ? 1 : -1) *
        (0.52 + Math.abs(local.forward) * 0.45) + local.sideways * 0.28;
      const hitTwist = z.hitTwist = THREE.MathUtils.lerp(z.hitTwist ?? 0, impact * torque, response);
      const hitRoll = z.hitRoll = THREE.MathUtils.lerp(
        z.hitRoll ?? 0,
        impact * (-local.sideways * 0.84 + shoulder * 0.26),
        response,
      );
      z.hitPitch = THREE.MathUtils.lerp(z.hitPitch ?? 0, impact * local.forward, response);
      z.group.rotation.x = 0.38 * z.hitPitch;
      z.group.rotation.z = idle * 0.023 + hitRoll * 0.42;
      z.rig.rotation.y += hitTwist * 0.52;
      z.head.rotation.set(
        idle * 0.05 - flinch * 0.36 - pose.lean * 0.45,
        idle * 0.065 + hitRoll * 0.42,
        -pose.roll * 0.65 + hitRoll * 0.18,
      );
      z.rig.position.y -= flinch * 0.06;
      z.arms[0].rotation.x -= flinch * 0.30 + Math.max(0, hitTwist) * 0.42;
      z.arms[1].rotation.x += flinch * 0.25 + Math.max(0, -hitTwist) * 0.42;
      if (!playing) continue;
      let readyToCrawl = false;
      if (z.crawl) {
        if (!z.crawl.fall && this.updateFlierFall(z, dt) && p.y > 0) continue;
        z.crawl.fall ??= { pose: this.captureZombieMotion(z), startedAt: this.elapsed };
        readyToCrawl = this.poseCrawl(z, z.crawl.fall);
      }
      const stagger = z.knifeStagger;
      if (stagger && this.elapsed < stagger.until) {
        const duration = knifeTuning.staggerSeconds;
        const remaining = (stagger.until - this.elapsed) / duration;
        const previous = Math.min(1, remaining + dt / duration);
        const step = previous ** 2 - remaining ** 2;
        const x = p.x + stagger.x * step;
        const nextZ = p.z + stagger.z * step;
        if (clearSegment(p.x, p.z, x, nextZ, this.obstacles)) p.set(x, p.y, nextZ);
        if (!z.crawl) {
          z.legs[0].rotation.x = 0.38 * remaining;
          z.legs[1].rotation.x = -0.24 * remaining;
          if (z.kind === "flier") this.updateFlierFall(z, dt);
        }
        continue;
      }
      z.knifeStagger = undefined;
      if (z.crawl) {
        if (readyToCrawl && !this.updateMelee(z, distance, true))
          this.moveZombie(z, crawlSpeed, dt);
        if (this.state.health === 0) break;
        continue;
      }
      if (this.boss?.zombie === z) {
        this.updateBoss(this.boss, dt);
        continue;
      }
      if (z.kind === "flier") {
        if (this.updateFlierFall(z, dt)) continue;
        const low = distance < 3.2;
        p.y = THREE.MathUtils.lerp(
          p.y,
          (low ? 0.55 : 2.65) + Math.sin(time * 4.1 + z.phase) * 0.28,
          1 - Math.exp(-dt * 4),
        );
        z.wings?.forEach((wing, i) => {
          const flap = Math.sin(time * 15 + z.phase) * 0.66;
          wing.rotation.z = i === 0 ? -flap : flap;
        });
        if (!this.updateMelee(z, distance, p.y < 1))
          this.moveZombie(z, z.speed, dt);
        if (this.state.health === 0) break;
        continue;
      }
      if (z.melee) {
        this.updateMelee(z, distance, true);
        if (this.state.health === 0) break;
        continue;
      }
      if (z.kind === "spitter") {
        const lunge = zombieHitAmount(this.elapsed - (z.spitReleasedAt ?? -1));
        z.group.rotation.x += lunge * 0.74;
        if (this.updateSpitter(z, distance)) continue;
      }
      if (!this.updateMelee(z, distance, true)) {
        const difficulty =
          this.settings.difficulty === "recruit"
            ? 0.72
            : this.settings.difficulty === "veteran"
              ? 1.35
              : 1;
        const speed =
          z.speed *
          difficulty *
          (1 + Math.min(this.state.wave, 12) * 0.09);
        this.moveZombie(z, speed, dt);
      }
    }
    this.combatTarget = null;
  }

  private poseCrawl(zombie: Zombie, fall: { pose: ZombieMotion; startedAt: number }) {
    const seconds = this.elapsed - fall.startedAt;
    const { lower, brace } = zombieCrawlTransition(seconds);
    const reach = Math.sin(zombie.gait.phase * Math.PI * 2) * zombie.gait.weight;
    const side = zombie.injuredLeg ?? 1;
    const standing = this.captureZombieMotion(zombie);
    const motion = blendZombieMotion(
      { ...fall.pose, x: standing.x, z: standing.z, yaw: standing.yaw },
      {
        ...standing, y: 0,
        pose: [
          standing.pose[0] * 0.24, standing.pose[1] * 0.32,
          1.44 - Math.abs(reach) * 0.07, standing.pose[3] * 0.4, reach * 0.14,
          zombieCrawl.rigHeight + Math.abs(reach) * 0.038,
          -1.03, reach * 0.09, 0.22 * reach,
          -2.57 - reach * 0.34, -0.12, -2.57 + reach * 0.34, 0.12,
          -0.08 + reach * 0.11, 0.08 - reach * 0.11,
          -0.81, 0.81, 1,
        ],
      },
      lower,
    );
    motion.pose[5] -= brace * 0.16;
    motion.pose[4] += brace * side * 0.20;
    motion.pose[13] -= brace * (side < 0 ? 0.42 : 0.17);
    motion.pose[14] -= brace * (side > 0 ? 0.42 : 0.17);
    this.renderZombieMotion(zombie, motion);
    return lower === 1;
  }

  private updateMelee(zombie: Zombie, distance: number, lowEnough: boolean) {
    const p = zombie.group.position,
      player = this.combatTarget?.eye ?? this.camera.position;
    const scale = enemyTypes[zombie.kind].scale;
    const profile = zombie.crawl ? zombieCrawl.melee : zombieMelee[zombie.kind];
    const reach = profile.reach * scale;
    if (!zombie.melee) {
      if (
        !lowEnough ||
        distance > profile.trigger * scale ||
        !clearSegment(p.x, p.z, player.x, player.z, this.obstacles)
      )
        return false;
      if (this.elapsed < zombie.attack) return true;
      zombie.melee = {
        startedAt: this.elapsed,
        yaw: Math.atan2(player.x - p.x, player.z - p.z),
        side: Math.sin(zombie.phase + this.elapsed) < 0 ? 0 : 1,
        resolved: false,
      };
      if (profile.style === "pounce") {
        zombie.melee.lunge = {
          distance: Math.min(hunterPounce.maxDistance, Math.max(0.9, distance + 0.18)),
          advanced: 0,
          blocked: false,
        };
        this.playSpatialCue("enemy-crouch", p, distance);
      } else if (profile.style === "slam") {
        this.playSpatialCue("enemy-brace", p, distance);
      }
    }
    const swing = zombie.melee;
    const elapsed = this.elapsed - swing.startedAt;
    const windup = zombie.crawl ? zombieCrawl.melee.windup : meleeWindupSeconds[zombie.kind];
    const impactEnd = windup + (swing.lunge ? hunterPounce.duration : 0);
    this.poseMelee(zombie, swing.side, elapsed, windup, impactEnd);
    if (swing.lunge) {
      this.advanceHunterPounce(zombie, swing, swing.lunge, (elapsed - windup) / hunterPounce.duration);
    } else if (!swing.resolved && elapsed >= windup) {
      swing.resolved = true;
      this.playSpatialCue(profile.style === "slam" ? "enemy-slam" : "enemy-swing", p, distance);
      if (
        lowEnough &&
        Math.abs(player.y - 1.7 - p.y) < (zombie.crawl ? 0.72 : 1.35) &&
        meleeStrikeHits(swing.yaw, player.x - p.x, player.z - p.z, reach, profile.arc) &&
        clearSegment(p.x, p.z, player.x, player.z, this.obstacles)
      )
        this.enemyDamagePlayer(this.enemyDamage(zombie));
    }
    if (elapsed >= impactEnd + meleeRecoverySeconds) {
      zombie.melee = undefined;
      zombie.attack = this.elapsed + 0.24;
    }
    return true;
  }

  private poseMelee(zombie: Zombie, side: 0 | 1, elapsed: number, windup: number, impactEnd: number) {
    const smooth = THREE.MathUtils.smoothstep;
    const wind = smooth(elapsed, 0, windup * 0.81);
    const strike = smooth(elapsed, windup - 0.14, windup);
    const blend = wind * (1 - smooth(elapsed, impactEnd + 0.07, impactEnd + meleeRecoverySeconds));
    const follow = Math.sin(Math.PI * smooth(elapsed, impactEnd, impactEnd + 0.23)) * blend;
    const arm = zombie.arms[side].rotation;
    const other = zombie.arms[1 - side].rotation;
    const sign = side === 0 ? -1 : 1;
    const lerp = THREE.MathUtils.lerp;
    switch (zombie.crawl ? zombieCrawl.melee.style : zombieMelee[zombie.kind].style) {
      case "crawl":
        arm.x = lerp(arm.x, lerp(-2.01, -2.92, strike), blend);
        arm.z = sign * lerp(0.38, 0.06, strike) * blend;
        other.x = lerp(other.x, -2.48, blend);
        zombie.rig.rotation.z += sign * (-0.19 + strike * 0.26) * blend;
        zombie.rig.position.y += (0.075 * (1 - strike) - 0.024 * follow) * blend;
        break;
      case "slam":
        for (const [i, limb] of zombie.arms.entries()) {
          limb.rotation.x = lerp(limb.rotation.x, lerp(-3.02, -0.85, strike), blend);
          limb.rotation.z = (i === 0 ? -1 : 1) * 0.28 * (1 - strike) * blend;
        }
        zombie.group.rotation.x += lerp(-0.24, 0.84, strike) * blend + follow * 0.11;
        zombie.rig.position.y -= (0.13 * strike + 0.03 * wind) * blend;
        zombie.legs[0].rotation.x = lerp(zombie.legs[0].rotation.x, -0.23, blend);
        zombie.legs[1].rotation.x = lerp(zombie.legs[1].rotation.x, 0.16, blend);
        break;
      case "pounce": {
        const takeoff = smooth(elapsed, windup, windup + 0.08);
        const { lift } = hunterPounceMotion((elapsed - windup) / hunterPounce.duration);
        arm.x = lerp(arm.x, lerp(0.7, -1.95, takeoff), blend);
        other.x = lerp(other.x, lerp(0.43, -1.75, takeoff), blend);
        zombie.rig.rotation.x = lerp(zombie.rig.rotation.x, 0.68, blend);
        zombie.rig.position.y += (lift * 0.37 - (1 - takeoff) * 0.32) * blend - follow * 0.12;
        zombie.legs[0].rotation.x = lerp(zombie.legs[0].rotation.x, lerp(-0.7, 0.86, takeoff), blend);
        zombie.legs[1].rotation.x = lerp(zombie.legs[1].rotation.x, lerp(0.33, 1.13, takeoff), blend);
        break;
      }
      case "shove":
        zombie.rig.rotation.y += sign * lerp(-0.58, 0.36, strike) * blend;
        zombie.group.rotation.x += lerp(-0.09, 0.52, strike) * blend + follow * 0.08;
        zombie.rig.position.y -= 0.06 * strike * blend;
        zombie.legs[side].rotation.x = lerp(zombie.legs[side].rotation.x, -0.21, blend);
        arm.x = lerp(arm.x, lerp(-0.93, -1.39, strike), blend);
        arm.z = sign * lerp(0.64, 0.16, strike) * blend;
        other.x = lerp(other.x, 0.21, blend);
        break;
      case "dive":
        zombie.group.rotation.x += lerp(-0.45, 0.77, strike) * blend + follow * 0.09;
        zombie.rig.position.y -= 0.24 * strike * blend;
        arm.x = lerp(arm.x, lerp(0.45, -1.33, strike), blend);
        other.x = lerp(other.x, lerp(0.45, -1.2, strike), blend);
        zombie.wings?.forEach((wing, i) => {
          wing.rotation.z = lerp(wing.rotation.z, (i === 0 ? -1 : 1) * lerp(0.9, -0.62, strike), blend);
        });
        break;
      case "bite":
        zombie.group.rotation.x += lerp(-0.36, 0.67, strike) * blend;
        zombie.head.rotation.x += lerp(-0.31, 0.35, strike) * blend + follow * 0.13;
        arm.x = lerp(arm.x, -1.04, blend);
        other.x = lerp(other.x, -1.04, blend);
        break;
      case "swipe":
        zombie.group.rotation.x += lerp(-0.26, 0.32, strike) * blend;
        zombie.group.rotation.z += sign * (lerp(0.26, -0.21, strike) * blend - follow * 0.09);
        zombie.legs[side].rotation.x = lerp(zombie.legs[side].rotation.x, -0.16, blend);
        arm.x = lerp(arm.x, lerp(1.42, -1.23, strike), blend);
        arm.z = sign * lerp(0.65, -0.2, strike) * blend;
        other.x = lerp(other.x, lerp(-0.71, -1.13, strike), blend);
        break;
    }
  }

  private advanceHunterPounce(zombie: Zombie, attack: ZombieMelee, lunge: NonNullable<ZombieMelee["lunge"]>, progress: number) {
    if (progress <= 0 || lunge.blocked || lunge.advanced >= lunge.distance) return;
    const p = zombie.group.position;
    const player = this.combatTarget?.eye ?? this.camera.position;
    if (lunge.advanced === 0) this.playSpatialCue("enemy-swing", p, p.distanceTo(player));
    const advanced = hunterPounceMotion(progress).travel * lunge.distance;
    const step = advanced - lunge.advanced;
    const x = p.x + Math.sin(attack.yaw) * step;
    const z = p.z + Math.cos(attack.yaw) * step;
    if (!clearSegment(p.x, p.z, x, z, this.obstacles)) {
      lunge.blocked = true;
      return;
    }
    const hit = !attack.resolved && this.combatPlayers().find(({ eye }) =>
      Math.abs(eye.y - 1.7 - p.y) < 1 &&
      hunterPounceHits(p.x, p.z, x, z, eye.x, eye.z) &&
      clearSegment(x, z, eye.x, eye.z, this.obstacles),
    );
    if (hit) {
      attack.resolved = true;
      this.enemyDamagePlayer(this.enemyDamage(zombie), hit.id);
    }
    p.x = x;
    p.z = z;
    lunge.advanced = advanced;
  }

  private animateZombieDeath(zombie: Zombie) {
    const death = zombie.death;
    if (!death) return;
    const seconds = this.elapsed - zombie.dead;
    const { start } = death;
    const { airborne, landed, height, stagger, collapse, settle, release } =
      zombieFallMotion(zombie.kind, seconds, start.y, death.fallSpeed);
    if (landed && death.landed && Math.abs(settle) < 0.001 && seconds > 1.5) {
      if (seconds > 5) zombie.group.visible = false;
      return;
    }
    const heavy = zombie.kind === "brute" || zombie.kind === "tank";
    const low = zombie.crawl && start.pose[5] < 0.58;
    const side = zombie.tumbleSign ?? 1;
    const direction = zombie.lastImpact ?? zombieImpactDirection(0, 0, start.yaw);
    const { forward, sideways } = zombieLocalImpact(direction.x, direction.z, start.yaw);
    const slide = (heavy ? 0.52 : 0.27) * collapse + (heavy ? 0.19 : 0.07) * stagger;
    const flutter = airborne ? Math.sin(seconds * 23) * (1 - collapse) * 0.32 : 0;
    const target = blendZombieMotion(start, {
      x: start.x + direction.x * slide,
      y: 0,
      z: start.z + direction.z * slide,
      yaw: start.yaw + side * (stagger * 0.23 + collapse * 0.12),
      pose: [
        forward * ((low ? 0.16 : 1.53) * collapse + 0.18 * stagger) + settle * 0.085,
        -sideways * (low ? 0.31 : 1.49) * collapse + side * (heavy ? 0.46 : 0.19) * stagger,
        low ? 1.46 : stagger * 0.18, 0, side * stagger * 0.11,
        low ? zombieCrawl.rigHeight : zombieRigHeight - stagger * (heavy ? 0.23 : 0.1),
        -stagger * 0.52, side * 0.22 * collapse, side * 0.20 * collapse,
        -0.18 - 0.78 * stagger, -0.28 * collapse - side * 0.34 * stagger,
        -0.43 - 0.51 * stagger, 0.22 * collapse - side * 0.22 * stagger,
        0.48 * stagger + 0.07 * collapse, -0.48 * stagger,
        -0.91 * collapse - flutter, 0.82 * collapse - flutter * 0.63, 1,
      ],
    }, release);
    if (airborne) target.y = height;
    else target.y = Math.max(0, target.y + settle * (heavy ? 0.046 : 0.026));
    const p = zombie.group.position;
    if (!clearSegment(p.x, p.z, target.x, target.z, this.obstacles)) {
      target.x = p.x;
      target.z = p.z;
    }
    this.renderZombieMotion(zombie, target);
    if (landed && !death.landed) {
      death.landed = true;
      this.playSpatialCue("fall", p, p.distanceTo(this.camera.position), heavy ? 1.75 : 1);
    }
  }

  private updateFlierFall(zombie: Zombie, dt: number) {
    if (
      zombie.airFallSpeed === undefined &&
      this.elapsed >= (zombie.groundedUntil ?? 0)
    )
      return false;
    const p = zombie.group.position;
    const descending = zombie.airFallSpeed !== undefined;
    if (descending) {
      const previousSpeed = zombie.airFallSpeed!;
      const speed = previousSpeed + 13 * dt;
      p.y = Math.max(0, p.y - (previousSpeed + speed) * 0.5 * dt);
      zombie.airFallSpeed = speed;
      if (p.y === 0) {
        zombie.airFallSpeed = undefined;
        zombie.groundedUntil = this.elapsed + 0.8;
        this.playSpatialCue("fall", p, p.distanceTo(this.camera.position));
      }
    }
    const smooth = THREE.MathUtils.smoothstep;
    const balance = smooth(this.elapsed - (zombie.airFallAt ?? this.elapsed), 0, 0.21) *
      (descending ? 1 : smooth((zombie.groundedUntil ?? this.elapsed) - this.elapsed, 0, 0.35));
    zombie.group.rotation.x -= 0.49 * balance;
    zombie.group.rotation.z += (zombie.tumbleSign ?? 1) * 0.62 * balance;
    const flap = Math.sin(this.elapsed * 15 + zombie.phase) * 0.66;
    zombie.wings?.forEach((wing, i) => {
      const flutter = Math.sin(this.elapsed * 23 + i) * 0.22 * smooth(p.y, 0, 0.35);
      wing.rotation.z = (i === 0 ? -1 : 1) * THREE.MathUtils.lerp(flap, 0.89 + flutter, balance);
    });
    return true;
  }

  private enemyDamage(zombie: Zombie) {
    const base =
      this.settings.difficulty === "recruit"
        ? 7
        : this.settings.difficulty === "veteran"
          ? 18
          : 12;
    return Math.round(enemyTypes[zombie.kind].damage * base);
  }

  private updateSpitter(zombie: Zombie, distance: number) {
    if (distance > 15 && zombie.spitAt === undefined) return false;
    const start = zombie.group.position
      .clone()
      .add(new THREE.Vector3(0, 1.48, 0));
    const target = (this.combatTarget?.eye ?? this.camera.position)
      .clone()
      .add(new THREE.Vector3(0, -0.43, 0));
    const direction = target.clone().sub(start);
    const travel = direction.length();
    if (travel < 0.001) return false;
    direction.divideScalar(travel);
    this.raycaster.set(start, direction);
    const wall = this.raycaster.intersectObjects(this.solidMeshes, true)[0];
    const clear = !wall || wall.distance > travel;
    if (zombie.spitAt === undefined) {
      if (!clear || distance < 1.5) return false;
      if (this.elapsed >= zombie.attack) {
        zombie.spitAt = this.elapsed + spitterWindupSeconds;
        this.playSpatialCue("spit-warn", zombie.group.position, distance);
      }
      return true;
    }
    const windup = THREE.MathUtils.clamp(
      1 - (zombie.spitAt - this.elapsed) / spitterWindupSeconds,
      0,
      1,
    );
    zombie.throat?.scale.setScalar(1.25 + windup * 0.85);
    zombie.group.rotation.x -= 0.23 + windup * 0.31;
    zombie.arms[0].rotation.x += 0.5 + windup * 0.36;
    zombie.arms[1].rotation.x += 0.5 + windup * 0.36;
    if (this.elapsed < zombie.spitAt) return true;
    zombie.spitAt = undefined;
    zombie.throat?.scale.setScalar(1);
    zombie.attack = this.elapsed + 2.65;
    if (!clear || distance > 17) return false;
    zombie.spitReleasedAt = this.elapsed;
    this.playSpatialCue("spit-release", zombie.group.position, distance);
    const mesh = this.makeSpitMesh();
    mesh.position.copy(start);
    this.spitBolts.push({
      mesh,
      velocity: direction.multiplyScalar(10),
      expires: this.elapsed + 1.8,
    });
    return true;
  }

  private playSpatialCue(
    kind: "spit-warn" | "spit-release" | "enemy-step" | "enemy-swing" |
      "enemy-brace" | "enemy-crouch" | "enemy-slam" |
      "impact-metal" | "impact-concrete" | "fall",
    source: THREE.Vector3,
    distance: number,
    stepWeight?: number,
  ) {
    const player = this.camera.position;
    const right =
      (source.x - player.x) * Math.cos(this.yaw) -
      (source.z - player.z) * Math.sin(this.yaw);
    this.sound(
      kind,
      distance,
      THREE.MathUtils.clamp(right / Math.max(distance, 1), -0.85, 0.85),
      stepWeight,
    );
  }

  private updateSpit(dt: number) {
    if (!this.spitBolts.length) return;
    const players = this.combatPlayers().map(({ id, eye }) => ({
      id,
      body: eye.clone().add(new THREE.Vector3(0, -0.43, 0)),
    }));
    for (let i = this.spitBolts.length - 1; i >= 0; i--) {
      const { mesh, velocity, expires } = this.spitBolts[i];
      const step = velocity.length() * dt;
      this.raycaster.set(mesh.position, velocity.clone().normalize());
      const wall = this.raycaster.intersectObjects(this.solidMeshes, true)[0];
      const distance = Math.min(step, wall?.distance ?? Infinity);
      const end = this.raycaster.ray.at(distance, new THREE.Vector3());
      const segment = new THREE.Line3(mesh.position, end);
      const nearest = new THREE.Vector3();
      const hit = (!wall || wall.distance > step) && players.find(({ body }) =>
        segment.closestPointToPoint(body, true, nearest).distanceToSquared(body) < 0.28,
      );
      if (hit || (wall && wall.distance <= step) || this.elapsed >= expires) {
        this.spitBolts.splice(i, 1);
        this.removeSpit(mesh);
        this.impact(hit ? nearest : end, "#badf67", 0.23);
        if (hit) {
          const damage =
            this.settings.difficulty === "recruit"
              ? 6
              : this.settings.difficulty === "veteran"
                ? 14
                : 9;
          this.enemyDamagePlayer(damage, hit.id);
          if (this.state.health === 0) return;
        }
      } else mesh.position.copy(end);
    }
  }

  private removeSpit(mesh: THREE.Mesh) {
    this.world.remove(mesh);
    mesh.geometry.dispose();
    (mesh.material as THREE.Material).dispose();
  }

  private makeSpitMesh() {
    const mesh = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.16, 1),
      new THREE.MeshBasicMaterial({ color: "#c5ec68" }),
    );
    this.world.add(mesh);
    return mesh;
  }

  private moveZombie(zombie: Zombie, speed: number, dt: number) {
    const p = zombie.group.position,
      player = this.combatTarget?.eye ?? this.camera.position;
    const navigation = this.combatTarget && this.roomNavigation.get(this.combatTarget.id);
    const target = chaseWaypoint(
      p.x,
      p.z,
      player.x,
      player.z,
      this.obstacles,
      navigation || this.navigation!,
    );
    const dx = target.x - p.x,
      dz = target.z - p.z;
    const distance = Math.hypot(dx, dz);
    if (distance <= 0.01) return;
    const gait = zombie.gait;
    gait.heading = Math.atan2(dx, dz);
    const pace = zombie.kind === "flier" || zombie.crawl ? 1 : 1 - 0.16 * Math.abs(zombie.limp ?? 0);
    const speedTarget = Math.min(speed * pace, distance / Math.max(dt, 0.001));
    const direction = steerZombieVelocity(gait.vx, gait.vz, dx / distance * speedTarget, dz / distance * speedTarget, dt);
    gait.vx = direction.x;
    gait.vz = direction.z;
    const step = Math.min(dt, distance / Math.max(0.001, Math.hypot(gait.vx, gait.vz)));
    const nx = gait.vx * step, nz = gait.vz * step;
    const beforeX = p.x,
      beforeZ = p.z;
    if (canOccupy(p.x + nx, p.z, this.obstacles)) p.x += nx;
    else gait.vx = 0;
    if (canOccupy(p.x, p.z + nz, this.obstacles)) p.z += nz;
    else gait.vz = 0;
    const travel = Math.hypot(p.x - beforeX, p.z - beforeZ);
    gait.travel += travel;
    const phase = advanceZombieGait(zombie.kind, gait.phase, travel, zombie.group.scale.y);
    const footfall = Math.floor(phase * 2) > Math.floor(gait.phase * 2);
    gait.phase = phase % 1;
    const { stepWeight } = zombieGaits[zombie.kind];
    if (footfall && stepWeight > 0 && !zombie.crawl) {
      const distanceToPlayer = p.distanceTo(this.camera.position);
      if (distanceToPlayer < 16)
        this.playSpatialCue("enemy-step", p, distanceToPlayer, stepWeight);
    }
  }

  private animate = (now: number) => {
    if (this.destroyed) return;
    this.frame = requestAnimationFrame(this.animate);
    const frameTime = (now - (this.lastTime || now)) / 1000;
    const dt = Math.min(frameTime, 0.04);
    this.lastTime = now;
    const playing = this.state.status === "playing" && this.roomConnected;
    if (playing && this.renderBudget.sample(frameTime, this.settings.prefer120)) this.applyRenderScale();
    const guest = this.room && !this.room.host;
    const hostingWhilePaused = this.room?.host && this.roomConnected && this.state.status === "paused";
    const recoilDecay = Math.exp(-dt * weapons[this.state.weaponId].fireFx.recovery);
    this.recoil *= recoilDecay;
    this.recoilSway *= recoilDecay;
    if (playing || hostingWhilePaused) {
      this.elapsed += dt;
      this.activeTime += this.room ? Math.min(frameTime, 0.15) : frameTime;
      if (!guest) this.state.seconds = Math.floor(this.activeTime);
      if (playing) this.updatePlayer(dt);
      else {
        this.updateSpit(dt);
        if (this.state.status !== "dead") this.updateObjectives(dt);
      }
    }
    const preview = this.state.status === "menu";
    if (!guest && ((playing && this.state.status === "playing") || hostingWhilePaused || preview))
      this.updateZombies(dt, preview ? now / 1000 : this.elapsed, !preview);
    if (guest) {
      for (const zombie of this.zombies) {
        const target = this.roomZombieTargets.get(zombie.networkId);
        if (!target || target.age >= target.duration) continue;
        target.age += Math.min(frameTime, 0.12);
        this.renderZombieMotion(zombie, blendZombieMotion(target.from, target.to, target.age / target.duration));
      }
    }
    if (this.room) this.roomAvatars.update(dt);
    this.state.hit = Math.max(0, this.state.hit - dt * 4);
    this.state.hurt = Math.max(0, this.state.hurt - dt * 2);
    this.state.aiming = this.ads;
    const dodgeAmount = this.dodge
      ? Math.sin(
          Math.PI *
            Math.min(
              1,
              (this.elapsed - this.dodge.startedAt) / dodgeTuning.seconds,
            ),
        )
      : 0;
    this.dodgeLean = THREE.MathUtils.lerp(
      this.dodgeLean,
      -(this.dodge?.lean ?? 0) * dodgeAmount * 0.14,
      1 - Math.exp(-dt * 24),
    );
    this.camera.rotation.set(
      this.pitch + this.recoil * (this.ads ? 0.013 : 0.022) - dodgeAmount * 0.045,
      this.yaw + this.recoilSway + (preview ? Math.sin(now * 0.000055) * 0.025 : 0),
      this.dodgeLean + this.recoilSway * 0.35,
      "YXZ",
    );
    const aiming = this.ads && playing && this.state.heldItem === "gun";
    const weaponSpec = weapons[this.state.weaponId];
    const targetFov = aiming ? weaponSpec.sight : this.dodge ? 74 : this.sprinting ? 72 : 68;
    if (this.camera.fov !== targetFov) {
      this.camera.fov = Math.abs(this.camera.fov - targetFov) < 0.02 ? targetFov :
        THREE.MathUtils.lerp(this.camera.fov, targetFov, 1 - Math.exp(-dt * 13));
      this.camera.updateProjectionMatrix();
    }
    const stride = playing ? Math.min(this.movement.length() / 4, 1) : 0;
    const bob =
      Math.sin(this.stepPhase * 2) * stride * 0.012 +
      Math.sin(now * 0.0015) * 0.003;
    this.sprintPose = THREE.MathUtils.lerp(
      this.sprintPose,
      this.sprinting && playing ? 1 : 0,
      1 - Math.exp(-dt * 11),
    );
    const run = this.sprintPose;
    this.reloadPose = THREE.MathUtils.lerp(
      this.reloadPose,
      this.state.reloading ? (this.state.weaponId === "shotgun" ? 0.57 : 0.72) : 0,
      1 - Math.exp(-dt * 14),
    );
    const gunHeld = this.state.heldItem === "gun";
    const reload = gunHeld ? this.reloadPose : 0;
    this.weapon.position.z -= this.recoilTravel;
    this.weapon.position.lerp(
      new THREE.Vector3(
        (aiming ? 0 : preview ? 0.38 : gunHeld ? 0.24 - reload * 0.14 : 0.26) +
          run * (0.07 + Math.sin(this.stepPhase) * 0.026),
        (aiming ? -0.151 : gunHeld ? -0.21 + reload * 0.06 : -0.29) +
          bob -
          run * 0.24 -
          dodgeAmount * 0.17,
        (aiming ? -0.3 : gunHeld ? -0.72 - reload * 0.27 : -0.53) + run * 0.1,
      ),
      1 - Math.exp(-dt * 14),
    );
    this.recoilTravel = this.recoil * (aiming ? 0.027 : 0.052);
    this.weapon.position.z += this.recoilTravel;
    this.weapon.rotation.set(
      reload * -0.18 + this.recoil * 0.074 - run * 0.32,
      reload * (this.state.weaponId === "shotgun" ? 0.86 : -0.35) + run * 0.29,
      reload * -0.8 +
        (preview ? -0.08 : 0) + this.recoil * (aiming ? 0.007 : 0.023) +
        run * (0.29 + Math.sin(this.stepPhase) * 0.09),
    );
    this.animateEquipment(dt);
    this.animateReload();
    this.animateKnife();
    this.updateShotEffects(dt);
    this.surfaceEffects.update(dt);
    this.dust.rotation.y = now * 0.000006;
    for (let i = this.impacts.length - 1; i >= 0; i--) {
      const p = this.impacts[i];
      p.life -= dt;
      p.mesh.scale.addScalar(dt * 5);
      if (p.life <= 0) {
        this.world.remove(p.mesh);
        p.mesh.geometry.dispose();
        (p.mesh.material as THREE.Material).dispose();
        this.impacts.splice(i, 1);
      }
    }
    this.updateContactShadows();
    this.shadowFrame = !this.shadowFrame;
    if (this.renderer.shadowMap.enabled) {
      const adaptiveLimit = this.staticShadows ? 0.94 : 0.83;
      this.setStaticShadows(this.settings.prefer120 || this.renderBudget.scale < adaptiveLimit);
      const shadowInterval = this.coarse ? 47 : 30;
      if (!this.staticShadows && this.shadowFrame && now - this.lastShadow >= shadowInterval) {
        this.lastShadow = now;
        this.renderer.shadowMap.needsUpdate = true;
      }
    }
    this.renderer.render(this.scene, this.camera);
    if (playing && this.state.status === "playing") this.sampleFps(now);
    else if (this.fpsWindowStart !== null) this.resetFps();
    if (playing && now - this.lastSnapshot > 90) {
      this.lastSnapshot = now;
      this.publish();
    }
  };

  private sampleFps(now: number) {
    if (this.fpsWindowStart === null) {
      this.fpsWindowStart = now;
      return;
    }
    this.fpsFrameCount++;
    const elapsed = now - this.fpsWindowStart;
    if (elapsed < 250) return;
    this.state.fps = Math.round(this.fpsFrameCount * 1000 / elapsed);
    this.fpsWindowStart = now;
    this.fpsFrameCount = 0;
  }

  private resetFps() {
    this.fpsWindowStart = null;
    this.fpsFrameCount = 0;
    this.state.fps = null;
  }

  private animateEquipment(dt: number) {
    const grenade = this.equipmentModels.get("grenade")!;
    const windup = this.state.throwProgress ?? 0;
    const follow = Math.max(
      0,
      (this.throwFollowThroughUntil - this.elapsed) / 0.34,
    );
    const swinging = follow > 0;
    const returnArc = swinging ? Math.sin(follow * Math.PI * 0.75) : 0;
    const ease = 1 - Math.exp(-dt * 18);
    grenade.position.lerp(
      new THREE.Vector3(
        -0.06 + windup * 0.19 - returnArc * 0.13,
        0.04 + windup * 0.11 + returnArc * 0.16,
        -0.25 + windup * 0.14 - returnArc * 0.23,
      ),
      swinging ? 1 - Math.exp(-dt * 30) : ease,
    );
    grenade.rotation.set(
      windup * 0.65 - returnArc * 0.62,
      -windup * 0.35,
      -0.13 + windup * 0.54 - returnArc * 0.38,
    );
    if (this.grenadeInHand)
      this.grenadeInHand.visible = !swinging && this.state.grenades > 0;
    if (this.throwHand) this.throwHand.rotation.x = -0.12 - returnArc * 0.55;
    this.injectorView.model.visible = this.state.heldItem === "medkit" && this.state.medkits > 0;
    if (this.injectorView.model.visible)
      this.injectorView.pose((this.state.healProgress ?? 0) * healingSeconds);
    const can = this.equipmentModels.get("energy")!;
    const drinking = this.state.drinkProgress !== null;
    const time = (this.state.drinkProgress ?? 0) * drinkingSeconds;
    const smooth = THREE.MathUtils.smoothstep;
    const present =
      smooth(time, 0, 0.24) * (1 - smooth(time, 1.42, drinkingSeconds));
    const lift =
      smooth(time, 0.46, 0.86) * (1 - smooth(time, 1.38, drinkingSeconds));
    const tabLift = smooth(time, 0.27, drinkOpeningSeconds);
    can.position.set(
      -0.06 - present * 0.085 - lift * 0.08,
      0.04 + present * 0.085 + lift * 0.17,
      -0.25 + lift * 0.28,
    );
    can.rotation.set(0.92 * lift, -0.18 * present, -0.13 - 0.13 * lift);
    can.children[0].visible = this.state.energy > 0;
    if (this.canTab) this.canTab.rotation.x = -Math.PI / 2 + 1.04 * tabLift;
    if (this.canOpeningHand) {
      const reach = smooth(time, 0.06, 0.26) * (1 - smooth(time, 0.43, 0.64));
      this.canOpeningHand.visible = drinking && time < 0.64;
      this.canOpeningHand.position.set(
        -0.24 + reach * 0.19,
        0.03 + reach * (0.065 + tabLift * 0.038),
        0.1 - reach * 0.035,
      );
      this.canOpeningHand.rotation.set(-0.21 + tabLift * 0.27, 0.48, -0.32);
    }
  }

  private animateKnife() {
    const swing = this.state.status === "playing" ? this.knifeSwing : null;
    this.knifeView.visible = swing !== null;
    this.weapon.visible = swing === null;
    if (!swing) return;

    const age = this.elapsed - swing.startedAt;
    const smooth = THREE.MathUtils.smoothstep;
    const cut = smooth(age, 0.09, 0.25);
    const recover = smooth(age, 0.27, knifeTuning.swingSeconds);
    const lift = smooth(age, 0, 0.09) * (1 - recover);
    this.knifeView.position.set(
      THREE.MathUtils.lerp(0.31 - 0.62 * cut, 0.31, recover),
      -0.5 + lift * 0.34 - cut * (1 - recover) * 0.08,
      -0.5 - lift * 0.1,
    );
    this.knifeView.rotation.set(-0.38 + lift * 0.22, -0.37 + cut * 0.72, 0.46 - cut * 1.56);
  }

  private animateReload() {
    const active = this.state.reloading && this.state.heldItem === "gun";
    const scoped =
      this.state.aiming &&
      this.state.status === "playing" &&
      this.state.weaponId === "marksman";
    const p = this.state.reloadProgress ?? 0;
    const selected = this.state.weaponId;
    const swap = magazineReloadPose(p);
    let magazine: THREE.Object3D | undefined;
    for (const [id, model] of this.weaponModels) {
      const current = this.state.heldItem === "gun" && id === selected;
      model.visible = current && !scoped;
      const mag = model.getObjectByName("reload-magazine");
      if (mag) {
        mag.position.copy(mag.userData.restPosition);
        mag.rotation.copy(mag.userData.restRotation);
        if (active && current) {
          magazine = mag;
          mag.position.x -= 0.11 * swap.away;
          mag.position.y -= 0.25 * swap.away;
          mag.position.z += 0.1 * swap.away;
          mag.rotation.z -= 0.22 * swap.away;
          mag.visible = swap.visible;
        } else mag.visible = true;
      }
    }
    const hand = this.weaponHands.support;
    hand.visible = this.state.heldItem === "gun" && !scoped;
    this.reloadShell.visible = false;
    if (!hand.visible) return;
    const short = selected === "sidearm";
    hand.position.set(short ? -0.027 : -0.006, short ? -0.121 : -0.074, short ? -0.039 : -0.47);
    hand.rotation.set(-0.13, short ? -0.24 : -0.04, short ? 0.35 : 0.13);
    if (magazine) {
      hand.position.lerp(new THREE.Vector3(
        magazine.position.x - (selected === "lmg" ? 0.031 : 0),
        magazine.position.y - (short ? 0.025 : 0.047),
        magazine.position.z + 0.026,
      ), swap.reach);
      hand.rotation.set(
        THREE.MathUtils.lerp(hand.rotation.x, magazine.rotation.x - 0.14, swap.reach),
        THREE.MathUtils.lerp(hand.rotation.y, -0.27, swap.reach),
        THREE.MathUtils.lerp(hand.rotation.z, magazine.rotation.z + 0.41, swap.reach),
      );
      this.weaponHands.grasp(THREE.MathUtils.lerp(0.78, 0.24 + 0.76 * swap.grip, swap.reach));
    } else if (active && selected === "shotgun") {
      const shell = shellReloadPose(p);
      const target = new THREE.Vector3(-0.13, -0.302, 0.09)
        .lerp(new THREE.Vector3(-0.017, -0.12, -0.195), shell.lift)
        .lerp(new THREE.Vector3(0.013, -0.071, -0.3), shell.push);
      hand.position.lerp(target, shell.reach);
      hand.rotation.set(-0.13 + 0.35 * shell.reach * (1 - shell.push), 0.17 * shell.reach * (1 - shell.lift), 0.13 + 0.2 * shell.reach * (1 - shell.push));
      this.weaponHands.grasp(0.76 - 0.42 * shell.reach, shell.pinch);
      this.reloadShell.visible = shell.visible;
    } else {
      this.weaponHands.grasp(0.78);
    }
  }

  private publish() {
    if (this.destroyed) return;
    const inventory = weaponSlots.flatMap((id) => {
      const rounds = this.arsenal[id];
      return rounds ? [{ id, total: rounds.ammo + rounds.reserve }] : [];
    });
    const guest = this.room && !this.room.host;
    const boss = guest ? this.state.boss : this.boss && {
      kind: this.boss.kind,
      health: Math.max(0, this.boss.zombie.health),
      maxHealth: this.boss.maxHealth,
      warning: !!this.boss.attack,
    };
    const spitWarning = guest ? this.state.spitWarning : this.zombies.some(
      (zombie) =>
        zombie.health > 0 &&
        zombie.spitAt !== undefined &&
        zombie.group.position.distanceToSquared(this.camera.position) <=
          18 ** 2,
    );
    this.onSnapshot({
      ...this.state,
      ...this.currentAmmo,
      inventory,
      boss,
      spitWarning,
    });
  }

  dispose() {
    this.destroyed = true;
    this.clearZombies();
    this.roomAvatars.dispose();
    this.zombieModels.dispose();
    this.clearShotEffects();
    this.surfaceEffects.dispose();
    this.shotSmokeTexture?.dispose();
    cancelAnimationFrame(this.frame);
    this.observer.disconnect();
    window.removeEventListener("keydown", this.keydown);
    window.removeEventListener("keyup", this.keyup);
    window.removeEventListener("mousemove", this.mousemove);
    window.removeEventListener("mousedown", this.mousedown);
    window.removeEventListener("mouseup", this.mouseup);
    window.removeEventListener("blur", this.blur);
    document.removeEventListener("pointerlockchange", this.pointerlock);
    document.removeEventListener("visibilitychange", this.visibility);
    this.host.removeEventListener("contextmenu", this.contextmenu);
    if (document.pointerLockElement === this.renderer.domElement)
      document.exitPointerLock();
    const disposedMaterials = new Set<THREE.Material>();
    this.scene.traverse((o) => {
      if (o instanceof THREE.DirectionalLight) o.shadow.dispose();
      if (o instanceof THREE.InstancedMesh) o.dispose();
      if (
        o instanceof THREE.Mesh ||
        o instanceof THREE.Points ||
        o instanceof THREE.Line
      ) {
        o.geometry.dispose();
        const list = Array.isArray(o.material) ? o.material : [o.material];
        for (const material of list) {
          if (disposedMaterials.has(material)) continue;
          disposedMaterials.add(material);
          if ("map" in material && material.map instanceof THREE.Texture)
            material.map.dispose();
          material.dispose();
        }
      }
    });
    for (const material of this.materials.values()) {
      if (!disposedMaterials.has(material)) material.dispose();
    }
    this.materials.clear();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    void this.audio?.close();
  }
}
