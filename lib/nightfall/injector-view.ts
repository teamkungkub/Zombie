import * as THREE from "three";
import { injectionPose } from "./equipment";
import { oval, tapered } from "./viewmodel-geometry";

const contactPoint = new THREE.Vector3(-0.228, 0.049, 0.043);
const needleTip = new THREE.Vector3(0, -0.193, 0);

function exposedForearm(parent: THREE.Group, skin: THREE.Material) {
  const elbow = new THREE.Vector3(-0.387, -0.026, 0.092);
  const axis = new THREE.Vector3(-0.01, 0, 0).sub(elbow);
  const length = axis.length();
  const outline = [[0.059, 0], [0.065, 0.13], [0.067, 0.29], [0.061, 0.49],
    [0.05, 0.73], [0.041, 0.93], [0.04, 1]];
  const mesh = new THREE.Mesh(new THREE.LatheGeometry(
    outline.map(([radius, fraction]) => new THREE.Vector2(radius, length * fraction)),
    16,
  ), skin);
  mesh.position.copy(elbow);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis.normalize());
  parent.add(mesh);
}

export class InjectorView {
  readonly model = new THREE.Group();
  private arm = new THREE.Group();
  private grip = new THREE.Group();
  private thumb = new THREE.Group();
  private plunger = new THREE.Group();
  private target = new THREE.Vector3();
  private tip = new THREE.Vector3();
  private cap: THREE.Mesh;
  private liquid: THREE.Mesh;

  constructor() {
    const skin = new THREE.MeshStandardMaterial({ color: "#bd9276", roughness: 0.76 });
    const fingertips = new THREE.MeshStandardMaterial({ color: "#c99d81", roughness: 0.72 });
    const nails = new THREE.MeshStandardMaterial({ color: "#d6b097", roughness: 0.55 });
    const sleeve = new THREE.MeshStandardMaterial({ color: "#576052", roughness: 0.91 });
    const edge = new THREE.MeshStandardMaterial({ color: "#82866c", roughness: 0.82 });
    const glove = new THREE.MeshStandardMaterial({ color: "#363d37", roughness: 0.86 });
    const padding = new THREE.MeshStandardMaterial({ color: "#576154", roughness: 0.83 });
    const metal = new THREE.MeshStandardMaterial({ color: "#cbd8d5", metalness: 0.57, roughness: 0.28 });
    const capPlastic = new THREE.MeshStandardMaterial({ color: "#d29d5a", roughness: 0.54 });
    const glass = new THREE.MeshStandardMaterial({
      color: "#c4d6d6", transparent: true, opacity: 0.38, roughness: 0.24, depthWrite: false,
    });
    const medicine = new THREE.MeshStandardMaterial({
      color: "#65bbb0", emissive: "#18312d", emissiveIntensity: 0.45, roughness: 0.35,
    });

    const arm = this.arm;
    tapered(arm, sleeve, [-0.91, -0.29, 0.345], [-0.386, -0.026, 0.092], 0.094, 0.068);
    tapered(arm, edge, [-0.399, -0.03, 0.096], [-0.369, -0.024, 0.087], 0.071, 0.065);
    exposedForearm(arm, skin);
    oval(arm, skin, [0.044, 0.002, 0], [0.076, 0.043, 0.027]);
    const lengths = [0.065, 0.084, 0.075, 0.054];
    for (let i = 0; i < lengths.length; i++) {
      const y = 0.029 - i * 0.019;
      const x = 0.1 + lengths[i];
      tapered(arm, skin, [0.088, y, 0.001], [x - 0.027, y + 0.002, 0.009], 0.011, 0.009);
      tapered(arm, fingertips, [x - 0.029, y + 0.002, 0.009], [x, y - 0.003, 0.033], 0.0095, 0.007);
      oval(arm, nails, [x - 0.007, y - 0.001, 0.039], [0.011, 0.006, 0.003]);
    }
    tapered(arm, skin, [0.018, 0.026, 0.007], [0.065, 0.068, 0.025], 0.018, 0.012);
    oval(arm, fingertips, [0.082, 0.07, 0.038], [0.027, 0.012, 0.011]);

    const grip = this.grip;
    tapered(grip, sleeve, [0.47, -0.46, 0.34], [0.145, -0.071, 0.105], 0.081, 0.054);
    tapered(grip, edge, [0.166, -0.084, 0.115], [0.131, -0.065, 0.095], 0.057, 0.054);
    tapered(grip, glove, [0.15, -0.073, 0.097], [0.081, -0.023, 0.057], 0.047, 0.043);
    oval(grip, glove, [0.073, -0.018, 0.056], [0.063, 0.067, 0.036]).rotation.z = 0.22;
    oval(grip, padding, [0.091, -0.025, 0.078], [0.034, 0.049, 0.019]).rotation.z = 0.27;
    for (let i = 0; i < 4; i++) {
      const y = 0.024 - i * 0.022;
      tapered(grip, glove, [0.079, y, 0.032], [0.035, y + 0.003, 0.044], 0.013, 0.012);
      tapered(grip, skin, [0.036, y + 0.003, 0.045], [0.009, y + 0.001, 0.027], 0.012, 0.01);
      oval(grip, fingertips, [0.01, y, 0.023], [0.013, 0.010, 0.012]);
    }
    tapered(this.thumb, glove, [0.059, 0.079, 0.043], [0.033, 0.116, 0.021], 0.016, 0.014);
    oval(this.thumb, fingertips, [0.013, 0.111, 0.008], [0.031, 0.015, 0.015]).rotation.z = -0.24;
    grip.add(this.thumb);

    tapered(grip, glass, [0, -0.115, 0], [0, 0.055, 0], 0.024, 0.026);
    this.liquid = tapered(grip, medicine, [0, -0.105, 0], [0, -0.005, 0], 0.019, 0.019);
    tapered(grip, metal, [0, 0.037, 0], [0, 0.049, 0], 0.028, 0.028);
    tapered(grip, capPlastic, [0, -0.134, 0], [0, -0.109, 0], 0.013, 0.02);
    tapered(grip, metal, [0, -0.193, 0], [0, -0.132, 0], 0.0007, 0.0026);
    this.cap = tapered(grip, capPlastic, [0, -0.211, 0], [0, -0.126, 0], 0.012, 0.015);
    tapered(this.plunger, metal, [0, 0.014, 0], [0, 0.108, 0], 0.006, 0.008);
    oval(this.plunger, capPlastic, [0, 0.108, 0], [0.027, 0.008, 0.025]);
    grip.add(this.plunger);

    this.model.add(arm, grip);
    this.model.visible = false;
    this.model.position.set(-0.26, 0.29, -0.33);
    this.pose(0);
  }

  pose(seconds: number) {
    const { arm, seat, press, capped } = injectionPose(seconds);
    this.arm.visible = arm > 0.001;
    this.arm.position.set(-0.025 - arm * 0.03, -0.35 + arm * 0.20, 0.09);
    this.arm.rotation.set(-0.1 + arm * 0.27, 0.09 - arm * 0.25, 0.34 - arm * 0.35);
    this.grip.position.set(0.23 - arm * 0.015, -0.28 + arm * 0.32, 0.065 - arm * 0.075);
    this.grip.rotation.set(-0.19 + arm * 0.37, 0.26 - seat * 0.33, -0.33 - seat * 0.20);
    this.arm.updateMatrix();
    this.tip.copy(needleTip).applyEuler(this.grip.rotation);
    this.target.copy(contactPoint).applyMatrix4(this.arm.matrix).sub(this.tip);
    this.grip.position.lerp(this.target, seat);
    this.cap.visible = capped;
    this.plunger.position.y = this.thumb.position.y = -0.057 * press;
    this.liquid.scale.y = 1 - press * 0.91;
    this.liquid.position.y = -0.055 - press * 0.045;
  }
}
