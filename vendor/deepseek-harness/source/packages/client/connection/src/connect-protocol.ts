/** API connection inputs shared by the Host and its clients. */

/** Whether a Peer receives forwarded Remote events and maintains their connection lifecycle. */
export type ConnectionInteractions = 'answer' | 'none'

/** Launch-token exchange route for API clients. */
export const CONNECT_PATH = '/connect'
