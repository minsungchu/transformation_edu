/**
 * 뷰어 기능(축 토글 · Mount 전환 · T 화살표)의 공용 타입/정의.
 *
 * index.tsx(React, SSR에서도 로드됨)와 scene.ts(three.js, 브라우저 전용)가
 * 함께 쓰므로 three 의존성이 없어야 한다.
 */

/** 축 토글을 지원하는 좌표계 (CONTEXT.md 용어). */
export type FrameName = 'world' | 'flange' | 'tool' | 'camera';

export const FRAME_LABELS: Record<FrameName, string> = {
  world: 'World',
  flange: 'Flange',
  tool: 'Tool',
  camera: 'Camera',
};

export const ALL_FRAMES: readonly FrameName[] = ['world', 'flange', 'tool', 'camera'];

/** 카메라 설치 방식 — Post Mount(고정) vs Robot Mount(플랜지에 부착). */
export type MountMode = 'post' | 'robot';

/**
 * from-to 화살표로 표시할 수 있는 transformation.
 * CONTEXT.md 도식 규칙: 꼬리 = 기준(위첨자) 좌표계 원점, 화살촉 = 타겟(아래첨자) 원점.
 */
export interface ArrowDef {
  /** 기준(위첨자) 좌표계 — 화살표 꼬리. */
  from: FrameName;
  /** 타겟(아래첨자) 좌표계 — 화살촉. */
  to: FrameName;
  /** 표시 색 (CSS/three 공용 hex). */
  color: string;
}

export const ARROW_DEFS = {
  'world-flange': {from: 'world', to: 'flange', color: '#2563eb'},
  'world-camera': {from: 'world', to: 'camera', color: '#d97706'},
  'flange-camera': {from: 'flange', to: 'camera', color: '#9333ea'},
  'flange-tool': {from: 'flange', to: 'tool', color: '#0d9488'},
} as const satisfies Record<string, ArrowDef>;

export type ArrowId = keyof typeof ARROW_DEFS;

export const ALL_ARROWS: readonly ArrowId[] = [
  'world-flange',
  'world-camera',
  'flange-camera',
  'flange-tool',
];
