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
 *
 * **Master 박스 드래그**는 matching 전/후를 화면에서 직접 비교하는 장치다. 박스를
 * 끌면 Master 박스 · 이동된 Master 원점 마커 · Master picking point가 하나의
 * Group(`masterGroup`)에 묶여 **강체로** 함께 움직인다 — 셋 사이의 오프셋과 회전은
 * 드래그 내내 불변이고, 바뀌는 것은 Group 하나의 pose뿐이다. 그래서 끌어 놓은 자리가
 * 곧 "matching이 아직 안 끝난 상태"의 그림이 된다. 이때 $T_{match}$(카메라 원점 →
 * 이동된 Master 원점)와 $P^{camera}_{master}$(이동된 Master 원점 → Master pick)는
 * 끝점이 움직이므로 정적 메시로 둘 수 없고, 끝점을 받아 다시 그리는 동적 화살표로
 * 만들어 드래그마다 갱신한다. Scene 쪽 요소는 카메라·World에 고정이라 그대로 남는다.
 *
 * **스텝 시뮬레이션**은 이 완성된 그림을 거꾸로 풀어 9단계로 다시 쌓아 보이는
 * 장치다(`steps.ts`). 페이지에 들어오면 완성 상태(STEP 0)로 시작하고, START를
 * 누르면 카메라와 로봇만 남은 STEP 1로 돌아간 뒤 NEXT마다 요소가 하나씩 붙는다.
 * 지도가 다 쌓인 뒤의 마지막 STEP에서는 **로봇이 그 답을 실제로 쓴다** — 계산된
 * $P^{world}_{scene}$을 TCP 목표로 놓고 IK로 관절 해를 구해, 홈 자세에서 석션 패드가
 * Scene 상면에 닿는 자세까지 관절을 보간한다. 앞 단계로 돌아가면 홈으로 되돌아간다.
 * 시뮬레이션이 켜져 있는 동안에는 **sim이 Master의 위치와 요소 가시성을 소유**하므로
 * 수동 Master 드래그를 잠근다 — 로봇 조그·free 드래그·궤도·최대화는 그대로 열려 있다.
 *
 * 전환은 전부 트윈이다. 요소의 등장/소멸은 opacity fade이고(재질 불투명도 ×
 * alpha, 라벨 DOM은 style.opacity), Master의 matching 이동과 관절 자세 복귀는
 * 위치·관절값 보간이다. `prefers-reduced-motion: reduce`이면 모든 트윈이 최종
 * 상태로 즉시 건너뛴다.
 */
import * as THREE from 'three';
import {CSS2DObject} from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import URDFLoader from 'urdf-loader';
import type {URDFRobot} from 'urdf-loader';
import type {CartesianJogStep, JogControlFrame, KinematicChain, Vec3} from 'transform-core';
import {Transform, flangePoseFromTcp, jogTargetFlangePose, solveIk} from 'transform-core';
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
import {PIPELINE_STEP_COUNT} from './steps';

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
  /** 초기(홈) 자세로 부드럽게 되돌린다. */
  resetPose: () => void;
  /**
   * 드래그로 옮긴 Master 묶음을 matching이 끝난 원래 자리로 되돌린다.
   * 시뮬레이션이 Master를 소유하고 있는 동안(STEP 1~7)에는 무시된다.
   */
  resetMaster: () => void;
  /**
   * 스텝 시뮬레이션의 단계를 지정한다 — `0`이면 완성 상태(수동 조작 전부 열림),
   * `1`..`PIPELINE_STEP_COUNT`면 해당 STEP의 그림으로 트윈한다. 마지막 STEP은
   * 그림이 완성 상태와 같고 수동 조작도 다시 풀린다.
   */
  setSimStep: (step: number) => void;
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
/** Scene 박스의 z축 회전 (rad) — 마지막 STEP에서 그리퍼 방향을 여기에 맞춘다. */
const SCENE_YAW = -0.3;
/**
 * 박스 로컬 좌표의 picking point — Master와 Scene에서 같은 자리다.
 * z가 박스 높이(BOX_SIZE[2])와 같으므로 이 점은 **상면 위**에 있고, 그래서
 * 마지막 STEP의 TCP 목표로 그대로 쓸 수 있다.
 */
const PICK_LOCAL: readonly [number, number, number] = [0.145, 0.095, 0.12];
/** Master 몸체 불투명도 — 감싸인 Scene이 비쳐 보이도록 옅게, 잡을 때만 진하게. */
const MASTER_BODY_OPACITY = 0.12;
const MASTER_BODY_OPACITY_ACTIVE = 0.34;

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

interface ObjectBox {
  group: THREE.Group;
  /** 반투명 몸체 — 레이캐스트 픽 대상이자 hover 강조를 입히는 곳이다. */
  body: THREE.Mesh;
  material: THREE.MeshStandardMaterial;
}

/**
 * Master / Scene 물체 박스 — 반투명 몸체 + 와이어프레임 모서리.
 * 이미지 원점은 원래 카메라 원점과 같으므로 박스 자체에는 원점 표시가 없다.
 * matching으로 이동한 Master의 원점은 물체 밖 허공에 buildOriginMarker로
 * 따로 그린다.
 *
 * 픽 대상으로는 몸체 mesh만 쓴다 — 모서리 LineSegments는 레이캐스트 임계값이
 * 커서 실제 박스보다 훨씬 넓게 잡힌다.
 */
function buildObjectBox(color: string, {bodyOpacity = 0.3}: {bodyOpacity?: number} = {}): ObjectBox {
  const group = new THREE.Group();
  const geometry = new THREE.BoxGeometry(BOX_SIZE[0], BOX_SIZE[1], BOX_SIZE[2]);
  // 로컬 원점이 박스 바닥 모서리에 오도록 밀어 둔다.
  geometry.translate(BOX_SIZE[0] / 2, BOX_SIZE[1] / 2, BOX_SIZE[2] / 2);
  const material = new THREE.MeshStandardMaterial({
    color,
    transparent: true,
    opacity: bodyOpacity,
    roughness: 0.5,
    depthWrite: false,
  });
  const body = new THREE.Mesh(geometry, material);
  group.add(body);
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(geometry),
    new THREE.LineBasicMaterial({color}),
  );
  group.add(edges);
  return {group, body, material};
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

/** 화살표의 모양·라벨 — 끝점(from/to)과 달리 만든 뒤에는 바뀌지 않는다. */
interface ArrowStyle {
  base: string;
  sup: string;
  sub: string;
  color: string;
  /** 점선 = 파이프라인의 중간 재료, 실선 = 최종 답 강조(굵은 실린더). */
  dashed: boolean;
  /** 라벨 위치 (from→to 보간 비율) — 화살표 선 위에 겹쳐 놓는다. */
  labelT: number;
}

interface PipelineArrow {
  group: THREE.Group;
  /** 끝점을 주면 축·머리·라벨을 그 자리에 다시 맞춘다 (드래그마다 호출). */
  update: (from: THREE.Vector3, to: THREE.Vector3) => void;
}

/** 머리 길이의 상한 (m) — 짧은 화살표에서는 scale로 이보다 줄여 쓴다. */
const ARROW_HEAD_LENGTH = 0.07;
/** 실린더·원뿔 기하의 로컬 축 — 여기서 from→to 방향으로 돌린다. */
const GEOMETRY_AXIS = new THREE.Vector3(0, 1, 0);

/**
 * from → to 화살표 (worldRoot의 z-up 좌표로 그린다).
 *
 * 기하는 한 번만 만들고 update()가 위치·회전·스케일만 고쳐 쓴다 — 그래야 매
 * 프레임 다시 그려도 버퍼를 새로 할당하지 않는다. 끝점이 고정인 화살표는 만든
 * 직후 update()를 한 번 부르고 두면 된다.
 */
function buildPipelineArrow(style: ArrowStyle): PipelineArrow {
  const {color, dashed, labelT} = style;
  const group = new THREE.Group();

  // 점선은 두 점짜리 버퍼를 제자리에서 고쳐 쓴다.
  const linePositions = new Float32Array(6);
  let line: THREE.Line | null = null;
  let shaft: THREE.Mesh | null = null;
  if (dashed) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(linePositions, 3));
    line = new THREE.Line(
      geometry,
      new THREE.LineDashedMaterial({color, dashSize: 0.045, gapSize: 0.028, depthTest: false}),
    );
    line.renderOrder = 11;
    // 끝점이 매번 바뀌므로 bounding sphere로 컬링하면 사라질 수 있다.
    line.frustumCulled = false;
    group.add(line);
  } else {
    // 길이 1로 만들어 두고 scale.y로 늘린다.
    shaft = new THREE.Mesh(
      new THREE.CylinderGeometry(0.0065, 0.0065, 1, 12),
      new THREE.MeshBasicMaterial({color, depthTest: false}),
    );
    shaft.renderOrder = 11;
    group.add(shaft);
  }

  const cone = new THREE.Mesh(
    new THREE.ConeGeometry(dashed ? 0.016 : 0.021, ARROW_HEAD_LENGTH, 16),
    new THREE.MeshBasicMaterial({color, depthTest: false}),
  );
  cone.renderOrder = 11;
  group.add(cone);

  // 라벨 anchor를 화살표 선 위(labelT 지점)에 올려 겹치게 한다.
  const labelAnchor = new THREE.Object3D();
  labelAnchor.add(new CSS2DObject(buildMathLabel(style.base, style.sup, style.sub, color)));
  group.add(labelAnchor);

  const unit = new THREE.Vector3();
  const orientation = new THREE.Quaternion();

  const update = (from: THREE.Vector3, to: THREE.Vector3): void => {
    unit.subVectors(to, from);
    const length = unit.length();
    if (length < 1e-6) {
      return; // 끝점이 겹치면 방향이 없다 — 마지막 모습을 그대로 둔다
    }
    unit.divideScalar(length);
    const headLength = Math.min(ARROW_HEAD_LENGTH, length * 0.3);
    orientation.setFromUnitVectors(GEOMETRY_AXIS, unit);

    if (line) {
      linePositions[0] = from.x;
      linePositions[1] = from.y;
      linePositions[2] = from.z;
      linePositions[3] = to.x - unit.x * headLength * 0.8;
      linePositions[4] = to.y - unit.y * headLength * 0.8;
      linePositions[5] = to.z - unit.z * headLength * 0.8;
      line.geometry.attributes.position!.needsUpdate = true;
      line.computeLineDistances(); // 대시 간격은 선 길이에 딸린 값이라 같이 갱신한다
    }
    if (shaft) {
      shaft.position.copy(from).addScaledVector(unit, (length - headLength) / 2);
      shaft.quaternion.copy(orientation);
      shaft.scale.set(1, length - headLength, 1);
    }
    cone.position.copy(to).addScaledVector(unit, -headLength / 2);
    cone.quaternion.copy(orientation);
    cone.scale.set(1, headLength / ARROW_HEAD_LENGTH, 1); // 굵기는 그대로, 길이만

    labelAnchor.position.lerpVectors(from, to, labelT);
  };

  return {group, update};
}

// ── 트윈 ──────────────────────────────────────────────────────────────
/** 화살표·박스·원점이 등장/소멸하는 fade 시간 (초). */
const FADE_SECONDS = 0.4;
/** Master 묶음이 matching 자리로 옮겨가는 시간 (초) — 과정이 다 보여야 한다. */
const MASTER_MOVE_SECONDS = 0.9;
/** 관절 자세가 홈으로 되돌아가는 시간 (초). */
const POSE_SECONDS = 0.8;
/** 마지막 STEP에서 홈 ↔ 집기 자세를 오가는 시간 (초) — 한 번에 튀지 않게 넉넉히. */
const PICK_SECONDS = 1;
/**
 * 한 프레임에 흘려보낼 시간의 상한 (초) — 탭을 다시 켜거나 렌더가 한참 멈췄다가
 * 돌아왔을 때 누적된 dt로 트윈이 통째로 건너뛰지 않게 한다.
 */
const MAX_FRAME_SECONDS = 0.1;

/** ease-in-out — 시작과 끝이 느리고 가운데가 빠른 표준 곡선. */
function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t);
}

/** 불투명도를 가진 재질 — three의 Material 타입에는 opacity가 이미 있다. */
type OpaqueMaterial = THREE.Material & {opacity: number};

/**
 * 묶음 하나를 통째로 fade in/out하는 손잡이.
 *
 * 요소마다 원래 불투명도가 다르므로(옅은 Master 몸체 0.12, 선 1.0 …) 절대값을
 * 덮어쓰지 않고 **원래 값 × alpha**로 곱한다. CSS2D 라벨은 재질이 없으므로 DOM의
 * `style.opacity`를 같이 건드리고, alpha가 0이면 루트의 `visible`을 내려 렌더에서
 * 아예 뺀다 — CSS2DRenderer도 부모의 `visible`을 따라 라벨 DOM을 숨긴다.
 */
interface Fade {
  /** 현재 alpha (0 = 감춤, 1 = 원래 모습). */
  readonly alpha: number;
  set: (alpha: number) => void;
  /** hover 강조처럼 **원래 불투명도 자체**가 바뀔 때 쓴다 (alpha는 유지). */
  setBase: (material: OpaqueMaterial, base: number) => void;
}

function createFade(roots: readonly THREE.Object3D[]): Fade {
  const materials: {material: OpaqueMaterial; base: number}[] = [];
  const elements: HTMLElement[] = [];
  for (const root of roots) {
    // traverse는 visible=false인 자식도 빠뜨리지 않으므로 순서를 신경 쓸 필요가 없다.
    root.traverse((object) => {
      if (object instanceof CSS2DObject) {
        elements.push(object.element);
        return;
      }
      const raw = (object as Partial<THREE.Mesh>).material;
      if (!raw) {
        return;
      }
      for (const material of Array.isArray(raw) ? raw : [raw]) {
        material.transparent = true; // 불투명 재질은 opacity를 무시한다
        const opaque = material as OpaqueMaterial;
        materials.push({material: opaque, base: opaque.opacity});
      }
    });
  }

  let alpha = 1;
  const apply = (): void => {
    for (const entry of materials) {
      entry.material.opacity = entry.base * alpha;
    }
    for (const element of elements) {
      element.style.opacity = String(alpha);
    }
    for (const root of roots) {
      root.visible = alpha > 0.002;
    }
  };

  return {
    get alpha() {
      return alpha;
    },
    set: (next) => {
      alpha = next;
      apply();
    },
    setBase: (material, base) => {
      const entry = materials.find((e) => e.material === material);
      if (entry) {
        entry.base = base;
        apply();
      }
    },
  };
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
    // 첫 프레임이 rAF로 미뤄지므로 아래에서 정의하는 frameUpdate를 참조해도 안전하다.
    onBeforeRender: () => frameUpdate(),
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
    Transform.rotationZ(SCENE_YAW),
  );
  const tWorldMaster = Transform.fromTranslation([0.546, -0.212, BOX_ALTITUDE + 0.008]).compose(
    Transform.rotationZ(-0.22),
  );

  const {group: sceneBox} = buildObjectBox(SCENE_BLUE);
  applyTransform(sceneBox, tWorldScene);
  worldRoot.add(sceneBox);

  // Master 쪽 세 요소(박스 · 이동된 원점 마커 · picking point)는 하나의 Group에
  // 묶는다. 셋의 상대관계는 matching이 만든 결과 그 자체라 드래그로 흐트러지면
  // 안 되고, Group 하나만 옮기면 강체 이동이 공짜로 보장된다. Group은 항등
  // 변환에서 시작하므로 자식들의 로컬 pose = 원래의 world pose다.
  const masterGroup = new THREE.Group();
  worldRoot.add(masterGroup);

  // Master는 몸체를 옅게 — 감싸인 Scene이 비쳐 보이도록.
  const master = buildObjectBox(MASTER_RED, {bodyOpacity: MASTER_BODY_OPACITY});
  const masterBox = master.group;
  applyTransform(masterBox, tWorldMaster);
  masterGroup.add(masterBox);
  // hover·드래그 중에만 뜨는 안내 라벨 — 이름표 'Master'가 위쪽이라 아래로 뺀다.
  const masterDragLabel = new CSS2DObject(buildTextLabel('끌어서 이동', MASTER_RED));
  masterDragLabel.position.set(BOX_SIZE[0] / 2, BOX_SIZE[1] / 2, -0.07);
  masterDragLabel.visible = false;
  masterBox.add(masterDragLabel);

  // 이동된 Master 이미지 원점 — 원점은 콘텐츠와 함께 변환을 받으므로
  // 일반적으로 물체 밖에 떨어진다 (원본 그림 2-8의 초록 점). 카메라 원점의
  // 오른쪽 아래, 박스의 오른쪽 위 허공에 두고 잔차 회전만 얹는다.
  const tWorldMasterOrigin = Transform.fromTranslation([0.8, -0.18, 0.72]).compose(
    Transform.rotationZ(-0.22),
  );
  const masterOriginMarker = buildOriginMarker(MASTER_RED);
  applyTransform(masterOriginMarker, tWorldMasterOrigin);
  masterGroup.add(masterOriginMarker);

  // ── 원점·점 위치 (world 좌표, z-up) ───────────────────────────────
  const vec = (p: readonly number[]): THREE.Vector3 => new THREE.Vector3(p[0], p[1], p[2]);
  const worldOrigin = new THREE.Vector3(0, 0, 0);
  const cameraOrigin = vec(tWorldCamera.translation);
  const masterOrigin = vec(tWorldMasterOrigin.translation);
  const masterPick = vec(tWorldMaster.transformPoint(PICK_LOCAL));
  const scenePick = vec(tWorldScene.transformPoint(PICK_LOCAL));

  const masterPickDot = buildPointDot(POINT_RED);
  masterPickDot.position.copy(masterPick);
  masterGroup.add(masterPickDot);
  const scenePickDot = buildPointDot(POINT_RED);
  scenePickDot.position.copy(scenePick);
  worldRoot.add(scenePickDot);

  // 이미지 원점의 원래 위치 = 카메라 원점 — Master·Scene 둘 다 여기서 시작한다.
  const imageOriginDot = buildPointDot('#e7ecf3');
  imageOriginDot.position.copy(cameraOrigin);
  worldRoot.add(imageOriginDot);

  // ── 파이프라인 화살표 5종 + 수식 라벨 ─────────────────────────────
  // 끝점이 World·Camera·Scene에 고정인 셋은 한 번 그리면 끝이다 (스텝 시뮬레이션이
  // 하나씩 fade in할 수 있도록 각각 이름을 붙여 둔다).
  const buildStaticArrow = (
    spec: ArrowStyle & {from: THREE.Vector3; to: THREE.Vector3},
  ): PipelineArrow => {
    const arrow = buildPipelineArrow(spec);
    arrow.update(spec.from, spec.to);
    worldRoot.add(arrow.group);
    return arrow;
  };
  // T_cal: World 원점 → Camera 원점 (calibration 결과)
  const tCalArrow = buildStaticArrow({
    from: worldOrigin, to: cameraOrigin, base: 'T', sup: '', sub: 'cal',
    color: GRAY, dashed: true, labelT: 0.6,
  });
  // P^{camera}_{scene}: Camera 원점(= Scene 이미지 원점) → Scene의 picking point
  const pCameraSceneArrow = buildStaticArrow({
    from: cameraOrigin, to: scenePick, base: 'P', sup: 'camera', sub: 'scene',
    color: GRAY, dashed: true, labelT: 0.68,
  });
  // P^{world}_{scene}: World 원점 → Scene의 picking point — 유일한 파란 실선(최종 답)
  const pWorldSceneArrow = buildStaticArrow({
    from: worldOrigin, to: scenePick, base: 'P', sup: 'world', sub: 'scene',
    color: BLUE, dashed: false, labelT: 0.45,
  });

  // 나머지 둘은 Master 묶음에 끝점이 걸려 있어 드래그마다 다시 그린다.
  // T_match: Scene 원점(= 카메라 원점, 고정) → 허공의 이동된 Master 원점
  const tMatchArrow = buildPipelineArrow({
    base: 'T', sup: '', sub: 'match', color: GRAY, dashed: true, labelT: 0.5,
  });
  // P^{camera}_{master}: 이동된 Master 원점 → Master의 picking point — 두 끝점이
  // 함께 움직이므로 길이·방향은 그대로고 평행이동만 한다.
  const pCameraMasterArrow = buildPipelineArrow({
    base: 'P', sup: 'camera', sub: 'master', color: GRAY, dashed: true, labelT: 0.55,
  });
  worldRoot.add(tMatchArrow.group, pCameraMasterArrow.group);

  /**
   * Master 화살표 두 개를 지금의 Master 묶음 위치에 맞춘다.
   *
   * masterGroup은 worldRoot의 직속 자식이고 **병진만** 하므로, 원점·pick 점의
   * 현재 위치는 원래 위치 + Group의 position이다 (matrixWorld를 거치지 않아
   * 프레임 순서에 영향받지 않는다).
   */
  const masterOriginNow = new THREE.Vector3();
  const masterPickNow = new THREE.Vector3();
  const updateMasterArrows = (): void => {
    masterOriginNow.addVectors(masterOrigin, masterGroup.position);
    masterPickNow.addVectors(masterPick, masterGroup.position);
    tMatchArrow.update(cameraOrigin, masterOriginNow);
    pCameraMasterArrow.update(masterOriginNow, masterPickNow);
  };
  updateMasterArrows();

  // ── 이름표 ────────────────────────────────────────────────────────
  /**
   * Master 원점 이름표 — matching 전에는 아직 "이동된" 원점이 아니라 카메라 원점과
   * 같은 자리에 있는 원본 이미지 원점이므로, 스텝 시뮬레이션이 문구를 바꿔 준다.
   */
  const MASTER_ORIGIN_NAMES = {
    beforeMatch: 'Master 원점 (= 카메라 원점)',
    afterMatch: '이동된 Master 원점',
  };
  const nameLabels: [readonly [number, number, number], string, string][] = [
    [[-0.28, 0, 0.06], 'Robot — World 좌표계', '#aeb8c4'],
    [[0.74, 0, 1.42], 'Camera 좌표계', '#aeb8c4'],
    [[0.32, 0.06, 1.3], '이미지 원점 (원래 위치)', '#e7ecf3'],
    [[0.05, 0.1, 0.24], 'Master', MASTER_RED],
    [[0.24, 0.1, -0.05], 'Scene', SCENE_BLUE],
    [[0.05, 0, -0.09], MASTER_ORIGIN_NAMES.afterMatch, MASTER_RED],
  ];
  const [worldName, cameraName, imageOriginName, masterName, sceneName, masterOriginName] =
    nameLabels.map(([position, text, color]) => {
      const element = buildTextLabel(text, color);
      const anchor = new THREE.Object3D();
      anchor.position.copy(vec(position));
      anchor.add(new CSS2DObject(element));
      return {anchor, element};
    });
  worldRoot.add(worldName!.anchor);
  worldRoot.add(cameraName!.anchor);
  worldRoot.add(imageOriginName!.anchor);
  // Master/Scene 이름표는 박스에, 이동된 원점 라벨은 허공의 마커에 붙여
  // 로컬 좌표로 띄운다.
  masterBox.add(masterName!.anchor);
  sceneBox.add(sceneName!.anchor);
  masterOriginMarker.add(masterOriginName!.anchor);

  // ── 트윈 러너 ─────────────────────────────────────────────────────
  // 진행 중인 트윈을 "무엇을 움직이는가"로 키를 잡아 Map에 담는다 — 같은 대상에
  // 새 트윈이 걸리면 이전 것을 자동으로 밀어내므로, NEXT를 연타해도 두 트윈이
  // 한 값을 동시에 쓰는 일이 없다.
  interface Tween {
    seconds: number;
    elapsed: number;
    /** 이징이 적용된 진행도(0~1)를 받아 값을 씌운다. */
    apply: (progress: number) => void;
    onDone?: () => void;
  }
  const tweens = new Map<unknown, Tween>();
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  /** 트윈을 걸거나, 모션을 줄이는 설정이면 최종 상태로 즉시 건너뛴다. */
  const animate = (
    key: unknown,
    seconds: number,
    apply: (progress: number) => void,
    onDone?: () => void,
  ): void => {
    if (reduceMotion.matches || seconds <= 0) {
      tweens.delete(key);
      apply(1);
      onDone?.();
      return;
    }
    tweens.set(key, {seconds, elapsed: 0, apply, onDone});
  };

  let lastFrameMs = 0;
  const advanceTweens = (): void => {
    const now = performance.now();
    const dt = lastFrameMs === 0 ? 0 : Math.min((now - lastFrameMs) / 1000, MAX_FRAME_SECONDS);
    lastFrameMs = now;
    // Map은 순회 중 delete가 안전하다 (아직 안 본 항목만 남는다).
    for (const [key, tween] of tweens) {
      tween.elapsed += dt;
      const t = Math.min(1, tween.elapsed / tween.seconds);
      tween.apply(easeInOut(t));
      if (t >= 1) {
        tweens.delete(key);
        tween.onDone?.();
      }
    }
  };

  // ── 스텝 시뮬레이션 ───────────────────────────────────────────────
  // 요소를 묶음 단위로 fade한다. 묶음끼리 재질이 겹치지 않게 나눠야 한 재질이
  // 두 alpha를 동시에 받지 않는다 (라벨은 각자 붙어 있는 부모 묶음을 따라간다).
  const masterFade = createFade([masterGroup]);
  const sceneFade = createFade([sceneBox, scenePickDot]);
  const imageOriginFade = createFade([imageOriginDot, imageOriginName!.anchor]);
  // T_match와 P^camera_master는 둘 다 "이동된 Master 원점"에 걸린 화살표라
  // 한 묶음으로 같이 등장한다.
  const tMatchFade = createFade([tMatchArrow.group, pCameraMasterArrow.group]);
  const pCameraSceneFade = createFade([pCameraSceneArrow.group]);
  const tCalFade = createFade([tCalArrow.group]);
  const pWorldSceneFade = createFade([pWorldSceneArrow.group]);

  /** 각 묶음이 처음 나타나는 STEP (`steps.ts`의 시나리오). */
  const REVEAL_AT: readonly {fade: Fade; step: number}[] = [
    {fade: masterFade, step: 2},
    {fade: imageOriginFade, step: 2},
    {fade: sceneFade, step: 3},
    {fade: tMatchFade, step: 5},
    {fade: pCameraSceneFade, step: 6},
    {fade: tCalFade, step: 7},
    {fade: pWorldSceneFade, step: 8},
  ];
  /** Master가 Scene 위로 옮겨가는 STEP — 이 단계부터 matching이 끝난 그림이다. */
  const MATCH_STEP = 4;
  /**
   * 로봇이 집기 자세로 가는 STEP — 지도가 다 쌓인 뒤의 마지막 단계다.
   * 여기서만 관절을 건드리므로, 그 밖의 단계 전환은 사람이 조그해 둔 자세를
   * 그대로 남긴다.
   */
  const PICK_STEP = PIPELINE_STEP_COUNT;

  /**
   * matching 전 Master 묶음의 위치 (masterGroup의 병진량).
   *
   * "이미지 원점은 원래 카메라 원점과 같다"를 그림으로 보이는 자리다 — 원점 마커를
   * 카메라 원점 바로 옆에 살짝 비껴 두면, 강체로 묶인 박스가 Scene에서 멀찍이
   * 떨어진 공중으로 딸려 올라간다. 즉 matching이 옮기는 것은 원점 하나이고 박스는
   * 그 결과로 따라오는 것이라는 관계가 시작 자세에서부터 드러난다.
   */
  const MASTER_ORIGIN_NUDGE: readonly [number, number, number] = [0.02, -0.09, -0.05];
  const masterPreMatchOffset = new THREE.Vector3()
    .copy(cameraOrigin)
    .add(vec(MASTER_ORIGIN_NUDGE))
    .sub(masterOrigin);
  /** matching이 끝난 자리 = 씬을 만들 때의 원래 pose이므로 병진량이 0이다. */
  const masterMatchedOffset = new THREE.Vector3(0, 0, 0);

  const MASTER_MOVE_KEY = 'master-move';
  const JOINT_KEY = 'joint-values';

  const tweenMasterTo = (to: THREE.Vector3, seconds: number): void => {
    const from = masterGroup.position.clone();
    if (from.distanceToSquared(to) < 1e-12) {
      tweens.delete(MASTER_MOVE_KEY);
      return;
    }
    animate(MASTER_MOVE_KEY, seconds, (progress) => {
      masterGroup.position.lerpVectors(from, to, progress);
      updateMasterArrows(); // 끝점이 Master에 걸린 화살표 둘은 매 프레임 다시 그린다
    });
  };
  const snapMasterTo = (to: THREE.Vector3): void => {
    tweens.delete(MASTER_MOVE_KEY);
    masterGroup.position.copy(to);
    updateMasterArrows();
  };

  /** 관절 자세를 목표값까지 보간한다 — 자세 전환이 한 프레임에 튀지 않도록. */
  const tweenJointsTo = (
    target: Readonly<Record<string, number>>,
    seconds = POSE_SECONDS,
  ): void => {
    const from = {...jointValues};
    animate(JOINT_KEY, seconds, (progress) => {
      for (const [name, goal] of Object.entries(target)) {
        const start = from[name];
        if (start !== undefined) {
          jointValues[name] = start + (goal - start) * progress;
        }
      }
      applyJointValues();
    });
  };
  /** 사람이 직접 팔을 움직이기 시작하면 진행 중인 자세 트윈을 놓아준다. */
  const cancelJointTween = (): void => {
    tweens.delete(JOINT_KEY);
  };

  // ── 마지막 STEP의 집기 자세 ───────────────────────────────────────
  /**
   * 계산이 끝난 답 $P^{world}_{scene}$을 실제 관절값으로 바꾼 결과.
   *
   * 파이프라인이 내놓는 것은 **TCP의 목표**이지 관절값이 아니다. 그 간극을 메우는
   * 순서가 그대로 여기에 있다:
   *
   * 1. **목표 TCP pose** — 위치는 `scenePick`(= $P^{world}_{scene}$, 이미 박스
   *    상면 위의 점)이고, 자세는 approach 축(TCP의 +z)이 상면 법선의 반대인
   *    world −Z를 향하도록 x축 180°를 준다. 그래야 석션 패드가 상면에 비스듬히
   *    걸리지 않고 평평하게 맞닿는다. z축 회전은 상면 법선을 바꾸지 않으므로
   *    자유롭게 고를 수 있고, 박스와 나란해 보이도록 Scene의 yaw를 얹는다.
   * 2. **flange 목표** — IK가 푸는 체인의 끝점은 TCP가 아니라 플랜지이므로
   *    $T^{base}_{flange} = T^{base}_{tcp}\cdot(T^{flange}_{tcp})^{-1}$로 되돌린다
   *    (조그가 쓰는 것과 같은 변환).
   * 3. **IK** — 홈 자세를 seed로 두어 여러 해 중 홈에서 가장 가까운 것으로
   *    수렴시킨다. 그래야 이어지는 관절 보간이 팔을 크게 휘두르지 않는다.
   *
   * 결과는 한 번만 풀고 재사용한다 (`undefined` = 아직 안 풀어 봄, `null` = 못 품).
   */
  let pickPose: Record<string, number> | null | undefined;
  const resolvePickPose = (): Record<string, number> | null => {
    if (pickPose !== undefined) {
      return pickPose;
    }
    if (!chain) {
      return null; // 체인이 아직 없다 — 다음 기회에 다시 풀어 본다
    }
    const pickInBase = tRobotBaseWorld.transformPoint([scenePick.x, scenePick.y, scenePick.z]);
    const tcpTarget = Transform.fromTranslation(pickInBase)
      .compose(Transform.rotationZ(SCENE_YAW))
      .compose(Transform.rotationX(Math.PI));
    const result = solveIk(
      chain,
      flangePoseFromTcp(tcpTarget, T_FLANGE_TCP),
      robotConfig.jointValues,
      {maxIterations: 200},
    );
    if (!result.converged) {
      // 도달 범위 밖이면 로봇은 홈에 그대로 둔다 — 나머지 그림은 정상이다.
      console.warn('집기 자세의 IK가 수렴하지 못해 STEP 마지막에서 로봇을 움직이지 않습니다');
      pickPose = null;
      return null;
    }
    pickPose = result.values;
    return pickPose;
  };

  /**
   * 현재 단계. `0` = 완성 상태(시뮬레이션 꺼짐), `1..PIPELINE_STEP_COUNT` = 각 STEP.
   * 마지막 STEP은 그림이 완성 상태와 같으므로 잠금도 함께 풀린다.
   */
  let simStep = 0;
  /** sim이 Master의 위치·가시성을 소유하고 있는가 (= 수동 Master 드래그 잠금). */
  const simOwnsMaster = (): boolean => simStep >= 1 && simStep < PIPELINE_STEP_COUNT;
  /** 완성 상태(0)와 마지막 STEP은 "전부 보이는" 같은 그림이다. */
  const showsEverything = (step: number): boolean => step === 0 || step >= PIPELINE_STEP_COUNT;
  const masterVisibleAt = (step: number): boolean => showsEverything(step) || step >= 2;
  const matchedAt = (step: number): boolean => showsEverything(step) || step >= MATCH_STEP;

  const fadeTo = (fade: Fade, target: number, onDone?: () => void): void => {
    const from = fade.alpha;
    if (from === target) {
      tweens.delete(fade);
      onDone?.();
      return;
    }
    animate(fade, FADE_SECONDS, (progress) => fade.set(from + (target - from) * progress), onDone);
  };

  const setSimStep = (next: number): void => {
    const clamped = Math.max(0, Math.min(PIPELINE_STEP_COUNT, Math.round(next)));
    const previous = simStep;
    simStep = clamped;

    const matched = matchedAt(clamped);
    masterOriginName!.element.textContent = matched
      ? MASTER_ORIGIN_NAMES.afterMatch
      : MASTER_ORIGIN_NAMES.beforeMatch;

    // Master의 자리는 fade와 어긋나면 안 된다: 보이는 채로 옮길 때만 트윈하고,
    // 사라지는 중이라면 다 사라진 뒤에(onDone) 조용히 옮긴다.
    const to = matched ? masterMatchedOffset : masterPreMatchOffset;
    const visible = masterVisibleAt(clamped);
    const wasVisible = masterVisibleAt(previous);
    let onMasterFadeDone: (() => void) | undefined;
    if (visible && wasVisible) {
      tweenMasterTo(to, MASTER_MOVE_SECONDS); // STEP 4의 matching이 바로 이 경우다
    } else if (visible) {
      snapMasterTo(to); // 아직 안 보이는 동안 자리를 잡아 두고 fade in한다
    } else {
      onMasterFadeDone = () => snapMasterTo(to);
    }

    for (const entry of REVEAL_AT) {
      const target = showsEverything(clamped) || clamped >= entry.step ? 1 : 0;
      fadeTo(entry.fade, target, entry.fade === masterFade ? onMasterFadeDone : undefined);
    }

    // 로봇 자세는 집기 STEP을 드나들 때만 움직인다 — PREV로 나오면 홈으로 되돌아간다.
    if (clamped === PICK_STEP && previous !== PICK_STEP) {
      const pose = resolvePickPose();
      if (pose) {
        tweenJointsTo(pose, PICK_SECONDS);
      }
    } else if (previous === PICK_STEP && clamped !== PICK_STEP) {
      tweenJointsTo(robotConfig.jointValues, PICK_SECONDS);
    }

    // 잠기는 순간 Master를 잡고 있었거나 hover 강조가 남아 있으면 여기서 놓아준다.
    if (simOwnsMaster()) {
      if (dragTarget === 'master') {
        endDrag();
      }
      if (hoverTarget === 'master') {
        hoverTarget = null;
      }
    }
    applyDragStyle(); // 잠금이 바뀌면 hover 강조·커서도 따라가야 한다
  };

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

  // ── 씬 안에서 끄는 두 가지 드래그 ─────────────────────────────────
  // 둘 다 "시선에 수직인 평면 위에서 목표를 옮긴다"는 같은 골격을 쓰지만 결과가
  // 다르다:
  //
  // - 손목 핸들: 매 프레임 "위치만 바뀐 플랜지 목표"를 IK로 푼다. 자세는 잡은
  //   순간 값으로 고정해 두어(순수 위치 드래그) 끌려오는 동안 손목이 제멋대로
  //   돌지 않는다.
  // - Master 박스: IK와 무관하게 masterGroup의 pose만 바꾼다 — 묶인 세 요소가
  //   강체로 따라오고, 끝점이 걸린 화살표 둘을 다시 그린다.
  //
  // 어느 쪽도 잡지 못한 클릭은 그대로 흘려보내 OrbitControls가 궤도 회전을 맡는다.
  type DragTarget = 'handle' | 'master';

  const tRobotBaseWorld = tWorldRobotBase.inverse();
  const raycaster = new THREE.Raycaster();
  const pointerNdc = new THREE.Vector2();
  const dragPlane = new THREE.Plane();
  /** 움직이는 대상의 기준점 − 첫 클릭 지점 — 잡는 순간 커서로 순간이동하지 않게 한다. */
  const grabOffset = new THREE.Vector3();
  const planeHit = new THREE.Vector3();
  const scratch = new THREE.Vector3();

  let hoverTarget: DragTarget | null = null;
  let dragTarget: DragTarget | null = null;
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

  /** hover·드래그 중인 대상만 강조하고 커서 모양을 맞춘다. */
  const applyDragStyle = (): void => {
    const active = (target: DragTarget): boolean =>
      dragTarget === target || (dragTarget === null && hoverTarget === target);

    const handleActive = active('handle');
    handle.material.opacity = handleActive ? 0.7 : 0.42;
    handle.material.emissiveIntensity = handleActive ? 0.95 : 0.4;
    handle.sphere.scale.setScalar(handleActive ? 1.1 : 1);
    handle.label.visible = handleActive;

    // Master 몸체는 fade의 곱셈 대상이라 opacity를 직접 쓰면 안 된다 — 원래
    // 불투명도(base)만 바꿔 주고 alpha는 시뮬레이션 쪽에 맡긴다.
    const masterActive = active('master');
    masterFade.setBase(
      master.material,
      masterActive ? MASTER_BODY_OPACITY_ACTIVE : MASTER_BODY_OPACITY,
    );
    masterDragLabel.visible = masterActive;

    shell.domElement.style.cursor = dragTarget ? 'grabbing' : hoverTarget ? 'grab' : '';
  };

  /** 포인터 위치에서 카메라 레이를 세운다. 캔버스 크기가 0이면 좌표가 없다. */
  const castFrom = (event: PointerEvent): boolean => {
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

  /**
   * 포인터 아래에 있는 드래그 대상. 손목 핸들이 Master 박스보다 앞선다 — 둘이
   * 겹쳐 보일 때는 로봇을 움직이려는 의도로 읽는 편이 자연스럽다.
   */
  const pickTarget = (event: PointerEvent): DragTarget | null => {
    if (!castFrom(event)) {
      return null;
    }
    // Raycaster는 visible을 보지 않으므로 핸들은 여기서 직접 걸러 준다
    // (IK 체인이 없으면 끌어도 팔이 따라오지 못한다).
    if (handle.group.visible && chain && raycaster.intersectObject(handle.sphere, false).length > 0) {
      return 'handle';
    }
    // 시뮬레이션이 도는 동안에는 sim이 Master의 위치를 소유한다 — 손으로 끌면
    // 트윈과 서로 덮어쓰므로 아예 잡히지 않게 한다 (로봇 조작은 위에서 이미 통과).
    if (simOwnsMaster() || masterFade.alpha < 0.5) {
      return null;
    }
    return raycaster.intersectObject(master.body, false).length > 0 ? 'master' : null;
  };

  /** three.js world 좌표(y-up) → 로봇 base 좌표 — IK 목표는 base 기준이다. */
  const toBaseFrame = (point: THREE.Vector3): Vec3 => {
    const local = worldRoot.worldToLocal(scratch.copy(point));
    return tRobotBaseWorld.transformPoint([local.x, local.y, local.z]);
  };

  const onDragMove = (event: PointerEvent): void => {
    if (!dragTarget || event.pointerId !== dragPointerId || !castFrom(event)) {
      return;
    }
    if (!raycaster.ray.intersectPlane(dragPlane, planeHit)) {
      return; // 시선과 평면이 나란해지는 순간 — 이 프레임은 건너뛴다
    }
    planeHit.add(grabOffset);
    if (dragTarget === 'handle') {
      followGoal = toBaseFrame(planeHit);
      return;
    }
    // masterGroup의 position은 부모(worldRoot)의 z-up 좌표다.
    masterGroup.position.copy(worldRoot.worldToLocal(scratch.copy(planeHit)));
    updateMasterArrows();
  };

  const endDrag = (): void => {
    if (!dragTarget) {
      return;
    }
    dragTarget = null;
    dragPointerId = null;
    followGoal = null;
    grabbedPose = null;
    failStreak = 0;
    shell.controls.enabled = true;
    window.removeEventListener('pointermove', onDragMove);
    window.removeEventListener('pointerup', endDrag);
    window.removeEventListener('pointercancel', endDrag);
    applyDragStyle();
    reportState('idle');
  };

  const onPointerDown = (event: PointerEvent): void => {
    if (dragTarget || event.button !== 0) {
      return;
    }
    const target = pickTarget(event);
    if (!target) {
      return; // 빈 공간이면 그대로 흘려보내 OrbitControls가 궤도 회전을 맡는다
    }
    // 컨테이너의 **캡처 단계**라 캔버스에 붙은 OrbitControls 리스너보다 먼저 돈다 —
    // 여기서 전파를 끊어야 드래그와 궤도 회전이 동시에 걸리지 않는다.
    event.stopPropagation();
    event.preventDefault();
    dragTarget = target;
    dragPointerId = event.pointerId;
    shell.controls.enabled = false;

    // 드래그 평면은 "잡은 자리"를 지나야 깊이가 유지된다. 핸들은 구체 중심이
    // 곧 목표점이라 그 자리를 쓰고, 박스는 표면의 클릭 지점을 쓴다.
    const grabPoint = new THREE.Vector3();
    // 실제로 옮기는 기준점 — 핸들은 구체 중심, Master는 Group 원점이다.
    const moved = new THREE.Vector3();
    if (target === 'handle') {
      handle.sphere.getWorldPosition(grabPoint);
      moved.copy(grabPoint);
    } else {
      const hit = raycaster.intersectObject(master.body, false)[0];
      grabPoint.copy(hit ? hit.point : master.body.getWorldPosition(scratch));
      masterGroup.getWorldPosition(moved);
    }
    dragPlane.setFromNormalAndCoplanarPoint(
      shell.viewCamera.getWorldDirection(new THREE.Vector3()),
      grabPoint,
    );
    grabOffset.set(0, 0, 0);
    if (raycaster.ray.intersectPlane(dragPlane, planeHit)) {
      grabOffset.subVectors(moved, planeHit);
    }

    if (target === 'handle' && chain) {
      cancelJointTween(); // 사람이 잡은 순간부터는 자세 트윈이 아니라 손이 주인이다
      grabbedPose = chain.fk(jointValues);
      followGoal = toBaseFrame(grabPoint);
      failStreak = 0;
      reportState('dragging');
    }

    window.addEventListener('pointermove', onDragMove);
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);
    applyDragStyle();
  };

  const onHoverMove = (event: PointerEvent): void => {
    if (dragTarget) {
      return;
    }
    const next = pickTarget(event);
    if (next !== hoverTarget) {
      hoverTarget = next;
      applyDragStyle();
    }
  };

  const onPointerLeave = (): void => {
    if (!dragTarget && hoverTarget) {
      hoverTarget = null;
      applyDragStyle();
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
    if (dragTarget !== 'handle' || !robot || !chain || !followGoal || !grabbedPose) {
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

  /**
   * 렌더 한 프레임의 갱신 — 트윈을 먼저 진행시키고 free 드래그를 뒤에 둔다.
   * 손이 잡고 있는 동안에는 자세 트윈이 이미 취소되어 있으므로 둘이 겹치지 않는다.
   */
  const frameUpdate = (): void => {
    advanceTweens();
    followFrame();
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
      cancelJointTween();
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
      cancelJointTween();
      const before = jointValues[jointName]!;
      jointValues[jointName] = before + delta;
      applyJointValues(); // limit을 넘으면 여기서 잘려 되읽힌다
      return Math.abs(jointValues[jointName]! - before) > 1e-9;
    },
    resetPose: () => {
      tweenJointsTo(robotConfig.jointValues);
    },
    resetMaster: () => {
      if (simOwnsMaster()) {
        return; // 시뮬레이션이 Master를 소유하고 있는 동안에는 손을 대지 않는다
      }
      tweenMasterTo(masterMatchedOffset, MASTER_MOVE_SECONDS);
    },
    setSimStep,
    dispose: () => {
      disposed = true;
      tweens.clear();
      endDrag(); // 드래그 도중 언마운트되어도 window 리스너가 남지 않게
      container.removeEventListener('pointerdown', onPointerDown, true);
      shell.domElement.removeEventListener('pointermove', onHoverMove);
      shell.domElement.removeEventListener('pointerleave', onPointerLeave);
      shell.dispose();
    },
  };
}
