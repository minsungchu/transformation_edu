/** 3차원 벡터/점. */
export type Vec3 = readonly [number, number, number];

export function addVec3(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function subVec3(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function scaleVec3(v: Vec3, s: number): Vec3 {
  return [v[0] * s, v[1] * s, v[2] * s];
}

export function dotVec3(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function crossVec3(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

export function normVec3(v: Vec3): number {
  return Math.hypot(v[0], v[1], v[2]);
}

export function normalizeVec3(v: Vec3): Vec3 {
  const n = normVec3(v);
  if (n === 0) {
    throw new Error('영벡터는 정규화할 수 없습니다');
  }
  return scaleVec3(v, 1 / n);
}

export function vec3ApproxEquals(a: Vec3, b: Vec3, eps = 1e-9): boolean {
  return (
    Math.abs(a[0] - b[0]) <= eps &&
    Math.abs(a[1] - b[1]) <= eps &&
    Math.abs(a[2] - b[2]) <= eps
  );
}
