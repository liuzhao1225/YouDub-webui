/** Exact-read Session query used by the descriptor-less child snapshot. */

import SessionQueryEngine from '@deepseek-ai/dsh-session-query'

/** Search is outside this fixture; inherited corpus and observation reads stay real. */
export default class SubagentDiagnosticQuery extends SessionQueryEngine {
  override searchSessions(): Promise<never> {
    return Promise.reject(new Error('session search is unavailable in this fixture'))
  }

  override searchEvents(): Promise<never> {
    return Promise.reject(new Error('event search is unavailable in this fixture'))
  }
}
