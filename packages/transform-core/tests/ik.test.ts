import {describe, expect, it} from 'vitest';
import type {
  CartesianJogStep,
  IkResult,
  JogControlFrame,
  JogReferenceFrame,
} from '../src/index';
import {
  KinematicChain,
  Transform,
  cartesianJogTarget,
  jogTargetFlangePose,
  normVec3,
  rotationMat3ToAxisAngle,
  solveIk,
  subVec3,
  tcpPoseFromFlange,
} from '../src/index';
import {DEG, makeRng} from './helpers';
import {UR5E_REST_POSE, ur5eChain} from './ur5e-fixture';

/** 두 pose의 위치·자세 오차 (m, rad). */
function poseGap(a: Transform, b: Transform): {position: number; orientation: number} {
  return {
    position: normVec3(subVec3(a.translation, b.translation)),
    orientation: normVec3(rotationMat3ToAxisAngle(a.inverse().compose(b).rotation)),
  };
}

function expectPoseClose(actual: Transform, expected: Transform, posEps = 1e-4, rotEps = 1e-4): void {
  const gap = poseGap(actual, expected);
  expect(gap.position, `위치 오차 ${gap.position} m`).toBeLessThan(posEps);
  expect(gap.orientation, `자세 오차 ${gap.orientation} rad`).toBeLessThan(rotEps);
}

describe('solveIk — FK(IK(pose)) ≈ pose', () => {
  it('이미 목표에 있으면 반복 없이 seed를 그대로 돌려준다', () => {
    const chain = ur5eChain();
    const target = chain.fk(UR5E_REST_POSE);
    const result = solveIk(chain, target, UR5E_REST_POSE);
    expect(result.converged).toBe(true);
    expect(result.iterations).toBe(0);
    for (const [name, value] of Object.entries(UR5E_REST_POSE)) {
      expect(result.values[name]).toBeCloseTo(value, 12);
    }
  });

  it('흐트러진 seed에서 출발해도 목표 pose로 수렴한다 (UR5e 6-DOF)', () => {
    const chain = ur5eChain();
    const rng = makeRng(20250813);
    const names = Object.keys(UR5E_REST_POSE);
    let solved = 0;
    for (let trial = 0; trial < 25; trial++) {
      // 특이자세를 피하려고 rest pose 주변의 넉넉한 범위에서 목표를 뽑는다.
      const truth: Record<string, number> = {};
      for (const name of names) {
        truth[name] = UR5E_REST_POSE[name]! + (rng() * 2 - 1) * 0.6;
      }
      const target = chain.fk(truth);
      const seed: Record<string, number> = {};
      for (const name of names) {
        seed[name] = truth[name]! + (rng() * 2 - 1) * 0.25;
      }
      const result = solveIk(chain, target, seed);
      if (!result.converged) {
        continue; // 실패는 아래에서 개수로 확인한다 (graceful하면 된다)
      }
      solved++;
      expectPoseClose(chain.fk(result.values), target, 1e-4, 1e-4);
      expect(result.positionError).toBeLessThan(1e-4);
      expect(result.orientationError).toBeLessThan(1e-4);
    }
    // 조그 규모(≤0.25 rad)의 seed 오차에서는 전부 수렴해야 한다.
    expect(solved).toBe(25);
  });

  it('자세만 다른 목표도 푼다 (위치 고정, TCP만 회전)', () => {
    const chain = ur5eChain();
    const current = chain.fk(UR5E_REST_POSE);
    const target = current.compose(Transform.rotationZ(20 * DEG));
    const result = solveIk(chain, target, UR5E_REST_POSE);
    expect(result.converged).toBe(true);
    expectPoseClose(chain.fk(result.values), target);
  });
});

/** 조그 스텝을 n번 적용 — 실패한 스텝은 그냥 무시된다 (뷰어와 같은 규칙). */
function jogRepeat(
  chain: KinematicChain,
  start: Record<string, number>,
  step: CartesianJogStep,
  frame: JogReferenceFrame,
  times: number,
): {values: Record<string, number>; results: IkResult[]} {
  let values = {...start};
  const results: IkResult[] = [];
  for (let i = 0; i < times; i++) {
    const target = cartesianJogTarget(chain.fk(values), step, frame);
    const result = solveIk(chain, target, values);
    results.push(result);
    values = result.values;
  }
  return {values, results};
}

describe('solveIk — incremental 조그 왕복', () => {
  it('Base 기준 +X로 10스텝 간 뒤 −X로 10스텝 오면 원래 자세로 돌아온다', () => {
    const chain = ur5eChain();
    const startPose = chain.fk(UR5E_REST_POSE);

    const out = jogRepeat(chain, UR5E_REST_POSE, {kind: 'translate', axis: [1, 0, 0], amount: 0.005}, 'base', 10);
    expect(out.results.every((r) => r.converged)).toBe(true);
    // 정말 이동했는지 — 10 × 5mm = 50mm
    expect(poseGap(chain.fk(out.values), startPose).position).toBeCloseTo(0.05, 4);

    const back = jogRepeat(chain, out.values, {kind: 'translate', axis: [1, 0, 0], amount: -0.005}, 'base', 10);
    expect(back.results.every((r) => r.converged)).toBe(true);
    expectPoseClose(chain.fk(back.values), startPose);
    for (const [name, value] of Object.entries(UR5E_REST_POSE)) {
      expect(back.values[name]!, `${name}이 왕복 후 제자리로`).toBeCloseTo(value, 3);
    }
  });

  it('Tool 기준 병진 + 회전 조그도 왕복하면 제자리로 돌아온다', () => {
    const chain = ur5eChain();
    const startPose = chain.fk(UR5E_REST_POSE);

    const moved = jogRepeat(chain, UR5E_REST_POSE, {kind: 'translate', axis: [0, 0, 1], amount: 0.01}, 'tool', 5);
    const turned = jogRepeat(chain, moved.values, {kind: 'rotate', axis: [1, 0, 0], amount: 5 * DEG}, 'tool', 4);
    expect([...moved.results, ...turned.results].every((r) => r.converged)).toBe(true);
    expect(poseGap(chain.fk(turned.values), startPose).orientation).toBeCloseTo(20 * DEG, 3);

    const unturned = jogRepeat(chain, turned.values, {kind: 'rotate', axis: [1, 0, 0], amount: -5 * DEG}, 'tool', 4);
    const back = jogRepeat(chain, unturned.values, {kind: 'translate', axis: [0, 0, 1], amount: -0.01}, 'tool', 5);
    expect([...unturned.results, ...back.results].every((r) => r.converged)).toBe(true);
    expectPoseClose(chain.fk(back.values), startPose);
  });

  it('Base +X와 Tool +X는 서로 다른 자세로 간다 (기준 좌표계가 다르므로)', () => {
    const chain = ur5eChain();
    const step: CartesianJogStep = {kind: 'translate', axis: [1, 0, 0], amount: 0.05};
    const base = solveIk(chain, cartesianJogTarget(chain.fk(UR5E_REST_POSE), step, 'base'), UR5E_REST_POSE);
    const tool = solveIk(chain, cartesianJogTarget(chain.fk(UR5E_REST_POSE), step, 'tool'), UR5E_REST_POSE);
    expect(base.converged && tool.converged).toBe(true);
    expect(poseGap(chain.fk(base.values), chain.fk(tool.values)).position).toBeGreaterThan(0.01);
  });
});

describe('solveIk — tool 오프셋이 붙은 조그 (Base / Flange / TCP)', () => {
  /** 뷰어의 석션 그리퍼와 같은 오프셋 — approach 축(+Z)으로 0.12 m. */
  const TOOL_OFFSET = Transform.fromTranslation([0, 0, 0.12]);
  const tcpOf = (flange: Transform): Transform => tcpPoseFromFlange(flange, TOOL_OFFSET);

  /** 조그 → IK 한 스텝. 뷰어가 하는 것과 같은 순서다. */
  function jogStep(
    chain: KinematicChain,
    values: Record<string, number>,
    step: CartesianJogStep,
    frame: JogControlFrame,
  ): {values: Record<string, number>; result: IkResult; target: Transform} {
    const target = jogTargetFlangePose({flange: chain.fk(values), toolOffset: TOOL_OFFSET, step, frame});
    const result = solveIk(chain, target, values);
    return {values: result.values, result, target};
  }

  it('FK(IK(target)) ≈ target — 세 모드 모두 목표 플랜지 pose에 도달한다', () => {
    const chain = ur5eChain();
    const steps: CartesianJogStep[] = [
      {kind: 'translate', axis: [1, 0, 0], amount: 0.03},
      {kind: 'translate', axis: [0, 0, 1], amount: 0.03},
      {kind: 'rotate', axis: [0, 1, 0], amount: 6 * DEG},
      {kind: 'rotate', axis: [1, 0, 0], amount: 6 * DEG},
    ];
    for (const frame of ['base', 'flange', 'tcp'] as JogControlFrame[]) {
      for (const step of steps) {
        const out = jogStep(chain, UR5E_REST_POSE, step, frame);
        expect(out.result.converged, `${frame} / ${step.kind} 수렴`).toBe(true);
        expectPoseClose(chain.fk(out.values), out.target);
      }
    }
  });

  it('Base 병진은 TCP를 World 축 방향으로 정확히 그만큼 옮긴다', () => {
    const chain = ur5eChain();
    const before = tcpOf(chain.fk(UR5E_REST_POSE)).translation;
    const out = jogStep(chain, UR5E_REST_POSE, {kind: 'translate', axis: [0, 1, 0], amount: 0.04}, 'base');
    expect(out.result.converged).toBe(true);
    const after = tcpOf(chain.fk(out.values)).translation;
    const delta = subVec3(after, before);
    expect(delta[0]).toBeCloseTo(0, 4);
    expect(delta[1]).toBeCloseTo(0.04, 4);
    expect(delta[2]).toBeCloseTo(0, 4);
  });

  it('Flange 회전은 6축 원점을, TCP 회전은 그리퍼 끝단을 제자리에 둔다', () => {
    const chain = ur5eChain();
    const start = chain.fk(UR5E_REST_POSE);
    // approach 축과 수직인 축으로 돌려야 두 회전중심의 차이가 드러난다.
    const step: CartesianJogStep = {kind: 'rotate', axis: [0, 1, 0], amount: 10 * DEG};

    const byFlange = jogStep(chain, UR5E_REST_POSE, step, 'flange');
    const byTcp = jogStep(chain, UR5E_REST_POSE, step, 'tcp');
    expect(byFlange.result.converged && byTcp.result.converged).toBe(true);

    const flangeAfterFlangeJog = chain.fk(byFlange.values);
    const flangeAfterTcpJog = chain.fk(byTcp.values);
    // Flange 모드: 플랜지는 제자리, TCP는 원호를 따라 움직인다.
    expect(poseGap(flangeAfterFlangeJog, start).position).toBeLessThan(1e-4);
    const tcpMovedByFlange = poseGap(tcpOf(flangeAfterFlangeJog), tcpOf(start)).position;
    expect(tcpMovedByFlange).toBeCloseTo(2 * 0.12 * Math.sin(5 * DEG), 4);
    // TCP 모드: TCP는 제자리, 대신 플랜지가 움직인다.
    expect(poseGap(tcpOf(flangeAfterTcpJog), tcpOf(start)).position).toBeLessThan(1e-4);
    expect(poseGap(flangeAfterTcpJog, start).position).toBeCloseTo(tcpMovedByFlange, 4);
    // 자세 변화량은 같다 — 다른 것은 회전중심뿐이다.
    expect(poseGap(flangeAfterFlangeJog, start).orientation).toBeCloseTo(
      poseGap(flangeAfterTcpJog, start).orientation,
      4,
    );
  });

  it('Flange 회전과 TCP 회전을 왕복하면 각각 제자리로 돌아온다', () => {
    const chain = ur5eChain();
    const start = chain.fk(UR5E_REST_POSE);
    for (const frame of ['flange', 'tcp'] as JogControlFrame[]) {
      let values = UR5E_REST_POSE;
      for (const amount of [8 * DEG, 8 * DEG, -8 * DEG, -8 * DEG]) {
        const out = jogStep(chain, values, {kind: 'rotate', axis: [1, 0, 0], amount}, frame);
        expect(out.result.converged, `${frame} 왕복 수렴`).toBe(true);
        values = out.values;
      }
      expectPoseClose(chain.fk(values), start, 1e-3, 1e-3);
    }
  });

  it('도달 불가한 스텝은 seed를 그대로 돌려준다 (뷰어가 스텝을 조용히 건너뛴다)', () => {
    const chain = ur5eChain();
    // 팔 길이를 훌쩍 넘는 병진 — 수렴할 수 없다.
    const out = jogStep(chain, UR5E_REST_POSE, {kind: 'translate', axis: [1, 0, 0], amount: 3}, 'tcp');
    expect(out.result.converged).toBe(false);
    for (const [name, value] of Object.entries(UR5E_REST_POSE)) {
      expect(out.values[name]).toBe(value);
    }
  });
});

describe('solveIk — 수렴 실패 시 graceful 반환', () => {
  it('도달할 수 없는 목표는 throw 없이 seed를 그대로 돌려준다', () => {
    const chain = ur5eChain();
    const target = Transform.fromTranslation([5, 5, 5]);
    const result = solveIk(chain, target, UR5E_REST_POSE);
    expect(result.converged).toBe(false);
    for (const [name, value] of Object.entries(UR5E_REST_POSE)) {
      expect(result.values[name]).toBe(value);
    }
    expect(result.positionError).toBeGreaterThan(1);
  });

  it('반복 횟수는 maxIterations를 넘지 않는다 (무한루프 없음)', () => {
    const chain = ur5eChain();
    const result = solveIk(chain, Transform.fromTranslation([3, 0, 0]), UR5E_REST_POSE, {
      maxIterations: 12,
    });
    expect(result.converged).toBe(false);
    expect(result.iterations).toBeLessThanOrEqual(12);
  });

  it('움직일 수 있는 조인트가 없으면 실패로 돌아온다', () => {
    const chain = new KinematicChain([
      {name: 'f', type: 'fixed', parent: 'base', child: 'tip', origin: {xyz: [0.3, 0, 0]}},
    ]);
    const result = solveIk(chain, Transform.fromTranslation([0.31, 0, 0]));
    expect(result.converged).toBe(false);
    expect(result.values).toEqual({});
  });

  it('결과 관절값은 URDF limit 범위 안에 머문다', () => {
    const chain = ur5eChain();
    // 팔을 완전히 접게 만드는(도달 불가에 가까운) 목표로 강하게 밀어 본다.
    const result = solveIk(chain, Transform.fromTranslation([0, 0, 0.1]), UR5E_REST_POSE, {
      maxIterations: 300,
    });
    for (const spec of chain.joints) {
      if (spec.type === 'fixed' || !spec.limit) {
        continue;
      }
      const value = result.values[spec.name]!;
      expect(value).toBeGreaterThanOrEqual(spec.limit.lower);
      expect(value).toBeLessThanOrEqual(spec.limit.upper);
    }
  });

  it('싱귤래리티(완전히 뻗은 팔) 근처에서도 발산하지 않는다', () => {
    const chain = ur5eChain();
    const straight: Record<string, number> = {
      shoulder_pan_joint: 0,
      shoulder_lift_joint: -Math.PI / 2,
      elbow_joint: 0,
      wrist_1_joint: 0,
      wrist_2_joint: 0,
      wrist_3_joint: 0,
    };
    // 뻗은 방향으로 더 나가라고 요구 — 야코비안이 랭크를 잃는 지점.
    const target = cartesianJogTarget(
      chain.fk(straight),
      {kind: 'translate', axis: [0, 0, 1], amount: 0.05},
      'base',
    );
    const result = solveIk(chain, target, straight);
    for (const value of Object.values(result.values)) {
      expect(Number.isFinite(value)).toBe(true);
      expect(Math.abs(value)).toBeLessThan(10);
    }
  });
});
