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
 *
 * 툴바 조그와 별개로 씬 안에서 직접 끄는 free 드래그도 있다 — 손목의 구체
 * 핸들을 잡아 끌면 팔이 실시간으로 따라온다. 두 조작은 같은 관절 상태를
 * 공유하므로 섞어 써도 된다.
 *
 * Master 박스도 끌어서 옮길 수 있다 — matching 전(떨어져 있음)과 후(겹침)를
 * 화면에서 바로 비교하기 위한 것으로, 박스·이동된 원점·picking point가 강체로
 * 함께 움직이고 $T_{match}$가 실시간으로 다시 그려진다. 원래(= matching이 끝난)
 * 자리로는 툴바의 'Master 원위치' 버튼으로 되돌린다.
 *
 * 툴바 맨 위에는 **스텝 시뮬레이션**이 있다 — 완성된 그림을 거꾸로 풀어, 카메라와
 * 로봇만 있는 상태에서 시작해 NEXT마다 요소를 하나씩 쌓아 올린다(`steps.ts`).
 * 마지막 단계에서는 로봇이 계산된 $P^{world}_{scene}$으로 이동해 석션 패드를 Scene
 * 상면에 얹는다 — 좌표 계산이 자세로 바뀌는 지점이다.
 * 재생 중에는 씬이 Master의 위치를 소유하므로 수동 Master 드래그만 잠기고, 로봇
 * 조그·궤도·최대화는 그대로 쓸 수 있다.
 */
import React, {useEffect, useMemo, useRef, useState, type ReactNode} from 'react';
import useBaseUrl from '@docusaurus/useBaseUrl';
import type {CartesianJogStep, Vec3} from 'transform-core';
import {DEFAULT_ROBOT, ROBOT_MODELS} from '../RobotCellViewer/robots';
import {FullscreenButton, useViewerFullscreen} from '../RobotCellViewer/fullscreen';
import type {FreeDragState, JogMode, PipelineScene} from './scene';
import {PIPELINE_STEPS, PIPELINE_STEP_COUNT} from './steps';
import styles from '../RobotCellViewer/styles.module.css';

const DEG = Math.PI / 180;

/**
 * 이 뷰어의 홈(초기) 자세 — 팔을 뒤로 당겨 접은 자세다.
 *
 * 공용 `restPose`(RobotCellViewer)는 팔을 앞으로 뻗어 작업 공간을 보여 주는
 * 자세라 1단계 문서들이 그 모습에 맞춰져 있다. 반면 이 씬에는 로봇 앞 공중에
 * 물체 박스와 화살표 다섯 개가 놓이므로, 팔이 뻗어 있으면 지도를 가린다. 그래서
 * 팔을 뒤로 접어 세운 자세를 이 컴포넌트 안에만 둔다 — 관절 한계 안이고, 여기서
 * 출발해도 조그와 손목 free 드래그가 정상 동작한다.
 *
 * 순서는 base → tip이며(관절 조그 J1~J6 라벨이 이 순서를 그대로 쓴다), 어깨를
 * 수직보다 조금 더 뒤로 넘기고 팔꿈치를 접어 손목이 로봇 몸통 쪽으로 되돌아오게
 * 한다. 손목 각의 합(어깨 + 팔꿈치 + 손목1)은 공용 자세와 같게 유지해 공구가
 * 계속 아래를 보도록 했다.
 */
const HOME_POSE: Record<string, number> = {
  shoulder_pan_joint: 0,
  shoulder_lift_joint: -2.05,
  elbow_joint: 2.3,
  wrist_1_joint: -1.82,
  wrist_2_joint: -Math.PI / 2,
  wrist_3_joint: 0,
};

/** 관절 조그 버튼에 쓸 관절 목록 — HOME_POSE가 곧 움직이는 관절 6개다. */
const JOINT_NAMES = Object.keys(HOME_POSE);

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

/**
 * free 드래그 상태별 안내문 — 드래그 중에는 지금 손이 가 있는 조작이므로
 * 툴바 조그 힌트 대신 이쪽을 보여 준다.
 */
const FREE_DRAG_NOTES: Partial<Record<FreeDragState, string>> = {
  dragging:
    '손목 핸들을 끄는 중 — 목표를 화면(카메라) 평면 위에서 옮기고 매 프레임 IK를 풀어 따라갑니다. 관절 상태는 툴바 조그와 그대로 공유됩니다.',
  blocked:
    '도달 범위 밖입니다 — IK가 수렴하지 못하는 목표는 무시하고 마지막 유효 자세를 유지합니다.',
};

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
  const [freeDrag, setFreeDrag] = useState<FreeDragState>('idle');
  /** 스텝 시뮬레이션의 단계 — 0이면 꺼진 상태(= 완성된 그림). */
  const [simStep, setSimStepState] = useState(0);

  const model = ROBOT_MODELS[DEFAULT_ROBOT];
  const siteBase = useBaseUrl('/');
  const config = useMemo(
    () => ({
      urdfUrl: siteBase + model.urdfUrl,
      packages: Object.fromEntries(
        Object.entries(model.packages).map(([pkg, path]) => [pkg, siteBase + path]),
      ),
      jointValues: HOME_POSE,
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
    setSimStepState(0); // 씬을 새로 만들면 완성 상태에서 다시 시작한다
    void import('./scene').then(({createPipelineScene}) => {
      if (cancelled) {
        return;
      }
      try {
        scene = createPipelineScene({
          container,
          robot: config,
          initialJogMode: jogMode,
          onFreeDrag: setFreeDrag,
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

  /** 시뮬레이션 단계를 옮긴다 — 씬이 트윈으로 그림을 맞추고, 툴바는 표시만 따라간다. */
  const goToStep = (next: number): void => {
    const clamped = Math.max(0, Math.min(PIPELINE_STEP_COUNT, next));
    setSimStepState(clamped);
    sceneRef.current?.setSimStep(clamped);
  };
  /** START — 로봇도 홈 자세로 되돌리고 STEP 1(카메라 + 로봇만)에서 다시 시작한다. */
  const startSim = (): void => {
    sceneRef.current?.resetPose();
    setJogWarning('');
    goToStep(1);
  };
  /** 재생 중에는 씬이 Master를 소유한다 — 마지막 STEP에서 다시 풀린다. */
  const masterLocked = simStep >= 1 && simStep < PIPELINE_STEP_COUNT;
  const activeStep = simStep >= 1 ? PIPELINE_STEPS[simStep - 1] : undefined;

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
  const freeDragNote = FREE_DRAG_NOTES[freeDrag] ?? '';
  const noteText = freeDragNote || jogWarning || activeHint;
  const noteWarn = freeDrag === 'blocked' || (!freeDragNote && jogWarning !== '');

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
        aria-label="Bin picking 파이프라인 개요 3D 씬: World 좌표계(로봇)에서 Camera 좌표계로의 T_cal, 카메라 원점 자리의 Master·Scene 이미지 원점, Scene을 감싸며 겹쳐진 Master와 박스 옆 허공에 떨어진 이동된 Master 원점, Scene 원점(카메라)에서 이동된 Master 원점으로의 T_match, 그리고 최종 답 P world scene. 로봇은 팔을 뒤로 접은 홈 자세로 서 있고, 플랜지에는 석션 그리퍼가 달려 있으며 패드 끝단이 TCP다. 손목에는 마우스로 끌어 팔을 자유롭게 움직일 수 있는 노란 구체 드래그 핸들이 붙어 있다. Master 박스는 마우스로 끌어 옮길 수 있고, 이동된 Master 원점과 picking point가 상대관계를 유지한 채 함께 움직이며 T_match 화살표가 실시간으로 다시 그려진다. 툴바의 START/NEXT/PREV 버튼으로 이 그림을 9단계에 걸쳐 처음부터 쌓아 올리는 시뮬레이션을 재생할 수 있고, 마지막 단계에서는 로봇이 홈 자세에서 Scene을 집는 자세로 이동해 석션 패드 끝단이 Scene 박스 상면에 맞닿는다">
        {status === 'loading' && <div className={styles.overlay}>파이프라인 씬 불러오는 중…</div>}
        {status === 'error' && (
          <div className={`${styles.overlay} ${styles.error}`}>
            3D 뷰어를 불러오지 못했습니다: {errorMessage}
          </div>
        )}
        {status === 'ready' && (
          <div className={styles.hint}>
            손목의 노란 구체 드래그: 팔 자유 이동 ·{' '}
            {masterLocked
              ? 'Master 드래그: 시뮬레이션 중 잠김'
              : 'Master 박스 드래그: 매칭 전/후 비교'}{' '}
            · 빈 공간 드래그: 회전 · 휠: 확대/축소 · 우클릭 드래그: 이동
          </div>
        )}
      </div>
      {/* role="img" 컨테이너 안에 두면 보조기기에 presentational로 숨겨지므로 형제로 둔다. */}
      <FullscreenButton isFullscreen={isFullscreen} onToggle={toggleFullscreen} />
      <div className={styles.toolbar}>
        <div className={styles.toolbarGroup}>
          <span className={styles.toolbarTitle}>시뮬레이션</span>
          <button
            type="button"
            className={`${styles.jogReset} ${styles.simPrimary}`}
            disabled={jogDisabled}
            title="완성된 그림을 지우고 카메라와 로봇만 남긴 STEP 1부터 다시 쌓아 올립니다."
            onClick={startSim}>
            START
          </button>
          <button
            type="button"
            className={styles.jogReset}
            disabled={jogDisabled || simStep <= 1}
            title="이전 단계로 되돌립니다."
            onClick={() => goToStep(simStep - 1)}>
            ◀ PREV
          </button>
          <button
            type="button"
            className={styles.jogReset}
            disabled={jogDisabled || simStep === 0 || simStep >= PIPELINE_STEP_COUNT}
            title="다음 단계로 넘어갑니다."
            onClick={() => goToStep(simStep + 1)}>
            NEXT ▶
          </button>
          <button
            type="button"
            className={styles.jogReset}
            disabled={jogDisabled || simStep === 0}
            title="시뮬레이션을 끄고 완성된 그림으로 돌아갑니다."
            onClick={() => goToStep(0)}>
            완성 상태
          </button>
          <span className={styles.simCounter} aria-live="polite">
            {/* '완성 상태' 버튼과 같은 글자가 나란히 오면 헷갈리므로 재생 여부로 적는다. */}
            {simStep === 0 ? '재생 전' : `${simStep} / ${PIPELINE_STEP_COUNT}`}
          </span>
        </div>
        <p className={styles.simNote}>
          <span className={styles.simBadge}>
            {activeStep ? `STEP ${simStep} · ${activeStep.title}` : '완성'}
          </span>
          {activeStep
            ? activeStep.detail
            : 'START를 누르면 카메라와 로봇만 남기고, NEXT마다 Master · Scene · 화살표가 순서대로 쌓인 뒤 마지막에 로봇이 그 답으로 집으러 갑니다. 재생 중에는 Master 드래그만 잠기고 로봇 조작은 그대로 됩니다.'}
        </p>
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
              ? JOINT_NAMES.map((name, index) => (
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
          <button
            type="button"
            className={styles.jogReset}
            disabled={jogDisabled || masterLocked}
            title={
              masterLocked
                ? '시뮬레이션이 Master의 자리를 정하고 있어 지금은 쓸 수 없습니다.'
                : '드래그로 옮긴 Master를 matching이 끝난 자리(Scene과 겹친 상태)로 되돌립니다.'
            }
            onClick={() => sceneRef.current?.resetMaster()}>
            Master 원위치
          </button>
        </div>
        <p className={`${styles.jogNote}${noteWarn ? ` ${styles.jogWarn}` : ''}`}>{noteText}</p>
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
        팔이 다르게 움직이는 것을 볼 수 있다. 손목의 노란 구체를 마우스로 끌면
        축·스텝을 고르지 않고도 팔을 자유롭게 움직일 수 있다 — 매 프레임 IK를
        풀어 따라오며, 도달 범위를 벗어난 목표는 무시하고 마지막 자세를 유지한다.
        Master 박스를 끌어 Scene에서 떼어 놓으면 matching 전의 모습이 된다 —
        박스·이동된 Master 원점·Master picking point는 matching이 만든 상대관계
        그대로 강체로 함께 움직이고, T_match와 P^camera_master 화살표만 새 위치에
        맞춰 다시 그려진다. Scene 쪽 화살표가 꼼짝하지 않는 것도 함께 보라 —
        움직인 것은 Master의 원점 하나뿐이기 때문이다. 'Master 원위치' 버튼으로
        겹친 상태로 되돌릴 수 있다. 이 완성된 그림이 어떻게 만들어지는지 순서대로
        보고 싶다면 툴바의 START를 누르면 된다 — 카메라와 로봇만 남은 상태에서
        출발해 NEXT마다 Master · Scene · matching · 화살표 넷이 차례로 붙고,
        마지막 단계에서 로봇이 그 답을 실제로 쓴다: 계산된 P^world_scene을 TCP의
        목표로 놓고, 석션 패드가 상면에 평평하게 닿도록 approach 축을 수직 아래로
        세운 뒤 IK로 관절 해를 구해 홈 자세에서 부드럽게 이동한다. PREV로 돌아오면
        홈 자세로 되돌아간다.
        재생 중에는 시뮬레이션이 Master의 자리를 정하므로 Master 드래그만 잠기고,
        로봇 조그와 궤도·확대는 그대로 쓸 수 있다.
      </figcaption>
    </figure>
  );
}
