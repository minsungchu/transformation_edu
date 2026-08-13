/**
 * 3D 뷰어 최대화(전체 화면) 훅 + 버튼 — RobotCellViewer와 BinPickingPipeline이
 * 공유한다.
 *
 * Fullscreen API(requestFullscreen)로 위젯 전체(캔버스 + 툴바)를 전체 화면에
 * 띄우고, API 미지원/요청 거부 환경에서는 페이지 위 고정 오버레이(modal)로
 * 폴백한다. 종료는 같은 버튼(⛶ → ✕) 또는 ESC — 네이티브는 fullscreenchange
 * 이벤트로, 오버레이는 keydown으로 동기화한다. 캔버스 리사이즈는 viewer-core의
 * ResizeObserver가 처리하므로 여기서는 레이아웃 클래스만 바꾼다.
 */
import React, {useCallback, useEffect, useRef, useState, type ReactNode, type RefObject} from 'react';
import styles from './styles.module.css';

/** 'native' = Fullscreen API, 'overlay' = 고정 오버레이 폴백. */
export type FullscreenMode = 'off' | 'native' | 'overlay';

export interface ViewerFullscreen {
  /** 전체 화면 대상(위젯 figure)에 연결할 ref. */
  targetRef: RefObject<HTMLElement | null>;
  mode: FullscreenMode;
  isFullscreen: boolean;
  toggle: () => void;
  /** 위젯 figure에 얹을 전체 화면 상태 클래스 (기본 클래스 뒤에 붙인다). */
  widgetClassName: string;
}

export function useViewerFullscreen(): ViewerFullscreen {
  const targetRef = useRef<HTMLElement>(null);
  const [mode, setMode] = useState<FullscreenMode>('off');

  // 네이티브 전체 화면: ESC·브라우저 UI로 종료해도 상태를 따라간다.
  useEffect(() => {
    const onChange = (): void => {
      if (document.fullscreenElement !== targetRef.current) {
        setMode((prev) => (prev === 'native' ? 'off' : prev));
      }
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  // 오버레이 폴백: ESC로 종료하고, 떠 있는 동안 페이지 스크롤을 잠근다.
  useEffect(() => {
    if (mode !== 'overlay') {
      return undefined;
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        setMode('off');
      }
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [mode]);

  const toggle = useCallback((): void => {
    const el = targetRef.current;
    if (!el) {
      return;
    }
    if (mode === 'off') {
      if (document.fullscreenEnabled && typeof el.requestFullscreen === 'function') {
        el.requestFullscreen().then(
          () => setMode('native'),
          () => setMode('overlay'),
        );
      } else {
        setMode('overlay');
      }
    } else {
      if (mode === 'native' && document.fullscreenElement === el) {
        void document.exitFullscreen().catch(() => {});
      }
      setMode('off');
    }
  }, [mode]);

  const widgetClassName =
    mode === 'off'
      ? ''
      : ` ${styles.isFullscreen}${mode === 'overlay' ? ` ${styles.overlayFullscreen}` : ''}`;

  return {targetRef, mode, isFullscreen: mode !== 'off', toggle, widgetClassName};
}

/** 뷰어 우상단 최대화 버튼 (⛶ ↔ ✕). */
export function FullscreenButton({
  isFullscreen,
  onToggle,
}: {
  isFullscreen: boolean;
  onToggle: () => void;
}): ReactNode {
  const label = isFullscreen ? '전체 화면 종료' : '전체 화면으로 보기';
  return (
    <button
      type="button"
      className={styles.fullscreenButton}
      aria-label={label}
      title={label}
      onClick={onToggle}>
      {isFullscreen ? '✕' : '⛶'}
    </button>
  );
}
