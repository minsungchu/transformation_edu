import {describe, expect, it} from 'vitest';
import {Transform} from '../src/index';
import {DEG, expectTransformClose, expectVec3Close, makeRng, randomTransform} from './helpers';

describe('Transform', () => {
  it('항등 변환은 점을 바꾸지 않는다', () => {
    expectVec3Close(Transform.identity().transformPoint([1.5, -2, 3]), [1.5, -2, 3]);
  });

  describe('항등식 T^A_B · T^B_A = I', () => {
    it('임의의 rigid transform 30개에 대해 성립한다', () => {
      const rng = makeRng(42);
      for (let n = 0; n < 30; n++) {
        const tAB = randomTransform(rng);
        expectTransformClose(tAB.compose(tAB.inverse()), Transform.identity());
        expectTransformClose(tAB.inverse().compose(tAB), Transform.identity());
      }
    });

    it('역변환의 역변환은 자기 자신이다', () => {
      const t = randomTransform(makeRng(7));
      expectTransformClose(t.inverse().inverse(), t);
    });
  });

  describe('known-answer: 90° 회전', () => {
    it('Rz(90°)는 x̂를 ŷ로 보낸다', () => {
      expectVec3Close(Transform.rotationZ(90 * DEG).transformPoint([1, 0, 0]), [0, 1, 0]);
    });

    it('Rx(90°)는 ŷ를 ẑ로 보낸다', () => {
      expectVec3Close(Transform.rotationX(90 * DEG).transformPoint([0, 1, 0]), [0, 0, 1]);
    });

    it('Ry(90°)는 ẑ를 x̂로 보낸다', () => {
      expectVec3Close(Transform.rotationY(90 * DEG).transformPoint([0, 0, 1]), [1, 0, 0]);
    });

    it('임의 축 [1,1,1] 기준 120° 회전은 축을 순환시킨다 (x̂→ŷ)', () => {
      const t = Transform.rotationAxisAngle([1, 1, 1], 120 * DEG);
      expectVec3Close(t.transformPoint([1, 0, 0]), [0, 1, 0]);
    });
  });

  describe('P^A = T^A_B · P^B (좌표 표현 변환)', () => {
    it('이동 + 회전 known-answer', () => {
      // B 좌표계: A에서 (1, 0, 0)만큼 이동한 뒤 z축 기준 90° 회전
      const tAB = Transform.fromTranslation([1, 0, 0]).compose(Transform.rotationZ(90 * DEG));
      // B에서 본 점 (1, 0, 0) → A에서는 (1, 1, 0)
      expectVec3Close(tAB.transformPoint([1, 0, 0]), [1, 1, 0]);
      // B의 원점은 A에서 (1, 0, 0)
      expectVec3Close(tAB.transformPoint([0, 0, 0]), [1, 0, 0]);
    });

    it('방향 벡터 변환은 이동을 무시한다', () => {
      const tAB = Transform.fromTranslation([5, 5, 5]).compose(Transform.rotationZ(90 * DEG));
      expectVec3Close(tAB.transformDirection([1, 0, 0]), [0, 1, 0]);
    });
  });

  describe('체인룰 (합성)', () => {
    it('T^A_C = T^A_B · T^B_C — 점 변환을 단계별로 해도 같다', () => {
      const rng = makeRng(123);
      for (let n = 0; n < 10; n++) {
        const tAB = randomTransform(rng);
        const tBC = randomTransform(rng);
        const tAC = tAB.compose(tBC);
        const pC: [number, number, number] = [rng() * 2, rng() * 2, rng() * 2];
        expectVec3Close(tAC.transformPoint(pC), tAB.transformPoint(tBC.transformPoint(pC)));
      }
    });

    it('합성은 결합법칙을 만족한다', () => {
      const rng = makeRng(99);
      const a = randomTransform(rng);
      const b = randomTransform(rng);
      const c = randomTransform(rng);
      expectTransformClose(a.compose(b).compose(c), a.compose(b.compose(c)));
    });

    it('(T^A_B · T^B_C)^{-1} = T^C_B · T^B_A', () => {
      const rng = makeRng(555);
      const tAB = randomTransform(rng);
      const tBC = randomTransform(rng);
      expectTransformClose(
        tAB.compose(tBC).inverse(),
        tBC.inverse().compose(tAB.inverse()),
      );
    });
  });

  it('toMatrix4는 행 우선 4×4를 반환한다', () => {
    const t = Transform.fromTranslation([1, 2, 3]);
    expect(t.toMatrix4()).toEqual([1, 0, 0, 1, 0, 1, 0, 2, 0, 0, 1, 3, 0, 0, 0, 1]);
  });
});
