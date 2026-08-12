import type {Mat3} from './mat3';
import {mat3Multiply, rotationMat3X, rotationMat3Y, rotationMat3Z} from './mat3';

/**
 * Passive(intrinsic) Euler 회전 — 이 교재의 기본 회전각 표현 (CONTEXT.md).
 *
 * 회전할 때마다 좌표계가 함께 회전하며, 다음 회전은 회전된 좌표계 기준으로
 * 이뤄진다. order 'ZYX'의 각도 [a1, a2, a3]은 "Z축 기준 a1 회전 → (회전된)
 * Y축 기준 a2 회전 → (다시 회전된) X축 기준 a3 회전"을 뜻하고, 행렬로는
 * $R = R_Z(a_1) \cdot R_Y(a_2) \cdot R_X(a_3)$이다.
 */
export type EulerOrder = 'XYZ' | 'XZY' | 'YXZ' | 'YZX' | 'ZXY' | 'ZYX';

/** 각도는 radians, order의 축 글자 순서와 1:1 대응. */
export type EulerAngles = readonly [number, number, number];

const AXIS_INDEX: Record<string, 0 | 1 | 2> = {X: 0, Y: 1, Z: 2};
const AXIS_ROTATION = [rotationMat3X, rotationMat3Y, rotationMat3Z] as const;

/** 짝순열(XYZ, YZX, ZXY) = +1, 홀순열(XZY, YXZ, ZYX) = -1. */
function permutationSign(order: EulerOrder): 1 | -1 {
  return order === 'XYZ' || order === 'YZX' || order === 'ZXY' ? 1 : -1;
}

function axisIndices(order: EulerOrder): [number, number, number] {
  return [
    AXIS_INDEX[order[0]!]!,
    AXIS_INDEX[order[1]!]!,
    AXIS_INDEX[order[2]!]!,
  ];
}

/** Passive Euler 각 → 회전 행렬. */
export function eulerToRotation(angles: EulerAngles, order: EulerOrder): Mat3 {
  const [i, j, k] = axisIndices(order);
  const r1 = AXIS_ROTATION[i]!(angles[0]);
  const r2 = AXIS_ROTATION[j]!(angles[1]);
  const r3 = AXIS_ROTATION[k]!(angles[2]);
  return mat3Multiply(mat3Multiply(r1, r2), r3);
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * 회전 행렬 → passive Euler 각.
 *
 * 두 번째 각이 ±90°(짐벌락)이면 첫 번째·세 번째 회전축이 겹쳐 분해가 유일하지
 * 않다. 이때는 세 번째 각을 0으로 두고 첫 번째 각에 합성 회전을 몰아넣는다 —
 * 반환된 각으로 eulerToRotation을 계산하면 항상 원래 행렬과 일치한다.
 */
export function rotationToEuler(m: Mat3, order: EulerOrder): [number, number, number] {
  const [i, j, k] = axisIndices(order);
  const e = permutationSign(order);
  const at = (row: number, col: number) => m[row * 3 + col]!;

  const sinB = clamp(e * at(i, k), -1, 1);
  const b = Math.asin(sinB);

  if (Math.abs(sinB) < 1 - 1e-9) {
    const a = Math.atan2(-e * at(j, k), at(k, k));
    const c = Math.atan2(-e * at(i, j), at(i, i));
    return [a, b, c];
  }

  // 짐벌락: 세 번째 각 = 0으로 고정.
  const sign = sinB > 0 ? 1 : -1;
  const a = Math.atan2(sign * at(j, i), at(j, j));
  return [a, b, 0];
}
