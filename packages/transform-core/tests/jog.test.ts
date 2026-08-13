import {describe, expect, it} from 'vitest';
import type {CartesianJogStep, JogControlFrame} from '../src/index';
import {
  Transform,
  cartesianJogTarget,
  flangePoseFromTcp,
  jogDelta,
  jogTargetFlangePose,
  normVec3,
  subVec3,
  tcpPoseFromFlange,
} from '../src/index';
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

// ── tool 오프셋: Base / Flange / TCP ────────────────────────────────────

/** 그리퍼 길이 (m) — flange → TCP 오프셋의 크기. */
const TOOL_LENGTH = 0.12;
/** approach 축(+Z)으로만 뻗은 오프셋 $T^{flange}_{tcp}$ — 회전 없음. */
const TOOL_OFFSET = Transform.fromTranslation([0, 0, TOOL_LENGTH]);

/**
 * 플랜지가 (0.4, 0.1, 0.6)에서 y축 90° 돌아 approach 축(+Z)이 World +X를 보는 자세.
 * 그러면 TCP는 그 앞 0.12 m, 즉 (0.52, 0.1, 0.6)에 놓인다.
 */
function sideFacingFlange(): Transform {
  return Transform.fromTranslation([0.4, 0.1, 0.6]).compose(Transform.rotationY(90 * DEG));
}

/** 목표 플랜지 pose에서 실제로 TCP가 어디로 갔는지. */
function tcpOf(flangeTarget: Transform): Transform {
  return tcpPoseFromFlange(flangeTarget, TOOL_OFFSET);
}

function jog(flange: Transform, step: CartesianJogStep, frame: JogControlFrame): Transform {
  return jogTargetFlangePose({flange, toolOffset: TOOL_OFFSET, step, frame});
}

describe('tcpPoseFromFlange / flangePoseFromTcp', () => {
  it('오프셋만큼 approach 축으로 나간 점이 TCP다', () => {
    expectVec3Close(tcpOf(sideFacingFlange()).translation, [0.52, 0.1, 0.6]);
  });

  it('두 변환은 서로의 역이다 (IK에 넣기 전 되돌리기가 정확하다)', () => {
    const flange = sideFacingFlange();
    expectTransformClose(flangePoseFromTcp(tcpPoseFromFlange(flange, TOOL_OFFSET), TOOL_OFFSET), flange);
  });
});

describe('jogTargetFlangePose — Base 병진은 자세와 무관하게 World 축 방향', () => {
  const step: CartesianJogStep = {kind: 'translate', axis: [1, 0, 0], amount: 0.1};

  it('플랜지가 어떻게 기울어져 있어도 TCP는 World +X로 그만큼 간다', () => {
    for (const tilt of [
      Transform.identity(),
      Transform.rotationY(90 * DEG),
      Transform.rotationZ(-40 * DEG).compose(Transform.rotationX(70 * DEG)),
    ]) {
      const flange = Transform.fromTranslation([0.4, 0.1, 0.6]).compose(tilt);
      const before = tcpOf(flange).translation;
      const target = jog(flange, step, 'base');
      expectVec3Close(tcpOf(target).translation, [before[0] + 0.1, before[1], before[2]]);
      // 자세는 건드리지 않는다.
      expectTransformClose(Transform.fromRotation(target.rotation), Transform.fromRotation(flange.rotation));
    }
  });

  it('플랜지 목표도 같은 World 델타만큼 평행이동한다 (오프셋이 상쇄된다)', () => {
    const flange = sideFacingFlange();
    expectVec3Close(jog(flange, step, 'base').translation, [0.5, 0.1, 0.6]);
  });

  it('Base 회전은 TCP를 제자리에 두고 자세만 World 축 기준으로 돌린다', () => {
    const flange = sideFacingFlange();
    const target = jog(flange, {kind: 'rotate', axis: [0, 0, 1], amount: 25 * DEG}, 'base');
    // 제어점 = TCP — 그리퍼 끝단이 회전중심이므로 그 자리에 머문다.
    expectVec3Close(tcpOf(target).translation, [0.52, 0.1, 0.6]);
    expectTransformClose(
      Transform.fromRotation(target.rotation),
      Transform.rotationZ(25 * DEG).compose(Transform.fromRotation(flange.rotation)),
    );
  });
});

describe('jogTargetFlangePose — Flange 회전 vs TCP 회전 (회전중심 차이)', () => {
  // approach 축과 수직인 축으로 돌려 두 회전중심의 차이가 드러나게 한다
  // (approach 축 자신으로 돌리면 두 점 모두 제자리라 구분되지 않는다).
  const step: CartesianJogStep = {kind: 'rotate', axis: [0, 1, 0], amount: 90 * DEG};

  it('Flange 회전은 6축 원점을 고정하고 TCP를 크게 끌고 간다', () => {
    const target = jog(sideFacingFlange(), step, 'flange');
    // 플랜지(회전중심)는 제자리.
    expectVec3Close(target.translation, [0.4, 0.1, 0.6]);
    // TCP는 반지름 0.12 m 의 원호를 따라 90° — 아래로 꺾여 내려온다.
    expectVec3Close(tcpOf(target).translation, [0.4, 0.1, 0.6 - TOOL_LENGTH]);
  });

  it('TCP 회전은 그리퍼 끝단을 고정하고 플랜지를 끌고 간다', () => {
    const target = jog(sideFacingFlange(), step, 'tcp');
    // TCP(회전중심)는 제자리.
    expectVec3Close(tcpOf(target).translation, [0.52, 0.1, 0.6]);
    // 대신 플랜지가 TCP 둘레로 돌아 위로 올라간다.
    expectVec3Close(target.translation, [0.52, 0.1, 0.6 + TOOL_LENGTH]);
  });

  it('같은 회전 델타인데 자세는 같고 제어점 이동만 다르다', () => {
    const flange = sideFacingFlange();
    const byFlange = jog(flange, step, 'flange');
    const byTcp = jog(flange, step, 'tcp');
    // 회전량은 동일 — 오프셋에 회전이 없으므로 두 프레임의 축이 평행하다.
    expectTransformClose(
      Transform.fromRotation(tcpOf(byFlange).rotation),
      Transform.fromRotation(tcpOf(byTcp).rotation),
    );
    // 그런데 TCP가 간 거리는 완전히 다르다: 원호 한 칸 vs 0.
    const tcpBefore = tcpOf(flange).translation;
    const movedByFlange = normVec3(subVec3(tcpOf(byFlange).translation, tcpBefore));
    const movedByTcp = normVec3(subVec3(tcpOf(byTcp).translation, tcpBefore));
    expect(movedByFlange).toBeCloseTo(TOOL_LENGTH * Math.SQRT2, 9);
    expect(movedByTcp).toBeCloseTo(0, 9);
  });

  it('오프셋이 항등이면(그리퍼 없음) Flange와 TCP 모드가 같아진다', () => {
    const flange = sideFacingFlange();
    const identity = Transform.identity();
    expectTransformClose(
      jogTargetFlangePose({flange, toolOffset: identity, step, frame: 'flange'}),
      jogTargetFlangePose({flange, toolOffset: identity, step, frame: 'tcp'}),
    );
  });

  it('Flange 모드 병진은 플랜지 자신의 축 방향이다', () => {
    // approach(+Z)로 밀면 World +X로 (플랜지가 그쪽을 보고 있으므로).
    const target = jog(sideFacingFlange(), {kind: 'translate', axis: [0, 0, 1], amount: 0.05}, 'flange');
    expectVec3Close(target.translation, [0.45, 0.1, 0.6]);
  });
});
