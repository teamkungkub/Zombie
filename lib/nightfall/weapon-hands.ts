import * as THREE from "three";
import { oval, tapered, type Point } from "./viewmodel-geometry";

export class WeaponHands {
  readonly support = new THREE.Group();
  private fingers: THREE.Group[] = [];
  private thumb = new THREE.Group();
  private sleeve = new THREE.MeshStandardMaterial({ color: "#576052", roughness: 0.91 });
  private edge = new THREE.MeshStandardMaterial({ color: "#82866c", roughness: 0.82 });
  private glove = new THREE.MeshStandardMaterial({ color: "#373e37", roughness: 0.86 });
  private padding = new THREE.MeshStandardMaterial({ color: "#646d60", roughness: 0.83 });
  private skin = new THREE.MeshStandardMaterial({ color: "#bd9276", roughness: 0.76 });
  private nail = new THREE.MeshStandardMaterial({ color: "#d9b398", roughness: 0.55 });

  setSleeve(color: string) {
    this.sleeve.color.set(color).multiplyScalar(0.63);
  }

  constructor() {
    const hand = this.support;
    hand.name = "weapon-support-hand";
    tapered(hand, this.sleeve, [-0.35, -0.34, 0.59], [-0.092, -0.064, 0.079], 0.078, 0.051);
    tapered(hand, this.edge, [-0.108, -0.08, 0.107], [-0.091, -0.06, 0.074], 0.054, 0.049);
    tapered(hand, this.glove, [-0.098, -0.069, 0.083], [-0.06, -0.049, 0.026], 0.045, 0.039);
    oval(hand, this.glove, [-0.049, -0.045, 0.009], [0.048, 0.028, 0.053]);
    oval(hand, this.padding, [-0.081, -0.041, 0.023], [0.018, 0.024, 0.037]);
    for (let i = 0; i < 4; i++) {
      const finger = new THREE.Group();
      finger.position.set(-0.038, -0.047, -0.038 + i * 0.022);
      const reach = [0.071, 0.083, 0.076, 0.061][i];
      tapered(finger, this.glove, [0, 0, 0], [0.037, 0.002, 0], 0.012, 0.011);
      tapered(finger, this.skin, [0.035, 0.002, 0], [reach, 0.009, -0.004], 0.011, 0.009);
      tapered(finger, this.skin, [reach, 0.009, -0.004], [reach + 0.008, 0.035, -0.008], 0.009, 0.0075);
      oval(finger, this.nail, [reach + 0.011, 0.026, -0.001], [0.005, 0.01, 0.004]);
      hand.add(finger);
      this.fingers.push(finger);
    }
    this.thumb.position.set(-0.07, -0.015, 0.034);
    tapered(this.thumb, this.glove, [0, -0.025, 0.011], [0.004, 0.018, 0.012], 0.017, 0.014);
    tapered(this.thumb, this.skin, [0.004, 0.016, 0.012], [0.024, 0.042, 0.008], 0.013, 0.01);
    oval(this.thumb, this.nail, [0.026, 0.039, 0.016], [0.008, 0.01, 0.004]);
    hand.add(this.thumb);
  }

  addGrip(model: THREE.Group, position: Point) {
    const hand = new THREE.Group();
    hand.name = "weapon-grip-hand";
    hand.position.set(...position);
    const wrist: Point = [0.065, -0.04, 0.088];
    tapered(hand, this.sleeve, [0.23, -0.34, 0.46], wrist, 0.086, 0.055);
    tapered(hand, this.edge, [0.081, -0.069, 0.12], wrist, 0.06, 0.054);
    tapered(hand, this.glove, wrist, [0.033, -0.014, 0.05], 0.05, 0.042);
    oval(hand, this.glove, [0.033, -0.003, 0.035], [0.047, 0.057, 0.031]);
    oval(hand, this.padding, [0.051, -0.009, 0.047], [0.029, 0.041, 0.021]);
    for (let i = 0; i < 3; i++) {
      const y = 0.006 - i * 0.026;
      const z = -0.048 + i * 0.006;
      tapered(hand, this.glove, [0.051, y, 0.035], [0.041, y, z], 0.0135, 0.0125);
      tapered(hand, this.glove, [0.041, y, z], [-0.018, y, z - 0.012], 0.0125, 0.011);
      tapered(hand, this.skin, [-0.017, y, z - 0.012], [-0.046, y + 0.001, z + 0.016], 0.011, 0.0087);
      oval(hand, this.nail, [-0.049, y + 0.002, z + 0.013], [0.005, 0.008, 0.012]);
    }
    tapered(hand, this.glove, [-0.037, 0.036, 0.04], [-0.051, 0.045, -0.015], 0.019, 0.015);
    tapered(hand, this.skin, [-0.051, 0.043, -0.014], [-0.054, 0.038, -0.051], 0.015, 0.011);
    oval(hand, this.nail, [-0.061, 0.04, -0.042], [0.004, 0.009, 0.011]);
    tapered(hand, this.glove, [0.022, 0.033, 0.048], [-0.033, 0.029, 0.061], 0.02, 0.014);
    tapered(hand, this.skin, [-0.033, 0.029, 0.061], [-0.056, 0.009, 0.047], 0.013, 0.01);
    model.add(hand);
  }

  grasp(curl: number, pinch = 0) {
    this.fingers.forEach((finger, i) => {
      finger.rotation.z = -0.28 + curl * 0.71 + pinch * (i === 0 ? 0.38 : 0.82);
      finger.rotation.y = pinch * (0.21 - i * 0.16);
    });
    this.thumb.rotation.z = 0.54 - curl * 1.01 - pinch * 0.54;
  }
}
