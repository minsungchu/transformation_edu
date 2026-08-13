/**
 * 0단계 bin picking 파이프라인 3D 씬 (브라우저 전용).
 *
 * RobotCellViewer의 렌더링 코어(viewer-core.ts)와 셀 배치(cell-layout.ts)를
 * 재사용하고, 그 위에 파이프라인 지도 요소를 얹는다:
 *
 * - Master / Scene 박스 — matching 완료 후 모습으로, Master 와이어프레임이
 *   Scene을 잔차 수준의 offset/회전만 남기고 감싼다 (reference DOCX 그림 2-8·2-9)
 * - 이미지 원점 — Master와 Scene의 이미지 원점은 원래 둘 다 카메라 원점과
 *   같다(카메라 자리에 점 + 라벨). matching으로 이동한 Master의 원점은
 *   콘텐츠와 함께 변환을 받아 일반적으로 물체 밖에 떨어지므로, 박스에서
 *   분리된 허공에 점 + 소형 축으로 따로 표시한다 (reference DOCX 그림 2-8)
 * - 화살표 5종 — 전부 from-to 규칙(ADR-0001, 꼬리 = 기준 좌표계 원점).
 *   $T_{match}$는 Scene 원점(= 카메라 원점)에서 허공의 이동된 Master
 *   원점으로, $P^{camera}_{master}$는 이동된 Master 원점에서 출발한다.
 *   점선 = 파이프라인의 중간 재료, 파란 실선 = 최종 답 $P^{world}_{scene}$
 *   (기존 2D SVG의 시각 언어 유지)
 *
 * 박스 pose와 점 위치는 transform-core로 계산하고, 렌더링 레이어는 결과를
 * 그리기만 한다.
 *
 * 플랜지에는 석션 그리퍼(원기둥 몸통 + 석션 패드)가 붙어 있다. 그리퍼는 플랜지
 * 링크의 자식이라 로봇과 함께 움직이고, 패드 끝단이 **TCP**다. 즉 IK가 푸는
 * 체인의 끝점(플랜지)과 사람이 조그하려는 점(TCP)이 그리퍼 길이만큼 어긋나 있고,
 * 그 고정 오프셋 $T^{flange}_{tcp}$를 transform-core의 `jogTargetFlangePose`가
 * 처리한다.
 *
 * 여기에 조그(jog)도 얹는다 — 로봇 팔만 움직이고 파이프라인 지도 요소는 World/
 * Camera/Scene에 고정이므로 그대로 남는다. Cartesian 조그는
 * FK(플랜지) → 기준 좌표계에서 델타 적용 → 목표 플랜지 pose → DLS
 * IK(transform-core) 순서로 풀고, Joint 조그는 관절값에 바로 더한다.
 *
 * 툴바 조그와 나란히 **free 드래그**도 있다 — 손목(6축 원점)에 붙은 구체 핸들을
 * 마우스로 끌면 매 프레임 IK를 풀어 팔이 따라온다. 툴바 조그가 "축 하나를 정해진
 * 스텝만큼" 미는 이산 조작이라면 이쪽은 연속 조작이고, 둘은 같은 `jointValues`를
 * 공유하므로 섞어 써도 상태가 어긋나지 않는다.
 */
import * as THREE from 'three';
import {CSS2DObject} from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import URDFLoader from 'urdf-loader';
import type {URDFRobot} from 'urdf-loader';
import type {CartesianJogStep, JogControlFrame, KinematicChain, Vec3} from 'transform-core';
import {Transform, jogTargetFlangePose, solveIk} from 'transform-core';
import {CELL_FRAMES, DEFAULT_CELL, createCellLayout} from '../RobotCellViewer/cell-layout';
import type {SceneRobotConfig} from '../RobotCellViewer/scene';
import {urdfSerialChain} from '../RobotCellViewer/urdf-chain';
import {
  applyTransform,
  buildCameraGlyph,
  buildFrameAxes,
  buildMathLabel,
  buildTextLabel,
  createViewerShell,
} from '../RobotCellViewer/viewer-core';

/** 조그 기준 — Cartesian 세 가지(Base/Flange/TCP) + 관절 직접 구동. */
export type JogMode = JogControlFrame | 'joint';

/**
 * free 드래그의 현재 상태 — 툴바 안내문을 바꾸는 데만 쓴다.
 *
 * - `'idle'` — 아무도 핸들을 잡고 있지 않다.
 * - `'dragging'` — 핸들을 끄는 중이고 팔이 따라오고 있다.
 * - `'blocked'` — 끄는 중이지만 목표가 도달 범위 밖이라 자세를 유지하고 있다.
 */
export type FreeDragState = 'idle' | 'dragging' | 'blocked';

export interface PipelineSceneOptions {
  container: HTMLElement;
  robot: SceneRobotConfig;
  /** 처음 켜 둘 조그 모드 (기준 좌표계 축 표시에 쓰인다). */
  initialJogMode?: JogMode;
  /** free 드래그 상태가 **바뀔 때만** 불린다 (매 프레임이 아니다). */
  onFreeDrag?: (state: FreeDragState) => void;
  onReady?: () => void;
  onError?: (error: unknown) => void;
}

export interface PipelineScene {
  /** 조그 기준 좌표계 축 표시를 모드에 맞게 바꾼다. */
  setJogMode: (mode: JogMode) => void;
  /**
   * Cartesian 조그 — 기준 좌표계에서 델타를 적용한 목표 **플랜지** pose를 IK로
   * 푼다 (Base/TCP 모드는 TCP 목표를 플랜지 목표로 되돌린 뒤 넘긴다).
   * 수렴하지 못하면(싱귤래리티·도달 불가) 자세를 그대로 두고 false를 돌려준다.
   */
  jogCartesian: (frame: JogControlFrame, step: CartesianJogStep) => boolean;
  /** Joint 조그 — 관절값에 델타를 더하고 FK만 다시 돌린다 (IK 불필요). */
  jogJoint: (jointName: string, delta: number) => boolean;
  /** 초기 자세로 되돌린다. */
  resetPose: () => void;
  dispose: () => void;
}

// 2D SVG 버전과 같은 시각 언어의 색.
const GRAY = '#8f959e';
const BLUE = '#3b82f6';
const SCENE_BLUE = '#5aa7f0';
const MASTER_RED = '#f0908a';
const POINT_RED = '#e5484d';

/** 물체 박스 크기 [x, y, z] (m) — 이미지 원점은 로컬 (0,0,0) = 바닥 모서리. */
const BOX_SIZE: readonly [number, number, number] = [0.2, 0.15, 0.12];
/** 박스 부양 높이 (m) — 물체는 공중에 떠 있다. */
const BOX_ALTITUDE = 0.35;
/** 박스 로컬 좌표의 picking point — Master와 Scene에서 같은 자리다. */
const PICK_LOCAL: readonly [number, number, number] = [0.145, 0.095, 0.12];

// ── 석션 그리퍼 기하 (m) ──────────────────────────────────────────────
// 플랜지 프레임(tool0 — 원점은 6축 원점, +z가 approach 축)에서 재는 치수다.
/** 마운팅 플레이트 두께 — 플랜지 면에 붙는 원판. */
const GRIPPER_PLATE_HEIGHT = 0.008;
const GRIPPER_PLATE_RADIUS = 0.036;
/** 그리퍼 몸통(원기둥) 길이·반지름. */
const GRIPPER_BODY_LENGTH = 0.092;
const GRIPPER_BODY_RADIUS = 0.019;
/** 석션 패드(얕은 원뿔) 높이와 접촉면 반지름. */
const SUCTION_PAD_HEIGHT = 0.02;
const SUCTION_PAD_RADIUS = 0.038;
/**
 * flange → TCP 고정 오프셋 $T^{flange}_{tcp}$ — approach 축(+z)으로 그리퍼
 * 전체 길이만큼 병진하고 회전은 없다(두 프레임의 축이 평행). TCP는 석션 패드의
 * 끝단, 즉 물체에 닿는 면이다.
 */
const TOOL_LENGTH = GRIPPER_PLATE_HEIGHT + GRIPPER_BODY_LENGTH + SUCTION_PAD_HEIGHT;
const T_FLANGE_TCP = Transform.fromTranslation([0, 0, TOOL_LENGTH]);

// ── free 드래그 핸들 ──────────────────────────────────────────────────
/** 손목 핸들 구체의 반지름 (m) — 마운팅 플레이트를 덮을 만큼 크게 잡아야 집기 쉽다. */
const HANDLE_RADIUS = 0.058;
/** 조그 기준 축과 같은 노란색 계열 — "사람이 미는 것" 표시. */
const HANDLE_COLOR = '#f5c451';
/** 한 프레임에 쫓아갈 위치 오차의 상한 (m) — 커서가 멀리 있어도 팔이 튀지 않는다. */
const FOLLOW_MAX_STEP = 0.03;
/** 이만큼 연속으로 IK가 실패해야 "도달 범위 밖"으로 알린다 (경계에서의 깜빡임 방지). */
const BLOCKED_STREAK = 3;

interface DragHandle {
  /** 플랜지 링크에 매다는 묶음. */
  group: THREE.Group;
  /** 레이캐스트 대상 — 중심이 곧 플랜지 원점이다. */
  sphere: THREE.Mesh;
  material: THREE.MeshStandardMaterial;
  /** hover·드래그 중에만 뜨는 안내 라벨. */
  label: CSS2DObject;
}

/**
 * free 드래그 핸들 — 손목(6축 원점)에 씌우는 반투명 구체.
 *
 * 구체의 중심을 플랜지 원점에 정확히 맞춰 두면 "핸들을 끌어간 자리"가 그대로
 * IK의 목표 플랜지 위치가 된다 (오프셋을 되돌리는 계산이 필요 없다).
 */
function buildDragHandle(): DragHandle {
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({
    color: HANDLE_COLOR,
    emissive: HANDLE_COLOR,
    emissiveIntensity: 0.4,
    transparent: true,
    opacity: 0.42,
    roughness: 0.3,
    depthWrite: false,
  });
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(HANDLE_RADIUS, 28, 20), material);
  sphere.renderOrder = 9;
  group.add(sphere);

  const label = new CSS2DObject(buildTextLabel('끌어서 이동', HANDLE_COLOR));
  label.position.set(0, 0, HANDLE_RADIUS + 0.04);
  label.visible = false;
  group.add(label);
  return {group, sphere, material, label};
}

/**
 * 플랜지에 장착하는 석션 그리퍼 — 마운팅 플레이트 + 원기둥 몸통 + 석션 패드.
 * 부모 프레임의 +z(approach 축)로 뻗고, 패드 끝단이 z = TOOL_LENGTH(= TCP)에 온다.
 * three.js CylinderGeometry의 축은 로컬 +y라 x축 90°로 세워 +z에 맞춘다.
 */
function buildSuctionGripper(): THREE.Group {
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

/**
 * Master / Scene 물체 박스 — 반투명 몸체 + 와이어프레임 모서리.
 * 이미지 원점은 원래 카메라 원점과 같으므로 박스 자체에는 원점 표시가 없다.
 * matching으로 이동한 Master의 원점은 물체 밖 허공에 buildOriginMarker로
 * 따로 그린다.
 */
function buildObjectBox(color: string, {bodyOpacity = 0.3}: {bodyOpacity?: number} = {}): THREE.Group {
  const group = new THREE.Group();
  const geometry = new THREE.BoxGeometry(BOX_SIZE[0], BOX_SIZE[1], BOX_SIZE[2]);
  // 로컬 원점이 박스 바닥 모서리에 오도록 밀어 둔다.
  geometry.translate(BOX_SIZE[0] / 2, BOX_SIZE[1] / 2, BOX_SIZE[2] / 2);
  const body = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({
      color,
      transparent: true,
      opacity: bodyOpacity,
      roughness: 0.5,
      depthWrite: false,
    }),
  );
  group.add(body);
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(geometry),
    new THREE.LineBasicMaterial({color}),
  );
  group.add(edges);
  return group;
}

/** 이동된 이미지 원점 마커 — 점 + 소형 축. */
function buildOriginMarker(color: string): THREE.Group {
  const group = new THREE.Group();
  const dot = new THREE.Mesh(
    new THREE.SphereGeometry(0.011, 16, 16),
    new THREE.MeshBasicMaterial({color, depthTest: false}),
  );
  dot.renderOrder = 10;
  group.add(dot);
  group.add(buildFrameAxes(0.09));
  return group;
}

/** picking point 마커. */
function buildPointDot(color: string): THREE.Mesh {
  const dot = new THREE.Mesh(
    new THREE.SphereGeometry(0.013, 16, 16),
    new THREE.MeshBasicMaterial({color, depthTest: false}),
  );
  dot.renderOrder = 10;
  return dot;
}

/**
 * from → to 정적 화살표 (worldRoot의 z-up 좌표로 그린다).
 * dashed = 파이프라인의 중간 재료, solid = 최종 답 강조(굵은 실린더).
 */
function buildPipelineArrow(
  from: THREE.Vector3,
  to: THREE.Vector3,
  color: string,
  dashed: boolean,
): THREE.Group {
  const group = new THREE.Group();
  const unit = new THREE.Vector3().subVectors(to, from);
  const length = unit.length();
  unit.normalize();
  const headLength = Math.min(0.07, length * 0.3);

  if (dashed) {
    const lineEnd = new THREE.Vector3().copy(to).addScaledVector(unit, -headLength * 0.8);
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([from.clone(), lineEnd]),
      new THREE.LineDashedMaterial({color, dashSize: 0.045, gapSize: 0.028, depthTest: false}),
    );
    line.computeLineDistances();
    line.renderOrder = 11;
    group.add(line);
  } else {
    const shaft = new THREE.Mesh(
      new THREE.CylinderGeometry(0.0065, 0.0065, length - headLength, 12),
      new THREE.MeshBasicMaterial({color, depthTest: false}),
    );
    shaft.position.copy(from).addScaledVector(unit, (length - headLength) / 2);
    shaft.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), unit);
    shaft.renderOrder = 11;
    group.add(shaft);
  }

  const cone = new THREE.Mesh(
    new THREE.ConeGeometry(dashed ? 0.016 : 0.021, headLength, 16),
    new THREE.MeshBasicMaterial({color, depthTest: false}),
  );
  cone.position.copy(to).addScaledVector(unit, -headLength / 2);
  cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), unit);
  cone.renderOrder = 11;
  group.add(cone);
  return group;
}

export function createPipelineScene(options: PipelineSceneOptions): PipelineScene {
  const {
    container,
    robot: robotConfig,
    initialJogMode = 'base',
    onFreeDrag,
    onReady,
    onError,
  } = options;

  const shell = createViewerShell({
    container,
    // 로봇(World 원점) · 카메라 · 공중의 박스가 함께 보이는 시점.
    cameraPosition: [-0.45, 1.55, 2.35],
    target: [0.35, 0.62, 0],
    // 첫 프레임이 rAF로 미뤄지므로 아래에서 정의하는 followFrame을 참조해도 안전하다.
    onBeforeRender: () => followFrame(),
  });
  const {worldRoot} = shell;

  const cell = DEFAULT_CELL;
  const frames = createCellLayout(cell);
  const tWorldCamera = frames.getTransform(CELL_FRAMES.world, CELL_FRAMES.camera);
  const tWorldRobotBase = frames.getTransform(CELL_FRAMES.world, CELL_FRAMES.robotBase);

  // 카메라는 공중의 고정 위치에 떠 있다 (기둥 mesh 없음).
  const cameraGlyph = buildCameraGlyph();
  applyTransform(cameraGlyph, tWorldCamera);
  worldRoot.add(cameraGlyph);

  // World / Camera 좌표계 축은 항상 켜 둔다 — 지도에서 두 원점이 기준점이다.
  const worldAxes = buildFrameAxes(0.34);
  worldRoot.add(worldAxes);
  const cameraAxes = buildFrameAxes(0.22);
  cameraGlyph.add(cameraAxes);

  // ── Master / Scene 박스 pose (transform-core) ─────────────────────
  // Scene: 공중에 떠 있는 실제 물체. Master: matching으로 이미 Scene 위에
  // 겹쳐진 기준 이미지 — 잔차 수준의 offset/회전만 남아 와이어프레임이
  // Scene을 감싼 것처럼 보인다.
  const tWorldScene = Transform.fromTranslation([0.53, -0.2, BOX_ALTITUDE]).compose(
    Transform.rotationZ(-0.3),
  );
  const tWorldMaster = Transform.fromTranslation([0.546, -0.212, BOX_ALTITUDE + 0.008]).compose(
    Transform.rotationZ(-0.22),
  );

  const sceneBox = buildObjectBox(SCENE_BLUE);
  applyTransform(sceneBox, tWorldScene);
  worldRoot.add(sceneBox);
  // Master는 몸체를 옅게 — 감싸인 Scene이 비쳐 보이도록.
  const masterBox = buildObjectBox(MASTER_RED, {bodyOpacity: 0.12});
  applyTransform(masterBox, tWorldMaster);
  worldRoot.add(masterBox);

  // 이동된 Master 이미지 원점 — 원점은 콘텐츠와 함께 변환을 받으므로
  // 일반적으로 물체 밖에 떨어진다 (원본 그림 2-8의 초록 점). 카메라 원점의
  // 오른쪽 아래, 박스의 오른쪽 위 허공에 두고 잔차 회전만 얹는다.
  const tWorldMasterOrigin = Transform.fromTranslation([0.8, -0.18, 0.72]).compose(
    Transform.rotationZ(-0.22),
  );
  const masterOriginMarker = buildOriginMarker(MASTER_RED);
  applyTransform(masterOriginMarker, tWorldMasterOrigin);
  worldRoot.add(masterOriginMarker);

  // ── 원점·점 위치 (world 좌표, z-up) ───────────────────────────────
  const vec = (p: readonly number[]): THREE.Vector3 => new THREE.Vector3(p[0], p[1], p[2]);
  const worldOrigin = new THREE.Vector3(0, 0, 0);
  const cameraOrigin = vec(tWorldCamera.translation);
  const masterOrigin = vec(tWorldMasterOrigin.translation);
  const masterPick = vec(tWorldMaster.transformPoint(PICK_LOCAL));
  const scenePick = vec(tWorldScene.transformPoint(PICK_LOCAL));

  const masterPickDot = buildPointDot(POINT_RED);
  masterPickDot.position.copy(masterPick);
  worldRoot.add(masterPickDot);
  const scenePickDot = buildPointDot(POINT_RED);
  scenePickDot.position.copy(scenePick);
  worldRoot.add(scenePickDot);

  // 이미지 원점의 원래 위치 = 카메라 원점 — Master·Scene 둘 다 여기서 시작한다.
  const imageOriginDot = buildPointDot('#e7ecf3');
  imageOriginDot.position.copy(cameraOrigin);
  worldRoot.add(imageOriginDot);

  // ── 파이프라인 화살표 5종 + 수식 라벨 ─────────────────────────────
  interface ArrowSpec {
    from: THREE.Vector3;
    to: THREE.Vector3;
    base: string;
    sup: string;
    sub: string;
    color: string;
    dashed: boolean;
    /** 라벨 위치 (from→to 보간 비율) — 화살표 선 위에 겹쳐 놓는다. */
    labelT: number;
  }
  const specs: ArrowSpec[] = [
    // T_cal: World 원점 → Camera 원점 (calibration 결과)
    {from: worldOrigin, to: cameraOrigin, base: 'T', sup: '', sub: 'cal',
     color: GRAY, dashed: true, labelT: 0.6},
    // T_match: Scene 원점(= 카메라 원점) → 허공의 이동된 Master 원점
    {from: cameraOrigin, to: masterOrigin, base: 'T', sup: '', sub: 'match',
     color: GRAY, dashed: true, labelT: 0.5},
    // P^{camera}_{master}: 이동된 Master 원점 → Master의 picking point
    {from: masterOrigin, to: masterPick, base: 'P', sup: 'camera', sub: 'master',
     color: GRAY, dashed: true, labelT: 0.55},
    // P^{camera}_{scene}: Camera 원점(= Scene 이미지 원점) → Scene의 picking point
    {from: cameraOrigin, to: scenePick, base: 'P', sup: 'camera', sub: 'scene',
     color: GRAY, dashed: true, labelT: 0.68},
    // P^{world}_{scene}: World 원점 → Scene의 picking point — 유일한 파란 실선(최종 답)
    {from: worldOrigin, to: scenePick, base: 'P', sup: 'world', sub: 'scene',
     color: BLUE, dashed: false, labelT: 0.45},
  ];
  for (const spec of specs) {
    worldRoot.add(buildPipelineArrow(spec.from, spec.to, spec.color, spec.dashed));
    // 라벨 anchor를 화살표 선 위(labelT 지점)에 정확히 올려 겹치게 한다.
    const anchor = new THREE.Object3D();
    anchor.position.lerpVectors(spec.from, spec.to, spec.labelT);
    anchor.add(new CSS2DObject(buildMathLabel(spec.base, spec.sup, spec.sub, spec.color)));
    worldRoot.add(anchor);
  }

  // ── 이름표 ────────────────────────────────────────────────────────
  const nameLabels: [readonly [number, number, number], string, string][] = [
    [[-0.28, 0, 0.06], 'Robot — World 좌표계', '#aeb8c4'],
    [[0.74, 0, 1.42], 'Camera 좌표계', '#aeb8c4'],
    [[0.32, 0.06, 1.3], '이미지 원점 (원래 위치)', '#e7ecf3'],
    [[0.05, 0.1, 0.24], 'Master', MASTER_RED],
    [[0.24, 0.1, -0.05], 'Scene', SCENE_BLUE],
    [[0.05, 0, -0.09], '이동된 Master 원점', MASTER_RED],
  ];
  const [worldName, cameraName, imageOriginName, masterName, sceneName, masterOriginName] =
    nameLabels.map(([position, text, color]) => {
      const anchor = new THREE.Object3D();
      anchor.position.copy(vec(position));
      anchor.add(new CSS2DObject(buildTextLabel(text, color)));
      return anchor;
    });
  worldRoot.add(worldName!);
  worldRoot.add(cameraName!);
  worldRoot.add(imageOriginName!);
  // Master/Scene 이름표는 박스에, 이동된 원점 라벨은 허공의 마커에 붙여
  // 로컬 좌표로 띄운다.
  masterBox.add(masterName!);
  sceneBox.add(sceneName!);
  masterOriginMarker.add(masterOriginName!);

  // ── 조그 기준 좌표계 축 ───────────────────────────────────────────
  // Cartesian 모드에서 "지금 어느 좌표계를 기준으로, 어느 점을 미는가"를 눈으로
  // 읽을 수 있게 한다. Base는 World 축(항상 켜 둔 worldAxes 대신 크게 강조해
  // 그리고), Flange는 플랜지 링크의 6축 원점, TCP는 그리퍼 끝단이다 — 회전
  // 조그에서 이 원점이 곧 회전중심이라 Flange와 TCP가 다르게 움직인다.
  const buildJogReference = (length: number, text: string, labelHeight: number): THREE.Group => {
    const group = new THREE.Group();
    group.add(buildFrameAxes(length));
    const anchor = new THREE.Object3D();
    anchor.position.set(0, 0, labelHeight);
    anchor.add(new CSS2DObject(buildTextLabel(text, '#f5c451')));
    group.add(anchor);
    group.visible = false;
    return group;
  };
  const baseJogAxes = buildJogReference(0.5, '조그 기준: World 좌표계 (제어점 = TCP)', 0.56);
  worldRoot.add(baseJogAxes);
  // 라벨은 approach 축의 반대쪽(-z, 손목 뒤)으로 빼 둔다 — +z 쪽에는 그리퍼와
  // TCP 라벨이 있고, 기본 자세에서는 물체 박스 쪽이라 글자가 겹친다.
  const flangeJogAxes = buildJogReference(0.19, '조그 기준: Flange (6축 원점)', -0.24);
  // TCP 축은 같은 플랜지 링크에 붙지만 원점이 그리퍼 끝단으로 밀려 있다.
  const tcpJogAxes = buildJogReference(0.16, '조그 기준: TCP (그리퍼 끝단)', 0.19);
  tcpJogAxes.position.z = TOOL_LENGTH;

  let jogMode: JogMode = initialJogMode;
  const applyJogMode = (): void => {
    baseJogAxes.visible = jogMode === 'base';
    flangeJogAxes.visible = jogMode === 'flange';
    tcpJogAxes.visible = jogMode === 'tcp';
    // Base 강조 축과 겹치지 않도록 기본 World 축은 잠시 접어 둔다.
    worldAxes.visible = jogMode !== 'base';
  };
  applyJogMode();

  // free 드래그 핸들은 IK 체인이 준비된 뒤에만 켠다 (체인이 없으면 끌 수 없다).
  const handle = buildDragHandle();
  handle.group.visible = false;

  // ── 로봇 (World 좌표계의 주인) + 조그 상태 ────────────────────────
  let disposed = false;
  let robot: URDFRobot | null = null;
  /** IK를 푸는 순수 수학 체인 — 렌더링용 URDF 씬 그래프와 같은 기하다. */
  let chain: KinematicChain | null = null;
  const jointValues: Record<string, number> = {...robotConfig.jointValues};

  /**
   * 관절값을 씬에 반영하고, urdf-loader가 limit으로 자른 실제 값을 되읽어
   * 상태를 맞춘다 (다음 조그가 어긋난 값에서 출발하지 않도록).
   */
  const applyJointValues = (): void => {
    if (!robot) {
      return;
    }
    for (const [name, value] of Object.entries(jointValues)) {
      robot.setJointValue(name, value);
      const applied = robot.joints[name]?.angle;
      if (typeof applied === 'number') {
        jointValues[name] = applied;
      }
    }
  };

  const manager = new THREE.LoadingManager(
    () => {
      if (!disposed) {
        onReady?.();
      }
    },
    undefined,
    (url) => {
      if (!disposed) {
        onError?.(new Error(`리소스를 불러오지 못했습니다: ${url}`));
      }
    },
  );
  const loader = new URDFLoader(manager);
  loader.packages = robotConfig.packages;
  loader.load(robotConfig.urdfUrl, (loadedRobot) => {
    if (disposed) {
      return;
    }
    robot = loadedRobot;
    applyJointValues();
    applyTransform(robot, tWorldRobotBase);
    worldRoot.add(robot);

    // frameLinks.tool(UR의 `tool0`)은 플랜지와 원점이 같고 +z가 approach 축인
    // ROS-Industrial 표준 프레임이다 — 즉 이것이 곧 플랜지(6축 원점) 프레임이며,
    // 그리퍼와 두 조그 기준 축을 모두 여기에 매단다.
    const flangeLink = robot.links[robotConfig.frameLinks.tool];
    if (flangeLink) {
      flangeLink.add(buildSuctionGripper());
      flangeLink.add(flangeJogAxes);
      flangeLink.add(tcpJogAxes);
      flangeLink.add(handle.group);
    }
    try {
      chain = urdfSerialChain(robot, robotConfig.frameLinks.tool);
    } catch (error) {
      // 체인을 못 세우면 Cartesian 조그만 비활성이고 나머지 씬은 정상이다.
      console.warn('IK 체인을 만들지 못해 Cartesian 조그를 끕니다:', error);
    }
    // 핸들도 IK가 있어야 의미가 있으므로 체인과 운명을 같이한다.
    handle.group.visible = chain !== null && flangeLink !== undefined;
    applyJogMode();
  });

  // ── free 드래그 조그 ──────────────────────────────────────────────
  // 손목 핸들을 끌면 매 프레임 "위치만 바뀐 플랜지 목표"를 IK로 푼다. 자세는 잡은
  // 순간 값으로 고정해 두어(순수 위치 드래그) 끌려오는 동안 손목이 제멋대로 돌지
  // 않는다. 목표점은 시선에 수직인 평면 위에서 움직이므로 깊이는 잡은 순간 그대로다.
  const tRobotBaseWorld = tWorldRobotBase.inverse();
  const raycaster = new THREE.Raycaster();
  const pointerNdc = new THREE.Vector2();
  const dragPlane = new THREE.Plane();
  /** 핸들 중심 − 첫 클릭 지점 — 잡는 순간 핸들이 커서로 순간이동하지 않게 한다. */
  const grabOffset = new THREE.Vector3();
  const planeHit = new THREE.Vector3();
  const scratch = new THREE.Vector3();

  let hovering = false;
  let dragging = false;
  let dragPointerId: number | null = null;
  /** 드래그 목표 — 로봇 base 좌표계에서 본 플랜지 원점 위치. */
  let followGoal: Vec3 | null = null;
  /** 잡은 순간의 플랜지 pose — 드래그 내내 그 **자세**를 목표로 유지한다. */
  let grabbedPose: Transform | null = null;
  let failStreak = 0;
  let reportedState: FreeDragState = 'idle';

  const reportState = (state: FreeDragState): void => {
    if (state !== reportedState) {
      reportedState = state;
      onFreeDrag?.(state);
    }
  };

  const applyHandleStyle = (): void => {
    const active = dragging || hovering;
    handle.material.opacity = active ? 0.7 : 0.42;
    handle.material.emissiveIntensity = active ? 0.95 : 0.4;
    handle.sphere.scale.setScalar(active ? 1.1 : 1);
    handle.label.visible = active;
    shell.domElement.style.cursor = dragging ? 'grabbing' : hovering ? 'grab' : '';
  };

  /** 포인터 위치에서 카메라 레이를 세운다. 핸들이 아직 없으면 아무것도 하지 않는다. */
  const castFrom = (event: PointerEvent): boolean => {
    // Raycaster는 visible을 보지 않으므로 여기서 직접 걸러 준다.
    if (!handle.group.visible) {
      return false;
    }
    const rect = shell.domElement.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      return false;
    }
    pointerNdc.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(pointerNdc, shell.viewCamera);
    return true;
  };

  const hitsHandle = (event: PointerEvent): boolean =>
    castFrom(event) && raycaster.intersectObject(handle.sphere, false).length > 0;

  /** three.js world 좌표(y-up) → 로봇 base 좌표 — IK 목표는 base 기준이다. */
  const toBaseFrame = (point: THREE.Vector3): Vec3 => {
    const local = worldRoot.worldToLocal(scratch.copy(point));
    return tRobotBaseWorld.transformPoint([local.x, local.y, local.z]);
  };

  const onDragMove = (event: PointerEvent): void => {
    if (!dragging || event.pointerId !== dragPointerId || !castFrom(event)) {
      return;
    }
    if (raycaster.ray.intersectPlane(dragPlane, planeHit)) {
      followGoal = toBaseFrame(planeHit.add(grabOffset));
    }
  };

  const endDrag = (): void => {
    if (!dragging) {
      return;
    }
    dragging = false;
    dragPointerId = null;
    followGoal = null;
    grabbedPose = null;
    failStreak = 0;
    shell.controls.enabled = true;
    window.removeEventListener('pointermove', onDragMove);
    window.removeEventListener('pointerup', endDrag);
    window.removeEventListener('pointercancel', endDrag);
    applyHandleStyle();
    reportState('idle');
  };

  const onPointerDown = (event: PointerEvent): void => {
    if (dragging || event.button !== 0 || !chain || !hitsHandle(event)) {
      return; // 빈 공간이면 그대로 흘려보내 OrbitControls가 궤도 회전을 맡는다
    }
    // 컨테이너의 **캡처 단계**라 캔버스에 붙은 OrbitControls 리스너보다 먼저 돈다 —
    // 여기서 전파를 끊어야 드래그와 궤도 회전이 동시에 걸리지 않는다.
    event.stopPropagation();
    event.preventDefault();
    dragging = true;
    dragPointerId = event.pointerId;
    shell.controls.enabled = false;
    grabbedPose = chain.fk(jointValues);

    const handleWorld = handle.sphere.getWorldPosition(new THREE.Vector3());
    dragPlane.setFromNormalAndCoplanarPoint(
      shell.viewCamera.getWorldDirection(new THREE.Vector3()),
      handleWorld,
    );
    grabOffset.set(0, 0, 0);
    if (raycaster.ray.intersectPlane(dragPlane, planeHit)) {
      grabOffset.subVectors(handleWorld, planeHit);
    }
    followGoal = toBaseFrame(handleWorld);
    failStreak = 0;

    window.addEventListener('pointermove', onDragMove);
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);
    applyHandleStyle();
    reportState('dragging');
  };

  const onHoverMove = (event: PointerEvent): void => {
    if (dragging) {
      return;
    }
    const next = hitsHandle(event);
    if (next !== hovering) {
      hovering = next;
      applyHandleStyle();
    }
  };

  const onPointerLeave = (): void => {
    if (!dragging && hovering) {
      hovering = false;
      applyHandleStyle();
    }
  };

  container.addEventListener('pointerdown', onPointerDown, true);
  shell.domElement.addEventListener('pointermove', onHoverMove);
  shell.domElement.addEventListener('pointerleave', onPointerLeave);

  /**
   * 드래그 한 프레임 — 목표까지의 거리를 잘라 조금씩 쫓아간다.
   *
   * 한 걸음이 작아야 IK의 선형화가 유효하고, 도달 범위 밖이면 그 작은 걸음조차
   * 수렴하지 못해 경계에서 저절로 멈춘다. 실패한 프레임은 통째로 버리므로
   * 관절값은 마지막 유효 자세 그대로 남는다.
   */
  const followFrame = (): void => {
    if (!dragging || !robot || !chain || !followGoal || !grabbedPose) {
      return;
    }
    const from = chain.fk(jointValues).translation;
    const dx = followGoal[0] - from[0];
    const dy = followGoal[1] - from[1];
    const dz = followGoal[2] - from[2];
    const distance = Math.hypot(dx, dy, dz);
    if (distance < 1e-4) {
      failStreak = 0;
      reportState('dragging');
      return;
    }
    const scale = distance > FOLLOW_MAX_STEP ? FOLLOW_MAX_STEP / distance : 1;
    const goal: Vec3 = [from[0] + dx * scale, from[1] + dy * scale, from[2] + dz * scale];
    // 자세는 잡은 순간 그대로, 위치만 목표로 — 순수 위치 드래그.
    const result = solveIk(chain, new Transform(grabbedPose.rotation, goal), jointValues, {
      maxIterations: 40,
    });
    if (!result.converged) {
      failStreak += 1;
      if (failStreak >= BLOCKED_STREAK) {
        reportState('blocked');
      }
      return;
    }
    failStreak = 0;
    Object.assign(jointValues, result.values);
    applyJointValues();
    reportState('dragging');
  };

  return {
    setJogMode: (mode) => {
      jogMode = mode;
      applyJogMode();
    },
    jogCartesian: (frame, step) => {
      if (!robot || !chain) {
        return false;
      }
      // 현재 관절각 → FK로 현재 플랜지 pose → 기준 좌표계에서 델타 적용 →
      // 목표 플랜지 pose(Base/TCP 모드는 tool 오프셋을 되돌린 값) → IK.
      const target = jogTargetFlangePose({
        flange: chain.fk(jointValues),
        toolOffset: T_FLANGE_TCP,
        step,
        frame,
      });
      const result = solveIk(chain, target, jointValues, {maxIterations: 80});
      if (!result.converged) {
        return false; // 싱귤래리티·도달 불가 — 이 스텝은 조용히 무시한다
      }
      Object.assign(jointValues, result.values);
      applyJointValues();
      return true;
    },
    jogJoint: (jointName, delta) => {
      if (!robot || !(jointName in jointValues)) {
        return false;
      }
      const before = jointValues[jointName]!;
      jointValues[jointName] = before + delta;
      applyJointValues(); // limit을 넘으면 여기서 잘려 되읽힌다
      return Math.abs(jointValues[jointName]! - before) > 1e-9;
    },
    resetPose: () => {
      Object.assign(jointValues, robotConfig.jointValues);
      applyJointValues();
    },
    dispose: () => {
      disposed = true;
      endDrag(); // 드래그 도중 언마운트되어도 window 리스너가 남지 않게
      container.removeEventListener('pointerdown', onPointerDown, true);
      shell.domElement.removeEventListener('pointermove', onHoverMove);
      shell.domElement.removeEventListener('pointerleave', onPointerLeave);
      shell.dispose();
    },
  };
}
