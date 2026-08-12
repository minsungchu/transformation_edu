import type {ReactNode} from 'react';
import React from 'react';

/**
 * 전체 bin picking 파이프라인 그림.
 *
 * reference DOCX 그림 2-9(Binpicking Summary)를 ADR-0001 표기법(위첨자 =
 * 기준 좌표계, 아래첨자 = 타겟)으로 재구성한 것이다. 화살표의 from-to
 * 방향(기준 → 타겟)은 원본과 동일하고, 첨자 라벨만 스왑했다.
 *
 * 구조물(로봇·카메라·글자)은 currentColor를 사용해 라이트/다크 테마를
 * 모두 지원한다.
 */

const GRAY = '#8f959e';
const BLUE = '#3b82f6';
const SCENE_BLUE = '#7cb2e8';
const MASTER_RED = '#f0908a';
const POINT_RED = '#e5484d';

type MathLabelProps = {
  x: number;
  y: number;
  base: string;
  sup?: string;
  sub?: string;
  color?: string;
};

/** T^{sup}_{sub} 형태의 수식 라벨을 SVG 텍스트로 그린다 (위첨자·아래첨자 스택). */
function MathLabel({x, y, base, sup, sub, color = 'currentColor'}: MathLabelProps) {
  const scriptX = x + base.length * 11;
  return (
    <g
      fill={color}
      style={{fontFamily: '"KaTeX_Math", "Times New Roman", serif', fontStyle: 'italic'}}>
      <text x={x} y={y} fontSize={20}>
        {base}
      </text>
      {sup && (
        <text x={scriptX} y={y - 8} fontSize={13}>
          {sup}
        </text>
      )}
      {sub && (
        <text x={scriptX} y={y + 9} fontSize={13}>
          {sub}
        </text>
      )}
    </g>
  );
}

type ArrowProps = {
  from: [number, number];
  to: [number, number];
  color: string;
  dashed?: boolean;
  width?: number;
  markerId: string;
};

function Arrow({from, to, color, dashed = false, width = 2, markerId}: ArrowProps) {
  return (
    <line
      x1={from[0]}
      y1={from[1]}
      x2={to[0]}
      y2={to[1]}
      stroke={color}
      strokeWidth={width}
      strokeDasharray={dashed ? '7 6' : undefined}
      markerEnd={`url(#${markerId})`}
    />
  );
}

/** 2.5D 상자 외곽선 (Scene / Master 표시용). */
function Box({x, y, size, color}: {x: number; y: number; size: number; color: string}) {
  const d = size * 0.45;
  return (
    <g stroke={color} strokeWidth={3} fill="none" strokeLinejoin="round">
      <rect x={x} y={y} width={size} height={size} />
      <polyline points={`${x},${y} ${x + d},${y - d} ${x + size + d},${y - d} ${x + size},${y}`} />
      <line x1={x + size + d} y1={y - d} x2={x + size + d} y2={y + size - d} />
      <line x1={x + size} y1={y + size} x2={x + size + d} y2={y + size - d} />
    </g>
  );
}

export default function BinPickingPipeline(): ReactNode {
  return (
    <figure style={{margin: '2rem auto', maxWidth: 760, textAlign: 'center'}}>
      <svg
        viewBox="0 0 740 470"
        role="img"
        aria-label="Bin picking 파이프라인 개요: World 좌표계(로봇)에서 Camera 좌표계로의 T_cal, 카메라가 본 Master·Scene의 점들, 그리고 최종 결과인 P world scene"
        style={{width: '100%', height: 'auto'}}>
        <defs>
          <marker
            id="bp-arrow-gray"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="8"
            markerHeight="8"
            orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill={GRAY} />
          </marker>
          <marker
            id="bp-arrow-blue"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="8"
            markerHeight="8"
            orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill={BLUE} />
          </marker>
        </defs>

        {/* ── 로봇 (World 좌표계) ─────────────────────────────── */}
        <g stroke="currentColor" strokeWidth={3} fill="none" strokeLinecap="round">
          {/* 바닥 */}
          <line x1={30} y1={408} x2={230} y2={408} />
          {/* 베이스 (반원) */}
          <path d="M 75 408 A 40 40 0 0 1 155 408" />
          {/* 링크 */}
          <polyline points="115,370 140,285 210,305" />
          {/* 그리퍼 */}
          <polyline points="210,305 222,297 222,315 210,305" />
        </g>
        <text x={30} y={438} fontSize={14} fill="currentColor">
          Robot — World 좌표계
        </text>

        {/* ── 카메라 (Camera 좌표계) ──────────────────────────── */}
        <g stroke="currentColor" strokeWidth={3} fill="none" strokeLinejoin="round">
          <rect x={320} y={28} width={90} height={58} />
          <polyline points="352,86 365,102 378,86" />
        </g>
        <text x={425} y={52} fontSize={14} fill="currentColor">
          Camera 좌표계
        </text>

        {/* ── Scene + Master 상자 (오른쪽 아래) ───────────────── */}
        <Box x={468} y={330} size={56} color={SCENE_BLUE} />
        <Box x={476} y={322} size={56} color={MASTER_RED} />
        <text x={468} y={425} fontSize={15} fill={SCENE_BLUE}>
          Scene
        </text>
        <text x={562} y={286} fontSize={15} fill={MASTER_RED}>
          Master
        </text>
        {/* Picking point */}
        <circle cx={496} cy={318} r={5} fill={POINT_RED} />

        {/* ── 관계 화살표 (점선 = 파이프라인의 중간 재료) ─────── */}
        {/* T_cal : World → Camera (calibration 결과) */}
        <Arrow from={[145, 372]} to={[332, 108]} color={GRAY} dashed markerId="bp-arrow-gray" />
        <MathLabel x={192} y={225} base="T" sub="cal" color={GRAY} />

        {/* T_match : matching 결과 */}
        <Arrow from={[395, 108]} to={[652, 268]} color={GRAY} dashed markerId="bp-arrow-gray" />
        <MathLabel x={548} y={158} base="T" sub="match" color={GRAY} />

        {/* P^{camera}_{scene} : Camera 좌표계에서 본 Scene의 picking point */}
        <Arrow from={[362, 110]} to={[490, 310]} color={GRAY} dashed markerId="bp-arrow-gray" />
        <MathLabel x={358} y={230} base="P" sup="camera" sub="scene" color={GRAY} />

        {/* P^{camera}_{master} : Camera 좌표계에서 본 Master의 picking point */}
        <Arrow from={[652, 282]} to={[510, 316]} color={GRAY} dashed markerId="bp-arrow-gray" />
        <MathLabel x={588} y={340} base="P" sup="camera" sub="master" color={GRAY} />

        {/* ── 최종 결과 (실선 파랑): P^{world}_{scene} ────────── */}
        <Arrow from={[122, 400]} to={[487, 322]} color={BLUE} width={3} markerId="bp-arrow-blue" />
        <MathLabel x={268} y={392} base="P" sup="world" sub="scene" color={BLUE} />
      </svg>
      <figcaption style={{fontSize: '0.85rem', opacity: 0.75, marginTop: '0.5rem'}}>
        Bin picking 파이프라인 개요 — reference 그림 2-9(Binpicking Summary)를 이 교재의
        표기법(ADR-0001)으로 재구성. 점선은 파이프라인의 중간 재료, 파란 실선은 로봇에게
        최종적으로 필요한 답이다.
      </figcaption>
    </figure>
  );
}
