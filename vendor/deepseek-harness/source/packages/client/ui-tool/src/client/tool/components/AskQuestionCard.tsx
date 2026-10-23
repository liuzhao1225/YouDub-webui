/** Ask-user transcript rendering from validated plain card data. @module */

import type { AskQuestionCardModel } from '../models/ask-question-card-model.ts'
import css from './AskQuestionCard.module.css'

/**
 * Render a validated ask-user transcript from plain card data.
 * @param props - Localized transcript card data.
 * @returns the readable answered or unanswered question list.
 */
export function AskQuestionCard({ card }: { card: AskQuestionCardModel }) {
  if (card.kind === 'unanswered') {
    return (
      <div className={css.card}>
        <p className={css.verdict}>{card.verdict}</p>
        <ul className={css.questionList}>
          {card.questions.map(question => (
            <li className={css.unansweredQuestion} key={question.id}>{question.question}</li>
          ))}
        </ul>
      </div>
    )
  }
  return (
    <dl className={css.card}>
      {card.questions.map(question => (
        <div className={css.item} key={question.id}>
          <dt className={css.question}>{question.question}</dt>
          <dd className={css.answer}>
            {question.answers.length === 0
              ? <span className={css.skipped}>{card.skippedLabel}</span>
              : question.answers.map((answer, index) => (
                <span className={css.answerLine} key={`${question.id}-${String(index)}`}>{answer}</span>
              ))}
          </dd>
        </div>
      ))}
    </dl>
  )
}
