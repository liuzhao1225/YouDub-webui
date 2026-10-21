/** Browser stack parsing for realm-neutral Runtime and Console events. */

import type { RuntimeScriptKey } from '../../shared/cdp/ids.ts'
import type { RuntimeCallFrame, RuntimeStackTrace } from '../../shared/cdp/index.ts'

/** Resolve a browser stack-frame URL to a Client catalog script key. */
export type ClientScriptKeyResolver = (url: string) => RuntimeScriptKey | undefined

/**
 * Capture the caller stack of a wrapped Client Console method.
 * @param resolveScript - Resolver for Client catalog script keys.
 * @returns Parsed call frames when the browser supplies a stack.
 */
export function captureClientConsoleStack(resolveScript: ClientScriptKeyResolver): RuntimeStackTrace | undefined {
  return parseClientStack(new Error().stack, resolveScript, 3)
}

/**
 * Parse the stack attached to an uncaught Client value when available.
 * @param value - Thrown or rejected value.
 * @param resolveScript - Resolver for Client catalog script keys.
 * @returns Parsed call frames when the value has a recognized stack string.
 */
export function clientErrorStack(
  value: unknown,
  resolveScript: ClientScriptKeyResolver = () => undefined,
): RuntimeStackTrace | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  let stack: unknown
  try {
    stack = Reflect.get(value, 'stack') as unknown
  } catch {
    // A thrown proxy or stack getter cannot replace the original JavaScript exception.
    return undefined
  }
  return typeof stack === 'string' ? parseClientStack(stack, resolveScript, 0) : undefined
}

/**
 * Parse V8- and Firefox-style textual frames into the common stack model.
 * @param stack - Browser stack text.
 * @param resolveScript - Resolver for Client catalog script keys.
 * @param skipFrames - Parsed observer frames omitted from the result.
 * @returns Parsed call frames, or `undefined` when none remain.
 */
export function parseClientStack(
  stack: string | undefined,
  resolveScript: ClientScriptKeyResolver,
  skipFrames: number,
): RuntimeStackTrace | undefined {
  if (stack === undefined) return undefined
  const frames: RuntimeCallFrame[] = []
  for (const line of stack.split('\n')) {
    const frame = parseFrame(line, resolveScript)
    if (frame !== undefined) frames.push(frame)
  }
  const callFrames = frames.slice(skipFrames)
  return callFrames.length === 0 ? undefined : { callFrames }
}

function parseFrame(line: string, resolveScript: ClientScriptKeyResolver): RuntimeCallFrame | undefined {
  const chrome = /^\s*at\s+(?:(.*?)\s+\()?(.+):(\d+):(\d+)\)?$/u.exec(line)
  const firefox = chrome === null ? /^(.*?)@(.+):(\d+):(\d+)$/u.exec(line) : null
  const match = chrome ?? firefox
  if (match === null) return undefined
  const url = match[2]
  const lineNumber = Number(match[3]) - 1
  const columnNumber = Number(match[4]) - 1
  if (url === undefined || !Number.isSafeInteger(lineNumber) || !Number.isSafeInteger(columnNumber)) return undefined
  const scriptKey = resolveScript(url)
  return {
    functionName: match[1] ?? '',
    ...(scriptKey === undefined ? {} : { scriptKey }),
    url,
    lineNumber,
    columnNumber,
  }
}
