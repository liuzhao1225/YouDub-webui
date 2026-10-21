/** Observation topic names carried by the internal bridge for captured fetches. */

/** Complete set of fetch observation topics. */
export const FETCH_TOPICS = [
  'fetch/start',
  'fetch/request-body-chunk',
  'fetch/request-body-end',
  'fetch/response',
  'fetch/response-body-chunk',
  'fetch/end',
  'fetch/error',
] as const
