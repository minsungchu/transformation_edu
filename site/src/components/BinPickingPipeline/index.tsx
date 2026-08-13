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
 *
 * 툴바에는 티칭 펜던트식 조그(jog)가 붙어 있다. 같은 +X 버튼이라도 기준
 * 좌표계에 따라 로봇이 다르게 움직이는 것을 눈으로 보는 게 목적이라,
 * Cartesian 모드에서는 해당 기준 좌표계의 축을 씬에 함께 그린다. 플랜지에
 * 석션 그리퍼가 달려 있어 Flange(6축 원점)와 TCP(그리퍼 끝단)가 그리퍼
 * 길이만큼 떨어져 있고, 회전 조그를 눌러 보면 회전중심 차이가 그대로 드러난다.
 */
import React, {useEffect, useMemo, useRef, useState, type ReactNode} from 'react';
import useBaseUrl from '@docusaurus/useBaseUrl';
import type {CartesianJogStep, Vec3} from 'transform-core';
import {DEFAULT_ROBOT, ROBOT_MODELS} from '../RobotCellViewer/robots';
import {FullscreenButton, useViewerFullscreen} from '../RobotCellViewer/fullscreen';
import type {JogMode, PipelineScene} from './scene';
import styles from '../RobotCellViewer/styles.module.css';

const DEG = Math.PI / 180;

// 좌표계 이름은 CONTEXT.md 용어(World / Flange / Tool·TCP)를 따르고, 티칭
// 펜던트에서 쓰는 버튼 이름(Base)은 괄호로만 붙인다.
const JOG_MODES: {id: JogMode; label: string; hint: string}[] = [
  {
    id: 'base',
    label: 'World(Base)',
    hint: 'World 좌표계 기준 — 제어점은 TCP(그리퍼 끝단). TCP가 어떻게 기울어져 있든 씬에 표시된 World 축 방향으로 움직인다.',
  },
  {
    id: 'flange',
    label: 'Flange',
    hint: 'Flange(6축 원점) 기준 — 플랜지 자신의 축 방향으로 움직이고, 회전은 6축 원점을 중심으로 돈다. 그리퍼 끝단은 그 둘레로 크게 휘어 나간다.',
  },
  {
    id: 'tcp',
    label: 'TCP',
    hint: 'Tool 좌표계(TCP = 그리퍼 끝단) 기준 — TCP 자신의 축 방향으로 움직이고, 회전은 그리퍼 끝단을 제자리에 둔 채 돈다. Flange 회전과 비교해 보라.',
  },
  {
    id: 'joint',
    label: 'Joint',
    hint: '관절 기준 — 관절 하나씩 직접 돌린다 (IK 없이 FK만 다시 계산).',
  },
];

/** 조그 버튼 툴팁에 쓰는 기준 좌표계 이름. */
const FRAME_LABELS: Record<Exclude<JogMode, 'joint'>, string> = {
  base: 'World',
  flange: 'Flange',
  tcp: 'TCP',
};

/** Cartesian 조그 버튼 6종 — 병진 3축 + 회전 3축. */
const CARTESIAN_AXES: {label: string; kind: CartesianJogStep['kind']; axis: Vec3}[] = [
  {label: 'X', kind: 'translate', axis: [1, 0, 0]},
  {label: 'Y', kind: 'translate', axis: [0, 1, 0]},
  {label: 'Z', kind: 'translate', axis: [0, 0, 1]},
  {label: 'Rx', kind: 'rotate', axis: [1, 0, 0]},
  {label: 'Ry', kind: 'rotate', axis: [0, 1, 0]},
  {label: 'Rz', kind: 'rotate', axis: [0, 0, 1]},
];

/** 스텝 크기 선택지 — 병진(mm) / 회전(°). */
const LINEAR_STEPS_MM = [5, 20, 50];
const ANGULAR_STEPS_DEG = [1, 5, 10];

function StepSelect({
  label,
  unit,
  values,
  value,
  onChange,
  disabled,
}: {
  label: string;
  unit: string;
  values: readonly number[];
  value: number;
  onChange: (next: number) => void;
  disabled: boolean;
}): ReactNode {
  return (
    <label className={styles.toggle}>
      {label}
      <select
        className={styles.jogSelect}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}>
        {values.map((v) => (
          <option key={v} value={v}>
            {v}
            {unit}
          </option>
        ))}
      </select>
    </label>
  );
}

/** [−] 라벨 [+] 한 벌. */
function JogChip({
  label,
  title,
  disabled,
  onStep,
}: {
  label: string;
  title: string;
  disabled: boolean;
  onStep: (sign: 1 | -1) => void;
}): ReactNode {
  return (
    <span className={styles.jogChip}>
      <button
        type="button"
        className={styles.jogButton}
        disabled={disabled}
        aria-label={`${title} − 방향`}
        onClick={() => onStep(-1)}>
        −
      </button>
      <span className={styles.jogChipLabel} title={title}>
        {label}
      </span>
      <button
        type="button"
        className={styles.jogButton}
        disabled={disabled}
        aria-label={`${title} + 방향`}
        onClick={() => onStep(1)}>
        +
      </button>
    </span>
  );
}

export default function BinPickingPipeline({height}: {height?: number} = {}): ReactNode {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<PipelineScene | null>(null);
  const {targetRef, isFullscreen, toggle: toggleFullscreen, widgetClassName} = useViewerFullscreen();
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState('');

  const [jogMode, setJogMode] = useState<JogMode>('base');
  const [linearStepMm, setLinearStepMm] = useState(20);
  const [angularStepDeg, setAngularStepDeg] = useState(5);
  const [jointStepDeg, setJointStepDeg] = useState(5);
  const [jogWarning, setJogWarning] = useState('');

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
  /** 조그 버튼에 쓸 관절 목록 — restPose가 곧 움직이는 관절 6개다 (base → tip 순). */
  const jointNames = useMemo(() => Object.keys(model.restPose), [model.restPose]);

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
          initialJogMode: jogMode,
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
    // 조그 모드는 씬 생성 시 초기값으로만 쓰고, 이후에는 changeJogMode로 반영한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config]);

  const changeJogMode = (mode: JogMode): void => {
    setJogMode(mode);
    setJogWarning('');
    sceneRef.current?.setJogMode(mode);
  };

  const jogDisabled = status !== 'ready';

  const stepCartesian = (spec: (typeof CARTESIAN_AXES)[number], sign: 1 | -1): void => {
    const amount =
      spec.kind === 'translate'
        ? (sign * linearStepMm) / 1000
        : sign * angularStepDeg * DEG;
    const ok = sceneRef.current?.jogCartesian(jogMode === 'joint' ? 'base' : jogMode, {
      kind: spec.kind,
      axis: spec.axis,
      amount,
    });
    setJogWarning(
      ok
        ? ''
        : '이 방향으로는 더 움직일 수 없습니다 (IK가 수렴하지 못해 스텝을 건너뛰었습니다).',
    );
  };

  const stepJoint = (jointName: string, sign: 1 | -1): void => {
    const ok = sceneRef.current?.jogJoint(jointName, sign * jointStepDeg * DEG);
    setJogWarning(ok ? '' : '이 관절은 가동 범위 끝에 있습니다.');
  };

  const activeHint = JOG_MODES.find((m) => m.id === jogMode)?.hint ?? '';

  return (
    <figure
      ref={targetRef}
      className={`${styles.widget}${widgetClassName}`}
      style={isFullscreen ? undefined : {margin: '2rem 0'}}>
      <div
        ref={containerRef}
        className={styles.container}
        style={isFullscreen || !height ? undefined : {height}}
        role="img"
        aria-label="Bin picking 파이프라인 개요 3D 씬: World 좌표계(로봇)에서 Camera 좌표계로의 T_cal, 카메라 원점 자리의 Master·Scene 이미지 원점, Scene을 감싸며 겹쳐진 Master와 박스 옆 허공에 떨어진 이동된 Master 원점, Scene 원점(카메라)에서 이동된 Master 원점으로의 T_match, 그리고 최종 답 P world scene. 로봇 플랜지에는 석션 그리퍼가 달려 있고 패드 끝단이 TCP다">
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
      {/* role="img" 컨테이너 안에 두면 보조기기에 presentational로 숨겨지므로 형제로 둔다. */}
      <FullscreenButton isFullscreen={isFullscreen} onToggle={toggleFullscreen} />
      <div className={styles.toolbar}>
        <div className={styles.toolbarGroup}>
          <span className={styles.toolbarTitle}>조그 기준</span>
          {JOG_MODES.map((mode) => (
            <label key={mode.id} className={styles.toggle} title={mode.hint}>
              <input
                type="radio"
                name="pipeline-jog-mode"
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
            }}>
            초기 자세
          </button>
        </div>
        <p className={`${styles.jogNote}${jogWarning ? ` ${styles.jogWarn}` : ''}`}>
          {jogWarning || activeHint}
        </p>
      </div>
      <figcaption style={{fontSize: '0.85rem', opacity: 0.75, marginTop: '0.5rem', textAlign: 'center'}}>
        Bin picking 파이프라인 개요 — Master와 Scene의 이미지 원점은 원래
        카메라 원점과 같고, Matching이 Master의 원점을 이동시켜 두 박스가
        겹쳐진다. 이동된 원점은 Master와 함께 변환을 받아 물체 밖 허공에
        떨어지고, T_match는 Scene
        원점(카메라 자리)에서 그 이동된 Master 원점으로 향한다. 점선은
        파이프라인의 중간 재료, 파란 실선은 로봇에게 최종적으로 필요한 답이다.
        툴바의 조그로 로봇 팔을 움직여 봐도 이 화살표·박스는 제자리에 남는다 —
        전부 World·Camera·Scene에 고정된 관계이기 때문이다. 플랜지에 달린 석션
        그리퍼의 패드 끝단이 TCP이며, 회전(Rx·Ry·Rz) 조그를 Flange 기준과 TCP
        기준으로 각각 눌러 보면 회전중심이 6축 원점인지 그리퍼 끝단인지에 따라
        팔이 다르게 움직이는 것을 볼 수 있다.
      </figcaption>
    </figure>
  );
}
