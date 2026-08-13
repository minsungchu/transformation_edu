import {describe, expect, it} from 'vitest';
import type {Vec3} from '../src/index';
import {
  mat3ApproxEquals,
  rotationMat3AxisAngle,
  rotationMat3ToAxisAngle,
  rotationMat3X,
  rotationMat3Y,
  rotationMat3Z,
} from '../src/index';
import {DEG, expectVec3Close, makeRng} from './helpers';

describe('rotationMat3ToAxisAngle', () => {
  it('항등 회전은 영벡터다', () => {
    expectVec3Close(rotationMat3ToAxisAngle([1, 0, 0, 0, 1, 0, 0, 0, 1]), [0, 0, 0]);
  });

  it('기본축 회전은 축 × 각도로 나온다', () => {
    expectVec3Close(rotationMat3ToAxisAngle(rotationMat3X(30 * DEG)), [30 * DEG, 0, 0]);
    expectVec3Close(rotationMat3ToAxisAngle(rotationMat3Y(-45 * DEG)), [0, -45 * DEG, 0]);
    expectVec3Close(rotationMat3ToAxisAngle(rotationMat3Z(120 * DEG)), [0, 0, 120 * DEG]);
  });

  it('rotationMat3AxisAngle의 역이다 (임의 축·각 왕복)', () => {
    const rng = makeRng(7);
    for (let i = 0; i < 60; i++) {
      const axis: Vec3 = [rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1];
      const norm = Math.hypot(axis[0], axis[1], axis[2]);
      if (norm < 1e-6) {
        continue;
      }
      const unit: Vec3 = [axis[0] / norm, axis[1] / norm, axis[2] / norm];
      const angle = rng() * (Math.PI - 0.02) + 0.01; // (0, π)
      const back = rotationMat3ToAxisAngle(rotationMat3AxisAngle(unit, angle));
      expectVec3Close(back, [unit[0] * angle, unit[1] * angle, unit[2] * angle]);
    }
  });

  it('회전각이 π에 가까워도 축을 잃지 않는다', () => {
    const axes: Vec3[] = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
      [1 / Math.sqrt(3), 1 / Math.sqrt(3), 1 / Math.sqrt(3)],
    ];
    for (const axis of axes) {
      const m = rotationMat3AxisAngle(axis, Math.PI);
      const v = rotationMat3ToAxisAngle(m);
      const angle = Math.hypot(v[0], v[1], v[2]);
      // 축 부호는 ±로 모호하므로 회전 벡터를 다시 행렬로 만들어 비교한다.
      expect(angle).toBeCloseTo(Math.PI, 6);
      expect(mat3ApproxEquals(rotationMat3AxisAngle(v, angle), m, 1e-6)).toBe(true);
    }
  });

  it('아주 작은 회전은 선형 근사로 안정적으로 나온다', () => {
    const v = rotationMat3ToAxisAngle(rotationMat3Z(1e-10));
    expectVec3Close(v, [0, 0, 1e-10]);
  });
});
