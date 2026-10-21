/** Pure ask-user transcript card data shared by its presenter and renderer. @module */

interface AnsweredQuestionCardItem {
  id: string
  question: string
  answers: readonly string[]
}

interface UnansweredQuestionCardItem {
  id: string
  question: string
}

/** Validated, localized data rendered by the ask-user transcript card. */
export type AskQuestionCardModel =
  | {
    kind: 'answered'
    questions: readonly AnsweredQuestionCardItem[]
    skippedLabel: string
  }
  | {
    kind: 'unanswered'
    questions: readonly UnansweredQuestionCardItem[]
    verdict: string
  }
