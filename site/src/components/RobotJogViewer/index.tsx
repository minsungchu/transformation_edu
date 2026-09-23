/**
 * 로봇 조그 뷰어 — 1단계 MDX 페이지에 임베드해서 쓴다. 로봇 하나와 좌표계 네 개
 * (World(Base) / Flange / TCP / User)만 있는 씬이다.
 *
 * ```mdx
 * import RobotJogViewer from '@site/src/components/RobotJogViewer';
 *
 * <RobotJogViewer jog={false} />                 // 뷰어 1 — 용어·좌표계 확인 (축 토글만)
 * <RobotJogViewer />                             // 뷰어 2 — 조깅 연습 (Joint/Base/Flange/TCP/User)
 * ```
 *
 * 조그 수학은 transform-core(`jogTargetFlangePose`, `solveIk`), 씬은 scene.ts.
 * Three.js는 브라우저에서만 동적 import되므로 SSR(빌드) 환경에서 안전하다.
 */
import React, {useEffect, useId, useMemo, useRef, useState, type ReactNode} from 'react';
import useBaseUrl from '@docusaurus/useBaseUrl';
import type {Vec3} from 'transform-core';
import {Transform, rotationToEuler} from 'transform-core';
import {DEFAULT_ROBOT, ROBOT_MODELS} from '../RobotCellViewer/robots';
import {FullscreenButton, useViewerFullscreen} from '../RobotCellViewer/fullscreen';
import {
  ANGULAR_STEPS_DEG,
  CARTESIAN_AXES,
  JogChip,
  LINEAR_STEPS_MM,
  StepSelect,
} from '../RobotCellViewer/jog-controls';
import type {JogFrameName, JogMode, RobotJogScene} from './scene';
import {ALL_JOG_FRAMES, JOG_FRAME_LABELS} from './scene';
import styles from '../RobotCellViewer/styles.module.css';
import rot from '../RotationViewer/styles.module.css';

const DEG = Math.PI / 180;

/** 티칭 펜던트의 조그 기준 선택지 — 버튼 이름은 현장 용어, 힌트는 CONTEXT.md 용어. */
const JOG_MODES: {id: JogMode; label: string; hint: string}[] = [
  {
    id: 'joint',
    label: 'Joint',
    hint: '관절 하나씩 직접 돌린다 — 좌표계와 무관. J1이 Base 쪽, J6이 플랜지 쪽이다.',
  },
  {
    id: 'base',
    label: 'Base',
    hint: 'World(Base) 좌표계 기준 — 제어점은 TCP. TCP가 어떻게 기울어져 있든 World 축 방향으로 곧게 움직인다.',
  },
  {
    id: 'tcp',
    label: 'TCP',
    hint: 'TCP(Tool 좌표계) 기준 — TCP 자신의 축 방향으로 움직이고, 회전은 그리퍼 끝단을 제자리에 둔 채 돈다.',
  },
  {
    id: 'flange',
    label: 'Flange',
    hint: 'Flange(6축 원점) 기준 — 축 방향은 TCP와 같지만 회전중심이 6축 원점이라, 회전하면 그리퍼 끝단이 크게 휘어 나간다.',
  },
  {
    id: 'user',
    label: 'User',
    hint: 'User 좌표계 기준 — 사용자가 정의한 축 방향으로 움직인다(제어점은 TCP). 아래 슬라이더로 User 좌표계를 옮기고 돌려 보라.',
  },
];

/** 조그 버튼 툴팁에 쓰는 기준 좌표계 이름. */
const FRAME_LABELS: Record<Exclude<JogMode, 'joint'>, string> = {
  base: 'Base',
  flange: 'Flange',
  tcp: 'TCP',
  user: 'User',
};

/** User 좌표계 초기값 — 로봇 앞 오른쪽, 30° 틀어진 작업대 모서리를 흉내 낸다. */
const DEFAULT_USER_POS: Vec3 = [0.45, -0.35, 0.15];
const DEFAULT_USER_YAW_DEG = 30;

export interface RobotJogViewerProps {
  /** 뷰어 높이 (px). */
  height?: number;
  /** 조그 툴바 노출 여부 — false면 축 토글만 있는 "용어 확인" 뷰어가 된다. */
  jog?: boolean;
  /** 축 토글을 노출할 좌표계 — 기본은 jog면 네 개, 아니면 User를 뺀 세 개. */
  frames?: readonly JogFrameName[];
  /** 처음부터 켜 둘 축. */
  defaultFrames?: readonly JogFrameName[];
  defaultJogMode?: JogMode;
  /** 초기 관절 자세 재정의 (joint 이름 → radians). */
  jointValues?: Record<string, number>;
}

/** −0.000을 만들지 않는 고정 소수점 표기. */
function fmt(value: number, digits = 3): string {
  return (Math.abs(value) < 5e-4 ? 0 : value).toFixed(digits);
}

function userFrameOf(pos: Vec3, yawDeg: number): Transform {
  return Transform.fromTranslation(pos).compose(Transform.rotationZ(yawDeg * DEG));
}

export default function RobotJogViewer({
  height,
  jog = true,
  frames,
  defaultFrames = ['world', 'flange', 'tcp'],
  defaultJogMode = 'joint',
  jointValues,
}: RobotJogViewerProps = {}): ReactNode {
  const uid = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<RobotJogScene | null>(null);
  const {targetRef, isFullscreen, toggle: toggleFullscreen, widgetClassName} = useViewerFullscreen();
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState('');

  const frameChoices: readonly JogFrameName[] =
    frames ?? (jog ? ALL_JOG_FRAMES : ALL_JOG_FRAMES.filter((f) => f !== 'user'));
  const [framesOn, setFramesOn] = useState<ReadonlySet<JogFrameName>>(() => new Set(defaultFrames));

  const [jogMode, setJogMode] = useState<JogMode>(defaultJogMode);
  const [linearStepMm, setLinearStepMm] = useState(20);
  const [angularStepDeg, setAngularStepDeg] = useState(5);
  const [jointStepDeg, setJointStepDeg] = useState(5);
  const [jogWarning, setJogWarning] = useState('');
  const [userPos, setUserPos] = useState<Vec3>(DEFAULT_USER_POS);
  const [userYawDeg, setUserYawDeg] = useState(DEFAULT_USER_YAW_DEG);
  /** 현재 TCP pose — 조그마다 갱신해 툴바에 숫자로 보여 준다. */
  const [tcp, setTcp] = useState<Transform | null>(null);

  const model = ROBOT_MODELS[DEFAULT_ROBOT];
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
    [siteBase, JSON.stringify(jointValues)],
  );
  /** 관절 조그 버튼 순서 — restPose가 base → tip 순서다. */
  const jointNames = Object.keys(model.restPose);

  const refreshTcp = (): void => setTcp(sceneRef.current?.tcpPose() ?? null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return undefined;
    }
    let cancelled = false;
    let scene: RobotJogScene | undefined;
    setStatus('loading');
    void import('./scene').then(({createRobotJogScene}) => {
      if (cancelled) {
        return;
      }
      try {
        scene = createRobotJogScene({
          container,
          robot: config,
          initialFrames: [...framesOn],
          initialJogMode: jog ? jogMode : 'joint',
          initialUserFrame: userFrameOf(userPos, userYawDeg),
          onReady: () => {
            setStatus('ready');
            setTcp(scene?.tcpPose() ?? null);
          },
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
    // 토글·모드·User 좌표계는 씬 생성 시 초기값으로만 쓰고 이후에는 개별 setter로 반영한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config]);

  useEffect(() => {
    sceneRef.current?.setUserFrame(userFrameOf(userPos, userYawDeg));
  }, [userPos, userYawDeg]);

  const toggleFrame = (frame: JogFrameName, on: boolean): void => {
    setFramesOn((prev) => {
      const next = new Set(prev);
      if (on) {
        next.add(frame);
      } else {
        next.delete(frame);
      }
      return next;
    });
    sceneRef.current?.setFrameVisible(frame, on);
  };

  const changeJogMode = (mode: JogMode): void => {
    setJogMode(mode);
    setJogWarning('');
    sceneRef.current?.setJogMode(mode);
  };

  const jogDisabled = status !== 'ready';

  const stepCartesian = (spec: (typeof CARTESIAN_AXES)[number], sign: 1 | -1): void => {
    if (jogMode === 'joint') {
      return;
    }
    const amount =
      spec.kind === 'translate' ? (sign * linearStepMm) / 1000 : sign * angularStepDeg * DEG;
    const ok = sceneRef.current?.jogCartesian(jogMode, {kind: spec.kind, axis: spec.axis, amount});
    setJogWarning(
      ok ? '' : '이 방향으로는 더 움직일 수 없습니다 (IK가 수렴하지 못해 스텝을 건너뛰었습니다).',
    );
    refreshTcp();
  };

  const stepJoint = (jointName: string, sign: 1 | -1): void => {
    const ok = sceneRef.current?.jogJoint(jointName, sign * jointStepDeg * DEG);
    setJogWarning(ok ? '' : '이 관절은 가동 범위 끝에 있습니다.');
    refreshTcp();
  };

  const activeHint = JOG_MODES.find((m) => m.id === jogMode)?.hint ?? '';
  const noteText = jogWarning || activeHint;
  const tcpEuler = tcp ? rotationToEuler(tcp.rotation, 'ZYX') : null;

  return (
    <figure ref={targetRef} className={`${styles.widget}${widgetClassName}`}>
      <div
        ref={containerRef}
        className={styles.container}
        style={height && !isFullscreen ? {height} : undefined}
        role="img"
        aria-label="로봇 3D 씬: World(Base) 좌표계 원점에 선 UR5e 로봇, 플랜지에 달린 석션 그리퍼, Flange·TCP·User 좌표계 축">
        {status === 'loading' && <div className={styles.overlay}>로봇 불러오는 중…</div>}
        {status === 'error' && (
          <div className={`${styles.overlay} ${styles.error}`}>
            3D 뷰어를 불러오지 못했습니다: {errorMessage}
          </div>
        )}
        {status === 'ready' && (
          <div className={styles.hint}>드래그: 회전 · 휠: 확대/축소 · 우클릭 드래그: 이동</div>
        )}
      </div>
      <FullscreenButton isFullscreen={isFullscreen} onToggle={toggleFullscreen} />
      <div className={styles.toolbar}>
        {frameChoices.length > 0 && (
          <div className={styles.toolbarGroup}>
            <span className={styles.toolbarTitle}>좌표계 축</span>
            {frameChoices.map((frame) => (
              <label key={frame} className={styles.toggle}>
                <input
                  type="checkbox"
                  checked={framesOn.has(frame)}
                  disabled={jogDisabled}
                  onChange={(e) => toggleFrame(frame, e.target.checked)}
                />
                {JOG_FRAME_LABELS[frame]}
              </label>
            ))}
          </div>
        )}
        {jog && (
          <>
            <div className={styles.toolbarGroup}>
              <span className={styles.toolbarTitle}>조그 기준</span>
              {JOG_MODES.map((mode) => (
                <label key={mode.id} className={styles.toggle} title={mode.hint}>
                  <input
                    type="radio"
                    name={`robot-jog-mode-${uid}`}
                    checked={jogMode === mode.id}
                    onChange={() => changeJogMode(mode.id)}
                  />
                  {mode.label}
                </label>
              ))}
            </div>
            <div className={styles.toolbarGroup}>
              <span className={styles.toolbarTitle}>스텝</span>
              {jogMode === 'joint' ? (
                <StepSelect
                  label="관절"
                  unit="°"
                  values={ANGULAR_STEPS_DEG}
                  value={jointStepDeg}
                  onChange={setJointStepDeg}
                  disabled={jogDisabled}
                />
              ) : (
                <>
                  <StepSelect
                    label="병진"
                    unit="mm"
                    values={LINEAR_STEPS_MM}
                    value={linearStepMm}
                    onChange={setLinearStepMm}
                    disabled={jogDisabled}
                  />
                  <StepSelect
                    label="회전"
                    unit="°"
                    values={ANGULAR_STEPS_DEG}
                    value={angularStepDeg}
                    onChange={setAngularStepDeg}
                    disabled={jogDisabled}
                  />
                </>
              )}
            </div>
            <div className={styles.toolbarGroup}>
              <span className={styles.toolbarTitle}>조그</span>
              <span className={styles.jogGrid}>
                {jogMode === 'joint'
                  ? jointNames.map((name, index) => (
                      <JogChip
                        key={name}
                        label={`J${index + 1}`}
                        title={name}
                        disabled={jogDisabled}
                        onStep={(sign) => stepJoint(name, sign)}
                      />
                    ))
                  : CARTESIAN_AXES.map((spec) => (
                      <JogChip
                        key={spec.label}
                        label={spec.label}
                        title={`${FRAME_LABELS[jogMode]} 기준 ${spec.label}`}
                        disabled={jogDisabled}
                        onStep={(sign) => stepCartesian(spec, sign)}
                      />
                    ))}
              </span>
              <button
                type="button"
                className={styles.jogReset}
                disabled={jogDisabled}
                onClick={() => {
                  sceneRef.current?.resetPose();
                  setJogWarning('');
                  refreshTcp();
                }}>
                초기 자세
              </button>
            </div>
            {jogMode === 'user' && (
              <div className={rot.sliderGroup}>
                <span className={styles.toolbarTitle}>User 좌표계</span>
                {(['x', 'y', 'z'] as const).map((axis, i) => (
                  <label key={axis} className={rot.sliderRow}>
                    <span className={rot.sliderLabel}>{axis}</span>
                    <input
                      className={rot.slider}
                      type="range"
                      min={-0.8}
                      max={0.8}
                      step={0.05}
                      value={userPos[i]}
                      disabled={jogDisabled}
                      onChange={(e) =>
                        setUserPos((prev) => {
                          const next: [number, number, number] = [...prev];
                          next[i] = Number(e.target.value);
                          return next;
                        })
                      }
                    />
                    <span className={rot.sliderValue}>{fmt(userPos[i], 2)} m</span>
                  </label>
                ))}
                <label className={rot.sliderRow}>
                  <span className={rot.sliderLabel}>
                    R<sub>z</sub>
                  </span>
                  <input
                    className={rot.slider}
                    type="range"
                    min={-180}
                    max={180}
                    step={5}
                    value={userYawDeg}
                    disabled={jogDisabled}
                    onChange={(e) => setUserYawDeg(Number(e.target.value))}
                  />
                  <span className={rot.sliderValue}>{userYawDeg}°</span>
                </label>
                <button
                  type="button"
                  className={styles.jogReset}
                  disabled={jogDisabled}
                  onClick={() => {
                    setUserPos(DEFAULT_USER_POS);
                    setUserYawDeg(DEFAULT_USER_YAW_DEG);
                  }}>
                  User 초기화
                </button>
              </div>
            )}
            {tcp && tcpEuler && (
              <p className={rot.vectorRow}>
                <span className={rot.mono}>
                  TCP 위치 (World 기준, m) = ({tcp.translation.map((v) => fmt(v)).join(', ')})
                </span>
                <span className={rot.mono}>
                  TCP 자세 (ZYX, °) = ({tcpEuler.map((r) => fmt(r / DEG, 1)).join(', ')})
                </span>
              </p>
            )}
          </>
        )}
        <p className={`${styles.jogNote}${jogWarning ? ` ${styles.jogWarn}` : ''}`}>
          {jog
            ? noteText
            : 'World(Base)는 로봇 발밑에 고정, Flange는 6축 끝 원판 중심, TCP는 그리퍼 끝단이다. 축을 하나씩 켜고 끄며 어디에 붙어 있는지 확인해 보라.'}
        </p>
      </div>
    </figure>
  );
}
