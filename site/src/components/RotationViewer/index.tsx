/**
 * 회전 전용 위젯 — 2단계(회전) MDX 페이지에 임베드해서 쓴다.
 *
 * ```mdx
 * import RotationViewer from '@site/src/components/RotationViewer';
 *
 * <RotationViewer />                                       // 전체 기능
 * <RotationViewer orderCompare={false} perspective={false} /> // 슬라이더 + 행렬만
 * ```
 *
 * 좌표계 하나를 슬라이더로 돌리면 3×3 회전 행렬이 실시간으로 갱신되고, 행렬의
 * 한 열에 마우스를 올리면 그 열이 가리키는 축이 씬에서 밝아진다 — "열 = 그 축의
 * 방향벡터"를 눈으로 붙이는 게 이 위젯의 핵심이다.
 *
 * 회전 수학은 전부 transform-core를 거친다. Euler 각 → 행렬은
 * `eulerToRotation`, 순서를 바꾼 합성은 **축 순서와 각도를 함께 뒤집은**
 * 같은 함수 호출이다 — order가 'ZYX'이고 각이 $(a_1, a_2, a_3)$이면
 * $R = R_Z(a_1) R_Y(a_2) R_X(a_3)$이고, 뒤집으면 order 'XYZ' + 각
 * $(a_3, a_2, a_1)$이 곧 $R_X(a_3) R_Y(a_2) R_Z(a_1)$이다. 같은 세 회전을
 * 순서만 바꿔 곱한 것이라 둘의 차이가 그대로 비가환성이 된다.
 *
 * Three.js는 브라우저에서만 동적 import되므로 SSR(빌드) 환경에서 안전하다.
 */
import React, {useEffect, useId, useMemo, useRef, useState, type ReactNode} from 'react';
import type {EulerAngles, EulerOrder, Mat3, Vec3} from 'transform-core';
import {eulerToRotation, mat3ApplyToVec3, mat3ApproxEquals, mat3Transpose} from 'transform-core';
import {FullscreenButton, useViewerFullscreen} from '../RobotCellViewer/fullscreen';
import type {AxisIndex, RotationPerspective, RotationScene, RotationSceneState} from './scene';
import viewer from '../RobotCellViewer/styles.module.css';
import styles from './styles.module.css';

const DEG = Math.PI / 180;

/** scene.ts의 POINT_P와 같은 점 — 좌표 표시는 여기서 계산한다. */
const POINT_P: Vec3 = [0.6, 0.4, 0.45];

const AXIS_COLORS = ['#e5484d', '#30a46c', '#3b82f6'] as const;
const AXIS_NAMES = ['x', 'y', 'z'] as const;
/** order 글자('X'/'Y'/'Z') → 축 색 — 슬라이더 라벨을 그 축 색으로 칠한다. */
const AXIS_COLOR_BY_LETTER: Record<string, string> = {X: '#e5484d', Y: '#30a46c', Z: '#3b82f6'};

const ORDERS: readonly EulerOrder[] = ['ZYX', 'XYZ', 'XZY', 'YXZ', 'YZX', 'ZXY'];

/** 회전 한 단계를 도는 데 걸리는 시간 — '순서대로 돌려보기' 재생용. */
const STAGE_SECONDS = 0.9;

export interface RotationViewerProps {
  /** 뷰포트 높이 (px). */
  height?: number;
  /** 각도 슬라이더 3개 노출 여부. */
  sliders?: boolean;
  /** 3×3 행렬 표시 여부. */
  matrix?: boolean;
  /** Euler order 선택 노출 여부. */
  orderSelect?: boolean;
  /** 회전 순서 비교(비가환) 토글 노출 여부. */
  orderCompare?: boolean;
  /** passive ↔ active 관점 토글 노출 여부. */
  perspective?: boolean;
  /** 관점 비교의 대상인 점 p를 씬에 그릴지. */
  vector?: boolean;
  defaultOrder?: EulerOrder;
  /** 초기 각도 (도, order의 축 글자 순서와 1:1 대응). */
  defaultAngles?: readonly [number, number, number];
  defaultPerspective?: RotationPerspective;
  /** 순서 비교를 처음부터 켜 둔다 (토글을 숨긴 채 켜 두면 비교 전용 위젯이 된다). */
  defaultCompare?: boolean;
}

/** 'ZYX' → 'XYZ' — 축 글자를 뒤집는다. 6종 Tait-Bryan order는 뒤집어도 6종 안에 있다. */
function reverseOrder(order: EulerOrder): EulerOrder {
  return `${order[2]}${order[1]}${order[0]}` as EulerOrder;
}

/**
 * 재생 진행도(0~3)만큼만 돌린 회전.
 *
 * 아직 차례가 오지 않은 각은 0이고, 0 회전은 단위행렬이라 곱해도 결과가 바뀌지
 * 않는다 — 그래서 부분 각을 그대로 `eulerToRotation`에 넘기면 "지금까지 돈 만큼"이
 * 나온다.
 */
function partialRotation(
  anglesDeg: readonly [number, number, number],
  order: EulerOrder,
  progress: number,
): Mat3 {
  const scaled = anglesDeg.map((deg, i) => {
    const t = Math.min(1, Math.max(0, progress - i));
    return deg * t * DEG;
  }) as unknown as EulerAngles;
  return eulerToRotation(scaled, order);
}

/** −0.000을 만들지 않는 고정 소수점 표기. */
function fmt(value: number): string {
  return (Math.abs(value) < 5e-4 ? 0 : value).toFixed(3);
}

function fmtVec(v: Vec3): string {
  return `(${v.map((n) => fmt(n)).join(', ')})`;
}

/** 3×3 행렬 — 열 하나가 버튼 하나이고, 그 열이 곧 대응 축의 방향벡터다. */
function MatrixGrid({
  label,
  matrix,
  highlight,
  onHighlight,
  muted,
}: {
  label: ReactNode;
  matrix: Mat3;
  highlight: AxisIndex | null;
  onHighlight: (axis: AxisIndex | null) => void;
  muted?: boolean;
}): ReactNode {
  return (
    <div className={`${styles.matrixBlock}${muted ? ` ${styles.matrixMuted}` : ''}`}>
      <span className={styles.matrixLabel}>{label}</span>
      <span className={`${styles.bracket} ${styles.bracketLeft}`} aria-hidden="true" />
      <span className={styles.columns}>
        {([0, 1, 2] as const).map((col) => (
          <button
            key={col}
            type="button"
            className={`${styles.column}${highlight === col ? ` ${styles.columnActive}` : ''}`}
            style={{'--axis-color': AXIS_COLORS[col]} as React.CSSProperties}
            aria-label={`${AXIS_NAMES[col]}축 열 강조`}
            aria-pressed={highlight === col}
            onMouseEnter={() => onHighlight(col)}
            onMouseLeave={() => onHighlight(null)}
            onFocus={() => onHighlight(col)}
            onBlur={() => onHighlight(null)}
            onClick={() => onHighlight(highlight === col ? null : col)}>
            <span className={styles.colHead}>{AXIS_NAMES[col]}</span>
            {([0, 1, 2] as const).map((row) => (
              <span key={row} className={styles.cell}>
                {fmt(matrix[row * 3 + col]!)}
              </span>
            ))}
          </button>
        ))}
      </span>
      <span className={`${styles.bracket} ${styles.bracketRight}`} aria-hidden="true" />
    </div>
  );
}

export default function RotationViewer({
  height,
  sliders = true,
  matrix = true,
  orderSelect = true,
  orderCompare = true,
  perspective = true,
  vector = true,
  defaultOrder = 'ZYX',
  defaultAngles = [30, 20, 0],
  defaultPerspective = 'passive',
  defaultCompare = false,
}: RotationViewerProps = {}): ReactNode {
  const uid = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<RotationScene | null>(null);
  const {targetRef, isFullscreen, toggle: toggleFullscreen, widgetClassName} = useViewerFullscreen();
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState('');

  const [order, setOrder] = useState<EulerOrder>(defaultOrder);
  const [anglesDeg, setAnglesDeg] = useState<[number, number, number]>([...defaultAngles] as [
    number,
    number,
    number,
  ]);
  const [view, setView] = useState<RotationPerspective>(defaultPerspective);
  const [compareOn, setCompareOn] = useState(defaultCompare);
  const [highlight, setHighlight] = useState<AxisIndex | null>(null);
  /** 0~3 — 세 회전을 차례로 도는 재생 진행도. 3이면 다 돈 상태(정지). */
  const [progress, setProgress] = useState(3);
  const [playing, setPlaying] = useState(false);

  const swappedOrder = reverseOrder(order);
  const swappedAngles: [number, number, number] = [anglesDeg[2], anglesDeg[1], anglesDeg[0]];

  const rotation = useMemo(
    () => partialRotation(anglesDeg, order, progress),
    [anglesDeg, order, progress],
  );
  const swapped = useMemo(
    () => partialRotation(swappedAngles, swappedOrder, progress),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [anglesDeg, order, progress],
  );
  const compare = compareOn ? swapped : null;
  const commutes = mat3ApproxEquals(rotation, swapped, 1e-6);

  const sceneState: RotationSceneState = {
    rotation,
    compare,
    perspective: view,
    showVector: vector,
    highlight,
  };
  // 씬은 동적 import 뒤에 생기므로, 그동안 바뀐 상태를 놓치지 않게 최신값을 들고 있는다.
  const stateRef = useRef(sceneState);
  stateRef.current = sceneState;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return undefined;
    }
    let cancelled = false;
    let scene: RotationScene | undefined;
    setStatus('loading');
    void import('./scene').then(({createRotationScene}) => {
      if (cancelled) {
        return;
      }
      try {
        scene = createRotationScene({container});
        scene.update(stateRef.current);
        sceneRef.current = scene;
        setStatus('ready');
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : String(error));
        setStatus('error');
      }
    });
    return () => {
      cancelled = true;
      sceneRef.current = null;
      scene?.dispose();
    };
  }, []);

  useEffect(() => {
    sceneRef.current?.update(stateRef.current);
  }, [rotation, compare, view, vector, highlight]);

  // '순서대로 돌려보기' — 세 회전을 한 단계씩 이어 돌린다.
  useEffect(() => {
    if (!playing) {
      return undefined;
    }
    let frame = 0;
    let last = performance.now();
    const tick = (): void => {
      const now = performance.now();
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      setProgress((prev) => {
        const next = prev + dt / STAGE_SECONDS;
        if (next >= 3) {
          setPlaying(false);
          return 3;
        }
        return next;
      });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing]);

  /** 조작이 들어오면 재생을 멈추고 완성 상태로 돌려놓는다. */
  const settle = (): void => {
    setPlaying(false);
    setProgress(3);
  };

  const play = (): void => {
    // 모션을 줄이는 설정이면 애니메이션 없이 결과만 보여 준다.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      settle();
      return;
    }
    setProgress(0);
    setPlaying(true);
  };

  const changeAngle = (index: 0 | 1 | 2, deg: number): void => {
    settle();
    setAnglesDeg((prev) => {
      const next: [number, number, number] = [...prev];
      next[index] = deg;
      return next;
    });
  };

  const showOrderGroup = orderSelect || orderCompare;
  const hasToolbar = sliders || matrix || showOrderGroup || perspective;

  const passive = view === 'passive';
  const pInB = mat3ApplyToVec3(mat3Transpose(rotation), POINT_P);
  const pMoved = mat3ApplyToVec3(rotation, POINT_P);

  const note = passive
    ? '기준 좌표계 A(흐린 축, 대문자 X/Y/Z)는 그대로 두고 좌표계 B(진한 축, 소문자 x/y/z)만 돌린다. 점 p는 공간에 붙박여 있고 좌표 표현만 바뀐다 — 행렬의 열이 곧 A에서 본 B 축의 방향벡터다.'
    : '좌표계는 고정하고 점 자신을 돌린다. 같은 행렬 R이지만 이번에는 p가 R·p로 옮겨 간다 — 이 교재의 기본 표현은 passive다.';

  return (
    <figure ref={targetRef} className={`${viewer.widget}${widgetClassName}`}>
      <div
        ref={containerRef}
        className={viewer.container}
        style={height && !isFullscreen ? {height} : undefined}
        role="img"
        aria-label="회전 3D 씬: 원점에 놓인 기준 좌표계와 그것을 각도만큼 돌린 좌표계의 RGB 축, 그리고 관점 비교용 점 p">
        {status === 'loading' && <div className={viewer.overlay}>회전 뷰어 불러오는 중…</div>}
        {status === 'error' && (
          <div className={`${viewer.overlay} ${viewer.error}`}>
            3D 뷰어를 불러오지 못했습니다: {errorMessage}
          </div>
        )}
        {status === 'ready' && (
          <div className={viewer.hint}>드래그: 회전 · 휠: 확대/축소 · 우클릭 드래그: 이동</div>
        )}
      </div>
      <FullscreenButton isFullscreen={isFullscreen} onToggle={toggleFullscreen} />
      {hasToolbar && (
        <div className={viewer.toolbar}>
          {sliders && (
            <div className={styles.sliderGroup}>
              <span className={viewer.toolbarTitle}>회전각</span>
              {([0, 1, 2] as const).map((i) => (
                <label key={i} className={styles.sliderRow}>
                  <span
                    className={styles.sliderLabel}
                    style={{color: AXIS_COLOR_BY_LETTER[order[i]!]}}>
                    R<sub>{order[i]!.toLowerCase()}</sub>
                  </span>
                  <input
                    className={styles.slider}
                    type="range"
                    min={-180}
                    max={180}
                    step={1}
                    value={anglesDeg[i]}
                    disabled={status !== 'ready'}
                    onChange={(e) => changeAngle(i, Number(e.target.value))}
                  />
                  <span className={styles.sliderValue}>{anglesDeg[i]}°</span>
                </label>
              ))}
              <button
                type="button"
                className={viewer.jogReset}
                disabled={status !== 'ready'}
                onClick={() => {
                  settle();
                  setAnglesDeg([...defaultAngles] as [number, number, number]);
                }}>
                각도 초기화
              </button>
            </div>
          )}
          {matrix && (
            <div className={styles.matrixGroup}>
              <MatrixGrid
                label={
                  <>
                    R<sub>{order}</sub> =
                  </>
                }
                matrix={rotation}
                highlight={highlight}
                onHighlight={setHighlight}
              />
              {compare && (
                <MatrixGrid
                  label={
                    <>
                      R<sub>{swappedOrder}</sub> =
                    </>
                  }
                  matrix={swapped}
                  highlight={highlight}
                  onHighlight={setHighlight}
                  muted
                />
              )}
              <p className={styles.matrixNote}>
                열 하나가 곧 그 축의 방향벡터다 — 열에 마우스를 올리면 씬에서 해당 축만 남는다.
                {compare && (
                  <span
                    className={`${styles.badge}${commutes ? ` ${styles.badgeOk}` : ''}`}
                    aria-live="polite">
                    {commutes ? '두 행렬이 같다 (이 각에서는 가환)' : '두 행렬이 다르다 (비가환)'}
                  </span>
                )}
              </p>
            </div>
          )}
          {(showOrderGroup || perspective) && (
          <div className={viewer.toolbarGroup}>
            {showOrderGroup && <span className={viewer.toolbarTitle}>회전 순서</span>}
            {orderSelect && (
              <label className={viewer.toggle}>
                order
                <select
                  className={viewer.jogSelect}
                  value={order}
                  disabled={status !== 'ready'}
                  onChange={(e) => {
                    settle();
                    setOrder(e.target.value as EulerOrder);
                  }}>
                  {ORDERS.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {orderCompare && (
              <label className={viewer.toggle}>
                <input
                  type="checkbox"
                  checked={compareOn}
                  onChange={(e) => {
                    settle();
                    setCompareOn(e.target.checked);
                  }}
                />
                순서 바꿔 비교 ({swappedOrder})
              </label>
            )}
            {showOrderGroup && (
              <button
                type="button"
                className={viewer.jogReset}
                disabled={status !== 'ready' || playing}
                title="세 회전을 한 단계씩 차례로 돌려 봅니다. 비교를 켜 두면 순서를 바꾼 쪽이 같이 돕니다."
                onClick={play}>
                ▶ 순서대로 돌려보기
              </button>
            )}
            {perspective && (
              <>
                <span className={viewer.toolbarTitle}>관점</span>
                {(['passive', 'active'] as const).map((mode) => (
                  <label key={mode} className={viewer.toggle}>
                    <input
                      type="radio"
                      name={`rotation-view-${uid}`}
                      checked={view === mode}
                      onChange={() => setView(mode)}
                    />
                    {mode === 'passive' ? 'passive (좌표계가 돈다)' : 'active (물체가 돈다)'}
                  </label>
                ))}
              </>
            )}
          </div>
          )}
          {vector && (
            <p className={styles.vectorRow}>
              {passive ? (
                <>
                  <span className={styles.mono}>p&nbsp;(A 기준) = {fmtVec(POINT_P)}</span>
                  <span className={styles.mono}>p&nbsp;(B 기준) = {fmtVec(pInB)}</span>
                </>
              ) : (
                <>
                  <span className={styles.mono}>p = {fmtVec(POINT_P)}</span>
                  <span className={styles.mono}>R·p = {fmtVec(pMoved)}</span>
                </>
              )}
            </p>
          )}
          <p className={viewer.jogNote}>{note}</p>
        </div>
      )}
    </figure>
  );
}
