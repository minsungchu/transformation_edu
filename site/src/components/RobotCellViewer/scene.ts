/**
 * Three.js 렌더링 레이어.
 *
 * 프레임 pose는 전부 cell-layout.ts(transform-core)에서 받아와 4×4 행렬로
 * 씌우기만 한다 — 이 파일에는 좌표계 수학 로직이 없다 (mesh의 로컬 생김새
 * 구성만 있다).
 */
import * as THREE from 'three';
import {OrbitControls} from 'three/examples/jsm/controls/OrbitControls.js';
import URDFLoader from 'urdf-loader';
import type {Transform} from 'transform-core';
import type {CellDimensions} from './cell-layout';
import {CELL_FRAMES, DEFAULT_CELL, createCellLayout} from './cell-layout';

export interface SceneRobotConfig {
  /** 절대 URL(사이트 baseUrl 적용 후)의 URDF. */
  urdfUrl: string;
  /** `package://<pkg>` → 절대 경로 매핑. */
  packages: Record<string, string>;
  /** 초기 관절 자세. */
  jointValues: Record<string, number>;
}

export interface RobotCellSceneOptions {
  container: HTMLElement;
  robot: SceneRobotConfig;
  cell?: CellDimensions;
  onReady?: () => void;
  onError?: (error: unknown) => void;
}

export interface RobotCellScene {
  dispose: () => void;
}

/** transform-core의 Transform을 Object3D의 pose로 그대로 씌운다. */
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

export function createRobotCellScene(options: RobotCellSceneOptions): RobotCellScene {
  const {container, robot: robotConfig, cell = DEFAULT_CELL, onReady, onError} = options;

  const renderer = new THREE.WebGLRenderer({antialias: true, alpha: true});
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  container.appendChild(renderer.domElement);

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

  const grid = new THREE.GridHelper(4, 20, 0x8899aa, 0xaabbcc);
  (grid.material as THREE.Material).transparent = true;
  (grid.material as THREE.Material).opacity = 0.45;
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

  const table = buildTable(cell);
  applyTransform(table, tWorldTable);
  worldRoot.add(table);

  const cameraGlyph = buildCameraGlyph();
  applyTransform(cameraGlyph, tWorldCamera);
  worldRoot.add(cameraGlyph);
  worldRoot.add(buildCameraPost(tWorldCamera.translation));

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

  let frameHandle = 0;
  const renderLoop = () => {
    frameHandle = requestAnimationFrame(renderLoop);
    controls.update();
    renderer.render(scene, viewCamera);
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
  });
  resizeObserver.observe(container);

  return {
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
    },
  };
}
