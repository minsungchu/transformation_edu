/**
 * 로봇 셀의 좌표계 배치 — 프레임 pose 계산은 전부 transform-core를 경유한다.
 *
 * 여기서 FrameGraph에 등록하는 관계는 모두 $T^{world}_{...}$ (ADR-0001:
 * 위첨자 = 기준 좌표계, 아래첨자 = 타겟). 렌더링 레이어(scene.ts)는 이
 * 모듈이 돌려주는 Transform을 4×4 행렬로 바꿔 씌우기만 하고, 수학 로직을
 * 직접 갖지 않는다.
 */
import {FrameGraph, Transform} from 'transform-core';

/** 셀에 등장하는 좌표계 이름 (CONTEXT.md 용어). */
export const CELL_FRAMES = {
  world: 'world',
  robotBase: 'robot-base',
  table: 'table',
  camera: 'camera',
} as const;

export interface CellDimensions {
  /** 작업대 상판 크기 [x, y] (m). */
  tableSize: readonly [number, number];
  /** 작업대 상판 높이 (m). */
  tableHeight: number;
  /** 작업대 중심의 world x 좌표 (m). */
  tableDistance: number;
  /** 카메라(post mount) 설치 높이 (m). */
  cameraHeight: number;
}

export const DEFAULT_CELL: CellDimensions = {
  tableSize: [0.7, 0.9],
  tableHeight: 0.35,
  tableDistance: 0.55,
  cameraHeight: 1.35,
};

/**
 * 셀 프레임 그래프를 만든다. World 좌표계는 Robot Base가 원점(CONTEXT.md)이므로
 * $T^{world}_{robot-base}$는 항등이다.
 *
 * Camera는 작업대 위 post mount로, Camera 좌표계의 +z(광축)가 작업대를 향해
 * 아래를 보도록 x축 기준 180° 회전한다: $T^{world}_{camera}$.
 */
export function createCellLayout(dims: CellDimensions = DEFAULT_CELL): FrameGraph {
  const g = new FrameGraph();
  g.setTransform(CELL_FRAMES.world, CELL_FRAMES.robotBase, Transform.identity());
  g.setTransform(
    CELL_FRAMES.world,
    CELL_FRAMES.table,
    Transform.fromTranslation([dims.tableDistance, 0, dims.tableHeight]),
  );
  g.setTransform(
    CELL_FRAMES.world,
    CELL_FRAMES.camera,
    Transform.fromTranslation([dims.tableDistance, 0, dims.cameraHeight]).compose(
      Transform.rotationX(Math.PI),
    ),
  );
  return g;
}
