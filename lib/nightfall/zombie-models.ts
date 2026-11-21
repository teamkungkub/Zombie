import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { enemyTypes, type EnemyType } from "./rules";

type Point = readonly [number, number, number];
type Part = { geometry: THREE.BufferGeometry; color: string };
export const zombieRigHeight = 0.84;

const skinByType: Record<EnemyType, readonly [string, string]> = {
  standard: ["#9c9a83", "#797d6d"],
  brute: ["#9b7d69", "#836756"],
  hunter: ["#b09a7a", "#8b7862"],
  tank: ["#8d8b91", "#756f7c"],
  flier: ["#8a919a", "#6a7384"],
  spitter: ["#99a17e", "#79855f"],
};
const alternateClothes: Record<EnemyType, string> = {
  standard: "#586473",
  brute: "#8d6348",
  hunter: "#776c46",
  tank: "#4d595f",
  flier: "#645a73",
  spitter: "#526746",
};

function ellipsoid(at: Point, size: Point, color: string, tilt = 0): Part {
  const large = Math.max(...size) > 0.13;
  const geometry = new THREE.SphereGeometry(1, large ? 12 : 8, large ? 9 : 5);
  geometry.scale(...size);
  geometry.rotateZ(tilt);
  geometry.translate(...at);
  return { geometry, color };
}

function skull(skin: string, variant: number): Part {
  const geometry = new THREE.SphereGeometry(1, 20, 15);
  const points = geometry.getAttribute("position");
  for (let i = 0; i < points.count; i++) {
    const y = points.getY(i);
    const x = points.getX(i);
    const z = points.getZ(i);
    const jaw = THREE.MathUtils.smoothstep(y, -0.94, -0.12);
    const jawDepth = 0.044 * (1 - jaw);
    const width = (variant ? 0.147 : 0.136) * (0.85 + jaw * 0.15);
    const temple = Math.exp(-((y + 0.11) ** 2) * 35) * Math.max(0, z);
    points.setXYZ(
      i,
      x * width * (1 + temple * 0.11) + (variant ? 0.009 : -0.006) * (1 - jaw),
      0.196 + y * (variant ? 0.171 : 0.181),
      -0.021 + z * 0.153 + jawDepth,
    );
  }
  geometry.computeVertexNormals();
  return { geometry, color: skin };
}

function panel(at: Point, size: Point, color: string, tilt = 0): Part {
  const geometry = new THREE.BoxGeometry(...size);
  geometry.rotateZ(tilt);
  geometry.translate(...at);
  return { geometry, color };
}

function tapered(a: Point, b: Point, start: number, end: number, color: string): Part {
  const from = new THREE.Vector3(...a);
  const to = new THREE.Vector3(...b);
  const axis = to.clone().sub(from);
  const geometry = new THREE.CylinderGeometry(end, start, axis.length(), 8, 2);
  geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0), axis.normalize(),
  ));
  geometry.translate(...from.lerp(to, 0.5).toArray());
  return { geometry, color };
}

function bake(parts: Part[], material: THREE.MeshStandardMaterial) {
  const colored = parts.map(({ geometry, color }, i) => {
    const mesh = geometry.index ? geometry.toNonIndexed() : geometry;
    if (mesh !== geometry) geometry.dispose();
    const positions = mesh.getAttribute("position");
    const colors = new Float32Array(positions.count * 3);
    const tint = new THREE.Color(color);
    for (let j = 0; j < positions.count; j++) {
      const x = positions.getX(j), y = positions.getY(j), z = positions.getZ(j);
      const shade = 0.88 + 0.09 * Math.sin(x * 29 + y * 21 + z * 17 + i) +
        0.055 * Math.cos(x * 44 - y * 51 + z * 37);
      colors.set([tint.r * shade, tint.g * shade, tint.b * shade], j * 3);
    }
    mesh.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    return mesh;
  });
  const mesh = new THREE.Mesh(mergeGeometries(colored)!, material);
  mesh.castShadow = true;
  for (const geometry of colored) geometry.dispose();
  return mesh;
}

function grain() {
  const size = 32;
  const pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const fibers = (x % 2 === y % 2 ? 9 : 0);
      const weathering = 214 + ((x * 47 + y * 31 + x * y * 7) % 29) - fibers;
      pixels.set([weathering, weathering, weathering, 255], (y * size + x) * 4);
    }
  }
  const texture = new THREE.DataTexture(pixels, size, size);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

export class ZombieModels {
  private templates = new Map<string, THREE.Group>();
  private texture = grain();
  private cloth = new THREE.MeshStandardMaterial({
    vertexColors: true, map: this.texture, roughness: 0.89,
  });
  private membrane = new THREE.MeshStandardMaterial({
    vertexColors: true, map: this.texture, roughness: 0.76, side: THREE.DoubleSide,
  });

  create(kind: EnemyType, variant: number) {
    const key = `${kind}:${variant}`;
    let template = this.templates.get(key);
    if (!template) {
      template = this.build(kind, variant);
      this.templates.set(key, template);
    }
    const group = template.clone(true);
    group.traverse((object) => { object.userData.zombie = group.id; });
    const joint = (name: string) => group.getObjectByName(name) as THREE.Group;
    return {
      group,
      rig: joint("body-rig"),
      head: joint("head"),
      arms: [joint("arm-left"), joint("arm-right")],
      legs: [joint("leg-left"), joint("leg-right")],
      wings: kind === "flier" ? [joint("wing-left"), joint("wing-right")] : [],
      throat: group.getObjectByName("throat") as THREE.Mesh | undefined,
    };
  }

  dispose() {
    for (const template of this.templates.values()) {
      template.traverse((object) => {
        if (object instanceof THREE.Mesh) object.geometry.dispose();
      });
    }
    this.templates.clear();
    this.cloth.dispose();
    this.membrane.dispose();
    this.texture.dispose();
  }

  private build(kind: EnemyType, variant: number) {
    const group = new THREE.Group();
    const body = variant ? alternateClothes[kind] : enemyTypes[kind].color;
    const skin = skinByType[kind][variant % 2];
    const runner = kind === "hunter";
    const heavy = kind === "brute" || kind === "tank";
    const width = runner ? 0.192 : heavy ? 0.316 : 0.251;
    const jacket = [
      ellipsoid([0, 1.15, 0], [width, 0.307, 0.159], body),
      ellipsoid([0, 0.91, -0.009], [width * 0.82, 0.142, 0.14], "#47463a"),
      ellipsoid([0.006, 1.376, -0.019], [width * 0.91, 0.11, 0.129], body),
      tapered([0, 1.397, 0], [0, 1.61, 0], 0.087, 0.065, skin),
      panel([0.013, 1.13, 0.16], [0.035, 0.43, 0.021], "#3d4037", -0.09),
      panel([-0.12, 1.21, 0.13], [0.109, 0.091, 0.035], "#89846c", 0.08),
      panel([-0.12, 1.232, 0.155], [0.088, 0.018, 0.012], "#98917c", 0.08),
      panel([0.115, 1.07, 0.145], [0.11, 0.022, 0.02], "#706957", -0.23),
      panel([0.0, 0.91, 0.139], [0.28, 0.058, 0.023], "#36352d"),
      panel([0.047, 0.914, 0.157], [0.058, 0.046, 0.017], "#887b63"),
      panel([variant ? 0.092 : -0.097, 1.01, 0.137], [0.05, 0.043, 0.024], "#655f4e", -0.39),
    ];
    if (kind === "tank") {
      for (const side of [-1, 1]) {
        jacket.push(panel([side * 0.126, 1.221, 0.124], [0.205, 0.254, 0.093], "#414b52", side * 0.16));
        jacket.push(panel([side * 0.122, 1.209, 0.176], [0.151, 0.031, 0.023], "#707974", side * 0.11));
        jacket.push(panel([side * 0.097, 1.155, 0.176], [0.133, 0.025, 0.03], "#545f5e", side * 0.09));
      }
    } else if (kind === "brute") {
      jacket.push(
        ellipsoid([-0.202, 1.37, 0.035], [0.151, 0.112, 0.126], skin, -0.15),
        panel([0.095, 1.16, 0.169], [0.075, 0.28, 0.031], "#594237", 0.35),
      );
    } else if (runner) {
      jacket.push(
        panel([-0.103, 1.314, 0.138], [0.091, 0.046, 0.025], "#b09a67", -0.28),
        panel([0.075, 1.073, 0.144], [0.055, 0.086, 0.026], "#8e7963", 0.46),
      );
    }
    group.add(bake(jacket, this.cloth));

    const head = new THREE.Group();
    head.name = "head";
    head.position.y = runner ? 1.51 : 1.54;
    const face: Part[] = [
      skull(skin, variant),
      ellipsoid([0.009, 0.083, 0.139], [0.047, variant ? 0.019 : 0.014, 0.012], "#52423b", -0.18),
      ellipsoid([0, 0.175, 0.137], [0.029, 0.049, 0.039], skin, -0.15),
      ellipsoid([0.006, 0.145, 0.16], [0.029, 0.019, 0.027], "#a19378"),
    ];
    for (const side of [-1, 1]) {
      const eye = side * 0.057;
      face.push(
        ellipsoid([side * 0.135, 0.179, -0.024], [0.028, 0.05, 0.026], skin, side * 0.23),
        ellipsoid([side * 0.147, 0.177, -0.004], [0.012, 0.029, 0.008], "#634e47", side * 0.16),
        ellipsoid([side * 0.079, 0.144, 0.092], [0.054, 0.023, 0.033], skin, -side * 0.25),
        ellipsoid([eye, 0.209, 0.13], [0.036, 0.022, 0.018], variant && side === 1 ? "#57505a" : "#665c51", side * 0.16),
        ellipsoid([eye, 0.207, 0.145], [0.016, 0.007, 0.008], "#a7a89b", side * 0.13),
        ellipsoid([eye + 0.004, 0.208, 0.152], [0.0055, 0.006, 0.003], "#6f6c60"),
        ellipsoid([eye, 0.235, 0.119], [0.042, 0.017, 0.025], skin, -side * 0.21),
      );
    }
    for (const x of [-0.014, 0.001, 0.019])
      face.push(ellipsoid([x, 0.089, 0.15], [0.005, 0.005, 0.004], "#968b75"));
    if (variant) face.push(ellipsoid([-0.104, 0.156, 0.099], [0.013, 0.048, 0.013], "#756459", -0.32));
    if (kind === "tank") {
      face.push(
        ellipsoid([0, 0.298, -0.018], [0.157, 0.105, 0.149], "#555c67"),
        panel([0, 0.276, 0.122], [0.237, 0.058, 0.065], "#3a444d", -0.06),
      );
    } else if (kind !== "flier") {
      const hair = variant ? "#50483e" : "#49473a";
      face.push(
        ellipsoid([-0.023, 0.305, -0.07], [0.116, 0.087, 0.112], hair, -0.12),
        ellipsoid([-0.074, 0.274, -0.032], [0.056, 0.061, 0.099], hair, 0.41),
        ellipsoid([0.057, 0.323, -0.055], [0.074, variant ? 0.034 : 0.057, 0.097], hair, 0.3),
      );
    }
    const faceMesh = bake(face, this.cloth);
    faceMesh.userData.head = true;
    head.add(faceMesh);
    group.add(head);

    for (const side of [-1, 1]) {
      const label = side < 0 ? "left" : "right";
      const arm = new THREE.Group();
      arm.name = `arm-${label}`;
      arm.position.set(side * (width + 0.014), 1.38, 0);
      const sleeve = heavy ? 0.123 : runner ? 0.078 : 0.097;
      const cuff = runner ? (side < 0 ? -0.17 : -0.25) :
        variant && side < 0 ? -0.21 : side > 0 ? -0.35 : -0.29;
      const reach = runner ? -0.78 : heavy ? -0.72 : -0.68;
      const parts = [
        ellipsoid([0, -0.09, 0.009], [sleeve, 0.157, sleeve * 0.91], body, side * 0.12),
        tapered([0, -0.11, 0], [side * 0.027, cuff, 0.015], sleeve, sleeve * 0.66, body),
        tapered([side * 0.03, cuff + 0.014, 0.018], [side * 0.046, reach + 0.037, 0.045], sleeve * 0.62, 0.035, skin),
        ellipsoid([side * 0.046, reach, 0.053], [0.045, 0.067, 0.027], skin, side * 0.16),
        tapered([side * 0.014, reach, 0.07], [side * 0.007, reach - 0.051, 0.108], 0.015, 0.009, skin),
      ];
      for (let i = 0; i < 4; i++) {
        const x = side * 0.023 + i * 0.015;
        parts.push(tapered([x, reach - 0.035, 0.055], [x + side * 0.006, reach - 0.096 + Math.abs(1.5 - i) * 0.01, 0.087], 0.01, 0.005, skin));
      }
      if (heavy) parts.push(ellipsoid([0, -0.046, -0.016], [0.144, 0.109, 0.139], "#53534d", side * 0.2));
      arm.add(bake(parts, this.cloth));

      const leg = new THREE.Group();
      leg.name = `leg-${label}`;
      leg.position.set(side * 0.127, 0.849, 0);
      leg.add(bake([
        tapered([0, 0, 0], [side * 0.017, -0.38, 0.025], heavy ? 0.12 : 0.102, 0.078, "#4e5044"),
        ellipsoid([side * 0.018, -0.41, 0.033], [0.08, 0.099, 0.073], "#59594c"),
        tapered([side * 0.02, -0.39, 0.022], [side * 0.027, -0.69, -0.028], 0.077, 0.056, "#4a4b42"),
        ellipsoid([side * 0.03, -0.696, -0.02], [0.081, 0.106, 0.087], "#343631"),
        ellipsoid([side * 0.03, -0.778, 0.053], [0.091, 0.065, 0.135], "#303331"),
        panel([side * 0.03, -0.822, 0.048], [0.166, 0.034, 0.231], "#252823"),
        panel([side * 0.03, -0.724, 0.104], [0.06, 0.017, 0.019], "#6d6757", 0.18),
      ], this.cloth));
      group.add(arm, leg);
    }

    if (kind === "spitter") {
      const throat = bake([
        ellipsoid([0, -0.013, 0], [0.072, 0.112, 0.058], "#9aa962", 0.14),
        ellipsoid([-0.052, 0.002, -0.021], [0.046, 0.065, 0.038], "#718a55", 0.38),
        ellipsoid([0.054, -0.018, -0.011], [0.044, 0.081, 0.047], "#859451", -0.26),
      ], this.cloth);
      throat.name = "throat";
      throat.position.set(0, 1.424, 0.132);
      group.add(throat);
    } else if (kind === "flier") {
      for (const side of [-1, 1]) {
        const pivot = new THREE.Group();
        pivot.name = side < 0 ? "wing-left" : "wing-right";
        pivot.position.set(side * 0.235, 1.29, -0.116);
        pivot.scale.x = side;
        pivot.rotation.y = side * 0.21;
        const ridge: Point = [0.68, 0.29, 0];
        const edge = [[0, 0], [0.22, 0.24], [0.68, 0.29], [1.42, 0.07],
          [1.027, -0.102], [0.94, -0.191], [0.81, -0.075], [0.64, -0.229],
          [0.52, -0.148], [0.38, -0.313], [0.19, -0.188]];
        const shape = new THREE.Shape(edge.map(([x, y]) => new THREE.Vector2(x, y)));
        pivot.add(bake([
          { geometry: new THREE.ShapeGeometry(shape), color: "#636574" },
          tapered([0, 0, 0.013], ridge, 0.048, 0.025, "#62594f"),
          tapered(ridge, [1.42, 0.07, 0], 0.025, 0.006, "#706568"),
          tapered(ridge, [0.94, -0.191, 0.008], 0.015, 0.005, "#76686c"),
          tapered(ridge, [0.64, -0.229, 0.009], 0.017, 0.005, "#756a76"),
          tapered(ridge, [0.38, -0.313, 0.009], 0.017, 0.005, "#746777"),
        ], this.membrane));
        group.add(pivot);
      }
    }
    const rig = new THREE.Group();
    rig.name = "body-rig";
    rig.position.y = zombieRigHeight;
    for (const joint of [...group.children]) {
      rig.add(joint);
      joint.position.y -= zombieRigHeight;
    }
    group.add(rig);
    return group;
  }
}
