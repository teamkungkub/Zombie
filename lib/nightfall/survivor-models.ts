import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { CharacterId } from "./room-protocol";
import type { Point } from "./viewmodel-geometry";

type Part = { shape: THREE.BufferGeometry; color: string };

const uniforms = {
  vanguard: {
    cloth: "#333631", plate: "#5f6557", feature: "#dcad63", boots: "#282d2c",
    skin: "#a47961", trim: "#af8750", pants: "#3d433c", width: 0.25,
  },
  wraith: {
    cloth: "#292b32", plate: "#393b45", feature: "#737782", boots: "#1f2026",
    skin: "#b7a7a0", trim: "#575763", pants: "#292a32", width: 0.215,
  },
  ember: {
    cloth: "#884a3c", plate: "#503936", feature: "#ea8a69", boots: "#302827",
    skin: "#9a6b51", trim: "#b96652", pants: "#4d4140", width: 0.223,
  },
} as const;

function rounded(at: Point, size: Point, color: string, tilt = 0): Part {
  const shape = new THREE.SphereGeometry(1, 12, 8);
  shape.scale(...size);
  shape.rotateZ(tilt);
  shape.translate(...at);
  return { shape, color };
}

function plate(at: Point, size: Point, color: string, tilt = 0): Part {
  const shape = new THREE.BoxGeometry(...size);
  shape.rotateZ(tilt);
  shape.translate(...at);
  return { shape, color };
}

function tapered(from: Point, to: Point, radius: number, top: number, color: string): Part {
  const start = new THREE.Vector3(...from);
  const axis = new THREE.Vector3(...to).sub(start);
  const shape = new THREE.CylinderGeometry(top, radius, axis.length(), 9);
  const center = start.addScaledVector(axis, 0.5);
  shape.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0), axis.normalize(),
  ));
  shape.translate(...center.toArray());
  return { shape, color };
}

function curvedTrim(points: Point[], radius: number, color: string, closed = false): Part {
  const path = new THREE.CatmullRomCurve3(points.map((point) => new THREE.Vector3(...point)), closed);
  return { shape: new THREE.TubeGeometry(path, closed ? 20 : 10, radius, 6, closed), color };
}

function hairLock(start: Point, bend: Point, tip: Point, width: number, depth: number, color: string): Part {
  const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(...start), new THREE.Vector3(...bend), new THREE.Vector3(...tip));
  const positions: number[] = [], uvs: number[] = [], indices: number[] = [];
  const segments = 8, sides = 8;
  const forward = new THREE.Vector3(0, 0, 1);
  const across = new THREE.Vector3(), normal = new THREE.Vector3();
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const center = curve.getPoint(t), tangent = curve.getTangent(t);
    across.crossVectors(tangent, forward).normalize();
    normal.crossVectors(tangent, across).normalize();
    const taper = 0.025 + (1 - t) ** 0.72 * (0.68 + 0.6 * Math.sin(Math.PI * t));
    for (let j = 0; j <= sides; j++) {
      const angle = j / sides * Math.PI * 2;
      const a = Math.cos(angle) * width * taper, b = Math.sin(angle) * depth * taper;
      positions.push(center.x + across.x * a + normal.x * b,
        center.y + across.y * a + normal.y * b, center.z + across.z * a + normal.z * b);
      uvs.push(j / sides, t);
      if (i < segments && j < sides) {
        const index = i * (sides + 1) + j, next = index + sides + 1;
        indices.push(index, index + 1, next, next, index + 1, next + 1);
      }
    }
  }
  const shape = new THREE.BufferGeometry();
  shape.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  shape.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  shape.setIndex(indices);
  shape.computeVertexNormals();
  return { shape, color };
}

function wraithHair() {
  const snow = "#f4f4f1", silver = "#d9dce4", shade = "#a9aebc", frame = "#20212b";
  const parts = [
    rounded([0, 0.075, -0.019], [0.144, 0.135, 0.128], silver),
    rounded([-0.028, 0.14, 0.015], [0.12, 0.073, 0.113], snow, 0.19),
    hairLock([0.038, 0.185, 0.086], [-0.059, 0.156, 0.175], [-0.111, -0.049, 0.123], 0.065, 0.029, snow),
    hairLock([0.039, 0.179, 0.102], [0.013, 0.09, 0.164], [-0.049, -0.068, 0.133], 0.049, 0.024, silver),
    hairLock([0.056, 0.172, 0.097], [0.1, 0.108, 0.158], [0.049, -0.064, 0.139], 0.046, 0.026, snow),
    hairLock([0.083, 0.174, 0.068], [0.144, 0.095, 0.142], [0.102, -0.075, 0.122], 0.038, 0.024, silver),
    hairLock([-0.066, 0.168, 0.014], [-0.128, 0.226, 0.018], [-0.183, 0.183, 0.057], 0.048, 0.026, snow),
    hairLock([0.022, 0.166, -0.09], [0.055, 0.253, -0.074], [0.143, 0.224, -0.031], 0.047, 0.026, silver),
    hairLock([0.005, 0.186, 0.045], [-0.048, 0.238, 0.078], [-0.096, 0.244, 0.045], 0.034, 0.023, snow),
    hairLock([-0.051, 0.149, -0.116], [-0.01, 0.029, -0.155], [-0.027, -0.123, -0.08], 0.055, 0.029, silver),
    hairLock([0.031, 0.155, -0.111], [0.049, 0.038, -0.156], [0.072, -0.106, -0.078], 0.052, 0.027, snow),
    curvedTrim([[-0.025, 0.055, 0.184], [0, 0.064, 0.184], [0.025, 0.055, 0.184]], 0.006, frame),
  ];
  for (const side of [-1, 1]) {
    parts.push(
      hairLock([side * 0.088, 0.164, 0.002], [side * 0.143, 0.082, 0.049], [side * 0.127, -0.103, 0.066], 0.037, 0.027, silver),
      hairLock([side * 0.071, 0.154, -0.098], [side * 0.132, 0.034, -0.115], [side * 0.106, -0.116, -0.071], 0.051, 0.027, shade),
      hairLock([side * 0.091, 0.156, -0.044], [side * 0.158, 0.085, -0.027], [side * 0.169, -0.04, 0.003], 0.035, 0.023, snow),
      curvedTrim([[side * 0.023, 0.056, 0.184], [side * 0.045, 0.078, 0.193], [side * 0.094, 0.076, 0.19],
        [side * 0.124, 0.056, 0.175], [side * 0.107, 0.019, 0.185],
        [side * 0.071, 0.005, 0.193], [side * 0.037, 0.019, 0.193]], 0.006, frame, true),
      curvedTrim([[side * 0.124, 0.056, 0.175], [side * 0.144, 0.061, 0.088], [side * 0.136, 0.046, -0.005]], 0.005, frame),
    );
  }
  return parts;
}

function meshFor(parts: Part[], material: THREE.MeshStandardMaterial) {
  const geometries = parts.map(({ shape, color }, index) => {
    const geometry = shape.index ? shape.toNonIndexed() : shape;
    if (geometry !== shape) shape.dispose();
    const positions = geometry.getAttribute("position");
    const colors = new Float32Array(positions.count * 3);
    const tint = new THREE.Color(color);
    for (let i = 0; i < positions.count; i++) {
      const contrast = 0.93 + 0.05 * Math.sin(
        positions.getX(i) * 31 + positions.getY(i) * 42 + positions.getZ(i) * 38 + index,
      );
      colors.set([tint.r * contrast, tint.g * contrast, tint.b * contrast], i * 3);
    }
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    return geometry;
  });
  const geometry = mergeGeometries(geometries);
  for (const part of geometries) part.dispose();
  if (!geometry) throw new Error("Survivor mesh attributes did not match");
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  return mesh;
}

function makeJoint(name: string, at: Point, root: THREE.Group) {
  const group = new THREE.Group();
  group.name = name;
  group.position.set(...at);
  root.add(group);
  return group;
}

function makeHead(character: CharacterId): Part[] {
  const kit = uniforms[character];
  const parts = [
    rounded([0, 0.016, 0.01], [0.117, 0.153, 0.114], kit.skin),
    rounded([0, -0.067, 0.039], [0.091, 0.063, 0.081], kit.skin),
    rounded([0, -0.016, 0.114], [0.022, 0.036, 0.024], kit.skin),
  ];
  if (character === "vanguard") {
    parts.push(
      rounded([0, 0.079, -0.012], [0.143, 0.123, 0.132], kit.plate),
      plate([0, 0.098, 0.129], [0.218, 0.044, 0.041], kit.trim),
      plate([0, 0.034, 0.122], [0.224, 0.083, 0.052], "#232b30"),
      plate([0, 0.053, 0.15], [0.203, 0.015, 0.009], kit.feature),
      plate([0, -0.073, 0.116], [0.11, 0.057, 0.043], "#343936"),
    );
    for (const side of [-1, 1]) {
      parts.push(
        rounded([side * 0.115, -0.013, 0.017], [0.037, 0.095, 0.077], kit.plate, side * 0.16),
        plate([side * 0.14, 0.014, 0.011], [0.013, 0.054, 0.059], kit.trim),
      );
    }
  } else if (character === "wraith") {
    parts.push(
      rounded([0, -0.092, 0.056], [0.116, 0.06, 0.099], "#23252d"),
      rounded([0, -0.101, 0.087], [0.104, 0.023, 0.075], kit.plate, 0.12),
      ...wraithHair(),
    );
  } else {
    parts.push(
      rounded([0.014, 0.119, -0.016], [0.116, 0.078, 0.115], "#463128", -0.09),
      rounded([-0.067, 0.079, -0.043], [0.056, 0.089, 0.089], "#463128", 0.27),
      rounded([0, 0.067, 0.049], [0.126, 0.029, 0.084], kit.trim, 0.08),
      rounded([0, -0.087, 0.097], [0.102, 0.062, 0.036], "#69372f", -0.07),
      plate([0, -0.082, 0.131], [0.132, 0.017, 0.01], kit.trim, -0.09),
      plate([-0.108, 0.055, -0.036], [0.042, 0.052, 0.12], kit.trim, 0.28),
      plate([-0.118, -0.104, -0.06], [0.043, 0.191, 0.028], "#69372f", -0.19),
    );
    for (const side of [-1, 1]) {
      parts.push(
        rounded([side * 0.048, 0.019, 0.111], [0.028, 0.013, 0.01], "#47352f", -side * 0.09),
        rounded([side * 0.047, 0.019, 0.12], [0.017, 0.006, 0.004], "#d9c9b5", -side * 0.09),
        rounded([side * 0.045, 0.019, 0.124], [0.007, 0.006, 0.003], "#55443b"),
      );
    }
  }
  return parts;
}

export type SurvivorRig = {
  group: THREE.Group;
  head: THREE.Group;
  arms: [THREE.Group, THREE.Group];
  legs: [THREE.Group, THREE.Group];
  muzzle: THREE.Object3D;
};

export class SurvivorModels {
  private templates = new Map<CharacterId, THREE.Group>();
  private material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.75,
  });

  create(character: CharacterId): SurvivorRig {
    let template = this.templates.get(character);
    if (!template) {
      template = this.build(character);
      this.templates.set(character, template);
    }
    const group = template.clone(true);
    const joint = (name: string) => group.getObjectByName(name) as THREE.Group;
    return {
      group,
      head: joint("head"),
      arms: [joint("arm-left"), joint("arm-right")],
      legs: [joint("leg-left"), joint("leg-right")],
      muzzle: joint("muzzle"),
    };
  }

  dispose() {
    for (const template of this.templates.values()) {
      template.traverse((object) => {
        if (object instanceof THREE.Mesh) object.geometry.dispose();
      });
    }
    this.templates.clear();
    this.material.dispose();
  }

  private build(character: CharacterId) {
    const kit = uniforms[character];
    const group = new THREE.Group();
    const torso = [
      rounded([0, 1.22, 0], [kit.width, 0.284, 0.143], kit.cloth),
      rounded([0, 0.934, -0.015], [0.188, 0.106, 0.127], kit.pants),
      tapered([0, 1.43, -0.014], [0, 1.582, 0], 0.095, 0.067, kit.cloth),
      character === "wraith" ? rounded([0, 0.965, 0.03], [0.19, 0.04, 0.13], "#282a32") :
        plate([0, 0.965, 0.133], [0.354, 0.062, 0.033], "#2c302d"),
      character === "wraith" ? rounded([0.015, 0.972, 0.158], [0.033, 0.023, 0.012], kit.trim) :
        plate([0.015, 0.972, 0.157], [0.071, 0.052, 0.017], kit.trim),
      rounded([0, 1.224, -0.155], [0.169, 0.238, 0.093], kit.plate),
      plate([0, 1.242, -0.238], [0.22, 0.026, 0.016], kit.trim),
    ];
    if (character === "vanguard") {
      for (const side of [-1, 1]) {
        torso.push(
          plate([side * 0.102, 1.268, 0.139], [0.204, 0.242, 0.083], kit.plate, side * 0.14),
          plate([side * 0.111, 1.331, 0.184], [0.163, 0.037, 0.012], kit.feature, side * 0.14),
          plate([side * 0.097, 1.204, 0.184], [0.152, 0.021, 0.01], kit.trim, side * 0.09),
        );
      }
    } else if (character === "wraith") {
      torso.push(
      rounded([0, 1.45, 0.04], [0.154, 0.064, 0.126], "#252731", -0.06),
      rounded([0, 1.518, 0.011], [0.105, 0.067, 0.103], "#272932", 0.1),
      rounded([-0.126, 1.392, 0.056], [0.067, 0.088, 0.11], kit.plate, -0.45),
      rounded([0.126, 1.392, 0.056], [0.067, 0.088, 0.11], kit.plate, 0.45),
      rounded([-0.123, 1.273, 0.119], [0.06, 0.179, 0.048], "#32343d", -0.18),
      rounded([0.121, 1.273, 0.124], [0.054, 0.178, 0.044], "#34363e", 0.15),
      curvedTrim([[-0.099, 1.382, 0.159], [-0.026, 1.334, 0.165], [0.043, 1.256, 0.155], [0.151, 1.133, 0.119]], 0.014, "#1c1d26"),
      curvedTrim([[-0.088, 1.393, 0.168], [-0.018, 1.348, 0.18], [0.034, 1.356, 0.179], [0.079, 1.392, 0.162]], 0.005, "#aeb1bd"),
      curvedTrim([[-0.088, 1.386, 0.166], [-0.032, 1.322, 0.161], [0.012, 1.31, 0.172], [0.082, 1.385, 0.163]], 0.004, "#757989"),
      rounded([0.013, 1.313, 0.175], [0.016, 0.024, 0.008], "#aeb1bd", -0.15),
      rounded([0.155, 1.088, 0.099], [0.061, 0.093, 0.064], "#202129", 0.16),
      rounded([0.154, 1.131, 0.136], [0.052, 0.012, 0.022], kit.trim, 0.16),
      );
    } else {
      torso.push(
        plate([-0.084, 1.37, 0.153], [0.076, 0.20, 0.023], kit.feature, 0.30),
        plate([0.076, 1.362, 0.151], [0.055, 0.215, 0.023], kit.trim, -0.36),
        plate([-0.018, 1.14, 0.158], [0.025, 0.279, 0.017], "#48332f", -0.077),
        plate([0.133, 1.15, 0.13], [0.097, 0.086, 0.044], kit.plate, -0.12),
      );
    }
    group.add(meshFor(torso, this.material));

    const head = makeJoint("head", [0, 1.674, 0], group);
    const headMesh = meshFor(makeHead(character), this.material);
    headMesh.userData.head = true;
    head.add(headMesh);

    for (const side of [-1, 1]) {
      const isLeft = side === -1;
      const sideName = isLeft ? "left" : "right";
      const arm = makeJoint(`arm-${sideName}`, [side * (kit.width + 0.006), 1.387, 0], group);
      const elbow: Point = [isLeft ? 0.053 : -0.016, -0.183, 0.148];
      const wrist: Point = [isLeft ? kit.width * 2 - 0.12 : -0.12, -0.106, isLeft ? 0.382 : 0.192];
      const sleeves = [
        rounded([side * 0.005, -0.047, 0.03], [0.086, 0.14, 0.103], kit.cloth, side * 0.16),
        tapered([0, -0.044, 0.035], elbow, 0.079, 0.057, kit.cloth),
        tapered(elbow, wrist, 0.051, 0.04, kit.plate),
        rounded(wrist, [0.045, 0.053, 0.057], "#303333", side * 0.24),
        plate([side * 0.043, -0.113, 0.1], [0.064, 0.039, 0.051], kit.feature, side * 0.23),
      ];
      if (character === "vanguard") {
        sleeves.push(
          rounded([side * 0.027, -0.064, 0.039], [0.101, 0.103, 0.107], kit.plate, side * 0.23),
          plate([side * 0.069, -0.04, 0.108], [0.078, 0.035, 0.017], kit.feature, side * 0.42),
        );
      } else if (character === "wraith") {
        sleeves.push(
          rounded([side * 0.023, -0.019, 0.015], [0.091, 0.087, 0.101], kit.plate, side * 0.24),
          rounded([side * 0.029, -0.056, 0.098], [0.065, 0.047, 0.045], "#30323a", side * 0.28),
        );
      }
      if (!isLeft) {
        sleeves.push(
          plate([-0.126, -0.06, 0.318], [0.105, 0.112, 0.325], "#353e44"),
          plate([-0.126, -0.003, 0.245], [0.085, 0.034, 0.248], "#515959"),
          plate([-0.126, -0.133, 0.314], [0.073, 0.105, 0.083], "#2a3338", -0.14),
          plate([-0.126, 0.025, 0.345], [0.049, 0.025, 0.056], kit.trim),
          tapered([-0.126, -0.047, 0.451], [-0.126, -0.047, 0.618], 0.037, 0.028, "#293037"),
        );
        makeJoint("muzzle", [-0.126, -0.047, 0.619], arm);
      }
      arm.add(meshFor(sleeves, this.material));

      const leg = makeJoint(`leg-${sideName}`, [side * 0.117, 0.914, -0.009], group);
      leg.add(meshFor([
        tapered([0, 0.022, 0], [0, -0.42, 0.027], 0.101, 0.073, kit.pants),
        tapered([0, -0.423, 0.022], [0, -0.738, -0.026], 0.075, 0.054, kit.pants),
        rounded([0, -0.441, 0.081], [0.066, 0.092, 0.03], kit.plate),
        rounded([0, -0.737, -0.012], [0.067, 0.109, 0.067], kit.boots),
        rounded([0, -0.845, 0.053], [0.075, 0.063, 0.132], kit.boots),
        plate([0, -0.901, 0.054], [0.148, 0.026, 0.233], "#222829"),
        plate([0, -0.751, 0.049], [0.10, 0.023, 0.027], kit.trim),
      ], this.material));
    }
    return group;
  }
}
