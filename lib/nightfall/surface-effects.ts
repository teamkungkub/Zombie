import * as THREE from "three";
import { surfaceImpactTuning as tuning } from "./weapons";

export type ImpactSurface = "concrete" | "metal";

export function impactSurfaceOf(object: THREE.Object3D): ImpactSurface {
  if (object.userData.impactSurface === "metal") return "metal";
  return object instanceof THREE.Mesh &&
    object.material instanceof THREE.MeshStandardMaterial &&
    object.material.metalness >= 0.32
    ? "metal"
    : "concrete";
}

type Mark = THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
type Sparks = {
  lines: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  velocities: THREE.Vector3[];
  age: number;
};

export class SurfaceEffects {
  private marks: { mesh: Mark; age: number }[] = [];
  private dust: { sprite: THREE.Sprite; velocity: THREE.Vector3; age: number }[] = [];
  private sparks: Sparks[] = [];
  private markGeometry = new THREE.PlaneGeometry(1, 1);
  private markTexture?: THREE.DataTexture;

  constructor(
    private world: THREE.Group,
    private cloudTexture: () => THREE.DataTexture,
  ) {}

  hit(hit: THREE.Intersection, direction: THREE.Vector3) {
    const surface = impactSurfaceOf(hit.object);
    const normal = hit.face?.normal.clone()
      .applyMatrix3(new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld))
      .normalize() ?? direction.clone().negate();
    if (normal.dot(direction) > 0) normal.negate();
    const origin = hit.point.clone().addScaledVector(normal, 0.009);
    const mesh = new THREE.Mesh(this.markGeometry, new THREE.MeshBasicMaterial({
      map: this.markTexture ??= createMarkTexture(),
      color: surface === "metal" ? "#302e28" : "#4a4036",
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    }));
    mesh.raycast = () => {};
    mesh.position.copy(origin);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
    mesh.rotateZ(Math.random() * Math.PI * 2);
    mesh.scale.setScalar(surface === "metal" ? 0.13 : 0.2);
    this.world.add(mesh);
    hit.object.attach(mesh);
    this.marks.push({ mesh, age: 0 });
    if (this.marks.length > tuning.maxMarks) this.removeMark(this.marks.shift()!.mesh);

    if (surface === "metal") {
      const reflected = direction.clone().reflect(normal);
      const velocities = Array.from({ length: 8 }, () =>
        reflected.clone().multiplyScalar(2 + Math.random() * 4)
          .addScaledVector(normal, 0.6)
          .add(new THREE.Vector3(
            (Math.random() - 0.5) * 4,
            (Math.random() - 0.45) * 4,
            (Math.random() - 0.5) * 4,
          )),
      );
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(velocities.length * 6), 3));
      const lines = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({
        color: "#ffd18a",
        transparent: true,
        depthWrite: false,
        toneMapped: false,
      }));
      lines.position.copy(origin);
      lines.frustumCulled = false;
      this.world.add(lines);
      this.sparks.push({ lines, velocities, age: 0 });
    } else {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this.cloudTexture(),
        color: "#cbbba6",
        opacity: 0.7,
        depthWrite: false,
        transparent: true,
        rotation: Math.random() * Math.PI * 2,
      }));
      sprite.position.copy(origin).addScaledVector(normal, 0.045);
      sprite.scale.setScalar(0.25);
      this.world.add(sprite);
      this.dust.push({
        sprite,
        velocity: normal.multiplyScalar(0.62).add(new THREE.Vector3(0, 0.28, 0)),
        age: 0,
      });
    }
    return surface;
  }

  update(dt: number) {
    for (let i = this.marks.length - 1; i >= 0; i--) {
      const mark = this.marks[i];
      mark.age += dt;
      mark.mesh.material.opacity = THREE.MathUtils.clamp((tuning.markSeconds - mark.age) / tuning.fadeSeconds, 0, 1);
      if (mark.age >= tuning.markSeconds) {
        this.removeMark(mark.mesh);
        this.marks.splice(i, 1);
      }
    }
    for (let i = this.dust.length - 1; i >= 0; i--) {
      const dust = this.dust[i];
      dust.age += dt;
      dust.sprite.position.addScaledVector(dust.velocity, dt);
      dust.velocity.multiplyScalar(Math.exp(-dt * 3));
      dust.sprite.scale.addScalar(dt * 1.7);
      dust.sprite.material.opacity = 0.7 * Math.max(0, 1 - dust.age / tuning.dustSeconds) ** 1.2;
      if (dust.age >= tuning.dustSeconds) {
        dust.sprite.removeFromParent();
        dust.sprite.material.dispose();
        this.dust.splice(i, 1);
      }
    }
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const spark = this.sparks[i];
      spark.age += dt;
      if (spark.age >= tuning.sparkSeconds) {
        spark.lines.removeFromParent();
        spark.lines.geometry.dispose();
        spark.lines.material.dispose();
        this.sparks.splice(i, 1);
        continue;
      }
      const positions = spark.lines.geometry.getAttribute("position");
      const tip = spark.age + 0.012;
      const tail = Math.max(0, tip - 0.028);
      spark.velocities.forEach((v, j) => {
        positions.setXYZ(j * 2, v.x * tail, v.y * tail - 5 * tail ** 2, v.z * tail);
        positions.setXYZ(j * 2 + 1, v.x * tip, v.y * tip - 5 * tip ** 2, v.z * tip);
      });
      positions.needsUpdate = true;
      spark.lines.material.opacity = 1 - spark.age / tuning.sparkSeconds;
    }
  }

  clear() {
    this.update(tuning.markSeconds);
  }

  dispose() {
    this.clear();
    this.markGeometry.dispose();
    this.markTexture?.dispose();
  }

  private removeMark(mesh: Mark) {
    mesh.removeFromParent();
    mesh.material.dispose();
  }
}

function createMarkTexture() {
  const size = 32;
  const pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5) / size * 2 - 1;
      const dy = (y + 0.5) / size * 2 - 1;
      const angle = Math.atan2(dy, dx);
      const distance = Math.hypot(dx, dy);
      const edge = 0.58 + 0.085 * Math.sin(angle * 7) + 0.07 * Math.cos(angle * 11);
      const alpha = THREE.MathUtils.clamp((edge - distance) * 5, 0, 1);
      const offset = (y * size + x) * 4;
      const color = distance > edge - 0.13 ? 232 : 94;
      pixels.set([color, color, color, Math.round(alpha * 255)], offset);
    }
  }
  const texture = new THREE.DataTexture(pixels, size, size);
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}
