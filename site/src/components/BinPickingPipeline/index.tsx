/**
 * 전체 bin picking 파이프라인 개요 — 3D 씬 위젯.
 *
 * reference DOCX 그림 2-8(Master/Scene 원점)·2-9(Binpicking Summary)를
 * ADR-0001 표기법(위첨자 = 기준 좌표계, 아래첨자 = 타겟)으로 재구성한
 * 것이다. 이미지 원점은 원래 카메라 원점과 같고, matching이 Master의
 * 원점을 이동시켜 Master가 Scene 위에 겹쳐진다 — 이동된 원점은 물체 밖
 * 허공에 떨어지고, $T_{match}$는 Scene 원점(카메라)에서 그 이동된 Master
 * 원점으로 향한다. 씬 구성은 scene.ts,
 * 렌더링 인프라는 RobotCellViewer를 재사용한다. Three.js는 브라우저에서만
 * 동적 import되므로 SSR(빌드) 환경에서 안전하다.
 */
import React, {useEffect, useMemo, useRef, useState, type ReactNode} from 'react';
import useBaseUrl from '@docusaurus/useBaseUrl';
import {DEFAULT_ROBOT, ROBOT_MODELS} from '../RobotCellViewer/robots';
import type {PipelineScene} from './scene';
import styles from '../RobotCellViewer/styles.module.css';

export default function BinPickingPipeline({height}: {height?: number} = {}): ReactNode {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState('');

  const model = ROBOT_MODELS[DEFAULT_ROBOT];
  const siteBase = useBaseUrl('/');
  const config = useMemo(
    () => ({
      urdfUrl: siteBase + model.urdfUrl,
      packages: Object.fromEntries(
        Object.entries(model.packages).map(([pkg, path]) => [pkg, siteBase + path]),
      ),
      jointValues: model.restPose,
      frameLinks: model.frameLinks,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [siteBase],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return undefined;
    }
    let cancelled = false;
    let scene: PipelineScene | undefined;
    setStatus('loading');
    void import('./scene').then(({createPipelineScene}) => {
      if (cancelled) {
        return;
      }
      try {
        scene = createPipelineScene({
          container,
          robot: config,
          onReady: () => setStatus('ready'),
          onError: (error) => {
            setErrorMessage(error instanceof Error ? error.message : String(error));
            setStatus('error');
          },
        });
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : String(error));
        setStatus('error');
      }
    });
    return () => {
      cancelled = true;
      scene?.dispose();
    };
  }, [config]);

  return (
    <figure className={styles.widget} style={{margin: '2rem 0'}}>
      <div
        ref={containerRef}
        className={styles.container}
        style={height ? {height, borderRadius: 8} : {borderRadius: 8}}
        role="img"
        aria-label="Bin picking 파이프라인 개요 3D 씬: World 좌표계(로봇)에서 Camera 좌표계로의 T_cal, 카메라 원점 자리의 Master·Scene 이미지 원점, Scene을 감싸며 겹쳐진 Master와 박스 옆 허공에 떨어진 이동된 Master 원점, Scene 원점(카메라)에서 이동된 Master 원점으로의 T_match, 그리고 최종 답 P world scene">
        {status === 'loading' && <div className={styles.overlay}>파이프라인 씬 불러오는 중…</div>}
        {status === 'error' && (
          <div className={`${styles.overlay} ${styles.error}`}>
            3D 뷰어를 불러오지 못했습니다: {errorMessage}
          </div>
        )}
        {status === 'ready' && (
          <div className={styles.hint}>드래그: 회전 · 휠: 확대/축소 · 우클릭 드래그: 이동</div>
        )}
      </div>
      <figcaption style={{fontSize: '0.85rem', opacity: 0.75, marginTop: '0.5rem', textAlign: 'center'}}>
        Bin picking 파이프라인 개요 — 이 교재의 표기법(ADR-0001)으로 그린 3D 씬.
        Master와 Scene의 이미지 원점은 원래 카메라 원점과 같고, Matching이
        Master의 원점을 이동시켜 두 박스가 겹쳐진다. 이동된 원점은 콘텐츠와
        함께 변환을 받아 물체 밖 허공에 떨어지고, T_match는 Scene
        원점(카메라 자리)에서 그 이동된 Master 원점으로 향한다. 점선은
        파이프라인의 중간 재료, 파란 실선은 로봇에게 최종적으로 필요한 답이다.
      </figcaption>
    </figure>
  );
}
