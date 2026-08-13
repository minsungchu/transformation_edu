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
 * Joint 조그는 여기 없다 — 관절각에 직접 더하고 FK만 다시 돌리면 되므로
 * 목표 pose도 IK도 필요 없다.
 */
import {Transform} from './transform';
import type {Vec3} from './vec3';

/** 조그 기준 좌표계. */
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
