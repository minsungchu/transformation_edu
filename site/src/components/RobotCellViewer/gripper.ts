/**
 * 플랜지에 장착하는 석션 그리퍼 — 0단계 파이프라인 뷰어와 1단계 로봇 뷰어가 함께 쓴다.
 *
 * 플랜지 프레임(UR의 `tool0` — 원점은 6축 원점, +z가 approach 축)에서 재는
 * 치수이고, 패드 끝단이 z = `TOOL_LENGTH`(= TCP)에 온다. 그리퍼가 있어야
 * Flange(6축 원점)와 TCP(그리퍼 끝단)가 실제로 떨어져 보인다.
 */
import * as THREE from 'three';
import {Transform} from 'transform-core';

// ── 석션 그리퍼 기하 (m) ──────────────────────────────────────────────
/** 마운팅 플레이트 두께 — 플랜지 면에 붙는 원판. */
const GRIPPER_PLATE_HEIGHT = 0.008;
const GRIPPER_PLATE_RADIUS = 0.036;
/** 그리퍼 몸통(원기둥) 길이·반지름. */
const GRIPPER_BODY_LENGTH = 0.092;
const GRIPPER_BODY_RADIUS = 0.019;
/** 석션 패드(얕은 원뿔) 높이와 접촉면 반지름. */
const SUCTION_PAD_HEIGHT = 0.02;
const SUCTION_PAD_RADIUS = 0.038;

/** 그리퍼 전체 길이 — flange 원점에서 TCP까지의 거리. */
export const TOOL_LENGTH = GRIPPER_PLATE_HEIGHT + GRIPPER_BODY_LENGTH + SUCTION_PAD_HEIGHT;

/**
 * flange → TCP 고정 오프셋 $T^{flange}_{tcp}$ — approach 축(+z)으로 그리퍼
 * 전체 길이만큼 병진하고 회전은 없다(두 프레임의 축이 평행). TCP는 석션 패드의
 * 끝단, 즉 물체에 닿는 면이다.
 */
export const T_FLANGE_TCP = Transform.fromTranslation([0, 0, TOOL_LENGTH]);

/**
 * 마운팅 플레이트 + 원기둥 몸통 + 석션 패드.
 * 부모 프레임의 +z(approach 축)로 뻗고, 패드 끝단이 z = TOOL_LENGTH(= TCP)에 온다.
 * three.js CylinderGeometry의 축은 로컬 +y라 x축 90°로 세워 +z에 맞춘다.
 */
export function buildSuctionGripper(): THREE.Group {
  const group = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({color: 0x8f98a3, roughness: 0.35, metalness: 0.55});
  const rubber = new THREE.MeshStandardMaterial({color: 0x2b3038, roughness: 0.85});

  const stack: [THREE.CylinderGeometry, THREE.Material][] = [
    [
      new THREE.CylinderGeometry(GRIPPER_PLATE_RADIUS, GRIPPER_PLATE_RADIUS, GRIPPER_PLATE_HEIGHT, 28),
      metal,
    ],
    [
      new THREE.CylinderGeometry(GRIPPER_BODY_RADIUS, GRIPPER_BODY_RADIUS, GRIPPER_BODY_LENGTH, 24),
      metal,
    ],
    // 패드는 끝(+z)으로 갈수록 벌어지는 고무 컵 — CylinderGeometry의 radiusTop이
    // 로컬 +y = 회전 후 +z 쪽이므로 접촉면 반지름을 radiusTop에 준다.
    [
      new THREE.CylinderGeometry(SUCTION_PAD_RADIUS, GRIPPER_BODY_RADIUS * 1.15, SUCTION_PAD_HEIGHT, 28),
      rubber,
    ],
  ];

  let z = 0;
  for (const [geometry, material] of stack) {
    const height = geometry.parameters.height;
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = Math.PI / 2; // 실린더 축(+y) → 프레임 +z(approach)
    mesh.position.z = z + height / 2;
    group.add(mesh);
    z += height;
  }
  return group;
}
