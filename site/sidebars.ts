import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';

/**
 * 교재 전체 목차 — 0~7단계 + 부록.
 *
 * 0단계만 작성 완료. 1단계의 챕터 구성(1-1 ~ 1-4)은 issue #1에서 확정된
 * 것이고, 2~7단계·부록의 제목은 가제다(챕터별 그릴링 세션에서 확정 —
 * issue #1 Out of Scope 참조).
 */
const sidebars: SidebarsConfig = {
  curriculumSidebar: [
    {
      type: 'doc',
      id: 'stage-0/index',
      label: '0단계 · 오리엔테이션 — 전체 지도',
    },
    {
      type: 'category',
      label: '1단계 · 좌표계 기초',
      link: {type: 'doc', id: 'stage-1/index'},
      items: [
        'stage-1/what-is-a-frame',
        'stage-1/frames-in-a-robot-cell',
        'stage-1/mount-types',
        'stage-1/notation-and-diagrams',
      ],
    },
    {type: 'doc', id: 'stage-2/index', label: '2단계 · Transformation Matrix'},
    {type: 'doc', id: 'stage-3/index', label: '3단계 · Calibration'},
    {type: 'doc', id: 'stage-4/index', label: '4단계 · 조그와 로봇 모션'},
    {type: 'doc', id: 'stage-5/index', label: '5단계 · Hand-Eye'},
    {type: 'doc', id: 'stage-6/index', label: '6단계 · Matching'},
    {type: 'doc', id: 'stage-7/index', label: '7단계 · Bin Picking 종합'},
    {type: 'doc', id: 'appendix/index', label: '부록'},
  ],
};

export default sidebars;
