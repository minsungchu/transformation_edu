/**
 * 로봇 하나만 있는 3D 씬 (브라우저 전용) — 1단계 "로봇 용어·좌표계"와 "조깅 연습"이
 * 함께 쓴다.
 *
 * World 좌표계 원점 = 로봇 Base(CONTEXT.md)이므로 로봇을 원점에 그대로 세운다.
 * 플랜지(UR의 `tool0` — 6축 원점, +z가 approach 축)에 석션 그리퍼를 달아
 * Flange와 TCP가 그리퍼 길이만큼 떨어져 보이게 한다.
 *
 * 화면에 놓이는 좌표계 네 개(축 토글 단위):
 *
 * - **World(Base)** — 원점의 큰 RGB 축.
 * - **Flange** — 플랜지 링크에 붙은 축. 로봇과 함께 움직인다.
 * - **TCP** — 같은 링크에 붙지만 원점이 그리퍼 끝단(z = TOOL_LENGTH)으로 밀려 있다.
 * - **User** — 사용자가 정의하는 좌표계 $T^{world}_{user}$. 조그 기준으로 쓴다.
 *
 * 조그는 0단계 뷰어와 같은 경로다 — 관절값 → FK로 플랜지 pose → 기준 좌표계에서
 * 델타 적용(transform-core `jogTargetFlangePose`) → 목표 플랜지 pose → IK.
 * Joint 조그는 관절값에 더하고 FK만 다시 돌린다. 수학은 전부 transform-core에 있다.
 */
import * as THREE from 'three';
import {CSS2DObject} from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import URDFLoader from 'urdf-loader';
import type {URDFRobot} from 'urdf-loader';
import type {CartesianJogStep, JogControlFrame, KinematicChain} from 'transform-core';
import {Transform, jogTargetFlangePose, solveIk, tcpPoseFromFlange} from 'transform-core';
import {T_FLANGE_TCP, TOOL_LENGTH, buildSuctionGripper} from '../RobotCellViewer/gripper';
import type {SceneRobotConfig} from '../RobotCellViewer/scene';
import {urdfSerialChain} from '../RobotCellViewer/urdf-chain';
import {
  applyTransform,
  buildFrameAxes,
  buildTextLabel,
  createViewerShell,
} from '../RobotCellViewer/viewer-core';

/** 이 뷰어가 다루는 좌표계 — 축 토글 단위. */
export type JogFrameName = 'world' | 'flange' | 'tcp' | 'user';

export const JOG_FRAME_LABELS: Record<JogFrameName, string> = {
  world: 'World (Base)',
  flange: 'Flange',
  tcp: 'TCP (Tool)',
  user: 'User',
};

export const ALL_JOG_FRAMES: readonly JogFrameName[] = ['world', 'flange', 'tcp', 'user'];

/** 조그 기준 — Cartesian 네 가지(Base/Flange/TCP/User) + 관절 직접 구동. */
export type JogMode = JogControlFrame | 'joint';

/** 조그 모드가 축을 빌려 쓰는 좌표계 — 그 축을 씬에서 강조한다. */
const MODE_FRAME: Record<Exclude<JogMode, 'joint'>, JogFrameName> = {
  base: 'world',
  flange: 'flange',
  tcp: 'tcp',
  user: 'user',
};

export interface RobotJogSceneOptions {
  container: HTMLElement;
  robot: SceneRobotConfig;
  initialFrames?: readonly JogFrameName[];
  initialJogMode?: JogMode;
  /** User 좌표계 초기 pose $T^{world}_{user}$. */
  initialUserFrame?: Transform;
  onReady?: () => void;
  onError?: (error: unknown) => void;
}

export interface RobotJogScene {
  setFrameVisible: (frame: JogFrameName, visible: boolean) => void;
  /** Cartesian 모드면 그 기준 좌표계 축을 토글과 무관하게 켜고 강조한다. */
  setJogMode: (mode: JogMode) => void;
  setUserFrame: (pose: Transform) => void;
  /** 현재 TCP pose $T^{world}_{tcp}$ — 로봇이 아직 없으면 null. */
  tcpPose: () => Transform | null;
  /** IK가 수렴하지 못하면 자세를 그대로 두고 false. */
  jogCartesian: (frame: JogControlFrame, step: CartesianJogStep) => boolean;
  /** 관절 한계에 걸려 움직이지 못하면 false. */
  jogJoint: (jointName: string, delta: number) => boolean;
  resetPose: () => void;
  dispose: () => void;
}

const AXES_LENGTH: Record<JogFrameName, number> = {
  world: 0.36,
  flange: 0.2,
  tcp: 0.15,
  user: 0.26,
};
const LABEL_COLOR: Record<JogFrameName, string> = {
  world: '#c8ced8',
  flange: '#9fd3ff',
  tcp: '#ffd27f',
  user: '#c9b6ff',
};
/** 조그 기준 강조 라벨 색 — 0단계 뷰어와 같은 노랑. */
const JOG_REF_COLOR = '#f5c451';
/** 강조되지 않은 축의 밝기 (Cartesian 조그 모드에서). */
const DIMMED = 0.35;

function setAxesOpacity(group: THREE.Group, opacity: number): void {
  for (const child of group.children) {
    if (child instanceof THREE.ArrowHelper) {
      for (const material of [child.line.material, child.cone.material] as THREE.Material[]) {
        material.transparent = true;
        material.opacity = opacity;
      }
    }
  }
}

interface FrameEntry {
  group: THREE.Group;
  axes: THREE.Group;
  /** 토글 상태 — 조그 기준 강조로 잠시 켜져도 이 값은 그대로다. */
  wanted: boolean;
  /** "조그 기준" 라벨 — 모드가 이 좌표계를 쓸 때만 보인다. */
  refLabel: CSS2DObject;
}

function buildFrame(name: JogFrameName, labelOffset: readonly [number, number, number]): FrameEntry {
  const group = new THREE.Group();
  const axes = buildFrameAxes(AXES_LENGTH[name]);
  group.add(axes);
  const nameLabel = new CSS2DObject(buildTextLabel(JOG_FRAME_LABELS[name], LABEL_COLOR[name]));
  nameLabel.position.set(labelOffset[0], labelOffset[1], labelOffset[2]);
  group.add(nameLabel);
  const refLabel = new CSS2DObject(buildTextLabel('조그 기준', JOG_REF_COLOR));
  refLabel.position.set(labelOffset[0], labelOffset[1], labelOffset[2] + 0.07);
  refLabel.visible = false;
  group.add(refLabel);
  return {group, axes, wanted: false, refLabel};
}

export function createRobotJogScene(options: RobotJogSceneOptions): RobotJogScene {
  const {
    container,
    robot: robotConfig,
    initialFrames = [],
    initialJogMode = 'joint',
    initialUserFrame = Transform.identity(),
    onReady,
    onError,
  } = options;

  const shell = createViewerShell({
    container,
    cameraPosition: [1.6, 1.35, 2.1],
    target: [0.1, 0.4, 0],
  });
  const {worldRoot} = shell;

  // ── 좌표계 네 개 ─────────────────────────────────────────────────
  const frames: Record<JogFrameName, FrameEntry> = {
    world: buildFrame('world', [0, 0, AXES_LENGTH.world + 0.06]),
    // 플랜지·TCP 라벨은 approach 축 반대쪽(손목 뒤)으로 빼서 그리퍼와 겹치지 않게 한다.
    flange: buildFrame('flange', [0, 0, -0.1]),
    tcp: buildFrame('tcp', [0.06, 0, 0.08]),
    user: buildFrame('user', [0, 0, AXES_LENGTH.user + 0.05]),
  };
  worldRoot.add(frames.world.group, frames.user.group);
  frames.tcp.group.position.z = TOOL_LENGTH;
  applyTransform(frames.user.group, initialUserFrame);
  for (const name of ALL_JOG_FRAMES) {
    frames[name].wanted = initialFrames.includes(name);
  }

  let jogMode: JogMode = initialJogMode;
  const applyVisibility = (): void => {
    const active = jogMode === 'joint' ? null : MODE_FRAME[jogMode];
    for (const name of ALL_JOG_FRAMES) {
      const entry = frames[name];
      const isRef = active === name;
      entry.group.visible = entry.wanted || isRef;
      entry.refLabel.visible = isRef;
      // Cartesian 모드에서는 기준 좌표계만 또렷하게, 나머지는 살짝 흐리게.
      setAxesOpacity(entry.axes, active === null || isRef ? 1 : DIMMED);
    }
  };
  applyVisibility();

  // ── 로봇 + 조그 상태 ─────────────────────────────────────────────
  let disposed = false;
  let robot: URDFRobot | null = null;
  /** IK를 푸는 순수 수학 체인 — 렌더링용 URDF 씬 그래프와 같은 기하다. */
  let chain: KinematicChain | null = null;
  const jointValues: Record<string, number> = {...robotConfig.jointValues};

  /** 관절값을 씬에 반영하고, limit으로 잘린 실제 값을 되읽어 상태를 맞춘다. */
  const applyJointValues = (): void => {
    if (!robot) {
      return;
    }
    for (const [name, value] of Object.entries(jointValues)) {
      robot.setJointValue(name, value);
      const applied = robot.joints[name]?.angle;
      if (typeof applied === 'number') {
        jointValues[name] = applied;
      }
    }
  };

  const manager = new THREE.LoadingManager(
    () => {
      if (!disposed) {
        onReady?.();
      }
    },
    undefined,
    (url) => {
      if (!disposed) {
        onError?.(new Error(`리소스를 불러오지 못했습니다: ${url}`));
      }
    },
  );
  const loader = new URDFLoader(manager);
  loader.packages = robotConfig.packages;
  loader.load(robotConfig.urdfUrl, (loadedRobot) => {
    if (disposed) {
      return;
    }
    robot = loadedRobot;
    applyJointValues();
    worldRoot.add(robot); // World 원점 = Robot Base — 오프셋 없음

    // frameLinks.tool(UR의 `tool0`)은 플랜지와 원점이 같고 +z가 approach 축인
    // ROS-Industrial 표준 프레임 — 곧 플랜지(6축 원점) 프레임이다.
    const flangeLink = robot.links[robotConfig.frameLinks.tool];
    if (flangeLink) {
      flangeLink.add(buildSuctionGripper());
      flangeLink.add(frames.flange.group);
      flangeLink.add(frames.tcp.group);
    }
    try {
      chain = urdfSerialChain(robot, robotConfig.frameLinks.tool);
    } catch (error) {
      // 체인을 못 세우면 Cartesian 조그만 비활성이고 나머지 씬은 정상이다.
      console.warn('IK 체인을 만들지 못해 Cartesian 조그를 끕니다:', error);
    }
    applyVisibility();
  });

  let userFrame = initialUserFrame;

  return {
    setFrameVisible: (frame, visible) => {
      frames[frame].wanted = visible;
      applyVisibility();
    },
    setJogMode: (mode) => {
      jogMode = mode;
      applyVisibility();
    },
    setUserFrame: (pose) => {
      userFrame = pose;
      applyTransform(frames.user.group, pose);
    },
    tcpPose: () => (chain ? tcpPoseFromFlange(chain.fk(jointValues), T_FLANGE_TCP) : null),
    jogCartesian: (frame, step) => {
      if (!robot || !chain) {
        return false;
      }
      const target = jogTargetFlangePose({
        flange: chain.fk(jointValues),
        toolOffset: T_FLANGE_TCP,
        step,
        frame,
        userFrame,
      });
      const result = solveIk(chain, target, jointValues, {maxIterations: 80});
      if (!result.converged) {
        return false; // 싱귤래리티·도달 불가 — 이 스텝은 조용히 무시한다
      }
      Object.assign(jointValues, result.values);
      applyJointValues();
      return true;
    },
    jogJoint: (jointName, delta) => {
      if (!robot || !(jointName in jointValues)) {
        return false;
      }
      const before = jointValues[jointName]!;
      jointValues[jointName] = before + delta;
      applyJointValues(); // limit을 넘으면 여기서 잘려 되읽힌다
      return Math.abs(jointValues[jointName]! - before) > 1e-9;
    },
    resetPose: () => {
      Object.assign(jointValues, robotConfig.jointValues);
      applyJointValues();
    },
    dispose: () => {
      disposed = true;
      shell.dispose();
    },
  };
}
