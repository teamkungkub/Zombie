import * as THREE from "three";
import { SurvivorModels } from "./survivor-models";
import type { CharacterId, RoomPlayer, RoomPose } from "./room-protocol";

type RemotePlayer = ReturnType<SurvivorModels["create"]> & {
  character: CharacterId;
  pose: RoomPose;
  eye: THREE.Vector3;
  gait: number;
  flash: THREE.Mesh;
  flashTime: number;
};

export class RoomAvatars {
  readonly root = new THREE.Group();
  readonly players = new Map<string, RemotePlayer>();
  private models = new SurvivorModels();
  private flashGeometry = new THREE.IcosahedronGeometry(0.09, 0);
  private flashMaterial = new THREE.MeshBasicMaterial({ color: "#ffe0a6", toneMapped: false });

  sync(players: RoomPlayer[], localId: string) {
    const visible = new Set<string>();
    for (const player of players) {
      if (player.id === localId || !player.pose) continue;
      const { pose } = player;
      visible.add(player.id);
      let remote = this.players.get(player.id);
      if (!remote || remote.character !== player.character) {
        remote?.group.removeFromParent();
        const model = this.models.create(player.character);
        const flash = new THREE.Mesh(this.flashGeometry, this.flashMaterial);
        flash.visible = false;
        flash.raycast = () => {};
        model.muzzle.add(flash);
        model.group.traverse(part => { if (part instanceof THREE.Mesh) part.userData.roomPlayer = player.id; });
        model.group.position.set(pose.x, pose.y - 1.7, pose.z);
        model.group.rotation.y = pose.yaw + Math.PI;
        remote = { ...model, pose, character: player.character, eye: new THREE.Vector3(pose.x, pose.y, pose.z), gait: 0, flash, flashTime: 0 };
        this.root.add(remote.group);
        this.players.set(player.id, remote);
      }
      if (pose.shot > remote.pose.shot) remote.flashTime = 0.08;
      remote.pose = pose;
      remote.eye.set(pose.x, pose.y, pose.z);
      remote.group.visible = pose.alive;
    }
    for (const [id, player] of this.players) {
      if (visible.has(id)) continue;
      player.group.removeFromParent();
      this.players.delete(id);
    }
  }

  update(dt: number) {
    const blend = 1 - Math.exp(-dt * 17);
    for (const player of this.players.values()) {
      const { group, pose } = player;
      const p = group.position;
      const dx = (pose.x - p.x) * blend;
      const dz = (pose.z - p.z) * blend;
      if (Math.hypot(dx, dz) > 2) p.set(pose.x, pose.y - 1.7, pose.z);
      else p.set(p.x + dx, THREE.MathUtils.lerp(p.y, pose.y - 1.7, blend), p.z + dz);
      const yaw = pose.yaw + Math.PI - group.rotation.y;
      group.rotation.y += Math.atan2(Math.sin(yaw), Math.cos(yaw)) * blend;
      const travel = Math.hypot(dx, dz);
      player.gait += travel * 7;
      const stride = Math.sin(player.gait) * Math.min(1, travel / Math.max(dt * 1.9, 0.001));
      player.legs[0].rotation.x = stride * 0.53;
      player.legs[1].rotation.x = -stride * 0.53;
      player.head.rotation.x = -pose.pitch * 0.55;
      player.arms[1].rotation.x = -pose.pitch * 0.55;
      player.flashTime = Math.max(0, player.flashTime - dt);
      player.flash.visible = pose.alive && player.flashTime > 0;
    }
  }

  clear() {
    this.root.clear();
    this.players.clear();
  }

  dispose() {
    this.clear();
    this.models.dispose();
    this.flashGeometry.dispose();
    this.flashMaterial.dispose();
  }
}
