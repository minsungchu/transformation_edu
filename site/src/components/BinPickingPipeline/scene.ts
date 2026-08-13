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
 * 여기에 조그(jog)도 얹는다 — 로봇 팔만 움직이고 파이프라인 지도 요소는 World/
 * Camera/Scene에 고정이므로 그대로 남는다. Cartesian 조그는
 * FK → 기준 좌표계에서 델타 적용 → DLS IK(transform-core) 순서로 풀고,
 * Joint 조그는 관절값에 바로 더한다.
 */
import * as THREE from 'three';
import {CSS2DObject} from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import URDFLoader from 'urdf-loader';
import type {URDFRobot} from 'urdf-loader';
import type {CartesianJogStep, JogReferenceFrame, KinematicChain} from 'transform-core';
import {Transform, cartesianJogTarget, solveIk} from 'transform-core';
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

/** 조그 기준 — Cartesian 두 가지 + 관절 직접 구동. */
export type JogMode = JogReferenceFrame | 'joint';

export interface PipelineSceneOptions {
  container: HTMLElement;
  robot: SceneRobotConfig;
  /** 처음 켜 둘 조그 모드 (기준 좌표계 축 표시에 쓰인다). */
  initialJogMode?: JogMode;
  onReady?: () => void;
  onError?: (error: unknown) => void;
}

export interface PipelineScene {
  /** 조그 기준 좌표계 축 표시를 모드에 맞게 바꾼다. */
  setJogMode: (mode: JogMode) => void;
  /**
   * Cartesian 조그 — 기준 좌표계에서 델타를 적용한 목표 pose를 IK로 푼다.
   * 수렴하지 못하면(싱귤래리티·도달 불가) 자세를 그대로 두고 false를 돌려준다.
   */
  jogCartesian: (frame: JogReferenceFrame, step: CartesianJogStep) => boolean;
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
  const {container, robot: robotConfig, initialJogMode = 'base', onReady, onError} = options;

  const shell = createViewerShell({
    container,
    // 로봇(World 원점) · 카메라 · 공중의 박스가 함께 보이는 시점.
    cameraPosition: [-0.45, 1.55, 2.35],
    target: [0.35, 0.62, 0],
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
  const tWorldScene = Transform.fromTranslation([0.66, -0.2, BOX_ALTITUDE]).compose(
    Transform.rotationZ(-0.3),
  );
  const tWorldMaster = Transform.fromTranslation([0.676, -0.212, BOX_ALTITUDE + 0.008]).compose(
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
  const tWorldMasterOrigin = Transform.fromTranslation([0.93, -0.18, 0.72]).compose(
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
  // Cartesian 모드에서 "지금 어느 좌표계를 기준으로 미는가"를 눈으로 읽을 수
  // 있게 한다. Base는 World 축(항상 켜 둔 worldAxes 대신 크게 강조해 그리고),
  // Tool은 TCP link에 붙인 축이다.
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
  const baseJogAxes = buildJogReference(0.5, '조그 기준: World 좌표계', 0.56);
  worldRoot.add(baseJogAxes);
  const toolJogAxes = buildJogReference(0.17, '조그 기준: Tool 좌표계 (TCP)', 0.2);

  let jogMode: JogMode = initialJogMode;
  const applyJogMode = (): void => {
    baseJogAxes.visible = jogMode === 'base';
    toolJogAxes.visible = jogMode === 'tool';
    // Base 강조 축과 겹치지 않도록 기본 World 축은 잠시 접어 둔다.
    worldAxes.visible = jogMode !== 'base';
  };
  applyJogMode();

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

    const toolLink = robot.links[robotConfig.frameLinks.tool];
    if (toolLink) {
      toolLink.add(toolJogAxes);
    }
    try {
      chain = urdfSerialChain(robot, robotConfig.frameLinks.tool);
    } catch (error) {
      // 체인을 못 세우면 Cartesian 조그만 비활성이고 나머지 씬은 정상이다.
      console.warn('IK 체인을 만들지 못해 Cartesian 조그를 끕니다:', error);
    }
    applyJogMode();
  });

  return {
    setJogMode: (mode) => {
      jogMode = mode;
      applyJogMode();
    },
    jogCartesian: (frame, step) => {
      if (!robot || !chain) {
        return false;
      }
      // 현재 관절각 → FK로 현재 TCP pose → 기준 좌표계에서 델타 적용 → IK.
      const target = cartesianJogTarget(chain.fk(jointValues), step, frame);
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
      shell.dispose();
    },
  };
}
