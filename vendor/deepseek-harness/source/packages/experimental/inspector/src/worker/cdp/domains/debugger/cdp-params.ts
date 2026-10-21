/** Validation for CDP Debugger requests handled by the shared domain. */

import type { RuntimeCallFrameEvaluationRequest } from '../../../../shared/cdp/index.ts'
import { exactKeys, optionalBoolean, optionalString } from '../../../../shared/validation.ts'

/**
 * Parse Debugger.evaluateOnCallFrame without silently accepting unsupported options.
 * @param params - Untrusted CDP parameters.
 * @returns The common call-frame evaluation request.
 */
export function parseCallFrameEvaluation(
  params: Readonly<Record<string, unknown>>,
): RuntimeCallFrameEvaluationRequest {
  exactKeys(params, [
    'callFrameId', 'expression', 'objectGroup', 'includeCommandLineAPI', 'silent', 'returnByValue',
    'generatePreview', 'throwOnSideEffect', 'timeout',
  ], 'Debugger.evaluateOnCallFrame parameters')
  if (typeof params.callFrameId !== 'string' || typeof params.expression !== 'string') {
    throw new Error('Debugger.evaluateOnCallFrame requires callFrameId and expression')
  }
  if (params.timeout !== undefined
    && (typeof params.timeout !== 'number' || !Number.isFinite(params.timeout) || params.timeout < 0)) {
    throw new Error('Debugger.evaluateOnCallFrame timeout must be a non-negative number')
  }
  return {
    callFrameId: params.callFrameId,
    expression: params.expression,
    ...optionalString(params, 'objectGroup'),
    ...optionalBoolean(params, 'includeCommandLineAPI'),
    ...optionalBoolean(params, 'silent'),
    ...optionalBoolean(params, 'returnByValue'),
    ...optionalBoolean(params, 'generatePreview'),
    ...optionalBoolean(params, 'throwOnSideEffect'),
    ...(params.timeout === undefined ? {} : { timeoutMs: params.timeout }),
  }
}

/**
 * Find a ScriptId carried directly or by a Debugger location parameter.
 * @param params - Parsed CDP parameter record.
 * @returns The targeted script id when the request names one.
 */
export function requestScriptId(params: Readonly<Record<string, unknown>>): string | undefined {
  if (typeof params.scriptId === 'string') return params.scriptId
  for (const key of ['location', 'start', 'end'] as const) {
    const value = params[key]
    if (typeof value !== 'object' || value === null || Array.isArray(value)) continue
    const scriptId = (value as Readonly<Record<string, unknown>>).scriptId
    if (typeof scriptId === 'string') return scriptId
  }
  return undefined
}
