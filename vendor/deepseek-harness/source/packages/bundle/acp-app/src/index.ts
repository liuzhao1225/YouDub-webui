/**
 * The ACP profile's command-line and stdin-lifetime provider. A successful
 * parse publishes {@link ACP_APP_STARTUP_SERVICE}; the ACP bridge waits for
 * that service, so help starts no transport.
 * @module @deepseek-ai/dsh-acp-app
 */

import { Command } from 'commander'
import type { Context } from '@deepseek-ai/cordis'
import { exitOnStdinEnd, parseCmdline } from '@deepseek-ai/dsh-cmdline'

/** Stable Cordis plugin name. */
export const name = 'acp-app-startup'

/** Launcher service required before this app can parse its invocation. */
export const inject = ['cmdlineArgs']

/** Service the ACP bridge row waits for before claiming stdio. */
export const ACP_APP_STARTUP_SERVICE = 'acpAppStartup'

/**
 * Build this app's zero-option command and help.
 * @returns a fresh program for one invocation.
 */
function acpCommand(): Command {
  return new Command()
    .name('dsh --profile acp')
    .description('Serve automation clients over Agent Client Protocol stdio.')
    .helpOption('-h, --help', 'show this help')
    .addHelpText('after', `
Example:
  dsh --profile acp     serve ACP until the client disconnects
`)
}

/**
 * Accept an ACP profile invocation, publish readiness, and bind EOF to the
 * launcher's bounded shutdown.
 * @param ctx - plugin context carrying command-line and exit launcher values.
 */
export function apply(ctx: Context): void {
  const program = acpCommand()
  program.action(() => {
    exitOnStdinEnd(ctx, 'acp-app.stdin')
    ctx.provide(ACP_APP_STARTUP_SERVICE, { accepted: true })
  })
  parseCmdline(ctx, program)
}
