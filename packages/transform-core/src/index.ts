/**
 * transform-core — 순수 TypeScript 좌표계 변환 라이브러리.
 *
 * 교재의 모든 위젯이 올라가는 수학·상태 로직 기반이며, Three.js/React
 * 의존성이 없다. 표기 규칙은 ADR-0001: $T^{A}_{B}$에서 위첨자 A = 기준
 * 좌표계, 아래첨자 B = 타겟 좌표계.
 */
export type {Vec3} from './vec3';
export {
  addVec3,
  crossVec3,
  dotVec3,
  normVec3,
  normalizeVec3,
  scaleVec3,
  subVec3,
  vec3ApproxEquals,
} from './vec3';
export type {Mat3} from './mat3';
export {
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
export {Transform} from './transform';
export type {EulerAngles, EulerOrder} from './euler';
export {eulerToRotation, rotationToEuler} from './euler';
export {FrameGraph} from './frame-graph';
export type {UrdfJointSpec} from './fk';
export {KinematicChain, jointTransform, urdfRpyToRotation} from './fk';
