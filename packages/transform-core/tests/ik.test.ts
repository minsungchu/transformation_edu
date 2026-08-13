import {describe, expect, it} from 'vitest';
import type {CartesianJogStep, IkResult, JogReferenceFrame} from '../src/index';
import {
  KinematicChain,
  Transform,
  cartesianJogTarget,
  normVec3,
  rotationMat3ToAxisAngle,
  solveIk,
  subVec3,
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
