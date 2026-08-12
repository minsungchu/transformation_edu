/**
 * 3D 위젯 공용 렌더링 코어 (브라우저 전용).
 *
 * 렌더러(WebGL + CSS2D 라벨 오버레이) · 카메라 · OrbitControls · 조명 ·
 * 그리드 · z-up 루트 그룹과 공용 mesh/라벨 빌더를 제공한다. 씬별 내용
 * (로봇, 화살표, 박스 등)은 각 scene 모듈이 이 코어 위에 얹는다 —
 * RobotCellViewer/scene.ts와 BinPickingPipeline/scene.ts가 함께 쓴다.
 */
import * as THREE from 'three';
import {OrbitControls} from 'three/examples/jsm/controls/OrbitControls.js';
import {CSS2DRenderer} from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import type {Transform} from 'transform-core';
import type {CellDimensions} from './cell-layout';

/** transform-core의 Transform을 Object3D의 (부모 기준) pose로 그대로 씌운다. */
export function applyTransform(object: THREE.Object3D, t: Transform): void {
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

export function buildTable(dims: CellDimensions): THREE.Group {
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
export function buildCameraGlyph(): THREE.Group {
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

export function buildCameraPost(cameraPosition: readonly [number, number, number]): THREE.Group {
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
export function buildFrameAxes(length: number): THREE.Group {
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

/**
 * $X^{sup}_{sub}$ 수식 라벨 DOM (위첨자 = 기준, 아래첨자 = 타겟 — 스택 표기).
 * 위첨자가 없으면 아래첨자만 붙인다 (예: $T_{cal}$처럼 이름 첨자만 있는 경우).
 */
export function buildMathLabel(base: string, sup: string, sub: string, color: string): HTMLElement {
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
  const baseEl = document.createElement('span');
  baseEl.textContent = base;
  el.append(baseEl);
  if (sup) {
    const scripts = document.createElement('span');
    scripts.style.cssText =
      'display:inline-flex;flex-direction:column;font-size:9.5px;line-height:1.15;margin-left:1px;font-style:italic';
    const supEl = document.createElement('span');
    supEl.textContent = sup;
    const subEl = document.createElement('span');
    subEl.textContent = sub;
    scripts.append(supEl, subEl);
    el.append(scripts);
  } else {
    const subEl = document.createElement('span');
    subEl.style.cssText =
      'font-size:9.5px;align-self:flex-end;transform:translateY(2px);margin-left:1px;font-style:italic';
    subEl.textContent = sub;
    el.append(subEl);
  }
  return el;
}

export interface ViewerShellOptions {
  container: HTMLElement;
  /** 초기 카메라 위치 (three.js y-up 좌표). */
  cameraPosition?: readonly [number, number, number];
  /** OrbitControls 타겟 (three.js y-up 좌표). */
  target?: readonly [number, number, number];
  /** 매 프레임 렌더 직전에 호출된다 (화살표 갱신 등). */
  onBeforeRender?: () => void;
}

export interface ViewerShell {
  scene: THREE.Scene;
  /** world 좌표계(z-up, 로보틱스 규약)를 three.js(y-up)로 얹는 루트 — 셀 내용은 여기에 붙인다. */
  worldRoot: THREE.Group;
  dispose: () => void;
}

export function createViewerShell({
  container,
  cameraPosition = [-0.4, 1.6, 2.75],
  target = [0.3, 0.45, 0],
  onBeforeRender,
}: ViewerShellOptions): ViewerShell {
  const renderer = new THREE.WebGLRenderer({antialias: true, alpha: true});
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  container.appendChild(renderer.domElement);

  // T/P 라벨용 CSS2D 오버레이.
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
  viewCamera.position.set(cameraPosition[0], cameraPosition[1], cameraPosition[2]);

  const controls = new OrbitControls(viewCamera, renderer.domElement);
  controls.target.set(target[0], target[1], target[2]);
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

  const worldRoot = new THREE.Group();
  worldRoot.rotation.x = -Math.PI / 2;
  scene.add(worldRoot);

  let frameHandle = 0;
  const renderLoop = () => {
    frameHandle = requestAnimationFrame(renderLoop);
    controls.update();
    onBeforeRender?.();
    renderer.render(scene, viewCamera);
    labelRenderer.render(scene, viewCamera);
  };
  // 첫 프레임은 rAF로 미룬다 — 호출부가 onBeforeRender에서 참조하는
  // 객체들을 shell 생성 직후에 마저 구성할 수 있도록.
  frameHandle = requestAnimationFrame(renderLoop);

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
    scene,
    worldRoot,
    dispose: () => {
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
