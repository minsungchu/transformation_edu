/**
 * 티칭 펜던트식 조그 컨트롤 조각 — 0단계 파이프라인 뷰어와 1단계 로봇 조그 뷰어가
 * 함께 쓴다. 스타일은 RobotCellViewer/styles.module.css의 jog* 클래스.
 */
import React, {type ReactNode} from 'react';
import type {CartesianJogStep, Vec3} from 'transform-core';
import styles from './styles.module.css';

/** Cartesian 조그 버튼 6종 — 병진 3축 + 회전 3축. */
export const CARTESIAN_AXES: {label: string; kind: CartesianJogStep['kind']; axis: Vec3}[] = [
  {label: 'X', kind: 'translate', axis: [1, 0, 0]},
  {label: 'Y', kind: 'translate', axis: [0, 1, 0]},
  {label: 'Z', kind: 'translate', axis: [0, 0, 1]},
  {label: 'Rx', kind: 'rotate', axis: [1, 0, 0]},
  {label: 'Ry', kind: 'rotate', axis: [0, 1, 0]},
  {label: 'Rz', kind: 'rotate', axis: [0, 0, 1]},
];

/** 스텝 크기 선택지 — 병진(mm) / 회전(°). */
export const LINEAR_STEPS_MM = [5, 20, 50];
export const ANGULAR_STEPS_DEG = [1, 5, 10];

export function StepSelect({
  label,
  unit,
  values,
  value,
  onChange,
  disabled,
}: {
  label: string;
  unit: string;
  values: readonly number[];
  value: number;
  onChange: (next: number) => void;
  disabled: boolean;
}): ReactNode {
  return (
    <label className={styles.toggle}>
      {label}
      <select
        className={styles.jogSelect}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}>
        {values.map((v) => (
          <option key={v} value={v}>
            {v}
            {unit}
          </option>
        ))}
      </select>
    </label>
  );
}

/** [−] 라벨 [+] 한 벌. */
export function JogChip({
  label,
  title,
  disabled,
  onStep,
}: {
  label: string;
  title: string;
  disabled: boolean;
  onStep: (sign: 1 | -1) => void;
}): ReactNode {
  return (
    <span className={styles.jogChip}>
      <button
        type="button"
        className={styles.jogButton}
        disabled={disabled}
        aria-label={`${title} − 방향`}
        onClick={() => onStep(-1)}>
        −
      </button>
      <span className={styles.jogChipLabel} title={title}>
        {label}
      </span>
      <button
        type="button"
        className={styles.jogButton}
        disabled={disabled}
        aria-label={`${title} + 방향`}
        onClick={() => onStep(1)}>
        +
      </button>
    </span>
  );
}
