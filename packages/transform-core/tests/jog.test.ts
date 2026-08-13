import {describe, expect, it} from 'vitest';
import {Transform, cartesianJogTarget, jogDelta} from '../src/index';
import {DEG, expectTransformClose, expectVec3Close} from './helpers';

/** TCP가 z축 기준 90° 돌아간 채 (1, 0, 0.5)에 있는 상태. */
function tiltedTcp(): Transform {
  return Transform.fromTranslation([1, 0, 0.5]).compose(Transform.rotationZ(90 * DEG));
}

describe('jogDelta', () => {
  it('병진 스텝은 축 × 양만큼의 이동이다', () => {
    expectTransformClose(
      jogDelta({kind: 'translate', axis: [0, 1, 0], amount: 0.02}),
      Transform.fromTranslation([0, 0.02, 0]),
    );
  });

  it('회전 스텝은 축 기준 회전이다', () => {
    expectTransformClose(
      jogDelta({kind: 'rotate', axis: [0, 0, 1], amount: 30 * DEG}),
      Transform.rotationZ(30 * DEG),
    );
  });
});

describe('cartesianJogTarget — Base(좌곱) vs Tool(우곱)', () => {
  it('Base 기준 +X는 TCP 자세와 무관하게 World +X로 간다', () => {
    const target = cartesianJogTarget(tiltedTcp(), {kind: 'translate', axis: [1, 0, 0], amount: 0.1}, 'base');
    expectVec3Close(target.translation, [1.1, 0, 0.5]);
    // 자세는 그대로
    expectTransformClose(
      Transform.fromRotation(target.rotation),
      Transform.rotationZ(90 * DEG),
    );
  });

  it('Tool 기준 +X는 TCP 자신의 +X(여기서는 World +Y)로 간다', () => {
    const target = cartesianJogTarget(tiltedTcp(), {kind: 'translate', axis: [1, 0, 0], amount: 0.1}, 'tool');
    expectVec3Close(target.translation, [1, 0.1, 0.5]);
    expectTransformClose(
      Transform.fromRotation(target.rotation),
      Transform.rotationZ(90 * DEG),
    );
  });

  it('TCP 자세가 항등이면 두 기준이 같은 결과를 준다', () => {
    const upright = Transform.fromTranslation([0.4, 0.1, 0.3]);
    const step = {kind: 'translate', axis: [0, 0, 1], amount: 0.05} as const;
    expectTransformClose(
      cartesianJogTarget(upright, step, 'base'),
      cartesianJogTarget(upright, step, 'tool'),
    );
  });

  it('Tool 기준 회전은 TCP 원점을 그 자리에 두고 돌린다', () => {
    const current = tiltedTcp();
    const target = cartesianJogTarget(current, {kind: 'rotate', axis: [0, 0, 1], amount: 30 * DEG}, 'tool');
    expectVec3Close(target.translation, current.translation);
    expectTransformClose(
      Transform.fromRotation(target.rotation),
      Transform.rotationZ(120 * DEG),
    );
  });

  it('Base 기준 회전은 TCP 위치를 그대로 두고 World 축 기준으로 자세만 돌린다', () => {
    const current = tiltedTcp();
    const target = cartesianJogTarget(current, {kind: 'rotate', axis: [0, 0, 1], amount: 90 * DEG}, 'base');
    // 회전 중심은 base 원점이 아니라 TCP 자신 — 위치는 그대로.
    expectVec3Close(target.translation, [1, 0, 0.5]);
    // 자세는 World z축 90° 를 왼쪽에 얹어 총 180°.
    expectTransformClose(
      Transform.fromRotation(target.rotation),
      Transform.rotationZ(180 * DEG),
    );
  });
});
