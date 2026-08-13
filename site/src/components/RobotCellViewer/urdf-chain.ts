/**
 * urdf-loader가 읽어 둔 URDF에서 transform-core `KinematicChain`을 뽑아낸다.
 *
 * 렌더링(관절 회전)은 urdf-loader의 씬 그래프가 하지만, IK는 순수 수학
 * 레이어에서 풀어야 한다. 두 쪽이 같은 기하를 보도록, 브라우저가 이미 파싱해
 * 놓은 `<joint>` XML 노드를 그대로 `UrdfJointSpec`으로 옮긴다 (숫자를 손으로
 * 옮겨 적지 않으므로 URDF를 바꿔도 어긋나지 않는다).
 *
 * URDF는 트리라서 base에서 갈라지는 가지(UR5e의 `base`, 툴 프레임 등)가 있다.
 * `KinematicChain`은 직렬 체인만 받으므로, tip link에서 부모를 따라 거슬러
 * 올라가 실제로 지나가는 경로만 골라 넘긴다.
 */
import type {URDFRobot} from 'urdf-loader';
import type {UrdfJointSpec} from 'transform-core';
import {KinematicChain} from 'transform-core';

type JointType = UrdfJointSpec['type'];

function firstChild(node: Element, tag: string): Element | null {
  for (const child of Array.from(node.children)) {
    if (child.tagName === tag) {
      return child;
    }
  }
  return null;
}

function parseTriple(value: string | null | undefined): [number, number, number] | undefined {
  if (!value) {
    return undefined;
  }
  const parts = value.trim().split(/\s+/).map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) {
    return undefined;
  }
  return [parts[0]!, parts[1]!, parts[2]!];
}

function parseJointSpec(node: Element): UrdfJointSpec {
  const name = node.getAttribute('name');
  const type = node.getAttribute('type');
  const parent = firstChild(node, 'parent')?.getAttribute('link');
  const child = firstChild(node, 'child')?.getAttribute('link');
  if (!name || !parent || !child) {
    throw new Error('URDF <joint>에 name/parent/child가 없습니다');
  }
  if (type !== 'fixed' && type !== 'revolute' && type !== 'continuous' && type !== 'prismatic') {
    throw new Error(`지원하지 않는 조인트 타입입니다: ${name} (${type})`);
  }

  const spec: UrdfJointSpec = {name, type: type as JointType, parent, child};

  const originNode = firstChild(node, 'origin');
  const xyz = parseTriple(originNode?.getAttribute('xyz'));
  const rpy = parseTriple(originNode?.getAttribute('rpy'));
  if (xyz || rpy) {
    spec.origin = {};
    if (xyz) {
      spec.origin.xyz = xyz;
    }
    if (rpy) {
      spec.origin.rpy = rpy;
    }
  }

  const axis = parseTriple(firstChild(node, 'axis')?.getAttribute('xyz'));
  if (axis) {
    spec.axis = axis;
  }

  const limitNode = firstChild(node, 'limit');
  const lower = Number(limitNode?.getAttribute('lower'));
  const upper = Number(limitNode?.getAttribute('upper'));
  if (Number.isFinite(lower) && Number.isFinite(upper) && upper > lower) {
    spec.limit = {lower, upper};
  }
  return spec;
}

/**
 * 로드된 로봇에서 root link → `tipLink`로 이어지는 직렬 체인을 만든다.
 * 가지로 갈라진 다른 link들은 IK에 관여하지 않으므로 제외된다.
 */
export function urdfSerialChain(robot: URDFRobot, tipLink: string): KinematicChain {
  const byChild = new Map<string, UrdfJointSpec>();
  for (const joint of Object.values(robot.joints)) {
    if (joint.urdfNode) {
      const spec = parseJointSpec(joint.urdfNode);
      byChild.set(spec.child, spec);
    }
  }

  const path: UrdfJointSpec[] = [];
  const visited = new Set<string>();
  let link = tipLink;
  while (byChild.has(link)) {
    if (visited.has(link)) {
      throw new Error(`URDF 체인에 순환이 있습니다: ${link}`);
    }
    visited.add(link);
    const spec = byChild.get(link)!;
    path.unshift(spec);
    link = spec.parent;
  }
  if (path.length === 0) {
    throw new Error(`URDF에서 ${tipLink}로 가는 조인트를 찾지 못했습니다`);
  }
  return new KinematicChain(path);
}
