/**
 * Three.js 렌더링 레이어.
 *
 * 프레임 pose는 전부 cell-layout.ts(transform-core)에서 받아와 4×4 행렬로
 * 씌우기만 한다 — 이 파일에는 좌표계 수학 로직이 없다 (mesh의 로컬 생김새
 * 구성과, 씬 그래프에서 읽은 원점 위치로 화살표를 긋는 일만 있다).
 * 로봇 내부 FK는 urdf-loader의 씬 그래프가 담당한다.
 * 렌더러·카메라·조명 등 공용 셸과 mesh 빌더는 viewer-core.ts에 있다.
 */
import * as THREE from 'three';
import {CSS2DObject} from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import URDFLoader from 'urdf-loader';
import type {URDFRobot} from 'urdf-loader';
import type {CellDimensions} from './cell-layout';
import {CELL_FRAMES, DEFAULT_CELL, createCellLayout, robotMountOffset} from './cell-layout';
import type {ArrowId, FrameName, MountMode} from './types';
import {ARROW_DEFS} from './types';
import {
  applyTransform,
  buildCameraGlyph,
  buildCameraPost,
  buildFrameAxes,
  buildMathLabel,
  buildTextLabel,
  createViewerShell,
} from './viewer-core';

export interface SceneRobotConfig {
  /** 절대 URL(사이트 baseUrl 적용 후)의 URDF. */
  urdfUrl: string;
  /** `package://<pkg>` → 절대 경로 매핑. */
  packages: Record<string, string>;
  /** 초기 관절 자세. */
  jointValues: Record<string, number>;
  /** FrameName → URDF link 이름 매핑. */
  frameLinks: {flange: string; tool: string};
}

export interface RobotCellSceneOptions {
  container: HTMLElement;
  robot: SceneRobotConfig;
  cell?: CellDimensions;
  initialAxes?: readonly FrameName[];
  initialMount?: MountMode;
  initialArrows?: readonly ArrowId[];
  onReady?: () => void;
  onError?: (error: unknown) => void;
}

export interface RobotCellScene {
  setFrameAxesVisible: (frame: FrameName, visible: boolean) => void;
  setMount: (mode: MountMode) => void;
  setArrowVisible: (id: ArrowId, visible: boolean) => void;
  dispose: () => void;
}

interface ArrowEntry {
  def: (typeof ARROW_DEFS)[ArrowId];
  arrow: THREE.ArrowHelper;
  labelAnchor: THREE.Object3D;
  wanted: boolean;
}

export function createRobotCellScene(options: RobotCellSceneOptions): RobotCellScene {
  const {
    container,
    robot: robotConfig,
    cell = DEFAULT_CELL,
    initialAxes = [],
    initialMount = 'post',
    initialArrows = [],
    onReady,
    onError,
  } = options;

  const shell = createViewerShell({
    container,
    // 로봇(원점)과 카메라가 나란히 보이는 측면 시점에서 시작한다.
    cameraPosition: [-0.4, 1.6, 2.75],
    target: [0.3, 0.45, 0],
    onBeforeRender: () => updateArrows(),
  });
  const {scene, worldRoot} = shell;

  // ── 프레임 pose: 전부 transform-core FrameGraph에서 조회 ──────────
  const frames = createCellLayout(cell);
  const tWorldCamera = frames.getTransform(CELL_FRAMES.world, CELL_FRAMES.camera);
  const tWorldRobotBase = frames.getTransform(CELL_FRAMES.world, CELL_FRAMES.robotBase);
  const tFlangeCamera = robotMountOffset();

  // User 좌표계의 예로 쓰는 기준점 — 공중에 떠 있는 소형 축 (1-2절 본문이 참조).
  const userFrameMarker = new THREE.Group();
  userFrameMarker.position.set(cell.cameraDistance, 0, 0.35);
  userFrameMarker.add(buildFrameAxes(0.12));
  const userFrameLabel = new THREE.Object3D();
  userFrameLabel.position.set(0, 0, 0.08);
  userFrameLabel.add(new CSS2DObject(buildTextLabel('User 좌표계 예시', '#aeb8c4')));
  userFrameMarker.add(userFrameLabel);
  worldRoot.add(userFrameMarker);

  const cameraGlyph = buildCameraGlyph();
  applyTransform(cameraGlyph, tWorldCamera);
  worldRoot.add(cameraGlyph);
  const cameraPost = buildCameraPost(tWorldCamera.translation);
  worldRoot.add(cameraPost);

  // ── 프레임 anchor: 화살표/축이 참조하는 원점 Object3D ─────────────
  const worldAnchor = new THREE.Group();
  worldRoot.add(worldAnchor);
  const anchors = new Map<FrameName, THREE.Object3D | null>([
    ['world', worldAnchor],
    ['camera', cameraGlyph],
    ['flange', null],
    ['tool', null],
  ]);

  // ── 좌표계 축 (프레임 anchor의 자식으로 붙어 함께 움직인다) ───────
  const axesVisible = new Map<FrameName, boolean>();
  const axesGroups = new Map<FrameName, THREE.Group>();
  const AXES_LENGTH: Record<FrameName, number> = {
    world: 0.34,
    camera: 0.22,
    flange: 0.22,
    tool: 0.16,
  };
  for (const frame of ['world', 'flange', 'tool', 'camera'] as const) {
    axesVisible.set(frame, initialAxes.includes(frame));
  }
  const attachAxes = (frame: FrameName): void => {
    const anchor = anchors.get(frame);
    if (!anchor || axesGroups.has(frame)) {
      return;
    }
    const axes = buildFrameAxes(AXES_LENGTH[frame]);
    axes.visible = axesVisible.get(frame) ?? false;
    anchor.add(axes);
    axesGroups.set(frame, axes);
  };
  attachAxes('world');
  attachAxes('camera');

  // ── T 화살표 + 라벨 ───────────────────────────────────────────────
  const arrows = new Map<ArrowId, ArrowEntry>();
  for (const [id, def] of Object.entries(ARROW_DEFS) as [ArrowId, (typeof ARROW_DEFS)[ArrowId]][]) {
    const arrow = new THREE.ArrowHelper(
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(),
      1,
      def.color,
      0.07,
      0.035,
    );
    (arrow.line.material as THREE.LineBasicMaterial).depthTest = false;
    (arrow.cone.material as THREE.MeshBasicMaterial).depthTest = false;
    arrow.line.renderOrder = 11;
    arrow.cone.renderOrder = 11;
    arrow.visible = false;
    scene.add(arrow);

    const labelAnchor = new THREE.Object3D();
    const label = new CSS2DObject(buildMathLabel('T', def.from, def.to, def.color));
    labelAnchor.add(label);
    labelAnchor.visible = false;
    scene.add(labelAnchor);

    arrows.set(id, {def, arrow, labelAnchor, wanted: initialArrows.includes(id)});
  }

  const tailPos = new THREE.Vector3();
  const headPos = new THREE.Vector3();
  const direction = new THREE.Vector3();
  const updateArrows = (): void => {
    for (const entry of arrows.values()) {
      const fromAnchor = anchors.get(entry.def.from);
      const toAnchor = anchors.get(entry.def.to);
      const available = Boolean(fromAnchor && toAnchor);
      const visible = entry.wanted && available;
      entry.arrow.visible = visible;
      entry.labelAnchor.visible = visible;
      if (!visible || !fromAnchor || !toAnchor) {
        continue;
      }
      fromAnchor.getWorldPosition(tailPos);
      toAnchor.getWorldPosition(headPos);
      direction.subVectors(headPos, tailPos);
      const length = direction.length();
      if (length < 1e-6) {
        entry.arrow.visible = false;
        entry.labelAnchor.visible = false;
        continue;
      }
      entry.arrow.position.copy(tailPos);
      entry.arrow.setDirection(direction.normalize());
      entry.arrow.setLength(length, Math.min(0.07, length * 0.3), Math.min(0.035, length * 0.15));
      entry.labelAnchor.position.lerpVectors(tailPos, headPos, 0.5);
    }
  };

  // ── Mount 전환 ────────────────────────────────────────────────────
  let robot: URDFRobot | null = null;
  let mountMode: MountMode = initialMount;
  const applyMount = (): void => {
    if (mountMode === 'robot') {
      const flange = anchors.get('flange');
      if (!flange) {
        return; // 로봇 로드 후 다시 적용된다
      }
      applyTransform(cameraGlyph, tFlangeCamera);
      flange.add(cameraGlyph);
      cameraPost.visible = false;
    } else {
      applyTransform(cameraGlyph, tWorldCamera);
      worldRoot.add(cameraGlyph);
      cameraPost.visible = true;
    }
  };

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
  loader.load(robotConfig.urdfUrl, (loadedRobot) => {
    if (disposed) {
      return;
    }
    robot = loadedRobot;
    for (const [joint, value] of Object.entries(robotConfig.jointValues)) {
      robot.setJointValue(joint, value);
    }
    applyTransform(robot, tWorldRobotBase);
    worldRoot.add(robot);

    anchors.set('flange', robot.links[robotConfig.frameLinks.flange] ?? null);
    anchors.set('tool', robot.links[robotConfig.frameLinks.tool] ?? null);
    attachAxes('flange');
    attachAxes('tool');
    applyMount();
  });

  applyMount();

  return {
    setFrameAxesVisible: (frame, visible) => {
      axesVisible.set(frame, visible);
      const group = axesGroups.get(frame);
      if (group) {
        group.visible = visible;
      }
    },
    setMount: (mode) => {
      mountMode = mode;
      applyMount();
    },
    setArrowVisible: (id, visible) => {
      const entry = arrows.get(id);
      if (entry) {
        entry.wanted = visible;
      }
    },
    dispose: () => {
      disposed = true;
      shell.dispose();
    },
  };
}
