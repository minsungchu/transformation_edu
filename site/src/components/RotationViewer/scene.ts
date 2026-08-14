/**
 * 회전 전용 3D 씬 (브라우저 전용).
 *
 * 좌표계 하나를 원점에 두고 돌리는 것만 한다 — 로봇도 셀도 없다.
 * 렌더링 인프라(셸·축 화살표·라벨)는 RobotCellViewer의 viewer-core를
 * 그대로 쓰고, 회전 행렬은 React 쪽(index.tsx)이 transform-core로 계산해
 * `update()`로 넘긴다. 이 모듈에는 회전 수학이 없다.
 *
 * 화면에 놓이는 것:
 *
 * - **기준 좌표계 A** — 흐린 RGB 축(대문자 X/Y/Z 라벨). passive 관점에서만 보인다.
 * - **회전한 좌표계 B** — 진한 RGB 축(소문자 x/y/z 라벨). passive에서는 $R$만큼
 *   돌아가 있고, active에서는 기준과 겹쳐 고정이다.
 * - **순서 바꾼 좌표계** — 같은 세 회전을 반대 순서로 합성한 결과. 짧고 흐리게
 *   그려 B와 얼마나 어긋나는지(= 비가환)를 눈으로 보게 한다.
 * - **점 p** — 관점 토글의 대상. passive에서는 공간에 고정된 채 좌표 표현만
 *   바뀌고, active에서는 점 자신이 $R \cdot p$로 옮겨 간다.
 *
 * 열 ↔ 축 하이라이트는 `highlight`로 들어온다 — 지목된 축만 남기고 나머지를
 * 흐리게 만들어, 행렬의 한 열이 어느 화살표인지 붙여 준다.
 */
import * as THREE from 'three';
import {CSS2DObject} from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import type {Mat3, Vec3} from 'transform-core';
import {MAT3_IDENTITY, Transform, mat3ApplyToVec3} from 'transform-core';
import {applyTransform, buildFrameAxes, buildTextLabel, createViewerShell} from '../RobotCellViewer/viewer-core';

/** 관점 — passive = 좌표계가 돈다, active = 물체가 돈다. */
export type RotationPerspective = 'passive' | 'active';

/** 행렬 열 ↔ 축 하이라이트 대상 (0 = x, 1 = y, 2 = z). */
export type AxisIndex = 0 | 1 | 2;

export interface RotationSceneState {
  /** 지금 그릴 회전 — index.tsx가 transform-core로 만든 것. */
  rotation: Mat3;
  /** 순서를 바꿔 합성한 회전 — null이면 비교를 끈 상태. */
  compare: Mat3 | null;
  perspective: RotationPerspective;
  /** 점 p(와 회전된 p)를 그릴지. */
  showVector: boolean;
  /** 강조할 축 — null이면 전부 평소 밝기. */
  highlight: AxisIndex | null;
}

export interface RotationScene {
  update: (state: RotationSceneState) => void;
  dispose: () => void;
}

/** 축 색 — viewer-core의 화살표 색과 같은 값(x 빨강 / y 초록 / z 파랑). */
const AXIS_CSS = ['#e5484d', '#30a46c', '#3b82f6'] as const;
const REF_AXIS_CSS = ['#8d5b5e', '#5d7f6d', '#5b6f92'] as const;

/** 관점 토글의 대상이 되는 점 — 축 어디에도 붙지 않게 세 성분 모두 살려 둔다. */
const POINT_P: Vec3 = [0.6, 0.4, 0.45];
const POINT_COLOR = 0xf5a524;
const COMPARE_POINT_COLOR = 0x8e6fef;

const AXIS_LENGTH = 1;
const REF_AXIS_LENGTH = 1.15;
const COMPARE_AXIS_LENGTH = 0.82;

/** 하이라이트에서 제외된 축이 남기는 밝기 — 완전히 지우지는 않는다. */
const DIMMED = 0.14;

function axisArrows(group: THREE.Group): THREE.ArrowHelper[] {
  return group.children.filter((c): c is THREE.ArrowHelper => c instanceof THREE.ArrowHelper);
}

function setArrowOpacity(arrow: THREE.ArrowHelper, opacity: number): void {
  for (const material of [arrow.line.material, arrow.cone.material] as THREE.Material[]) {
    material.transparent = true;
    material.opacity = opacity;
  }
}

/** 축 세 개에 기본 밝기를 주되, 하이라이트가 걸린 축만 남기고 흐리게 한다. */
function setAxesOpacity(group: THREE.Group, base: number, highlight: AxisIndex | null): void {
  axisArrows(group).forEach((arrow, index) => {
    setArrowOpacity(arrow, highlight === null || highlight === index ? base : base * DIMMED);
  });
}

function attachLabel(
  parent: THREE.Object3D,
  text: string,
  color: string,
  position: readonly [number, number, number],
): CSS2DObject {
  const label = new CSS2DObject(buildTextLabel(text, color));
  label.position.set(position[0], position[1], position[2]);
  parent.add(label);
  return label;
}

export function createRotationScene({container}: {container: HTMLElement}): RotationScene {
  const shell = createViewerShell({
    container,
    cameraPosition: [1.45, 1.15, 1.95],
    target: [0, 0.15, 0],
  });
  shell.controls.minDistance = 1.2;
  shell.controls.maxDistance = 6;

  const {worldRoot} = shell;

  // 기준 좌표계 A — 흐린 RGB. passive에서만 보인다.
  const refAxes = buildFrameAxes(REF_AXIS_LENGTH);
  worldRoot.add(refAxes);
  const refLabels = (['X', 'Y', 'Z'] as const).map((name, i) =>
    attachLabel(refAxes, name, REF_AXIS_CSS[i]!, [
      i === 0 ? REF_AXIS_LENGTH + 0.1 : 0,
      i === 1 ? REF_AXIS_LENGTH + 0.1 : 0,
      i === 2 ? REF_AXIS_LENGTH + 0.1 : 0,
    ]),
  );

  // 회전한 좌표계 B — 행렬의 열이 가리키는 축이 바로 이것이다.
  const frameAxes = buildFrameAxes(AXIS_LENGTH);
  worldRoot.add(frameAxes);
  (['x', 'y', 'z'] as const).forEach((name, i) =>
    attachLabel(frameAxes, name, AXIS_CSS[i]!, [
      i === 0 ? AXIS_LENGTH + 0.08 : 0,
      i === 1 ? AXIS_LENGTH + 0.08 : 0,
      i === 2 ? AXIS_LENGTH + 0.08 : 0,
    ]),
  );

  // 순서를 바꿔 합성한 좌표계 — 짧게 그려 B와 구분한다.
  const compareAxes = buildFrameAxes(COMPARE_AXIS_LENGTH);
  worldRoot.add(compareAxes);
  const compareLabel = attachLabel(compareAxes, '순서 바꿈', '#c9b6ff', [
    0,
    0,
    COMPARE_AXIS_LENGTH + 0.12,
  ]);

  // 점 p — passive에서는 공간에 고정, active에서는 R·p로 옮겨 간 화살표가 따로 선다.
  const pDir = new THREE.Vector3(POINT_P[0], POINT_P[1], POINT_P[2]);
  const pLength = pDir.length();
  const vecP = new THREE.ArrowHelper(
    pDir.clone().normalize(),
    new THREE.Vector3(),
    pLength,
    POINT_COLOR,
    0.14,
    0.075,
  );
  const vecMoved = new THREE.ArrowHelper(
    pDir.clone().normalize(),
    new THREE.Vector3(),
    pLength,
    POINT_COLOR,
    0.14,
    0.075,
  );
  const vecMovedCompare = new THREE.ArrowHelper(
    pDir.clone().normalize(),
    new THREE.Vector3(),
    pLength,
    COMPARE_POINT_COLOR,
    0.14,
    0.075,
  );
  for (const arrow of [vecP, vecMoved, vecMovedCompare]) {
    arrow.renderOrder = 11;
    arrow.line.renderOrder = 11;
    arrow.cone.renderOrder = 11;
    (arrow.line.material as THREE.LineBasicMaterial).depthTest = false;
    (arrow.cone.material as THREE.MeshBasicMaterial).depthTest = false;
    worldRoot.add(arrow);
  }
  const labelP = attachLabel(worldRoot, 'p', '#f5a524', [
    POINT_P[0] * 1.12,
    POINT_P[1] * 1.12,
    POINT_P[2] * 1.12,
  ]);
  const labelMoved = attachLabel(worldRoot, 'R·p', '#f5a524', [0, 0, 0]);

  const update = (state: RotationSceneState): void => {
    const passive = state.perspective === 'passive';
    const {highlight} = state;

    // passive면 좌표계가 돌고, active면 좌표계는 기준에 겹친 채 고정이다.
    applyTransform(frameAxes, Transform.fromRotation(passive ? state.rotation : MAT3_IDENTITY));
    applyTransform(compareAxes, Transform.fromRotation(state.compare ?? MAT3_IDENTITY));

    refAxes.visible = passive;
    for (const label of refLabels) {
      label.visible = passive;
    }
    compareAxes.visible = passive && state.compare !== null;
    compareLabel.visible = compareAxes.visible;

    setAxesOpacity(refAxes, 0.3, highlight);
    setAxesOpacity(frameAxes, 1, highlight);
    setAxesOpacity(compareAxes, 0.5, highlight);

    // active에서는 원래 자리의 p를 흔적으로만 남기고, 옮겨 간 화살표를 세운다.
    vecP.visible = state.showVector;
    labelP.visible = state.showVector;
    setArrowOpacity(vecP, passive ? 1 : 0.3);
    vecMoved.visible = state.showVector && !passive;
    labelMoved.visible = vecMoved.visible;
    vecMovedCompare.visible = state.showVector && !passive && state.compare !== null;

    if (!passive) {
      const moved = mat3ApplyToVec3(state.rotation, POINT_P);
      vecMoved.setDirection(new THREE.Vector3(moved[0], moved[1], moved[2]).normalize());
      labelMoved.position.set(moved[0] * 1.12, moved[1] * 1.12, moved[2] * 1.12);
      if (state.compare) {
        const movedCompare = mat3ApplyToVec3(state.compare, POINT_P);
        vecMovedCompare.setDirection(
          new THREE.Vector3(movedCompare[0], movedCompare[1], movedCompare[2]).normalize(),
        );
      }
    }
  };

  return {update, dispose: shell.dispose};
}
