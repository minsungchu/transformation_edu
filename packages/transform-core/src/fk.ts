import {eulerToRotation} from './euler';
import {Transform} from './transform';
import type {Vec3} from './vec3';

/**
 * URDF <joint> 요소와 1:1 대응하는 조인트 스펙.
 *
 * URDF의 XML을 그대로 옮긴 데이터 구조라서, urdf-loader 등이 파싱한 모델을
 * 이 형태로 넘기면 된다 (transform-core는 렌더러·파서 의존성이 없다).
 */
export interface UrdfJointSpec {
  name: string;
  type: 'fixed' | 'revolute' | 'continuous' | 'prismatic';
  /** 부모 link 이름 (URDF <parent link="...">). */
  parent: string;
  /** 자식 link 이름 (URDF <child link="...">). */
  child: string;
  /**
   * URDF <origin xyz rpy> — 조인트 변위가 0일 때의 T^{parent}_{child}.
   * rpy는 URDF 규약(고정축 XYZ: R = R_Z(yaw)·R_Y(pitch)·R_X(roll)), radians.
   * 이 규약은 URDF 호환을 위한 것으로, 교재 본문의 기본 표현(passive Euler)과는
   * 별개다.
   */
  origin?: {xyz?: Vec3; rpy?: Vec3};
  /** URDF <axis xyz> — 자식 link 좌표계 기준 회전/병진 축. 기본 [1, 0, 0]. */
  axis?: Vec3;
  /**
   * URDF <limit lower upper> — 관절 가동 범위 (revolute는 rad, prismatic은 m).
   * FK는 이 값을 보지 않는다(주어진 값을 그대로 계산). 범위를 지켜야 하는 쪽은
   * IK(`solveIk`)로, 반복 중 관절값을 이 범위로 자른다.
   */
  limit?: {lower: number; upper: number};
}

/** URDF origin의 rpy(roll, pitch, yaw)를 회전 행렬로. */
export function urdfRpyToRotation(rpy: Vec3): Transform {
  const [roll, pitch, yaw] = rpy;
  return Transform.fromRotation(eulerToRotation([yaw, pitch, roll], 'ZYX'));
}

function originTransform(spec: UrdfJointSpec): Transform {
  const xyz = spec.origin?.xyz ?? [0, 0, 0];
  const rpy = spec.origin?.rpy ?? [0, 0, 0];
  return Transform.fromTranslation(xyz).compose(urdfRpyToRotation(rpy));
}

/** 조인트 변위 값 → 해당 조인트의 T^{parent}_{child}. */
export function jointTransform(spec: UrdfJointSpec, value: number): Transform {
  const origin = originTransform(spec);
  switch (spec.type) {
    case 'fixed':
      return origin;
    case 'revolute':
    case 'continuous':
      return origin.compose(Transform.rotationAxisAngle(spec.axis ?? [1, 0, 0], value));
    case 'prismatic': {
      const axis = spec.axis ?? [1, 0, 0];
      const n = Math.hypot(axis[0], axis[1], axis[2]);
      if (n === 0) {
        throw new Error(`조인트 ${spec.name}의 축이 영벡터입니다`);
      }
      return origin.compose(
        Transform.fromTranslation([
          (axis[0] / n) * value,
          (axis[1] / n) * value,
          (axis[2] / n) * value,
        ]),
      );
    }
  }
}

/**
 * 직렬 kinematic chain — URDF 조인트 목록에서 base link → tip link(flange)
 * 순서를 유도하고, 조인트 값으로 FK를 계산한다.
 */
export class KinematicChain {
  readonly joints: readonly UrdfJointSpec[];
  readonly baseLink: string;
  readonly tipLink: string;

  constructor(joints: UrdfJointSpec[]) {
    if (joints.length === 0) {
      throw new Error('조인트가 하나 이상 필요합니다');
    }
    const parents = new Set(joints.map((j) => j.parent));
    const children = new Set(joints.map((j) => j.child));
    const bases = [...parents].filter((l) => !children.has(l));
    const tips = [...children].filter((l) => !parents.has(l));
    if (bases.length !== 1 || tips.length !== 1) {
      throw new Error(
        `직렬 체인이 아닙니다 (base 후보: ${bases.join(', ') || '없음'} / tip 후보: ${tips.join(', ') || '없음'})`,
      );
    }
    this.baseLink = bases[0]!;
    this.tipLink = tips[0]!;

    // parent → child 순으로 정렬
    const byParent = new Map(joints.map((j) => [j.parent, j]));
    const ordered: UrdfJointSpec[] = [];
    let link = this.baseLink;
    while (link !== this.tipLink) {
      const joint = byParent.get(link);
      if (!joint) {
        throw new Error(`link ${link}에서 체인이 끊겼습니다`);
      }
      ordered.push(joint);
      link = joint.child;
    }
    if (ordered.length !== joints.length) {
      throw new Error('체인에 속하지 않는 조인트가 있습니다');
    }
    this.joints = ordered;
  }

  /** 움직일 수 있는(fixed가 아닌) 조인트 이름들, base → tip 순. */
  movableJointNames(): string[] {
    return this.joints.filter((j) => j.type !== 'fixed').map((j) => j.name);
  }

  /**
   * FK — 조인트 값(이름 → 변위)으로 $T^{base}_{tip}$(flange pose)을 계산한다.
   * 값이 주어지지 않은 조인트는 0으로 둔다. fixed 조인트에 값을 주면 throw.
   */
  fk(values: Record<string, number> = {}): Transform {
    return this.linkPoses(values).get(this.tipLink)!;
  }

  /** 모든 link의 pose — link 이름 → $T^{base}_{link}$. */
  linkPoses(values: Record<string, number> = {}): Map<string, Transform> {
    const known = new Set(this.joints.map((j) => j.name));
    for (const name of Object.keys(values)) {
      if (!known.has(name)) {
        throw new Error(`알 수 없는 조인트입니다: ${name}`);
      }
      const joint = this.joints.find((j) => j.name === name)!;
      if (joint.type === 'fixed' && values[name] !== 0) {
        throw new Error(`fixed 조인트에는 값을 줄 수 없습니다: ${name}`);
      }
    }
    const poses = new Map<string, Transform>();
    let t = Transform.identity();
    poses.set(this.baseLink, t);
    for (const joint of this.joints) {
      t = t.compose(jointTransform(joint, values[joint.name] ?? 0));
      poses.set(joint.child, t);
    }
    return poses;
  }
}
