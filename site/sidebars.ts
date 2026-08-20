import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';

/**
 * 교재 전체 목차 — 0~8단계 + 부록.
 *
 * 편집 중: 지금은 0단계(전체 Overview)만 사이드바에 노출한다. 나머지 단계는
 * 아래 주석 블록에 그대로 보존해 두었고, 한 단계씩 편집·검토하며 다시 켠다.
 * (페이지 파일은 그대로 있으므로 URL로는 접근 가능 — 내비게이션에서만 숨김.)
 *
 * ▶ 한 단계를 다시 켜려면: 아래 "// 숨김 —" 블록에서 해당 항목을 통째로
 *   위 curriculumSidebar 배열의 원하는 자리로 옮기면 된다.
 *
 * 0~2단계 작성 완료. 3~8단계·부록의 제목은 가제다.
 */
const sidebars: SidebarsConfig = {
  curriculumSidebar: [
    {
      type: 'doc',
      id: 'stage-0/index',
      label: '0단계 · 오리엔테이션',
    },

    // ── 숨김 — 편집하며 한 단계씩 위로 옮겨 켠다 ──────────────────────
    // {
    //   type: 'category',
    //   label: '1단계 · 좌표계 기초',
    //   link: {type: 'doc', id: 'stage-1/index'},
    //   items: [
    //     'stage-1/what-is-a-frame',
    //     'stage-1/frames-in-a-robot-cell',
    //     'stage-1/mount-types',
    //     'stage-1/notation-and-diagrams',
    //   ],
    // },
    // {
    //   type: 'category',
    //   label: '2단계 · 회전',
    //   link: {type: 'doc', id: 'stage-2/index'},
    //   items: [
    //     'stage-2/rotation-in-2d',
    //     'stage-2/axis-rotations-in-3d',
    //     'stage-2/composing-rotations',
    //     'stage-2/euler-and-rpy',
    //     'stage-2/reading-a-rotation-matrix',
    //   ],
    // },
    // {type: 'doc', id: 'stage-3/index', label: '3단계 · Transformation Matrix'},
    // {type: 'doc', id: 'stage-4/index', label: '4단계 · 조그와 로봇 모션'},
    // {type: 'doc', id: 'stage-5/index', label: '5단계 · Calibration'},
    // {type: 'doc', id: 'stage-6/index', label: '6단계 · Matching'},
    // {type: 'doc', id: 'stage-7/index', label: '7단계 · Bin Picking 종합'},
    // {type: 'doc', id: 'stage-8/index', label: '8단계 · Hand-Eye 종합'},
    // {type: 'doc', id: 'appendix/index', label: '부록'},
  ],
};

export default sidebars;
