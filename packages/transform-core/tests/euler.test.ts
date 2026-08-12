import {describe, expect, it} from 'vitest';
import type {EulerOrder} from '../src/index';
import {
  eulerToRotation,
  mat3ApproxEquals,
  mat3Multiply,
  rotationMat3X,
  rotationMat3Y,
  rotationMat3Z,
  rotationToEuler,
} from '../src/index';
import {DEG, makeRng} from './helpers';

const ORDERS: EulerOrder[] = ['XYZ', 'XZY', 'YXZ', 'YZX', 'ZXY', 'ZYX'];

describe('passive Euler ↔ rotation matrix', () => {
  describe('known-answer', () => {
    it("ZYX [90°, 0, 0]은 Rz(90°)와 같다", () => {
      expect(
        mat3ApproxEquals(eulerToRotation([90 * DEG, 0, 0], 'ZYX'), rotationMat3Z(90 * DEG)),
      ).toBe(true);
    });

    it("ZYX [a, b, c]는 Rz(a)·Ry(b)·Rx(c)다 (passive: 회전된 축 기준으로 다음 회전)", () => {
      const [a, b, c] = [30 * DEG, 20 * DEG, -70 * DEG];
      const expected = mat3Multiply(mat3Multiply(rotationMat3Z(a), rotationMat3Y(b)), rotationMat3X(c));
      expect(mat3ApproxEquals(eulerToRotation([a, b, c], 'ZYX'), expected)).toBe(true);
    });

    it("XYZ [90°, 90°, 0]: x̂ 기준 90° 후 (회전된) ŷ 기준 90°", () => {
      const expected = mat3Multiply(rotationMat3X(90 * DEG), rotationMat3Y(90 * DEG));
      expect(mat3ApproxEquals(eulerToRotation([90 * DEG, 90 * DEG, 0], 'XYZ'), expected)).toBe(true);
    });
  });

  describe('왕복 변환 (euler → R → euler)', () => {
    it('중간각이 짐벌락 밖이면 각도 자체가 복원된다 — 모든 order', () => {
      const rng = makeRng(2024);
      for (const order of ORDERS) {
        for (let n = 0; n < 50; n++) {
          const angles: [number, number, number] = [
            (rng() * 2 - 1) * Math.PI,
            (rng() - 0.5) * Math.PI * 0.96,
            (rng() * 2 - 1) * Math.PI,
          ];
          const recovered = rotationToEuler(eulerToRotation(angles, order), order);
          expect(recovered[0]).toBeCloseTo(angles[0], 9);
          expect(recovered[1]).toBeCloseTo(angles[1], 9);
          expect(recovered[2]).toBeCloseTo(angles[2], 9);
        }
      }
    });

    it('행렬 수준 왕복(R → euler → R)은 항상 일치한다 — 모든 order', () => {
      const rng = makeRng(777);
      for (const order of ORDERS) {
        for (let n = 0; n < 50; n++) {
          const angles: [number, number, number] = [
            (rng() * 2 - 1) * Math.PI,
            (rng() * 2 - 1) * Math.PI,
            (rng() * 2 - 1) * Math.PI,
          ];
          const m = eulerToRotation(angles, order);
          const back = eulerToRotation(rotationToEuler(m, order), order);
          expect(mat3ApproxEquals(back, m, 1e-9)).toBe(true);
        }
      }
    });

    it('짐벌락(중간각 ±90°)에서도 행렬 수준 왕복이 일치한다 — 모든 order', () => {
      for (const order of ORDERS) {
        for (const middle of [90 * DEG, -90 * DEG]) {
          for (const [a, c] of [
            [30 * DEG, 40 * DEG],
            [-120 * DEG, 75 * DEG],
            [0, -15 * DEG],
          ] as const) {
            const m = eulerToRotation([a, middle, c], order);
            const recovered = rotationToEuler(m, order);
            // 짐벌락 규약: 세 번째 각은 0
            expect(recovered[2]).toBe(0);
            expect(mat3ApproxEquals(eulerToRotation(recovered, order), m, 1e-9)).toBe(true);
          }
        }
      }
    });
  });
});
