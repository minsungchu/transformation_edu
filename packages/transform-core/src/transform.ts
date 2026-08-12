import type {Mat3} from './mat3';
import {
  MAT3_IDENTITY,
  mat3ApplyToVec3,
  mat3ApproxEquals,
  mat3Multiply,
  mat3Transpose,
  rotationMat3AxisAngle,
  rotationMat3X,
  rotationMat3Y,
  rotationMat3Z,
} from './mat3';
import type {Vec3} from './vec3';
import {addVec3, scaleVec3, vec3ApproxEquals} from './vec3';

/**
 * 4×4 rigid transformation $T^{A}_{B}$.
 *
 * 표기 규칙(ADR-0001): 위첨자 A = 기준(reference) 좌표계, 아래첨자 B = 타겟
 * 좌표계. "A 좌표계에서 본 B 좌표계의 pose"이며, 좌표 표현을
 * $P^{A} = T^{A}_{B} \cdot P^{B}$로 변환한다.
 *
 * 내부적으로는 회전(3×3)과 이동(3)으로 나눠 저장한다. 인스턴스는 불변이며
 * 모든 연산은 새 Transform을 반환한다.
 */
export class Transform {
  readonly rotation: Mat3;
  readonly translation: Vec3;

  constructor(rotation: Mat3 = MAT3_IDENTITY, translation: Vec3 = [0, 0, 0]) {
    this.rotation = rotation;
    this.translation = translation;
  }

  static identity(): Transform {
    return new Transform();
  }

  static fromTranslation(translation: Vec3): Transform {
    return new Transform(MAT3_IDENTITY, translation);
  }

  static fromRotation(rotation: Mat3): Transform {
    return new Transform(rotation);
  }

  static rotationX(angle: number): Transform {
    return new Transform(rotationMat3X(angle));
  }

  static rotationY(angle: number): Transform {
    return new Transform(rotationMat3Y(angle));
  }

  static rotationZ(angle: number): Transform {
    return new Transform(rotationMat3Z(angle));
  }

  static rotationAxisAngle(axis: Vec3, angle: number): Transform {
    return new Transform(rotationMat3AxisAngle(axis, angle));
  }

  /**
   * 합성 — 체인룰. `T_ab.compose(T_bc)`는 $T^{A}_{C} = T^{A}_{B} \cdot T^{B}_{C}$를
   * 반환한다 (인접 인덱스 B 소거).
   */
  compose(other: Transform): Transform {
    return new Transform(
      mat3Multiply(this.rotation, other.rotation),
      addVec3(mat3ApplyToVec3(this.rotation, other.translation), this.translation),
    );
  }

  /** 역변환 — $T^{B}_{A} = (T^{A}_{B})^{-1}$. */
  inverse(): Transform {
    const rt = mat3Transpose(this.rotation);
    return new Transform(rt, scaleVec3(mat3ApplyToVec3(rt, this.translation), -1));
  }

  /**
   * 좌표 표현 변환 — `T_ab.transformPoint(pB)`는 $P^{A} = T^{A}_{B} \cdot P^{B}$를
   * 반환한다.
   */
  transformPoint(point: Vec3): Vec3 {
    return addVec3(mat3ApplyToVec3(this.rotation, point), this.translation);
  }

  /** 방향 벡터 변환 (이동 성분 무시). */
  transformDirection(direction: Vec3): Vec3 {
    return mat3ApplyToVec3(this.rotation, direction);
  }

  /** 행 우선(row-major) 4×4 행렬 (길이 16 배열). */
  toMatrix4(): number[] {
    const r = this.rotation;
    const t = this.translation;
    return [
      r[0], r[1], r[2], t[0],
      r[3], r[4], r[5], t[1],
      r[6], r[7], r[8], t[2],
      0, 0, 0, 1,
    ];
  }

  approxEquals(other: Transform, eps = 1e-9): boolean {
    return (
      mat3ApproxEquals(this.rotation, other.rotation, eps) &&
      vec3ApproxEquals(this.translation, other.translation, eps)
    );
  }
}
