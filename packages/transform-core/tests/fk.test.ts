import {describe, expect, it} from 'vitest';
import type {UrdfJointSpec} from '../src/index';
import {KinematicChain, Transform, urdfRpyToRotation} from '../src/index';
import {DEG, expectTransformClose, expectVec3Close} from './helpers';

describe('urdfRpyToRotation (URDF 고정축 XYZ 규약)', () => {
  it('rpy = (90°, 0, 0)은 Rx(90°)다', () => {
    expectTransformClose(urdfRpyToRotation([90 * DEG, 0, 0]), Transform.rotationX(90 * DEG));
  });

  it('rpy = (r, p, y)는 Rz(y)·Ry(p)·Rx(r)다', () => {
    const [r, p, y] = [40 * DEG, -25 * DEG, 110 * DEG];
    expectTransformClose(
      urdfRpyToRotation([r, p, y]),
      Transform.rotationZ(y).compose(Transform.rotationY(p)).compose(Transform.rotationX(r)),
    );
  });
});

/** 링크 길이 1짜리 2R 평면 팔 + flange (URDF 스타일 정의). */
function planarArm(): KinematicChain {
  const joints: UrdfJointSpec[] = [
    {name: 'j1', type: 'revolute', parent: 'base', child: 'link1', axis: [0, 0, 1]},
    {
      name: 'j2',
      type: 'revolute',
      parent: 'link1',
      child: 'link2',
      origin: {xyz: [1, 0, 0]},
      axis: [0, 0, 1],
    },
    {name: 'jf', type: 'fixed', parent: 'link2', child: 'flange', origin: {xyz: [1, 0, 0]}},
  ];
  return new KinematicChain(joints);
}

describe('KinematicChain — 2R 평면 팔 known-answer', () => {
  it('base/tip link를 parent-child 관계에서 유도한다', () => {
    const arm = planarArm();
    expect(arm.baseLink).toBe('base');
    expect(arm.tipLink).toBe('flange');
    expect(arm.movableJointNames()).toEqual(['j1', 'j2']);
  });

  it('영 자세: flange는 (2, 0, 0)', () => {
    const t = planarArm().fk();
    expectVec3Close(t.translation, [2, 0, 0]);
    expectTransformClose(Transform.fromRotation(t.rotation), Transform.identity());
  });

  it('θ = (90°, 0): flange는 (0, 2, 0)', () => {
    expectVec3Close(planarArm().fk({j1: 90 * DEG}).translation, [0, 2, 0]);
  });

  it('θ = (90°, -90°): flange는 (1, 1, 0), 회전은 항등', () => {
    const t = planarArm().fk({j1: 90 * DEG, j2: -90 * DEG});
    expectVec3Close(t.translation, [1, 1, 0]);
    expectTransformClose(Transform.fromRotation(t.rotation), Transform.identity());
  });

  it('θ = (30°, 60°): 표준 2R 공식 x = cosθ₁ + cos(θ₁+θ₂)와 일치', () => {
    const t = planarArm().fk({j1: 30 * DEG, j2: 60 * DEG});
    expectVec3Close(t.translation, [
      Math.cos(30 * DEG) + Math.cos(90 * DEG),
      Math.sin(30 * DEG) + Math.sin(90 * DEG),
      0,
    ]);
  });

  it('linkPoses는 중간 link(팔꿈치) 위치도 준다', () => {
    const poses = planarArm().linkPoses({j1: 90 * DEG});
    expectVec3Close(poses.get('link2')!.translation, [0, 1, 0]);
  });
});

describe('KinematicChain — URDF 기하 일치', () => {
  // <origin>에 xyz와 rpy가 모두 있는 3-조인트 체인
  const joints: UrdfJointSpec[] = [
    {
      name: 'shoulder',
      type: 'revolute',
      parent: 'world',
      child: 'l1',
      origin: {xyz: [0, 0, 0.4]},
      axis: [0, 0, 1],
    },
    {
      name: 'elbow',
      type: 'revolute',
      parent: 'l1',
      child: 'l2',
      origin: {xyz: [0, 0.1, 0], rpy: [90 * DEG, 0, 0]},
      axis: [0, 0, 1],
    },
    {
      name: 'wrist',
      type: 'fixed',
      parent: 'l2',
      child: 'flange',
      origin: {xyz: [0.2, 0, 0]},
    },
  ];

  it('영 자세의 flange pose가 origin들의 합성(URDF 기하)과 일치한다', () => {
    const t = new KinematicChain(joints).fk();
    // 손계산: (0,0,0.4) + (0,0.1,0) + Rx90·(0.2,0,0) = (0.2, 0.1, 0.4)
    expectVec3Close(t.translation, [0.2, 0.1, 0.4]);
    // 자세는 origin rpy의 곱 = Rx(90°)
    expectTransformClose(Transform.fromRotation(t.rotation), Transform.rotationX(90 * DEG));
  });

  it('elbow 90°: 회전축이 origin rpy로 기울어진 채 동작한다', () => {
    const t = new KinematicChain(joints).fk({elbow: 90 * DEG});
    // 손계산: Rz90·(0.2,0,0) = (0,0.2,0); Rx90·(0,0.2,0) = (0,0,0.2)
    // → (0,0,0.4) + (0,0.1,0) + (0,0,0.2) = (0, 0.1, 0.6)
    expectVec3Close(t.translation, [0, 0.1, 0.6]);
  });

  it('prismatic 조인트는 축 방향으로 병진한다 (축은 자동 정규화)', () => {
    const chain = new KinematicChain([
      {
        name: 'slider',
        type: 'prismatic',
        parent: 'base',
        child: 'carriage',
        origin: {xyz: [0.5, 0, 0]},
        axis: [0, 0, 2],
      },
    ]);
    expectVec3Close(chain.fk({slider: 0.25}).translation, [0.5, 0, 0.25]);
  });

  it('revolute 축도 자동 정규화된다', () => {
    const make = (axis: [number, number, number]) =>
      new KinematicChain([
        {name: 'j', type: 'revolute', parent: 'a', child: 'b', axis},
        {name: 'f', type: 'fixed', parent: 'b', child: 'c', origin: {xyz: [1, 0, 0]}},
      ]).fk({j: 90 * DEG});
    expectTransformClose(make([0, 0, 2]), make([0, 0, 1]));
  });
});

describe('KinematicChain — 입력 검증', () => {
  it('값을 주지 않은 조인트는 0으로 둔다', () => {
    expectTransformClose(planarArm().fk(), planarArm().fk({j1: 0, j2: 0}));
  });

  it('알 수 없는 조인트 이름은 throw', () => {
    expect(() => planarArm().fk({없는조인트: 1})).toThrow();
  });

  it('fixed 조인트에 0이 아닌 값을 주면 throw', () => {
    expect(() => planarArm().fk({jf: 0.1})).toThrow();
  });

  it('직렬 체인이 아니면(분기) throw', () => {
    expect(
      () =>
        new KinematicChain([
          {name: 'a', type: 'fixed', parent: 'base', child: 'left'},
          {name: 'b', type: 'fixed', parent: 'base', child: 'right'},
        ]),
    ).toThrow();
  });
});
