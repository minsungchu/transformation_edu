/**
 * 로봇 셀 3D 뷰어 위젯 — MDX 챕터 페이지에 임베드해서 쓴다.
 *
 * ```mdx
 * import RobotCellViewer from '@site/src/components/RobotCellViewer';
 *
 * <RobotCellViewer />            // 기본 로봇(UR5e)
 * <RobotCellViewer robot="ur5e" />  // 레지스트리 키로 교체
 * ```
 *
 * Three.js는 브라우저에서만 동적 import되므로 SSR(빌드) 환경에서 안전하다.
 */
import React, {useEffect, useMemo, useRef, useState, type ReactNode} from 'react';
import useBaseUrl from '@docusaurus/useBaseUrl';
import type {RobotModelConfig, RobotModelId} from './robots';
import {DEFAULT_ROBOT, ROBOT_MODELS} from './robots';
import styles from './styles.module.css';

export interface RobotCellViewerProps {
  /** 레지스트리 키(robots.ts) 또는 커스텀 URDF config. */
  robot?: RobotModelId | RobotModelConfig;
  /** 뷰어 높이 (px). */
  height?: number;
  /** 초기 관절 자세 재정의 (joint 이름 → radians). */
  jointValues?: Record<string, number>;
}

export default function RobotCellViewer({
  robot = DEFAULT_ROBOT,
  height = 440,
  jointValues,
}: RobotCellViewerProps): ReactNode {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState('');

  const model = typeof robot === 'string' ? ROBOT_MODELS[robot] : robot;
  const siteBase = useBaseUrl('/');
  const config = useMemo(
    () => ({
      urdfUrl: siteBase + model.urdfUrl,
      packages: Object.fromEntries(
        Object.entries(model.packages).map(([pkg, path]) => [pkg, siteBase + path]),
      ),
      jointValues: {...model.restPose, ...jointValues},
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
    let dispose: (() => void) | undefined;
    setStatus('loading');
    void import('./scene').then(({createRobotCellScene}) => {
      if (cancelled) {
        return;
      }
      try {
        const scene = createRobotCellScene({
          container,
          robot: config,
          onReady: () => setStatus('ready'),
          onError: (error) => {
            setErrorMessage(error instanceof Error ? error.message : String(error));
            setStatus('error');
          },
        });
        dispose = scene.dispose;
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : String(error));
        setStatus('error');
      }
    });
    return () => {
      cancelled = true;
      dispose?.();
    };
  }, [config]);

  return (
    <div ref={containerRef} className={styles.container} style={{height}}>
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
  );
}
