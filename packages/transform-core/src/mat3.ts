import type {Vec3} from './vec3';

/**
 * 행 우선(row-major) 3×3 회전 행렬.
 * m[row * 3 + col], row/col 0 = x, 1 = y, 2 = z.
 */
export type Mat3 = readonly [
  number, number, number,
  number, number, number,
  number, number, number,
];

export const MAT3_IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

export function mat3Multiply(a: Mat3, b: Mat3): Mat3 {
  const out = new Array<number>(9);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      out[r * 3 + c] =
        a[r * 3]! * b[c]! + a[r * 3 + 1]! * b[3 + c]! + a[r * 3 + 2]! * b[6 + c]!;
    }
  }
  return out as unknown as Mat3;
}

export function mat3Transpose(m: Mat3): Mat3 {
  return [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
}

export function mat3ApplyToVec3(m: Mat3, v: Vec3): Vec3 {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}

export function mat3ApproxEquals(a: Mat3, b: Mat3, eps = 1e-9): boolean {
  for (let i = 0; i < 9; i++) {
    if (Math.abs(a[i]! - b[i]!) > eps) {
      return false;
    }
  }
  return true;
}

/** X축 기준 회전 (radians). */
export function rotationMat3X(angle: number): Mat3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [1, 0, 0, 0, c, -s, 0, s, c];
}

/** Y축 기준 회전 (radians). */
export function rotationMat3Y(angle: number): Mat3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [c, 0, s, 0, 1, 0, -s, 0, c];
}

/** Z축 기준 회전 (radians). */
export function rotationMat3Z(angle: number): Mat3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [c, -s, 0, s, c, 0, 0, 0, 1];
}

/**
 * 회전 행렬 → 회전 벡터(axis × angle, radians). `rotationMat3AxisAngle`의 역이며,
 * 크기가 회전각(0 ~ π), 방향이 회전축이다.
 *
 * 두 자세의 차이를 "얼마나·어느 축으로 돌려야 하는가"라는 3-벡터로 만들 때
 * 쓴다 (IK의 자세 오차 항).
 *
 * $\theta = \arccos((\mathrm{tr}R - 1)/2)$로 각을 먼저 구하는 표준 공식은 각이
 * 0이나 π 근처일 때 무너진다(π에서는 반대칭 성분이 통째로 사라져 축을 잃는다).
 * 그래서 전 구간에서 안정적인 사원수 경로(Shepperd 방식 — 가장 큰 성분을
 * 골라 제곱근을 취한다)를 거친다.
 */
export function rotationMat3ToAxisAngle(m: Mat3): Vec3 {
  const trace = m[0] + m[4] + m[8];
  let w: number;
  let x: number;
  let y: number;
  let z: number;
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    w = s / 4;
    x = (m[7] - m[5]) / s;
    y = (m[2] - m[6]) / s;
    z = (m[3] - m[1]) / s;
  } else if (m[0] > m[4] && m[0] > m[8]) {
    const s = Math.sqrt(1 + m[0] - m[4] - m[8]) * 2;
    w = (m[7] - m[5]) / s;
    x = s / 4;
    y = (m[1] + m[3]) / s;
    z = (m[2] + m[6]) / s;
  } else if (m[4] > m[8]) {
    const s = Math.sqrt(1 + m[4] - m[0] - m[8]) * 2;
    w = (m[2] - m[6]) / s;
    x = (m[1] + m[3]) / s;
    y = s / 4;
    z = (m[5] + m[7]) / s;
  } else {
    const s = Math.sqrt(1 + m[8] - m[0] - m[4]) * 2;
    w = (m[3] - m[1]) / s;
    x = (m[2] + m[6]) / s;
    y = (m[5] + m[7]) / s;
    z = s / 4;
  }
  // q와 −q는 같은 회전 — 회전각이 [0, π]에 오도록 w ≥ 0 쪽을 고른다.
  if (w < 0) {
    w = -w;
    x = -x;
    y = -y;
    z = -z;
  }
  const sinHalf = Math.hypot(x, y, z);
  if (sinHalf === 0) {
    return [0, 0, 0];
  }
  // θ = 2·atan2(sin(θ/2), cos(θ/2)) — 소각에서도 0/0이 되지 않는다.
  const k = (2 * Math.atan2(sinHalf, w)) / sinHalf;
  return [x * k, y * k, z * k];
}

/**
 * 임의 축 기준 회전 (Rodrigues 공식). 축은 자동 정규화된다.
 */
export function rotationMat3AxisAngle(axis: Vec3, angle: number): Mat3 {
  const n = Math.hypot(axis[0], axis[1], axis[2]);
  if (n === 0) {
    throw new Error('회전축은 영벡터일 수 없습니다');
  }
  const x = axis[0] / n;
  const y = axis[1] / n;
  const z = axis[2] / n;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const t = 1 - c;
  return [
    t * x * x + c, t * x * y - s * z, t * x * z + s * y,
    t * x * y + s * z, t * y * y + c, t * y * z - s * x,
    t * x * z - s * y, t * y * z + s * x, t * z * z + c,
  ];
}
