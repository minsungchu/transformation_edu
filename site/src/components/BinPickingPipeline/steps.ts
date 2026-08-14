/**
 * 0단계 파이프라인 뷰어의 START/NEXT 튜토리얼 시나리오 — 단계 텍스트와 개수.
 *
 * 씬(`scene.ts`)은 three.js에 의존해 브라우저에서만 동적 import되고, 툴바
 * (`index.tsx`)는 SSR에서도 평가된다. 두 쪽이 같은 단계 정의를 봐야 하므로
 * 의존성이 없는 이 모듈에 따로 둔다 — 여기서 `scene.ts`를 정적으로 import하면
 * three.js가 빌드 시점에 끌려온다.
 *
 * 단계 번호 규칙:
 *
 * - `0` = **완성 상태**. 페이지에 처음 들어왔을 때의 모습이고, 시뮬레이션이
 *   꺼져 있어 Master 드래그 같은 수동 조작이 모두 열려 있다.
 * - `1`..`PIPELINE_STEP_COUNT` = 시뮬레이션의 각 STEP. 지도(박스·화살표)는
 *   마지막에서 두 번째 STEP에서 이미 완성 상태와 같아지고, 마지막 STEP은 그 위에
 *   로봇이 집기 자세로 이동하는 것만 더한다. 수동 조작은 마지막 STEP에서 풀린다.
 */

export interface PipelineStep {
  /** 툴바 배지에 붙는 짧은 이름. */
  title: string;
  /** 그 단계에서 무엇이 왜 생기는지 — 툴바 한 줄 설명. */
  detail: string;
}

/**
 * 화살표가 T_match → P^camera_scene → T_cal → P^world_scene 순으로 나오는 것은
 * 계산 순서를 그대로 따른 것이다: 카메라 좌표계 안에서 답을 먼저 구하고,
 * 마지막에 calibration으로 World 좌표계로 옮긴다.
 */
export const PIPELINE_STEPS: readonly PipelineStep[] = [
  {
    title: '카메라와 로봇',
    detail:
      '셀에 있는 것은 로봇(World 좌표계)과 카메라(Camera 좌표계)뿐입니다. 물체도 화살표도 아직 없습니다.',
  },
  {
    title: 'Master 등장',
    detail:
      '미리 가르쳐 둔 Master와 그 이미지 원점입니다. 이미지 원점은 원래 카메라 원점과 같으므로, 지금은 Master가 카메라 원점에 원점을 걸친 채 Scene과 떨어진 자리에 떠 있습니다 — 박스·원점·picking point는 하나의 강체입니다.',
  },
  {
    title: 'Scene 등장',
    detail:
      '실제 장면에서 검출된 물체입니다. Scene의 이미지 원점도 카메라 원점과 같아 따로 그리지 않고, Scene은 이 뒤로 움직이지 않습니다.',
  },
  {
    title: 'Matching',
    detail:
      'Master를 Scene에 겹치는 변환을 찾아 적용합니다. 박스·원점·picking point가 강체로 함께 움직이고, 원점은 카메라 원점을 떠나 물체 밖 허공에 떨어집니다.',
  },
  {
    title: 'T_match',
    detail:
      'Matching이 만든 변환 그 자체 — 카메라 원점에서 이동된 Master 원점으로 향합니다. 이동된 원점에 걸려 함께 옮겨진 P^camera_master(Master의 picking point)도 같이 나타납니다.',
  },
  {
    title: 'P^camera_scene',
    detail:
      'T_match와 P^camera_master를 합치면 Scene의 picking point를 카메라 기준으로 얻습니다. 카메라 좌표계 안에서는 여기서 답이 나옵니다.',
  },
  {
    title: 'T_cal',
    detail:
      'Calibration이 미리 재 둔 World → Camera 관계입니다. 카메라 기준의 답을 로봇 기준으로 옮기는 데 필요한 마지막 재료입니다.',
  },
  {
    title: 'P^world_scene',
    detail:
      'T_cal로 좌표계를 옮기면 로봇이 그대로 쓸 수 있는 최종 답이 됩니다. 여기까지가 좌표 계산이고, 다음 단계에서 로봇이 이 값을 실제로 씁니다.',
  },
  {
    title: '집으러 간다',
    detail:
      '로봇이 방금 구한 P^world_scene으로 갑니다 — 그 점을 TCP(석션 패드 끝단)의 목표로 놓고, 패드가 상면에 평평하게 닿도록 approach 축을 수직 아래로 세운 뒤 IK로 관절 해를 구해 홈 자세에서 이동합니다. 파이프라인이 계산한 값이 로봇의 자세로 바뀌는 지점입니다. 완성 상태이므로 Master 드래그 같은 수동 조작도 다시 열립니다.',
  },
];

export const PIPELINE_STEP_COUNT = PIPELINE_STEPS.length;
