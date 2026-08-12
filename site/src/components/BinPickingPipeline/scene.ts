/**
 * 0단계 bin picking 파이프라인 3D 씬 (브라우저 전용).
 *
 * RobotCellViewer의 렌더링 코어(viewer-core.ts)와 셀 배치(cell-layout.ts)를
 * 재사용하고, 그 위에 파이프라인 지도 요소를 얹는다:
 *
 * - Master / Scene 박스 — 각자의 이미지 원점(원점 점 + 소형 RGB 축)을 가진다
 *   (reference DOCX 그림 2-8의 "Master와 Scene은 각자의 원점을 갖는다")
 * - 화살표 5종 — 전부 from-to 규칙(ADR-0001, 꼬리 = 기준 좌표계 원점).
 *   점선 = 파이프라인의 중간 재료, 파란 실선 = 최종 답 $P^{world}_{scene}$
 *   (기존 2D SVG의 시각 언어 유지)
 *
 * 박스 pose와 점 위치는 transform-core로 계산하고, 렌더링 레이어는 결과를
 * 그리기만 한다.
 */
import * as THREE from 'three';
import {CSS2DObject} from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import URDFLoader from 'urdf-loader';
import {Transform} from 'transform-core';
import {CELL_FRAMES, DEFAULT_CELL, createCellLayout} from '../RobotCellViewer/cell-layout';
import type {SceneRobotConfig} from '../RobotCellViewer/scene';
import {
  applyTransform,
  buildCameraGlyph,
  buildCameraPost,
  buildFrameAxes,
  buildMathLabel,
  buildTable,
  createViewerShell,
} from '../RobotCellViewer/viewer-core';

export interface PipelineSceneOptions {
  container: HTMLElement;
  robot: SceneRobotConfig;
  onReady?: () => void;
  onError?: (error: unknown) => void;
}

export interface PipelineScene {
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
/** 박스 로컬 좌표의 picking point — Master와 Scene에서 같은 자리다. */
const PICK_LOCAL: readonly [number, number, number] = [0.145, 0.095, 0.12];

/**
 * Master / Scene 물체 박스 — 반투명 몸체 + 와이어프레임 모서리와
 * 자기 이미지 원점(점 + 소형 RGB 축)을 가진다.
 */
function buildObjectBox(color: string): THREE.Group {
  const group = new THREE.Group();
  const geometry = new THREE.BoxGeometry(BOX_SIZE[0], BOX_SIZE[1], BOX_SIZE[2]);
  // 로컬 원점이 박스 바닥 모서리에 오도록 밀어 둔다 — 이미지 원점 = (0,0,0).
  geometry.translate(BOX_SIZE[0] / 2, BOX_SIZE[1] / 2, BOX_SIZE[2] / 2);
  const body = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({
      color,
      transparent: true,
      opacity: 0.3,
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

  // 이미지 원점: 원점 점 + 소형 축.
  const originDot = new THREE.Mesh(
    new THREE.SphereGeometry(0.011, 16, 16),
    new THREE.MeshBasicMaterial({color, depthTest: false}),
  );
  originDot.renderOrder = 10;
  group.add(originDot);
  group.add(buildFrameAxes(0.07));
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

/** 좌표계·물체 이름표 DOM. */
function buildTextLabel(text: string, color: string): HTMLElement {
  const el = document.createElement('span');
  el.style.cssText = [
    `color:${color}`,
    'font:600 12.5px system-ui,sans-serif',
    'background:rgba(11,14,19,0.82)',
    'border-radius:4px',
    'padding:1px 5px',
    'pointer-events:none',
    'white-space:nowrap',
  ].join(';');
  el.textContent = text;
  return el;
}

export function createPipelineScene(options: PipelineSceneOptions): PipelineScene {
  const {container, robot: robotConfig, onReady, onError} = options;

  const shell = createViewerShell({
    container,
    // 로봇(World 원점) · 카메라 · 작업대 위 박스가 함께 보이는 시점.
    cameraPosition: [-0.45, 1.55, 2.35],
    target: [0.35, 0.62, 0],
  });
  const {worldRoot} = shell;

  const cell = DEFAULT_CELL;
  const frames = createCellLayout(cell);
  const tWorldTable = frames.getTransform(CELL_FRAMES.world, CELL_FRAMES.table);
  const tWorldCamera = frames.getTransform(CELL_FRAMES.world, CELL_FRAMES.camera);
  const tWorldRobotBase = frames.getTransform(CELL_FRAMES.world, CELL_FRAMES.robotBase);

  const table = buildTable(cell);
  applyTransform(table, tWorldTable);
  worldRoot.add(table);

  const cameraGlyph = buildCameraGlyph();
  applyTransform(cameraGlyph, tWorldCamera);
  worldRoot.add(cameraGlyph);
  worldRoot.add(buildCameraPost(tWorldCamera.translation));

  // World / Camera 좌표계 축은 항상 켜 둔다 — 지도에서 두 원점이 기준점이다.
  const worldAxes = buildFrameAxes(0.34);
  worldRoot.add(worldAxes);
  const cameraAxes = buildFrameAxes(0.22);
  cameraGlyph.add(cameraAxes);

  // ── Master / Scene 박스 pose (transform-core) ─────────────────────
  // Scene: 작업대 위에 놓인 실제 물체. Master: Scene에서 벗어난 pose로
  // 떠 있는 기준 이미지 — 각자 자기 이미지 원점을 가진다.
  const tWorldScene = Transform.fromTranslation([0.62, 0.2, cell.tableHeight]).compose(
    Transform.rotationZ(-0.3),
  );
  const tWorldMaster = Transform.fromTranslation([0.03, -0.6, 0.8]).compose(
    Transform.rotationZ(0.55),
  );

  const sceneBox = buildObjectBox(SCENE_BLUE);
  applyTransform(sceneBox, tWorldScene);
  worldRoot.add(sceneBox);
  const masterBox = buildObjectBox(MASTER_RED);
  applyTransform(masterBox, tWorldMaster);
  worldRoot.add(masterBox);

  // ── 원점·점 위치 (world 좌표, z-up) ───────────────────────────────
  const vec = (p: readonly number[]): THREE.Vector3 => new THREE.Vector3(p[0], p[1], p[2]);
  const worldOrigin = new THREE.Vector3(0, 0, 0);
  const cameraOrigin = vec(tWorldCamera.translation);
  const masterOrigin = vec(tWorldMaster.translation);
  const sceneOrigin = vec(tWorldScene.translation);
  const masterPick = vec(tWorldMaster.transformPoint(PICK_LOCAL));
  const scenePick = vec(tWorldScene.transformPoint(PICK_LOCAL));

  const masterPickDot = buildPointDot(POINT_RED);
  masterPickDot.position.copy(masterPick);
  worldRoot.add(masterPickDot);
  const scenePickDot = buildPointDot(POINT_RED);
  scenePickDot.position.copy(scenePick);
  worldRoot.add(scenePickDot);

  // ── 파이프라인 화살표 5종 + 수식 라벨 ─────────────────────────────
  interface ArrowSpec {
    from: THREE.Vector3;
    to: THREE.Vector3;
    base: string;
    sup: string;
    sub: string;
    color: string;
    dashed: boolean;
    /** 라벨 위치 (from→to 보간 비율). */
    labelT: number;
    labelOffset: readonly [number, number, number];
  }
  const specs: ArrowSpec[] = [
    // T_cal: World 원점 → Camera 원점 (calibration 결과)
    {from: worldOrigin, to: cameraOrigin, base: 'T', sup: '', sub: 'cal',
     color: GRAY, dashed: true, labelT: 0.6, labelOffset: [0.08, 0.04, -0.02]},
    // T_match: Master 원점 → Scene 원점 (Master를 Scene 위로 옮기는 변환)
    {from: masterOrigin, to: sceneOrigin, base: 'T', sup: '', sub: 'match',
     color: GRAY, dashed: true, labelT: 0.55, labelOffset: [0, -0.02, 0.06]},
    // P^{camera}_{master}: Camera 원점 → Master의 picking point
    {from: cameraOrigin, to: masterPick, base: 'P', sup: 'camera', sub: 'master',
     color: GRAY, dashed: true, labelT: 0.5, labelOffset: [-0.1, -0.02, 0]},
    // P^{camera}_{scene}: Camera 원점 → Scene의 picking point
    {from: cameraOrigin, to: scenePick, base: 'P', sup: 'camera', sub: 'scene',
     color: GRAY, dashed: true, labelT: 0.72, labelOffset: [0.1, 0.04, 0]},
    // P^{world}_{scene}: World 원점 → Scene의 picking point — 유일한 파란 실선(최종 답)
    {from: worldOrigin, to: scenePick, base: 'P', sup: 'world', sub: 'scene',
     color: BLUE, dashed: false, labelT: 0.35, labelOffset: [0.05, -0.12, -0.05]},
  ];
  for (const spec of specs) {
    worldRoot.add(buildPipelineArrow(spec.from, spec.to, spec.color, spec.dashed));
    const anchor = new THREE.Object3D();
    anchor.position.lerpVectors(spec.from, spec.to, spec.labelT);
    anchor.position.add(vec(spec.labelOffset));
    anchor.add(new CSS2DObject(buildMathLabel(spec.base, spec.sup, spec.sub, spec.color)));
    worldRoot.add(anchor);
  }

  // ── 이름표 ────────────────────────────────────────────────────────
  const nameLabels: [readonly [number, number, number], string, string][] = [
    [[-0.28, 0, 0.06], 'Robot — World 좌표계', '#aeb8c4'],
    [[0.74, 0, 1.42], 'Camera 좌표계', '#aeb8c4'],
    [[0.02, 0.075, 0.2], 'Master', MASTER_RED],
    [[0.24, 0.075, 0.06], 'Scene', SCENE_BLUE],
  ];
  const [worldName, cameraName, masterName, sceneName] = nameLabels.map(
    ([position, text, color]) => {
      const anchor = new THREE.Object3D();
      anchor.position.copy(vec(position));
      anchor.add(new CSS2DObject(buildTextLabel(text, color)));
      return anchor;
    },
  );
  worldRoot.add(worldName!);
  worldRoot.add(cameraName!);
  // Master/Scene 이름표는 박스에 붙여 로컬 좌표로 띄운다.
  masterBox.add(masterName!);
  sceneBox.add(sceneName!);

  // ── 로봇 (World 좌표계의 주인) ────────────────────────────────────
  let disposed = false;
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
  loader.load(robotConfig.urdfUrl, (robot) => {
    if (disposed) {
      return;
    }
    for (const [joint, value] of Object.entries(robotConfig.jointValues)) {
      robot.setJointValue(joint, value);
    }
    applyTransform(robot, tWorldRobotBase);
    worldRoot.add(robot);
  });

  return {
    dispose: () => {
      disposed = true;
      shell.dispose();
    },
  };
}
