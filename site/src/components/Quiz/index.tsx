/**
 * 즉시 채점 퀴즈 컴포넌트 — MDX 챕터 끝에 붙여 쓴다.
 *
 * ```mdx
 * import Quiz, {MultipleChoice, ShortAnswer, Math} from '@site/src/components/Quiz';
 *
 * <Quiz>
 *   <MultipleChoice
 *     question="로봇 Base를 원점으로 하는 좌표계는?"
 *     options={['World 좌표계', 'Tool 좌표계']}
 *     answerIndex={0}
 *     explanation="이 교재는 World 좌표계로 통일해 부릅니다."
 *   />
 *   <ShortAnswer question="..." acceptedAnswers={['post']} explanation="..." />
 * </Quiz>
 * ```
 *
 * 수식이 필요한 자리(question/options/explanation)는 ReactNode를 받으므로
 * `<Math tex="T^{world}_{camera}" />`를 섞어 쓸 수 있다.
 */
import React, {useState, type ReactNode} from 'react';
import katex from 'katex';
import styles from './styles.module.css';

/** KaTeX 수식 — remark가 닿지 않는 JSX prop 안에서 쓴다. */
export function Math({tex}: {tex: string}): ReactNode {
  return (
    <span
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{__html: katex.renderToString(tex, {throwOnError: false})}}
    />
  );
}

export function Quiz({children}: {children: ReactNode}): ReactNode {
  return (
    <section className={styles.quiz}>
      <div className={styles.quizHeader}>이해 확인 퀴즈</div>
      {children}
    </section>
  );
}

interface ResultProps {
  correct: boolean;
  explanation: ReactNode;
  onRetry: () => void;
}

function Result({correct, explanation, onRetry}: ResultProps): ReactNode {
  return (
    <div className={correct ? styles.resultCorrect : styles.resultWrong}>
      <div className={styles.resultVerdict}>
        {correct ? '✓ 정답입니다!' : '✗ 오답입니다.'}
        {!correct && (
          <button type="button" className={styles.retry} onClick={onRetry}>
            다시 풀기
          </button>
        )}
      </div>
      <div className={styles.explanation}>{explanation}</div>
    </div>
  );
}

export interface MultipleChoiceProps {
  question: ReactNode;
  options: ReactNode[];
  /** 정답 옵션의 0-기반 인덱스. */
  answerIndex: number;
  explanation: ReactNode;
}

export function MultipleChoice({
  question,
  options,
  answerIndex,
  explanation,
}: MultipleChoiceProps): ReactNode {
  const [selected, setSelected] = useState<number | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const submit = (): void => {
    if (selected !== null) {
      setSubmitted(true);
    }
  };
  const retry = (): void => {
    setSubmitted(false);
    setSelected(null);
  };

  return (
    <div className={styles.question}>
      <div className={styles.prompt}>{question}</div>
      <div className={styles.options}>
        {options.map((option, i) => {
          const showAsCorrect = submitted && i === answerIndex;
          const showAsWrong = submitted && selected === i && i !== answerIndex;
          return (
            <label
              // eslint-disable-next-line react/no-array-index-key
              key={i}
              className={[
                styles.option,
                showAsCorrect ? styles.optionCorrect : '',
                showAsWrong ? styles.optionWrong : '',
              ].join(' ')}>
              <input
                type="radio"
                checked={selected === i}
                disabled={submitted}
                onChange={() => setSelected(i)}
              />
              <span>{option}</span>
            </label>
          );
        })}
      </div>
      {!submitted ? (
        <button
          type="button"
          className={styles.submit}
          disabled={selected === null}
          onClick={submit}>
          제출
        </button>
      ) : (
        <Result correct={selected === answerIndex} explanation={explanation} onRetry={retry} />
      )}
    </div>
  );
}

/** 단답 비교용 정규화 — 앞뒤 공백 제거, 소문자화, 연속 공백 축약. */
function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

export interface ShortAnswerProps {
  question: ReactNode;
  /** 정답으로 인정할 답 목록 (대소문자·공백 무시 비교). */
  acceptedAnswers: string[];
  /** 채점 후 보여줄 대표 정답 표기. 생략하면 acceptedAnswers[0]. */
  displayAnswer?: string;
  explanation: ReactNode;
  placeholder?: string;
}

export function ShortAnswer({
  question,
  acceptedAnswers,
  displayAnswer,
  explanation,
  placeholder = '답을 입력하세요',
}: ShortAnswerProps): ReactNode {
  const [value, setValue] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const correct = acceptedAnswers.some((a) => normalize(a) === normalize(value));
  const submit = (): void => {
    if (value.trim() !== '') {
      setSubmitted(true);
    }
  };
  const retry = (): void => {
    setSubmitted(false);
    setValue('');
  };

  return (
    <div className={styles.question}>
      <div className={styles.prompt}>{question}</div>
      <div className={styles.answerRow}>
        <input
          type="text"
          className={styles.answerInput}
          value={value}
          placeholder={placeholder}
          disabled={submitted}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              submit();
            }
          }}
        />
        {!submitted && (
          <button
            type="button"
            className={styles.submit}
            disabled={value.trim() === ''}
            onClick={submit}>
            제출
          </button>
        )}
      </div>
      {submitted && (
        <Result
          correct={correct}
          explanation={
            <>
              {!correct && (
                <p className={styles.answerReveal}>
                  정답: <strong>{displayAnswer ?? acceptedAnswers[0]}</strong>
                </p>
              )}
              {explanation}
            </>
          }
          onRetry={retry}
        />
      )}
    </div>
  );
}

export default Quiz;
