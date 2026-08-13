/**
 * 조그(jog) 목표 pose 계산 — 티칭 펜던트의 "기준 좌표계" 개념을 수식으로.
 *
 * 같은 `+X` 버튼이라도 어떤 좌표계를 기준으로 삼느냐에 따라 로봇은 전혀 다르게
 * 움직인다. 차이는 델타를 **어느 쪽에 곱하느냐** 하나뿐이다
 * (ADR-0001 표기: 위첨자 = 기준 좌표계, 아래첨자 = 타겟):
 *
 * - **Base 기준 병진** — 델타를 base 좌표계에서 읽으므로 왼쪽에 곱한다(좌곱):
 *   $T^{base}_{tool'} = \Delta \cdot T^{base}_{tool}$.
 *   TCP가 어떤 자세든 World의 +X 방향으로 간다.
 * - **Base 기준 회전** — 축 방향은 World이되 회전 중심은 base 원점이 아니라
 *   제어점(TCP) 위치여야 한다. 그래서 그 점 둘레로 감싼다:
 *   $T' = \mathrm{Tr}(t)\,\Delta\,\mathrm{Tr}(-t)\,T$ ($t$ = 현재 TCP 위치).
 *   좌곱만 하면 TCP가 base 원점을 중심으로 크게 휘어 이상하게 움직인다.
 * - **Tool 기준** — 델타를 TCP 자신의 좌표계에서 읽으므로 오른쪽에 곱한다(우곱):
 *   $T^{base}_{tool'} = T^{base}_{tool} \cdot \Delta$.
 *   TCP가 기울어져 있으면 그 기울어진 +X 방향으로 가고, 회전은 자연히 TCP를 중심으로 돈다.
 *
 * 실제 로봇에는 여기에 한 겹이 더 붙는다 — 그리퍼다. IK가 푸는 체인의 끝점은
 * **플랜지**(6축 원점)인데 사람이 조그하고 싶은 점은 보통 **TCP**(그리퍼 끝단)라,
 * 둘 사이의 고정 오프셋 $T^{flange}_{tcp}$를 누가 처리해 주어야 한다. 그 변환이
 * 이 파일 아래쪽의 `jogTargetFlangePose`다.
 *
 * Joint 조그는 여기 없다 — 관절각에 직접 더하고 FK만 다시 돌리면 되므로
 * 목표 pose도 IK도 필요 없다.
 */
import {Transform} from './transform';
import type {Vec3} from './vec3';

/**
 * 조그 기준 좌표계 — 델타를 **어느 쪽에 곱하느냐**를 고르는 스위치.
 *
 * - `'base'` — 좌곱(World 축 기준). 회전은 제어점 둘레로 감싼다.
 * - `'tool'` — 우곱(제어 대상 프레임 자신의 축 기준). 회전중심은 그 프레임의 원점.
 *
 * `'tool'`은 "TCP"만이 아니라 넘긴 pose가 무엇이든 **그 프레임 자신**을 뜻한다 —
 * flange pose를 넘기면 flange 축 기준 조그가 된다 (`jogTargetFlangePose` 참고).
 */
export type JogReferenceFrame = 'base' | 'tool';

export interface CartesianJogStep {
  /** 병진(m) 인지 회전(rad) 인지. */
  kind: 'translate' | 'rotate';
  /** 기준 좌표계에서 본 축 — 보통 단위 기저 벡터 [1,0,0] 등. */
  axis: Vec3;
  /** 병진량(m) 또는 회전각(rad). 음수면 반대 방향. */
  amount: number;
}

/** 조그 스텝 하나를 나타내는 델타 변환 $\Delta$ (기준 좌표계에서 읽은 값). */
export function jogDelta(step: CartesianJogStep): Transform {
  if (step.kind === 'translate') {
    return Transform.fromTranslation([
      step.axis[0] * step.amount,
      step.axis[1] * step.amount,
      step.axis[2] * step.amount,
    ]);
  }
  return Transform.rotationAxisAngle(step.axis, step.amount);
}

/**
 * 현재 TCP pose $T^{base}_{tool}$에 조그 스텝을 적용한 목표 pose.
 * Base 기준은 좌곱, Tool 기준은 우곱 — 이 한 줄이 두 모드의 전부다.
 */
export function cartesianJogTarget(
  current: Transform,
  step: CartesianJogStep,
  frame: JogReferenceFrame,
): Transform {
  const delta = jogDelta(step);
  // Tool 기준 — 우곱. 병진·회전 모두 TCP 자신을 기준으로 (회전은 TCP 중심).
  if (frame === 'tool') {
    return current.compose(delta);
  }
  // Base 기준 병진 — 좌곱이면 World 축 방향으로 곧장 간다.
  if (step.kind === 'translate') {
    return delta.compose(current);
  }
  // Base 기준 회전 — 축은 World이되 회전 중심은 base 원점이 아니라 현재 TCP 위치.
  // 그 점 둘레로 감싸지 않고 좌곱만 하면 TCP가 base를 중심으로 크게 휜다.
  const t = current.translation;
  const toPivot = Transform.fromTranslation(t);
  const fromPivot = Transform.fromTranslation([-t[0], -t[1], -t[2]]);
  return toPivot.compose(delta).compose(fromPivot).compose(current);
}

// ── tool 오프셋: flange와 TCP 사이의 한 겹 ────────────────────────────

/**
 * 조그의 기준 좌표계 **세 가지** — 축 방향과 제어점(=회전중심)을 함께 고른다.
 *
 * - `'base'` — 축은 World, 제어점은 TCP. 어떤 자세든 World 축 방향으로 간다.
 * - `'flange'` — 축·회전중심 모두 플랜지(6축 원점).
 * - `'tcp'` — 축·회전중심 모두 TCP(그리퍼 끝단).
 *
 * `'flange'`와 `'tcp'`는 축 방향이 같아도(오프셋에 회전이 없으면) **회전중심**이
 * 그리퍼 길이만큼 떨어져 있어 회전 조그가 눈에 띄게 다르게 움직인다.
 */
export type JogControlFrame = 'base' | 'flange' | 'tcp';

/** 체인룰로 TCP pose를 얻는다 — $T^{base}_{tcp} = T^{base}_{flange} \cdot T^{flange}_{tcp}$. */
export function tcpPoseFromFlange(flange: Transform, toolOffset: Transform): Transform {
  return flange.compose(toolOffset);
}

/**
 * 그 역 — $T^{base}_{flange} = T^{base}_{tcp} \cdot (T^{flange}_{tcp})^{-1}$.
 * IK는 체인 끝점(플랜지)만 풀 수 있으므로, TCP 목표는 이걸 거쳐야 IK에 들어간다.
 */
export function flangePoseFromTcp(tcp: Transform, toolOffset: Transform): Transform {
  return tcp.compose(toolOffset.inverse());
}

export interface ToolJogRequest {
  /** 현재 플랜지 pose $T^{base}_{flange}$ — IK 체인의 끝점이다. */
  flange: Transform;
  /** flange → TCP 고정 오프셋 $T^{flange}_{tcp}$ (그리퍼 기하). */
  toolOffset: Transform;
  step: CartesianJogStep;
  frame: JogControlFrame;
}

/**
 * 조그 스텝 하나를 적용한 뒤 **IK에 넣을 목표 플랜지 pose**.
 *
 * 세 모드가 갈리는 지점은 "델타를 어느 pose에 적용하는가"뿐이다:
 *
 * - `'flange'` — 플랜지 pose에 우곱하고 그대로 돌려준다 (오프셋은 등장하지 않는다).
 * - `'tcp'` / `'base'` — TCP pose를 만들어 거기에 델타를 적용한 뒤,
 *   $T_{tcp'} \cdot (T^{flange}_{tcp})^{-1}$로 플랜지 목표로 되돌린다.
 *   그리퍼 끝단을 제어하고 싶다는 뜻이므로 회전중심도 자연히 TCP가 된다.
 */
export function jogTargetFlangePose({
  flange,
  toolOffset,
  step,
  frame,
}: ToolJogRequest): Transform {
  if (frame === 'flange') {
    return cartesianJogTarget(flange, step, 'tool');
  }
  const tcp = tcpPoseFromFlange(flange, toolOffset);
  // 'tcp'는 TCP 자신의 축(우곱), 'base'는 World 축(좌곱) — 제어점은 둘 다 TCP.
  const tcpTarget = cartesianJogTarget(tcp, step, frame === 'tcp' ? 'tool' : 'base');
  return flangePoseFromTcp(tcpTarget, toolOffset);
}
