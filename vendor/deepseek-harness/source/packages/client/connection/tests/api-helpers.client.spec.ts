/** Connection transport errors preserve their original diagnostic. */

import { describe, expect, it } from 'vitest'
import { transportError } from '../src/client/api.ts'

describe('transportError', () => {
  it('folds an Error to internal keeping the message, and stringifies non-Errors', () => {
    expect(transportError(new Error('线断了'))).toEqual({ ok: false, error: { code: 'gateway/internal', message: '线断了', details: {} } })
    expect(transportError('raw string')).toMatchObject({ ok: false, error: { message: 'raw string' } })
  })
})
