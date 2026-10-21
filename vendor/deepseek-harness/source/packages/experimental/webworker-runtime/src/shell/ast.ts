/**
 * The parsed command line, as this shell names it.
 *
 * `@yarnpkg/parsers` re-exports only part of its grammar's type map from the
 * package root, and its `exports` field forbids reaching the grammar module
 * directly, so the three missing members are derived from the ones it does
 * publish. `CommandChain` is `Command` plus an optional pipeline link, which
 * makes it usable wherever a command node is expected.
 * @module @deepseek-ai/dsh-experimental-webworker-runtime/src/shell/ast
 */

import type { Argument, CommandChain } from '@yarnpkg/parsers'

export type { ArgumentSegment, ArithmeticExpression, CommandChain, CommandLine, ShellLine } from '@yarnpkg/parsers'

/** One command node: a program call, a subshell, a group, or bare assignments. */
export type Command = CommandChain

/** An argument that becomes argv fields. */
export type ValueArgument = Extract<Argument, { type: 'argument' }>

/** An argument that rewires a descriptor instead of becoming argv. */
export type RedirectArgument = Extract<Argument, { type: 'redirection' }>
