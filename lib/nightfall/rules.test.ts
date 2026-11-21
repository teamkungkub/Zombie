import assert from "node:assert/strict";
import { test } from "node:test";
import { dodgeDistanceAt, dodgeTuning, movementInWorld } from "./movement.ts";
import { healingSeconds, injectionPose, injectionTiming, nextHeldItem, throwCharge } from "./equipment.ts";
import { advanceZombieGait, blendZombieMotion, steerZombieVelocity, turnZombieToward, zombieCrawl, zombieCrawlThreshold, zombieCrawlTransition, zombieFallMotion, zombieGaits, zombieGaitPose, zombieImpactDirection, zombieImpactMotion, zombieLocalImpact } from "./zombie-motion.ts";
import { hunterPounceHits, hunterPounceMotion, zombieMelee } from "./zombie-attack.ts";
import { magazineReloadPose, shellReloadPose } from "./reload-motion.ts";
import { RenderBudget, renderPixelLimit } from "./render-quality.ts";
import {
  collectWeapon,
  loadShotgunShell,
  collectAmmoDrop,
  rollAmmoDrop,
  weapons,
  type Arsenal,
} from "./weapons.ts";
import {
  damageForHit,
  reloadAmmo,
  waveSize,
  canOccupy,
  buildNavigationField,
  chaseWaypoint,
  stagePlan,
  stageLoadout,
  objectiveAt,
  nextCheckpoint,
  crossedGate,
  zoneForStage,
  zombieHitAmount,
  meleeStrikeHits,
  bossAttackHits,
  nextStagePhase,
} from "./rules.ts";

test("render resolution limits high-DPI buffers and lowers scale during sustained slow frames", () => {
  assert.ok(renderPixelLimit(3840, 2160, 2, false, true) < 0.6);
  assert.equal(renderPixelLimit(1280, 720, 2, false, true), 1.5);
  assert.equal(renderPixelLimit(1280, 720, 2, false, false), 1);
  const budget = new RenderBudget();
  for (let i = 0; i < 200; i++) budget.sample(1 / 30, false);
  assert.equal(budget.scale, 0.63);
  assert.equal(budget.sample(1, false), false);
  for (let i = 0; i < 60; i++) budget.sample(1 / 60, false);
  assert.equal(budget.scale, 0.63);
  for (let i = 0; i < 250; i++) budget.sample(1 / 60, false);
  assert.ok(budget.scale > 0.63);
});

test("120 FPS mode reduces resolution sooner and automatic mode detects high-refresh frames", () => {
  const preferred = new RenderBudget();
  const automatic = new RenderBudget();
  for (let i = 0; i < 100; i++) {
    preferred.sample(1 / 60, true);
    automatic.sample(1 / 60, false);
  }
  assert.ok(preferred.scale < 1);
  assert.equal(automatic.scale, 1);
  for (let i = 0; i < 120; i++) automatic.sample(1 / 120, false);
  assert.equal(automatic.scale, 1);
  for (let i = 0; i < 100; i++) automatic.sample(1 / 90, false);
  assert.ok(automatic.scale < 1);
});

test("dodge follows the movement direction relative to the camera and caps its travel", () => {
  assert.equal(movementInWorld(-1, 0, 0).z, 1);
  assert.equal(movementInWorld(0, 1, 0).x, 1);
  assert.ok(Math.abs(movementInWorld(1, 0, Math.PI / 2).x + 1) < 1e-9);
  assert.equal(dodgeDistanceAt(0), 0);
  assert.ok(dodgeDistanceAt(0.11) > dodgeTuning.distance / 2);
  assert.equal(dodgeDistanceAt(5), dodgeTuning.distance);
});

test("zombie gait uses distance and reports a footfall when it crosses a planted step", () => {
  assert.equal(advanceZombieGait("brute", 0.49, 0, 1), 0.49);
  const step = advanceZombieGait("brute", 0.49, 0.1, 1.45);
  assert.equal(Math.floor(step * 2), 1);
  assert.ok(advanceZombieGait("brute", 0, 1, 1.45) < advanceZombieGait("standard", 0, 1, 1));
  assert.ok(zombieGaits.brute.stepWeight > zombieGaits.hunter.stepWeight);
  assert.equal(zombieGaits.flier.stepWeight, 0);
});

test("hunters lean and stride farther while heavy zombies sway, then settle as movement stops", () => {
  const hunter = zombieGaitPose("hunter", 0.25, 1);
  const brute = zombieGaitPose("brute", 0.25, 1);
  const tank = zombieGaitPose("tank", 0.25, 1);
  const idle = zombieGaitPose("hunter", 0.25, 0);
  assert.ok(hunter.lean > brute.lean * 3);
  assert.ok(Math.abs(hunter.leftLeg) > Math.abs(brute.leftLeg));
  assert.ok(brute.roll > hunter.roll);
  assert.ok(tank.leftLeg < brute.leftLeg);
  assert.ok(idle.lean < hunter.lean);
  assert.equal(idle.leftLeg, 0);
});

test("zombie steering turns gradually, using the short path across the angle seam", () => {
  const current = Math.PI - 0.05;
  const target = -Math.PI + 0.05;
  const heading = turnZombieToward(current, target, 1 / 60);
  assert.ok(heading > current && heading < current + 0.1);
  assert.ok(Math.abs(turnZombieToward(0, Math.PI, 1 / 60)) <= 0.15);
  const step = steerZombieVelocity(2, 0, 0, 2, 1 / 60);
  assert.ok(step.x > 0 && step.x < 2 && step.z > 0 && step.z < 2);
});

test("remote zombie joints and position blend together and pounces ease into the landing", () => {
  const from = { x: 0, y: 0, z: 0, yaw: Math.PI - 0.1, pose: [0, 1] };
  const to = { x: 2, y: 0, z: 0, yaw: -Math.PI + 0.1, pose: [1, -1] };
  const halfway = blendZombieMotion(from, to, 0.5);
  assert.equal(halfway.x, 1);
  assert.ok(Math.abs(halfway.yaw - Math.PI) < 0.001);
  assert.deepEqual(halfway.pose, [0.5, 0]);
  assert.equal(blendZombieMotion(from, to, 2).x, to.x);
  assert.deepEqual(hunterPounceMotion(0), { travel: 0, lift: 0 });
  assert.ok(hunterPounceMotion(0.1).travel < 0.1);
  assert.ok(hunterPounceMotion(0.9).travel > 0.9);
  assert.deepEqual(hunterPounceMotion(1), { travel: 1, lift: 0 });
});

test("a melee swing misses players who back away or sidestep its locked direction", () => {
  assert.equal(meleeStrikeHits(0, 0, 1.1, 1.5), true);
  assert.equal(meleeStrikeHits(0, 0, 1.55, 1.5), false);
  assert.equal(meleeStrikeHits(0, 1.1, 0.35, 1.5), false);
  assert.equal(meleeStrikeHits(0, 0, -1, 1.5), false);
  assert.equal(meleeStrikeHits(Math.PI / 2, 1.4, 0, 1.5), true);
});

test("a hunter's pounce hits along the traveled segment and misses a sidestep", () => {
  assert.equal(hunterPounceHits(0, 0, 0, 2, 0, 1), true);
  assert.equal(hunterPounceHits(0, 0, 0, 2, 0.8, 1), false);
  assert.equal(hunterPounceHits(0, 0, 0, 2, 0, 3), false);
  assert.equal(hunterPounceHits(0, 0, 0, 0, 0, 0.5), true);
  assert.ok(zombieMelee.brute.arc < zombieMelee.tank.arc);
});

test("hit reactions settle back to the ordinary pose", () => {
  assert.equal(zombieHitAmount(-0.01), 0);
  assert.ok(zombieHitAmount(0.08) > zombieHitAmount(0.24));
  assert.equal(zombieHitAmount(0.32), 0);
});

test("a leg hit shortens the stride on its own side and incoming direction follows the zombie's heading", () => {
  const phase = 0.25;
  const ordinary = zombieGaitPose("standard", phase, 1);
  const left = zombieGaitPose("standard", phase, 1, -1);
  const right = zombieGaitPose("standard", phase, 1, 1);
  assert.ok(Math.abs(left.leftLeg) < Math.abs(ordinary.leftLeg));
  assert.equal(left.rightLeg, ordinary.rightLeg);
  assert.equal(right.leftLeg, ordinary.leftLeg);
  assert.ok(Math.abs(right.rightLeg) < Math.abs(ordinary.rightLeg));
  const incoming = zombieImpactDirection(0, -3, 0);
  assert.deepEqual(incoming, { x: 0, z: -1 });
  const local = zombieLocalImpact(incoming.x, incoming.z, Math.PI / 2);
  assert.ok(Math.abs(local.forward) < 0.001);
  assert.equal(local.sideways, 1);
});

test("a crawler braces while lowering and settles into its ground pose after repeated leg hits", () => {
  assert.equal(zombieCrawlThreshold("standard"), 2);
  assert.equal(zombieCrawlThreshold("hunter"), 2);
  assert.equal(zombieCrawlThreshold("brute"), 3);
  assert.equal(zombieCrawlThreshold("tank"), 3);
  assert.deepEqual(zombieCrawlTransition(0), { lower: 0, brace: 0 });
  const dropping = zombieCrawlTransition(0.29);
  assert.ok(dropping.lower > 0 && dropping.lower < 1);
  assert.equal(dropping.brace, 1);
  assert.deepEqual(zombieCrawlTransition(zombieCrawl.collapseSeconds), { lower: 1, brace: 0 });
});

test("a heavy zombie staggers before falling and an airborne zombie preserves its fall velocity", () => {
  assert.equal(zombieImpactMotion(0), 0);
  assert.ok(zombieImpactMotion(0.04) > 0);
  assert.equal(zombieImpactMotion(0.36), 0);
  const bracing = zombieFallMotion("tank", 0.21, 0, 0);
  assert.equal(bracing.collapse, 0);
  assert.ok(bracing.stagger > 0.95);
  assert.equal(zombieFallMotion("tank", 0.8, 0, 0).landed, false);
  const impact = zombieFallMotion("tank", 0.96, 0, 0);
  assert.equal(impact.landed, true);
  assert.equal(impact.collapse, 1);
  assert.equal(impact.settle, 0);
  const start = zombieFallMotion("flier", 0, 2.65, 2);
  assert.equal(start.release, 0);
  assert.equal(start.height, 2.65);
  const continuing = zombieFallMotion("flier", 0.1, 2.65, 2);
  assert.ok(continuing.height < zombieFallMotion("flier", 0.1, 2.65, 0).height);
  assert.equal(zombieFallMotion("flier", 1, 2.65, 2).height, 0);
  assert.equal(zombieFallMotion("flier", 1, 2.65, 2).landed, true);
});

test("shotgun reload commits exactly one shell per step and stops at capacity or empty reserve", () => {
  const rounds = { ammo: 4, reserve: 3 };
  assert.equal(loadShotgunShell(rounds, 6), true);
  assert.deepEqual(rounds, { ammo: 5, reserve: 2 });
  assert.equal(loadShotgunShell(rounds, 6), false);
  assert.equal(loadShotgunShell(rounds, 6), false);
  assert.deepEqual(rounds, { ammo: 6, reserve: 1 });
  const last = { ammo: 1, reserve: 1 };
  assert.equal(loadShotgunShell(last, 6), false);
  assert.deepEqual(last, { ammo: 2, reserve: 0 });
});

test("reload poses keep the equipment visible while it is held and release it at the receiver", () => {
  assert.equal(magazineReloadPose(0).away, 0);
  const removing = magazineReloadPose(0.34);
  assert.ok(removing.away > 0 && removing.grip === 1 && removing.visible);
  assert.equal(magazineReloadPose(0.51).visible, false);
  assert.equal(magazineReloadPose(0.7).visible, true);
  assert.equal(magazineReloadPose(0.9).away, 0);
  assert.equal(magazineReloadPose(1).reach, 0);
  assert.equal(shellReloadPose(0).visible, false);
  assert.equal(shellReloadPose(0.36).visible, true);
  assert.equal(shellReloadPose(0.78).push, 1);
  assert.equal(shellReloadPose(0.83).visible, false);
  assert.equal(shellReloadPose(1).reach, 0);
});

test("later stages add a runner, then flyers, then ranged enemies", () => {
  const plan = (stage: number) => stagePlan(stage, "survivor").enemies;
  assert.ok(plan(2).includes("hunter"));
  assert.ok(!plan(2).includes("flier") && plan(3).includes("flier"));
  assert.ok(!plan(3).includes("spitter") && plan(4).includes("spitter"));
});

test("Q skips empty supplies and wraps back to the gun", () => {
  const stock = { grenade: 0, medkit: 2, energy: 1 };
  assert.equal(nextHeldItem("gun", stock), "medkit");
  assert.equal(nextHeldItem("medkit", stock), "energy");
  assert.equal(nextHeldItem("energy", stock), "gun");
  assert.equal(
    nextHeldItem("gun", { grenade: 0, medkit: 0, energy: 0 }),
    "gun",
  );
  assert.equal(throwCharge(-1), 0);
  assert.ok(throwCharge(0.75) > throwCharge(0.25));
  assert.equal(throwCharge(2), 1);
});

test("the injector arm rises before contact and the plunger moves only while the injector is seated", () => {
  assert.equal(injectionPose(0).arm, 0);
  assert.equal(injectionPose(injectionTiming.liftEnd).arm, 1);
  assert.equal(injectionPose(injectionTiming.contact).seat, 1);
  assert.equal(injectionPose(injectionTiming.contact).press, 0);
  const pressing = injectionPose((injectionTiming.contact + injectionTiming.pressEnd) / 2);
  assert.equal(pressing.seat, 1);
  assert.ok(pressing.press > 0 && pressing.press < 1);
  assert.equal(injectionPose(injectionTiming.withdrawEnd).seat, 0);
  assert.equal(injectionPose(healingSeconds).arm, 0);
});

test("every zone requires its own boss before unlocking the exit", () => {
  assert.equal(nextStagePhase(1, false), "combat");
  assert.equal(nextStagePhase(0, false), "boss");
  assert.equal(nextStagePhase(0, true), "exit");
  const plans = Array.from({ length: 4 }, (_, i) =>
    stagePlan(i + 1, "survivor"),
  );
  assert.equal(new Set(plans.map((plan) => plan.bossKind)).size, 4);
  assert.ok(plans.every((plan) => plan.bossHealth > 440));
});

test("boss warning areas distinguish the charge lane, cone and circles", () => {
  const strike = { x: 0, z: 0, dx: 1, dz: 0, length: 8 };
  assert.equal(bossAttackHits("slam", strike, -3, 0), true);
  assert.equal(bossAttackHits("mortar", strike, -3, 0), false);
  assert.equal(bossAttackHits("charge", strike, 6, 2), false);
  assert.equal(bossAttackHits("spores", strike, 6, 2), true);
  assert.equal(bossAttackHits("spores", strike, -2, 0), false);
  assert.equal(bossAttackHits("charge", strike, 8.2, 0), false);
});

test("zombie drops are infrequent, small, and go only to the matching reserve", () => {
  const arsenal: Arsenal = {
    rifle: { ammo: 12, reserve: 9 },
    shotgun: { ammo: 2, reserve: 0 },
  };
  assert.equal(
    rollAmmoDrop(arsenal, () => 0.2),
    null,
  );
  const rolls = [0.19, 0.99];
  const drop = rollAmmoDrop(arsenal, () => rolls.shift()!);
  assert.deepEqual(drop, { weaponId: "shotgun", rounds: 1 });
  assert.equal(collectAmmoDrop(arsenal, drop!), true);
  assert.deepEqual(arsenal.shotgun, { ammo: 2, reserve: 1 });
  assert.deepEqual(arsenal.rifle, { ammo: 12, reserve: 9 });
  assert.equal(collectAmmoDrop(arsenal, { weaponId: "lmg", rounds: 4 }), false);
});

test("revisiting a weapon crate does not remove reserve rounds collected as drops", () => {
  const arsenal: Arsenal = { shotgun: { ammo: 2, reserve: 25 } };
  assert.deepEqual(collectWeapon(arsenal, "shotgun"), {
    unlocked: false,
    added: 0,
  });
  assert.deepEqual(arsenal.shotgun, { ammo: 2, reserve: 25 });
});

test("zone weapons have independent limited ammunition and capped pickup refills", () => {
  const ids = Array.from({ length: 4 }, (_, i) => zoneForStage(i + 1).weapon);
  assert.equal(new Set(ids).size, 4);
  const arsenal: Arsenal = { rifle: { ammo: 12, reserve: 9 } };
  assert.equal(collectWeapon(arsenal, "shotgun").unlocked, true);
  arsenal.shotgun = reloadAmmo(2, 4, weapons.shotgun.capacity);
  assert.deepEqual(arsenal.shotgun, { ammo: 6, reserve: 0 });
  for (let i = 0; i < 5; i++) collectWeapon(arsenal, "shotgun");
  assert.equal(arsenal.shotgun.reserve, 24);
  assert.deepEqual(arsenal.rifle, { ammo: 12, reserve: 9 });
});

test("the next arena requires walking through the unlocked gate", () => {
  assert.notEqual(zoneForStage(1).code, zoneForStage(2).code);
  assert.notEqual(zoneForStage(4).code, zoneForStage(5).code);
  const marker = nextCheckpoint(2);
  assert.equal(crossedGate(2, marker.x, marker.z, true), false);
  assert.equal(crossedGate(2, marker.x, -24, false), false);
  assert.equal(crossedGate(2, marker.x + 3, -24, true), false);
  assert.equal(crossedGate(2, marker.x, -24, true), true);
});

test("the next stage requires both an empty field and arrival before the deadline", () => {
  assert.equal(objectiveAt(1, 20, 0), "continue");
  assert.equal(objectiveAt(0, 20, 2.1), "continue");
  assert.equal(objectiveAt(0, 20, 2), "advance");
  assert.equal(objectiveAt(0, 0, 0), "timeout");
  assert.notDeepEqual(nextCheckpoint(1), nextCheckpoint(2));
});

test("stages add larger enemies and budget finite ammunition by the roster", () => {
  const first = stagePlan(1, "survivor");
  const second = stagePlan(2, "survivor");
  const later = stagePlan(5, "survivor");
  assert.ok(first.enemies.every((kind) => kind === "standard"));
  assert.ok(second.enemies.includes("brute"));
  assert.ok(later.enemies.includes("hunter") && later.enemies.includes("tank"));
  assert.ok(later.ammo > second.ammo && second.ammo > first.ammo);
  assert.ok(later.time < first.time);
  assert.deepEqual(stageLoadout(7, 5, 35), { ammo: 7, reserve: 28 });
  assert.deepEqual(stageLoadout(7, 30, 35), { ammo: 7, reserve: 30 });
});

test("headshots kill a standard zombie while body hits require three shots", () => {
  assert.ok(damageForHit(true) >= 100);
  assert.ok(damageForHit(false) * 2 < 100);
  assert.ok(damageForHit(false) * 3 >= 100);
});
test("reloading conserves ammunition and respects available reserve", () => {
  assert.deepEqual(reloadAmmo(7, 90), { ammo: 30, reserve: 67 });
  assert.deepEqual(reloadAmmo(25, 3), { ammo: 28, reserve: 0 });
  assert.deepEqual(reloadAmmo(30, 90), { ammo: 30, reserve: 90 });
});
test("waves become harder but stay bounded for browser performance", () => {
  assert.ok(waveSize(2) > waveSize(1));
  assert.ok(waveSize(100) <= 24);
});
test("movement cannot cross the yard boundary or walk inside solid cover", () => {
  const obstacles = [{ x: 2, z: 2, w: 4, d: 4 }];
  assert.equal(canOccupy(2, 2, obstacles), false);
  assert.equal(canOccupy(28, 0, []), false);
  assert.equal(canOccupy(-5, -5, obstacles), true);
});

test("a zombie navigates around a container rather than getting stuck against it", () => {
  const obstacles = [{ x: 9, z: -9, w: 3.3, d: 8.2 }];
  const field = buildNavigationField(9, 0, obstacles);
  let x = 10,
    z = -15;
  for (let frame = 0; frame < 2400 && Math.hypot(x - 9, z) > 1; frame++) {
    const target = chaseWaypoint(x, z, 9, 0, obstacles, field);
    const distance = Math.hypot(target.x - x, target.z - z);
    if (!distance) continue;
    const dx = ((target.x - x) / distance) * 0.035;
    const dz = ((target.z - z) / distance) * 0.035;
    if (canOccupy(x + dx, z, obstacles)) x += dx;
    if (canOccupy(x, z + dz, obstacles)) z += dz;
    assert.ok(
      canOccupy(x, z, obstacles),
      "enemy must not walk through solid cover",
    );
  }
  assert.ok(Math.hypot(x - 9, z) <= 1, `enemy stopped at ${x}, ${z}`);
});

test("navigation still reaches a player standing close to cover", () => {
  const obstacles = [{ x: 9, z: -9, w: 3.3, d: 8.2 }];
  const field = buildNavigationField(9, -13.5, obstacles);
  assert.ok(field.distances.some((distance) => distance === 0));
  const next = chaseWaypoint(9, -17, 9, -13.5, obstacles, field);
  assert.ok(next.z > -17);
});
