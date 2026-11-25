import * as T from "three";

export function box(group: T.Group, material: T.Material, x: number, y: number, z: number,
  width: number, height: number, length: number): T.Mesh {
  const mesh = new T.Mesh(new T.BoxGeometry(width, height, length), material);
  mesh.position.set(x, y, z);
  group.add(mesh);
  return mesh;
}

export function rod(group: T.Group, material: T.Material, radius: number, a: T.Vector3, b: T.Vector3): void {
  const direction = b.clone().sub(a);
  const mesh = new T.Mesh(new T.CylinderGeometry(radius, radius, direction.length(), 8), material);
  mesh.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), direction.normalize());
  mesh.position.copy(a).lerp(b, 0.5);
  group.add(mesh);
}
