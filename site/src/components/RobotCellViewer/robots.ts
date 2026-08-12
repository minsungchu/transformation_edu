/**
 * 로봇 모델 레지스트리 — URDF 교체는 여기서(또는 위젯의 robot prop으로 커스텀
 * config를 넘겨서) 한다. 렌더링 코드는 이 config만 읽으므로, 다른 브랜드의
 * URDF로 바꾸려면 static/urdf/에 파일을 두고 엔트리를 추가하면 된다.
 */
export interface RobotModelConfig {
  /** 표시용 이름. */
  name: string;
  /** 사이트 baseUrl 기준 상대 경로의 URDF 파일. */
  urdfUrl: string;
  /**
   * URDF 안의 `package://<pkg>/...` 참조를 풀기 위한 패키지 → 경로 매핑
   * (사이트 baseUrl 기준 상대 경로).
   */
  packages: Record<string, string>;
  /** 보기 좋은 초기 관절 자세 (joint 이름 → radians). */
  restPose: Record<string, number>;
}

export const ROBOT_MODELS = {
  ur5e: {
    name: 'Universal Robots UR5e',
    urdfUrl: 'urdf/ur5e.urdf',
    packages: {ur_description: 'urdf/ur_description'},
    restPose: {
      shoulder_pan_joint: 0,
      shoulder_lift_joint: -1.2,
      elbow_joint: 1.35,
      wrist_1_joint: -1.72,
      wrist_2_joint: -Math.PI / 2,
      wrist_3_joint: 0,
    },
  },
} satisfies Record<string, RobotModelConfig>;

export type RobotModelId = keyof typeof ROBOT_MODELS;

export const DEFAULT_ROBOT: RobotModelId = 'ur5e';
