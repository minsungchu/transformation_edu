import {expect} from 'vitest';
import type {Vec3} from '../src/index';
import {Transform, eulerToRotation} from '../src/index';

export const DEG = Math.PI / 180;

/** 결정적(seeded) 의사난수 — 테스트 재현성을 위해 Math.random 대신 사용. */
export function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    // LCG (Numerical Recipes)
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

/** 임의의 rigid transform (결정적). */
export function randomTransform(rng: () => number): Transform {
  const angles: [number, number, number] = [
    (rng() * 2 - 1) * Math.PI,
    (rng() - 0.5) * Math.PI * 0.98, // 중간각은 짐벌락 밖으로
    (rng() * 2 - 1) * Math.PI,
  ];
  const translation: Vec3 = [rng() * 4 - 2, rng() * 4 - 2, rng() * 4 - 2];
  return new Transform(eulerToRotation(angles, 'ZYX'), translation);
}

export function expectTransformClose(actual: Transform, expected: Transform, eps = 1e-9): void {
  expect(
    actual.approxEquals(expected, eps),
    `transform 불일치:\nactual   R=${actual.rotation} t=${actual.translation}\nexpected R=${expected.rotation} t=${expected.translation}`,
  ).toBe(true);
}

export function expectVec3Close(actual: Vec3, expected: Vec3): void {
  expect(actual[0]).toBeCloseTo(expected[0], 9);
  expect(actual[1]).toBeCloseTo(expected[1], 9);
  expect(actual[2]).toBeCloseTo(expected[2], 9);
}
