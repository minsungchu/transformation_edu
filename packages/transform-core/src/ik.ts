/**
 * 수치 역기구학(IK) — damped least squares(DLS, Levenberg-Marquardt).
 *
 * FK가 "관절각 → TCP pose"라면 IK는 그 반대다. 6-DOF 직렬 팔에는 닫힌 해가
 * 있지만 로봇마다 다르므로, 이 모듈은 어떤 `KinematicChain`에도 쓸 수 있는
 * 수치 해법을 쓴다. 현재 관절각을 seed로 두고 작은 델타만 푸는 조그(jog)
 * 용도가 주 대상이라 수렴이 빠르고 안정적이다.
 *
 * 알고리즘 한 걸음:
 *
 * 1. FK로 현재 pose를 구하고, 목표 pose와의 오차를 6-벡터
 *    $e = [\Delta p;\ \Delta \omega]$로 만든다 (위치 차 + 자세 차의 회전 벡터).
 * 2. 기하 야코비안 $J$ (6 × n)를 base 좌표계에서 세운다.
 * 3. $\delta\theta = J^{T}(JJ^{T} + \lambda^{2}I)^{-1} e$ — 감쇠항
 *    $\lambda$가 싱귤래리티 근처에서 해가 발산하는 것을 막는다.
 * 4. 관절각을 갱신하고 1로 돌아간다.
 *
 * 수렴하지 못하면 예외를 던지지 않고 `converged: false`와 **seed 그대로의**
 * 관절각을 돌려준다. 호출부(조그 UI)는 결과를 그냥 적용하기만 하면
 * "실패한 스텝은 무시"가 된다.
 */
import {mat3Multiply, mat3Transpose, rotationMat3ToAxisAngle} from './mat3';
import type {KinematicChain, UrdfJointSpec} from './fk';
import type {Transform} from './transform';
import type {Vec3} from './vec3';
import {crossVec3, normVec3, scaleVec3, subVec3} from './vec3';

export interface IkOptions {
  /** 최대 반복 횟수 — 넘으면 실패로 끝난다 (무한루프 방지). 기본 100. */
  maxIterations?: number;
  /** 위치 수렴 허용오차 (m). 기본 1e-5. */
  positionTolerance?: number;
  /** 자세 수렴 허용오차 (rad). 기본 1e-5. */
  orientationTolerance?: number;
  /**
   * DLS 감쇠 계수 $\lambda$. 크면 싱귤래리티에 강하지만 느리고, 작으면 빠르지만
   * 발산하기 쉽다. 기본 0.05.
   */
  damping?: number;
  /** 한 반복에서 쫓아가는 위치 오차의 상한 (m). 기본 0.05. */
  maxTranslationStep?: number;
  /** 한 반복에서 쫓아가는 자세 오차의 상한 (rad). 기본 0.2. */
  maxRotationStep?: number;
  /** 한 반복의 관절 변위 노름 상한 (rad·m 혼합). 기본 0.5. */
  maxJointStep?: number;
}

export interface IkResult {
  /** 허용오차 안에 들어왔는지. */
  converged: boolean;
  /**
   * 관절 이름 → 값. **수렴 실패 시에는 seed 그대로**라서, 호출부는 성공/실패를
   * 따지지 않고 적용해도 자세가 튀지 않는다.
   */
  values: Record<string, number>;
  /** 실제로 돈 반복 횟수. */
  iterations: number;
  /** `values`에서의 잔차 — 위치 (m). */
  positionError: number;
  /** `values`에서의 잔차 — 자세 (rad). */
  orientationError: number;
}

/** 목표 pose 대비 현재 pose의 오차 — 위치 차 + 자세 차(회전 벡터). */
function poseError(current: Transform, target: Transform): {linear: Vec3; angular: Vec3} {
  return {
    linear: subVec3(target.translation, current.translation),
    angular: rotationMat3ToAxisAngle(
      mat3Multiply(target.rotation, mat3Transpose(current.rotation)),
    ),
  };
}

/** 노름이 limit을 넘으면 방향은 유지한 채 limit으로 줄인다. */
function clampNorm(v: Vec3, limit: number): Vec3 {
  const n = normVec3(v);
  return n > limit ? scaleVec3(v, limit / n) : v;
}

/** 조인트의 회전/병진 축을 base 좌표계에서 본 단위 벡터. */
function axisInBase(spec: UrdfJointSpec, childPose: Transform): Vec3 {
  const axis = spec.axis ?? [1, 0, 0];
  const n = normVec3(axis);
  if (n === 0) {
    throw new Error(`조인트 ${spec.name}의 축이 영벡터입니다`);
  }
  return childPose.transformDirection(scaleVec3(axis, 1 / n));
}

/**
 * 기하 야코비안 $J$ (6 × n, base 좌표계) — 행 0~2가 위치, 3~5가 자세.
 * revolute는 $J_v = z_i \times (p_{tip} - p_i)$, prismatic은 $J_v = z_i$다.
 */
function chainJacobian(
  movable: readonly UrdfJointSpec[],
  poses: Map<string, Transform>,
  tipLink: string,
): number[][] {
  const tip = poses.get(tipLink)!.translation;
  const rows: number[][] = [[], [], [], [], [], []];
  for (const spec of movable) {
    const childPose = poses.get(spec.child)!;
    const axis = axisInBase(spec, childPose);
    let linear: Vec3;
    let angular: Vec3;
    if (spec.type === 'prismatic') {
      linear = axis;
      angular = [0, 0, 0];
    } else {
      linear = crossVec3(axis, subVec3(tip, childPose.translation));
      angular = axis;
    }
    rows[0]!.push(linear[0]);
    rows[1]!.push(linear[1]);
    rows[2]!.push(linear[2]);
    rows[3]!.push(angular[0]);
    rows[4]!.push(angular[1]);
    rows[5]!.push(angular[2]);
  }
  return rows;
}

/**
 * 대칭 양의 정부호 6×6 선형계 $Ay = b$를 부분 피벗 가우스 소거로 푼다.
 * 감쇠항 덕분에 특이해질 일이 없지만, 수치적으로 무너지면 null을 돌려준다.
 */
function solve6(a: number[][], b: number[]): number[] | null {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]!]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(m[r]![col]!) > Math.abs(m[pivot]![col]!)) {
        pivot = r;
      }
    }
    if (Math.abs(m[pivot]![col]!) < 1e-12) {
      return null;
    }
    [m[col], m[pivot]] = [m[pivot]!, m[col]!];
    const pivotRow = m[col]!;
    for (let r = 0; r < n; r++) {
      if (r === col) {
        continue;
      }
      const factor = m[r]![col]! / pivotRow[col]!;
      if (factor === 0) {
        continue;
      }
      for (let c = col; c <= n; c++) {
        m[r]![c] = m[r]![c]! - factor * pivotRow[c]!;
      }
    }
  }
  const y = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    y[i] = m[i]![n]! / m[i]![i]!;
    if (!Number.isFinite(y[i]!)) {
      return null;
    }
  }
  return y;
}

/** UrdfJointSpec의 limit이 있으면 그 범위로 자른다. */
function clampToLimit(spec: UrdfJointSpec, value: number): number {
  const limit = spec.limit;
  if (!limit) {
    return value;
  }
  return Math.min(limit.upper, Math.max(limit.lower, value));
}

/**
 * DLS 수치 IK — 목표 $T^{base}_{tip}$에 도달하는 관절값을 찾는다.
 *
 * `seed`는 탐색 시작점이자 실패 시 되돌아갈 자세다. 조그처럼 현재 자세에서
 * 작은 델타만 움직이는 경우 현재 관절각을 그대로 넘기면 된다 — 여러 해
 * 중 현재와 가장 가까운 것으로 수렴하므로 팔이 갑자기 뒤집히지 않는다.
 *
 * 실패(반복 초과 · 싱귤래리티 · 도달 불가)해도 throw하지 않는다.
 */
export function solveIk(
  chain: KinematicChain,
  target: Transform,
  seed: Record<string, number> = {},
  options: IkOptions = {},
): IkResult {
  const {
    maxIterations = 100,
    positionTolerance = 1e-5,
    orientationTolerance = 1e-5,
    damping = 0.05,
    maxTranslationStep = 0.05,
    maxRotationStep = 0.2,
    maxJointStep = 0.5,
  } = options;

  const movable = chain.joints.filter((j) => j.type !== 'fixed');
  const seedValues: Record<string, number> = {};
  for (const spec of movable) {
    seedValues[spec.name] = clampToLimit(spec, seed[spec.name] ?? 0);
  }

  const values = {...seedValues};
  const lambdaSquared = damping * damping;
  let iterations = 0;

  const fail = (): IkResult => {
    const residual = poseError(chain.fk(seedValues), target);
    return {
      converged: false,
      values: seedValues,
      iterations,
      positionError: normVec3(residual.linear),
      orientationError: normVec3(residual.angular),
    };
  };

  if (movable.length === 0) {
    return fail();
  }

  for (; iterations <= maxIterations; iterations++) {
    const poses = chain.linkPoses(values);
    const error = poseError(poses.get(chain.tipLink)!, target);
    const positionError = normVec3(error.linear);
    const orientationError = normVec3(error.angular);
    if (positionError <= positionTolerance && orientationError <= orientationTolerance) {
      return {converged: true, values, iterations, positionError, orientationError};
    }
    if (iterations === maxIterations) {
      break;
    }

    // 한 걸음에 쫓아갈 오차를 잘라 선형화가 유효한 범위 안에 머무르게 한다.
    const stepLinear = clampNorm(error.linear, maxTranslationStep);
    const stepAngular = clampNorm(error.angular, maxRotationStep);
    const e = [...stepLinear, ...stepAngular];

    const j = chainJacobian(movable, poses, chain.tipLink);
    // A = J·Jᵀ + λ²I (6×6)
    const a: number[][] = [];
    for (let r = 0; r < 6; r++) {
      const row = new Array<number>(6);
      for (let c = 0; c < 6; c++) {
        let sum = 0;
        for (let k = 0; k < movable.length; k++) {
          sum += j[r]![k]! * j[c]![k]!;
        }
        row[c] = r === c ? sum + lambdaSquared : sum;
      }
      a.push(row);
    }
    const y = solve6(a, e);
    if (!y) {
      return fail();
    }

    // δθ = Jᵀ·y
    const delta = new Array<number>(movable.length);
    let deltaNorm = 0;
    for (let k = 0; k < movable.length; k++) {
      let sum = 0;
      for (let r = 0; r < 6; r++) {
        sum += j[r]![k]! * y[r]!;
      }
      if (!Number.isFinite(sum)) {
        return fail();
      }
      delta[k] = sum;
      deltaNorm += sum * sum;
    }
    deltaNorm = Math.sqrt(deltaNorm);
    const scale = deltaNorm > maxJointStep ? maxJointStep / deltaNorm : 1;
    for (let k = 0; k < movable.length; k++) {
      const spec = movable[k]!;
      values[spec.name] = clampToLimit(spec, values[spec.name]! + delta[k]! * scale);
    }
  }

  return fail();
}
