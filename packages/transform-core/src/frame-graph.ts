import {Transform} from './transform';

interface Edge {
  /** 이 edge를 건너면 T^{현재 프레임}_{to}를 오른쪽에 곱한다. */
  to: string;
  transform: Transform;
}

/**
 * 좌표계(frame) 그래프.
 *
 * 좌표계 쌍 사이의 transformation을 등록해 두면, 등록된 관계들을 체인룰
 * ($T^{A}_{C} = T^{A}_{B} \cdot T^{B}_{C}$)로 이어 붙여 임의의 두 좌표계
 * 사이의 $T^{A}_{B}$를 조회할 수 있다. 등록된 관계들이 서로 모순되지 않는 한
 * 조회 결과는 그래프 안의 경로 선택과 무관하게 같다.
 */
export class FrameGraph {
  private readonly adjacency = new Map<string, Edge[]>();

  /** 좌표계를 등록한다. 이미 있으면 아무 일도 하지 않는다. */
  addFrame(name: string): void {
    if (!this.adjacency.has(name)) {
      this.adjacency.set(name, []);
    }
  }

  /**
   * $T^{ref}_{target}$을 등록한다. 양방향으로 조회 가능하다
   * (역방향은 자동으로 $T^{target}_{ref} = (T^{ref}_{target})^{-1}$).
   */
  setTransform(ref: string, target: string, transform: Transform): void {
    if (ref === target) {
      throw new Error(`같은 좌표계 사이의 transformation은 등록할 수 없습니다: ${ref}`);
    }
    this.addFrame(ref);
    this.addFrame(target);
    this.adjacency.get(ref)!.push({to: target, transform});
    this.adjacency.get(target)!.push({to: ref, transform: transform.inverse()});
  }

  frames(): string[] {
    return [...this.adjacency.keys()];
  }

  hasFrame(name: string): boolean {
    return this.adjacency.has(name);
  }

  /** ref에서 target까지 등록된 관계로 도달할 수 있는가. */
  hasPath(ref: string, target: string): boolean {
    return this.findPath(ref, target) !== null;
  }

  /**
   * $T^{ref}_{target}$ 조회. 체인룰로 경로상의 transformation을 합성한다.
   * 도달할 수 없으면 throw.
   */
  getTransform(ref: string, target: string): Transform {
    const path = this.findPath(ref, target);
    if (path === null) {
      throw new Error(`좌표계 경로를 찾을 수 없습니다: ${ref} → ${target}`);
    }
    let t = Transform.identity();
    for (const edge of path) {
      t = t.compose(edge.transform);
    }
    return t;
  }

  /** BFS — ref → target 최단 edge 경로. */
  private findPath(ref: string, target: string): Edge[] | null {
    if (!this.adjacency.has(ref) || !this.adjacency.has(target)) {
      return null;
    }
    if (ref === target) {
      return [];
    }
    const visited = new Set<string>([ref]);
    const queue: {frame: string; path: Edge[]}[] = [{frame: ref, path: []}];
    while (queue.length > 0) {
      const {frame, path} = queue.shift()!;
      for (const edge of this.adjacency.get(frame) ?? []) {
        if (visited.has(edge.to)) {
          continue;
        }
        const nextPath = [...path, edge];
        if (edge.to === target) {
          return nextPath;
        }
        visited.add(edge.to);
        queue.push({frame: edge.to, path: nextPath});
      }
    }
    return null;
  }
}
