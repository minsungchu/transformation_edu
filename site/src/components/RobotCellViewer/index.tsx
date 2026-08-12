/**
 * 로봇 셀 3D 뷰어 위젯 — MDX 챕터 페이지에 임베드해서 쓴다.
 *
 * ```mdx
 * import RobotCellViewer from '@site/src/components/RobotCellViewer';
 *
 * <RobotCellViewer />                            // 전체 기능
 * <RobotCellViewer axes={['world']} arrows={false} mountToggle={false} />
 * ```
 *
 * 절별로 기능을 제한하려면 axes / mountToggle / arrows props를 좁힌다.
 * Three.js는 브라우저에서만 동적 import되므로 SSR(빌드) 환경에서 안전하다.
 */
import React, {useEffect, useId, useMemo, useRef, useState, type ReactNode} from 'react';
import useBaseUrl from '@docusaurus/useBaseUrl';
import type {RobotModelConfig, RobotModelId} from './robots';
import {DEFAULT_ROBOT, ROBOT_MODELS} from './robots';
import type {ArrowId, FrameName, MountMode} from './types';
import {ALL_ARROWS, ALL_FRAMES, ARROW_DEFS, FRAME_LABELS} from './types';
import type {RobotCellScene} from './scene';
import styles from './styles.module.css';

export interface RobotCellViewerProps {
  /** 레지스트리 키(robots.ts) 또는 커스텀 URDF config. */
  robot?: RobotModelId | RobotModelConfig;
  /** 뷰어 높이 (px). */
  height?: number;
  /** 초기 관절 자세 재정의 (joint 이름 → radians). */
  jointValues?: Record<string, number>;
  /** 축 토글을 노출할 좌표계 — true = 전체, false = 기능 숨김. */
  axes?: boolean | readonly FrameName[];
  /** 처음부터 켜 둘 축. */
  defaultAxes?: readonly FrameName[];
  /** Post ↔ Robot Mount 전환 토글 노출 여부. */
  mountToggle?: boolean;
  /** 초기 Mount 방식. */
  defaultMount?: MountMode;
  /** T 화살표 토글을 노출할 목록 — true = 전체, false = 기능 숨김. */
  arrows?: boolean | readonly ArrowId[];
  /** 처음부터 켜 둘 T 화살표. */
  defaultArrows?: readonly ArrowId[];
}

/** $T^{A}_{B}$ 표기 (위첨자 = 기준, 아래첨자 = 타겟) — 토글 라벨용. */
function TNotation({sup, sub}: {sup: string; sub: string}): ReactNode {
  return (
    <span className={styles.tNotation}>
      T
      <span className={styles.tScripts}>
        <span>{sup}</span>
        <span>{sub}</span>
      </span>
    </span>
  );
}

export default function RobotCellViewer({
  robot = DEFAULT_ROBOT,
  height,
  jointValues,
  axes = true,
  defaultAxes = [],
  mountToggle = true,
  defaultMount = 'post',
  arrows = true,
  defaultArrows = [],
}: RobotCellViewerProps): ReactNode {
  const uid = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<RobotCellScene | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState('');

  const axesChoices: readonly FrameName[] = axes === true ? ALL_FRAMES : axes === false ? [] : axes;
  const arrowChoices: readonly ArrowId[] = arrows === true ? ALL_ARROWS : arrows === false ? [] : arrows;

  const [axesOn, setAxesOn] = useState<ReadonlySet<FrameName>>(() => new Set(defaultAxes));
  const [mount, setMount] = useState<MountMode>(defaultMount);
  const [arrowsOn, setArrowsOn] = useState<ReadonlySet<ArrowId>>(() => new Set(defaultArrows));

  const model = typeof robot === 'string' ? ROBOT_MODELS[robot] : robot;
  const siteBase = useBaseUrl('/');
  const config = useMemo(
    () => ({
      urdfUrl: siteBase + model.urdfUrl,
      packages: Object.fromEntries(
        Object.entries(model.packages).map(([pkg, path]) => [pkg, siteBase + path]),
      ),
      jointValues: {...model.restPose, ...jointValues},
      frameLinks: model.frameLinks,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [siteBase, model.urdfUrl, JSON.stringify(model.packages), JSON.stringify(jointValues)],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return undefined;
    }
    let cancelled = false;
    let scene: RobotCellScene | undefined;
    setStatus('loading');
    void import('./scene').then(({createRobotCellScene}) => {
      if (cancelled) {
        return;
      }
      try {
        scene = createRobotCellScene({
          container,
          robot: config,
          initialAxes: [...axesOn],
          initialMount: mount,
          initialArrows: [...arrowsOn],
          onReady: () => setStatus('ready'),
          onError: (error) => {
            setErrorMessage(error instanceof Error ? error.message : String(error));
            setStatus('error');
          },
        });
        sceneRef.current = scene;
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
    // 초기 토글 상태는 씬 생성 시에만 쓰고, 이후에는 아래 핸들러로 반영한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config]);

  const toggleAxis = (frame: FrameName, on: boolean): void => {
    setAxesOn((prev) => {
      const next = new Set(prev);
      if (on) {
        next.add(frame);
      } else {
        next.delete(frame);
      }
      return next;
    });
    sceneRef.current?.setFrameAxesVisible(frame, on);
  };

  const changeMount = (mode: MountMode): void => {
    setMount(mode);
    sceneRef.current?.setMount(mode);
  };

  const toggleArrow = (id: ArrowId, on: boolean): void => {
    setArrowsOn((prev) => {
      const next = new Set(prev);
      if (on) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
    sceneRef.current?.setArrowVisible(id, on);
  };

  const hasToolbar = axesChoices.length > 0 || mountToggle || arrowChoices.length > 0;

  return (
    <figure className={styles.widget}>
      <div ref={containerRef} className={styles.container} style={height ? {height} : undefined}>
        {status === 'loading' && <div className={styles.overlay}>로봇 셀 불러오는 중…</div>}
        {status === 'error' && (
          <div className={`${styles.overlay} ${styles.error}`}>
            3D 뷰어를 불러오지 못했습니다: {errorMessage}
          </div>
        )}
        {status === 'ready' && (
          <div className={styles.hint}>드래그: 회전 · 휠: 확대/축소 · 우클릭 드래그: 이동</div>
        )}
      </div>
      {hasToolbar && (
        <div className={styles.toolbar}>
          {axesChoices.length > 0 && (
            <div className={styles.toolbarGroup}>
              <span className={styles.toolbarTitle}>좌표계 축</span>
              {axesChoices.map((frame) => (
                <label key={frame} className={styles.toggle}>
                  <input
                    type="checkbox"
                    checked={axesOn.has(frame)}
                    onChange={(e) => toggleAxis(frame, e.target.checked)}
                  />
                  {FRAME_LABELS[frame]}
                </label>
              ))}
            </div>
          )}
          {mountToggle && (
            <div className={styles.toolbarGroup}>
              <span className={styles.toolbarTitle}>Mount</span>
              {(['post', 'robot'] as const).map((mode) => (
                <label key={mode} className={styles.toggle}>
                  <input
                    type="radio"
                    name={`mount-${uid}`}
                    checked={mount === mode}
                    onChange={() => changeMount(mode)}
                  />
                  {mode === 'post' ? 'Post' : 'Robot'}
                </label>
              ))}
            </div>
          )}
          {arrowChoices.length > 0 && (
            <div className={styles.toolbarGroup}>
              <span className={styles.toolbarTitle}>T 화살표</span>
              {arrowChoices.map((id) => (
                <label key={id} className={styles.toggle} style={{color: ARROW_DEFS[id].color}}>
                  <input
                    type="checkbox"
                    checked={arrowsOn.has(id)}
                    onChange={(e) => toggleArrow(id, e.target.checked)}
                  />
                  <TNotation sup={ARROW_DEFS[id].from} sub={ARROW_DEFS[id].to} />
                </label>
              ))}
            </div>
          )}
        </div>
      )}
    </figure>
  );
}
