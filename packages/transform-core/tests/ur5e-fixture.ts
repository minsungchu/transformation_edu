/**
 * UR5e의 base_link → tool0 직렬 체인 — site/static/urdf/ur5e.urdf에서 그대로 옮긴
 * 값이다 (뷰어가 조그에 쓰는 바로 그 체인). IK 테스트가 장난감 팔이 아니라
 * 실제 6-DOF 손목 기하에서 돌도록 하기 위한 픽스처.
 */
import type {UrdfJointSpec} from '../src/index';
import {KinematicChain} from '../src/index';

const TWO_PI = 6.28318530718;
const HALF_PI = 1.57079632679;

export const UR5E_JOINTS: UrdfJointSpec[] = [
  {
    name: 'base_link-base_link_inertia',
    type: 'fixed',
    parent: 'base_link',
    child: 'base_link_inertia',
    origin: {rpy: [0, 0, Math.PI]},
  },
  {
    name: 'shoulder_pan_joint',
    type: 'revolute',
    parent: 'base_link_inertia',
    child: 'shoulder_link',
    origin: {xyz: [0, 0, 0.1625]},
    axis: [0, 0, 1],
    limit: {lower: -TWO_PI, upper: TWO_PI},
  },
  {
    name: 'shoulder_lift_joint',
    type: 'revolute',
    parent: 'shoulder_link',
    child: 'upper_arm_link',
    origin: {rpy: [1.570796327, 0, 0]},
    axis: [0, 0, 1],
    limit: {lower: -TWO_PI, upper: TWO_PI},
  },
  {
    name: 'elbow_joint',
    type: 'revolute',
    parent: 'upper_arm_link',
    child: 'forearm_link',
    origin: {xyz: [-0.425, 0, 0]},
    axis: [0, 0, 1],
    limit: {lower: -Math.PI, upper: Math.PI},
  },
  {
    name: 'wrist_1_joint',
    type: 'revolute',
    parent: 'forearm_link',
    child: 'wrist_1_link',
    origin: {xyz: [-0.3922, 0, 0.1333]},
    axis: [0, 0, 1],
    limit: {lower: -TWO_PI, upper: TWO_PI},
  },
  {
    name: 'wrist_2_joint',
    type: 'revolute',
    parent: 'wrist_1_link',
    child: 'wrist_2_link',
    origin: {xyz: [0, -0.0997, 0], rpy: [1.570796327, 0, 0]},
    axis: [0, 0, 1],
    limit: {lower: -TWO_PI, upper: TWO_PI},
  },
  {
    name: 'wrist_3_joint',
    type: 'revolute',
    parent: 'wrist_2_link',
    child: 'wrist_3_link',
    origin: {xyz: [0, 0.0996, 0], rpy: [1.57079632659, Math.PI, Math.PI]},
    axis: [0, 0, 1],
    limit: {lower: -TWO_PI, upper: TWO_PI},
  },
  {
    name: 'wrist_3-flange',
    type: 'fixed',
    parent: 'wrist_3_link',
    child: 'flange',
    origin: {rpy: [0, -HALF_PI, -HALF_PI]},
  },
  {
    name: 'flange-tool0',
    type: 'fixed',
    parent: 'flange',
    child: 'tool0',
    origin: {rpy: [HALF_PI, 0, HALF_PI]},
  },
];

export function ur5eChain(): KinematicChain {
  return new KinematicChain(UR5E_JOINTS);
}

/** 뷰어가 쓰는 초기 자세(robots.ts의 restPose)와 같은 값. */
export const UR5E_REST_POSE: Record<string, number> = {
  shoulder_pan_joint: 0,
  shoulder_lift_joint: -1.2,
  elbow_joint: 1.35,
  wrist_1_joint: -1.72,
  wrist_2_joint: -Math.PI / 2,
  wrist_3_joint: 0,
};
