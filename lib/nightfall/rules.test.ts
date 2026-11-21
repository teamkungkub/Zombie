import assert from "node:assert/strict";
import { test } from "node:test";
import { dodgeDistanceAt, dodgeTuning, movementInWorld } from "./movement.ts";
import { healingSeconds, injectionPose, injectionTiming, nextHeldItem, throwCharge } from "./equipment.ts";
import { advanceZombieGait, zombieGaits, zombieGaitPose } from "./zombie-motion.ts";
import { hunterPounceHits, zombieMelee } from "./zombie-attack.ts";
import { magazineReloadPose, shellReloadPose } from "./reload-motion.ts";
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
