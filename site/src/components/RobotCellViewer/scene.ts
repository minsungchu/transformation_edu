/**
 * Three.js 렌더링 레이어.
 *
 * 프레임 pose는 전부 cell-layout.ts(transform-core)에서 받아와 4×4 행렬로
 * 씌우기만 한다 — 이 파일에는 좌표계 수학 로직이 없다 (mesh의 로컬 생김새
 * 구성과, 씬 그래프에서 읽은 원점 위치로 화살표를 긋는 일만 있다).
 * 로봇 내부 FK는 urdf-loader의 씬 그래프가 담당한다.
 */
import * as THREE from 'three';
import {OrbitControls} from 'three/examples/jsm/controls/OrbitControls.js';
import {CSS2DObject, CSS2DRenderer} from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import URDFLoader from 'urdf-loader';
import type {URDFRobot} from 'urdf-loader';
import type {Transform} from 'transform-core';
import type {CellDimensions} from './cell-layout';
import {CELL_FRAMES, DEFAULT_CELL, createCellLayout, robotMountOffset} from './cell-layout';
import type {ArrowId, FrameName, MountMode} from './types';
import {ARROW_DEFS} from './types';

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

/** transform-core의 Transform을 Object3D의 (부모 기준) pose로 그대로 씌운다. */
function applyTransform(object: THREE.Object3D, t: Transform): void {
  const m = t.toMatrix4();
  object.matrixAutoUpdate = false;
  // Matrix4.set은 행 우선 인자를 받는다 — toMatrix4()도 행 우선이다.
  object.matrix.set(
    m[0]!, m[1]!, m[2]!, m[3]!,
    m[4]!, m[5]!, m[6]!, m[7]!,
    m[8]!, m[9]!, m[10]!, m[11]!,
    m[12]!, m[13]!, m[14]!, m[15]!,
  );
}

function buildTable(dims: CellDimensions): THREE.Group {
  const group = new THREE.Group();
  const top = new THREE.Mesh(
    new THREE.BoxGeometry(dims.tableSize[0], dims.tableSize[1], 0.04),
    new THREE.MeshStandardMaterial({color: 0x8a97a3, roughness: 0.85}),
  );
  top.position.z = -0.02; // 프레임 원점 = 상판 표면 중심
  group.add(top);

  const legMaterial = new THREE.MeshStandardMaterial({color: 0x5c6670, roughness: 0.9});
  const legX = dims.tableSize[0] / 2 - 0.05;
  const legY = dims.tableSize[1] / 2 - 0.05;
  const legHeight = dims.tableHeight - 0.04;
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, legHeight), legMaterial);
      leg.position.set(sx * legX, sy * legY, -0.04 - legHeight / 2);
      group.add(leg);
    }
  }
  return group;
}

/** Camera 좌표계 +z(광축) 방향을 바라보는 카메라 글리프. */
function buildCameraGlyph(): THREE.Group {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.16, 0.1, 0.09),
    new THREE.MeshStandardMaterial({color: 0x2f3640, roughness: 0.6}),
  );
  body.position.z = -0.045;
  group.add(body);
  const lens = new THREE.Mesh(
    new THREE.CylinderGeometry(0.028, 0.028, 0.05, 24),
    new THREE.MeshStandardMaterial({color: 0x11151a, roughness: 0.35}),
  );
  lens.rotation.x = Math.PI / 2; // 실린더 축(Y) → 프레임 +z
  lens.position.z = 0.025;
  group.add(lens);
  return group;
}

function buildCameraPost(cameraPosition: readonly [number, number, number]): THREE.Group {
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({color: 0x9aa4ad, roughness: 0.8});
  const height = cameraPosition[2] + 0.06;
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, height, 16), material);
  post.rotation.x = Math.PI / 2; // 실린더 축(Y) → world +z
  post.position.set(cameraPosition[0] + 0.12, cameraPosition[1], height / 2);
  group.add(post);
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.12, 12), material);
  arm.rotation.z = Math.PI / 2; // 실린더 축(Y) → world +x
  arm.position.set(cameraPosition[0] + 0.06, cameraPosition[1], cameraPosition[2] + 0.05);
  group.add(arm);
  return group;
}

/** 좌표계 축(RGB = x, y, z) 화살표 묶음. */
function buildFrameAxes(length: number): THREE.Group {
  const group = new THREE.Group();
  const axes: [THREE.Vector3, number][] = [
    [new THREE.Vector3(1, 0, 0), 0xe5484d],
    [new THREE.Vector3(0, 1, 0), 0x30a46c],
    [new THREE.Vector3(0, 0, 1), 0x3b82f6],
  ];
  for (const [dir, color] of axes) {
    const arrow = new THREE.ArrowHelper(dir, new THREE.Vector3(), length, color, length * 0.22, length * 0.12);
    (arrow.line.material as THREE.LineBasicMaterial).depthTest = false;
    (arrow.cone.material as THREE.MeshBasicMaterial).depthTest = false;
    arrow.renderOrder = 10;
    arrow.cone.renderOrder = 10;
    arrow.line.renderOrder = 10;
    group.add(arrow);
  }
  return group;
}

/** $T^{A}_{B}$ 라벨 DOM (위첨자 = 기준, 아래첨자 = 타겟 — 스택 표기). */
function buildArrowLabel(sup: string, sub: string, color: string): HTMLElement {
  const el = document.createElement('span');
  el.style.cssText = [
    'display:inline-flex',
    'align-items:center',
    `color:${color}`,
    'font:italic 600 15px "KaTeX_Math","Times New Roman",serif',
    'background:rgba(11,14,19,0.82)',
    'border-radius:4px',
    'padding:1px 4px',
    'pointer-events:none',
    'white-space:nowrap',
  ].join(';');
  const base = document.createElement('span');
  base.textContent = 'T';
  const scripts = document.createElement('span');
  scripts.style.cssText =
    'display:inline-flex;flex-direction:column;font-size:9.5px;line-height:1.15;margin-left:1px;font-style:italic';
  const supEl = document.createElement('span');
  supEl.textContent = sup;
  const subEl = document.createElement('span');
  subEl.textContent = sub;
  scripts.append(supEl, subEl);
  el.append(base, scripts);
  return el;
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

  const renderer = new THREE.WebGLRenderer({antialias: true, alpha: true});
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  container.appendChild(renderer.domElement);

  // T 라벨용 CSS2D 오버레이.
  const labelRenderer = new CSS2DRenderer();
  labelRenderer.setSize(container.clientWidth, container.clientHeight);
  labelRenderer.domElement.style.cssText =
    'position:absolute;inset:0;pointer-events:none;overflow:hidden';
  container.appendChild(labelRenderer.domElement);

  const scene = new THREE.Scene();

  const viewCamera = new THREE.PerspectiveCamera(
    45,
    container.clientWidth / Math.max(container.clientHeight, 1),
    0.01,
    50,
  );
  // 로봇(원점)과 작업대가 나란히 보이는 측면 시점에서 시작한다.
  viewCamera.position.set(-0.4, 1.6, 2.75);

  const controls = new OrbitControls(viewCamera, renderer.domElement);
  controls.target.set(0.3, 0.45, 0);
  controls.enableDamping = true;
  controls.minDistance = 0.5;
  controls.maxDistance = 8;

  scene.add(new THREE.HemisphereLight(0xffffff, 0x60666e, 1.1));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(2, 4, 2.5);
  scene.add(sun);

  const grid = new THREE.GridHelper(4, 20, 0x55637a, 0x242c38);
  (grid.material as THREE.Material).transparent = true;
  (grid.material as THREE.Material).opacity = 0.6;
  scene.add(grid);

  // world 좌표계(z-up, 로보틱스 규약)를 three.js(y-up)로 얹는 루트.
  const worldRoot = new THREE.Group();
  worldRoot.rotation.x = -Math.PI / 2;
  scene.add(worldRoot);

  // ── 프레임 pose: 전부 transform-core FrameGraph에서 조회 ──────────
  const frames = createCellLayout(cell);
  const tWorldTable = frames.getTransform(CELL_FRAMES.world, CELL_FRAMES.table);
  const tWorldCamera = frames.getTransform(CELL_FRAMES.world, CELL_FRAMES.camera);
  const tWorldRobotBase = frames.getTransform(CELL_FRAMES.world, CELL_FRAMES.robotBase);
  const tFlangeCamera = robotMountOffset();

  const table = buildTable(cell);
  applyTransform(table, tWorldTable);
  worldRoot.add(table);

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
    const label = new CSS2DObject(buildArrowLabel(def.from, def.to, def.color));
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

  let frameHandle = 0;
  const renderLoop = () => {
    frameHandle = requestAnimationFrame(renderLoop);
    controls.update();
    updateArrows();
    renderer.render(scene, viewCamera);
    labelRenderer.render(scene, viewCamera);
  };
  renderLoop();

  const resizeObserver = new ResizeObserver(() => {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (w === 0 || h === 0) {
      return;
    }
    viewCamera.aspect = w / h;
    viewCamera.updateProjectionMatrix();
    renderer.setSize(w, h);
    labelRenderer.setSize(w, h);
  });
  resizeObserver.observe(container);

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
      cancelAnimationFrame(frameHandle);
      resizeObserver.disconnect();
      controls.dispose();
      scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
          for (const material of materials) {
            material.dispose();
          }
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
      labelRenderer.domElement.remove();
    },
  };
}
