import {describe, expect, it} from 'vitest';
import {FrameGraph, Transform} from '../src/index';
import {DEG, expectTransformClose, makeRng, randomTransform} from './helpers';

describe('FrameGraph', () => {
  it('등록한 T^{ref}_{target}을 그대로 조회한다', () => {
    const g = new FrameGraph();
    const tWC = Transform.fromTranslation([0, 1, 2]).compose(Transform.rotationX(30 * DEG));
    g.setTransform('world', 'camera', tWC);
    expectTransformClose(g.getTransform('world', 'camera'), tWC);
  });

  it('역방향 조회는 T^B_A = (T^A_B)^{-1}이고, 왕복 곱은 항등이다', () => {
    const g = new FrameGraph();
    const tWC = randomTransform(makeRng(11));
    g.setTransform('world', 'camera', tWC);
    expectTransformClose(g.getTransform('camera', 'world'), tWC.inverse());
    expectTransformClose(
      g.getTransform('world', 'camera').compose(g.getTransform('camera', 'world')),
      Transform.identity(),
    );
  });

  it('같은 좌표계 조회는 항등 변환이다', () => {
    const g = new FrameGraph();
    g.addFrame('world');
    expectTransformClose(g.getTransform('world', 'world'), Transform.identity());
  });

  it('체인룰: T^A_C = T^A_B · T^B_C (인접 인덱스 소거)', () => {
    const rng = makeRng(31);
    const tAB = randomTransform(rng);
    const tBC = randomTransform(rng);
    const g = new FrameGraph();
    g.setTransform('A', 'B', tAB);
    g.setTransform('B', 'C', tBC);
    expectTransformClose(g.getTransform('A', 'C'), tAB.compose(tBC));
  });

  it('긴 체인(world→…→tool)도 체인룰로 합성된다', () => {
    const rng = makeRng(47);
    const names = ['world', 'j1', 'j2', 'j3', 'flange', 'tool'];
    const g = new FrameGraph();
    let expected = Transform.identity();
    for (let i = 0; i < names.length - 1; i++) {
      const t = randomTransform(rng);
      g.setTransform(names[i]!, names[i + 1]!, t);
      expected = expected.compose(t);
    }
    expectTransformClose(g.getTransform('world', 'tool'), expected);
    // 중간에서 시작하는 조회도 일관적이다
    expectTransformClose(
      g.getTransform('j2', 'tool'),
      g.getTransform('j2', 'j3').compose(g.getTransform('j3', 'tool')),
    );
  });

  it('경로 무관성: 서로 다른 두 경로가 같은 T를 준다 (다이아몬드)', () => {
    // A→B→D 와 A→C→D 두 경로가 모순 없이 등록된 그래프
    const rng = makeRng(63);
    const tAB = randomTransform(rng);
    const tBD = randomTransform(rng);
    const tCD = randomTransform(rng);
    const tAD = tAB.compose(tBD);
    const tAC = tAD.compose(tCD.inverse());

    // 등록 순서를 바꾼 두 그래프 — BFS가 다른 경로를 고르더라도 결과는 같아야 한다
    const g1 = new FrameGraph();
    g1.setTransform('A', 'B', tAB);
    g1.setTransform('B', 'D', tBD);
    g1.setTransform('A', 'C', tAC);
    g1.setTransform('C', 'D', tCD);

    const g2 = new FrameGraph();
    g2.setTransform('A', 'C', tAC);
    g2.setTransform('C', 'D', tCD);
    g2.setTransform('A', 'B', tAB);
    g2.setTransform('B', 'D', tBD);

    expectTransformClose(g1.getTransform('A', 'D'), tAD);
    expectTransformClose(g2.getTransform('A', 'D'), tAD);
    expectTransformClose(g1.getTransform('A', 'D'), g2.getTransform('A', 'D'));
    // 두 경로를 손으로 합성해도 같다
    expectTransformClose(tAC.compose(tCD), tAD);
  });

  it('연결되지 않은 좌표계 조회는 throw', () => {
    const g = new FrameGraph();
    g.setTransform('world', 'camera', Transform.identity());
    g.addFrame('user');
    expect(g.hasPath('world', 'user')).toBe(false);
    expect(() => g.getTransform('world', 'user')).toThrow();
    expect(() => g.getTransform('world', '없는프레임')).toThrow();
  });

  it('같은 좌표계 사이의 등록은 거부한다', () => {
    const g = new FrameGraph();
    expect(() => g.setTransform('world', 'world', Transform.identity())).toThrow();
  });
});
