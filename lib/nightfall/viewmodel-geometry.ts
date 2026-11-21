import * as THREE from "three";

export type Point = readonly [number, number, number];

export function oval(parent: THREE.Group, material: THREE.Material, at: Point, scale: Point) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), material);
  mesh.position.set(...at);
  mesh.scale.set(...scale);
  parent.add(mesh);
  return mesh;
}

export function tapered(parent: THREE.Group, material: THREE.Material, from: Point, to: Point, start: number, end: number) {
  const a = new THREE.Vector3(...from);
  const axis = new THREE.Vector3(...to).sub(a);
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(end, start, axis.length(), 12), material);
  mesh.position.copy(a.addScaledVector(axis, 0.5));
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis.normalize());
  parent.add(mesh);
  return mesh;
}
