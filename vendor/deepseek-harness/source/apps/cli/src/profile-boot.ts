/**
 * Shared profile boot for every `dsh` surface: resolve the profile, stack its
 * patch layers (bundle layers in `dsh.profile.bundles` order, the profile's
 * own `cordis.patch.yml`, `--patch` overlays), mount the
 * tree over the profile's empty root config, and wire fail-loud plus bounded shutdown.
 *
 * App flags are not the launcher's business: the invocation's inner arguments
 * are provided to the tree through `ctx.cmdlineArgs`, where any injected app
 * plugin may read the same immutable snapshot.
 * @module @deepseek-ai/dsh/profile-boot
 */

import { writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { FiberState, type Context } from '@deepseek-ai/cordis'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import {
  boot,
  readProfilePatches,
  createRuntimeResolution,
  installFailLoud,
  loadOverlayPatches,
  PluginPackages,
  type ProfileContext,
  type Profile,
  type RuntimeResolution,
} from '@deepseek-ai/dsh-app-boot'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { installProxyFromEnvironment } from '@deepseek-ai/dsh-http-proxy'
import { DSH_LAUNCH_ENVIRONMENT_KEY, type LaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment'
import { provideCmdline, type AppReady } from '@deepseek-ai/dsh-cmdline'
import { createProcessShutdown, type ProcessShutdown } from './process-shutdown.ts'

const NAME = 'dsh'

/** Launcher-owned readiness signal committed only after boot and host setup succeed. */
function createAppReady(): { service: AppReady; commit(): void } {
  let ready = false
  const listeners = new Set<() => void>()
  return {
    service: {
      onReady(listener) {
        if (ready) {
          listener()
          return () => {}
        }
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
    },
    commit() {
      if (ready) return
      ready = true
      for (const listener of [...listeners]) listener()
      listeners.clear()
    },
  }
}

/** The empty root entry list every profile tree patches over. */
const PROFILE_ROOT_CONFIG = `# dsh profile root — an empty entry list. The tree is composed as patches:
# each bundle in package.json's dsh.profile.bundles, then cordis.patch.yml, then any
# --patch overlays. Edit cordis.patch.yml, not this file.
[]
`

/** Root config filename inside a profile directory. */
export const PROFILE_ROOT_FILENAME = 'cordis.yml'

/** One profile's patch layers, in application order. */
interface ComposedProfile {
  profile: Profile
  /** Immutable runtime resolution computed before any plugin imports. */
  resolution: RuntimeResolution
  /** Command-line overlay contents, frozen for this invocation. */
  overlays: PatchOptions[]
}

/**
 * Compose the application profile’s effective patch stack: bundle layers in
 * `dsh.profile.bundles` order (a base-backed profile gets the base bundle's
 * platform-gated shell rows), the profile's user layer, the home-level user
 * layer (`$DSH_HOME/cordis.patch.yml` — machine-local preferences that apply
 * to every profile, so it outranks the per-profile layer), `--patch` overlays,
 * then user-supplied overlays.
 * @param patchFiles - `--patch` overlay paths, in argv order.
 * @param resolvedProfile - application-owned profile and installation.
 * @returns the profile and its patch layers.
 */
async function composeProfile(
  patchFiles: readonly string[],
  resolvedProfile: ResolvedProfileRuntime,
): Promise<ComposedProfile> {
  const profile = resolvedProfile.profile
  writeFileSync(join(profile.dir, PROFILE_ROOT_FILENAME), PROFILE_ROOT_CONFIG)
  const resolutionOptions = { installAnchor: resolvedProfile.installAnchor, profile }
  const resolution = await createRuntimeResolution(resolutionOptions)
  const overlays = patchFiles.flatMap(file => loadOverlayPatches(NAME, resolve(file)))
  return { profile, resolution, overlays }
}

/** An application-owned profile and its independent installation fallback. */
export interface ResolvedProfileRuntime {
  /** Profile already loaded from the application's own directory. */
  profile: Profile
  /** Absolute package.json path of the application's dsh installation. */
  installAnchor: string
}

/** Options for {@link runProfile}. */
export interface RunProfileOptions {
  /** This run's frozen environment snapshot, provided before any entry mounts. */
  environment: LaunchEnvironmentSnapshot
  /** The profile name to boot. */
  profile: string
  /** Loaded application-owned profile and installation root. */
  resolvedProfile: ResolvedProfileRuntime
  /** `--patch` overlay paths, in argv order. */
  patchFiles: readonly string[]
  /** The invocation's inner arguments, handed to the tree through `ctx.cmdlineArgs`. */
  args: readonly string[]
  /** Application-owned package runtime, scoped to plugin package operations. */
  packageManager?: ProfileContext['packageManager']
}

/**
 * Boot one profile invocation end to end and leave process lifetime to the
 * mounted plugins (or to a one-shot runner the composition mounts).
 * @param options - environment snapshot, profile name, overlays, and the booted app's own arguments.
 * @returns the settled root context and the shutdown controller.
 * @throws after disposing startup resources; cleanup failures retain the original error.
 */
export async function runProfile(options: RunProfileOptions): Promise<{ ctx: Context; shutdown: ProcessShutdown }> {
  // Before the first plugin mounts and before anything can issue a request: Node's fetch ignores the
  // proxy environment on its own, so every profile would otherwise connect directly. Resolving from
  // the launcher's snapshot — not `process.env` — is what lets a proxy declared in a `.env` layer
  // work, which the NODE_USE_ENV_PROXY flag cannot do because Node samples the environment at start.
  const disposeProxy = await installProxyFromEnvironment(
    options.environment,
    (message) => { process.stderr.write(`${NAME}: ${message}\n`) },
  )

  const app: { current?: Context } = {}
  let disposal: Promise<void> | undefined
  const dispose = (): Promise<void> => disposal ??= (async () => {
    const failures: unknown[] = []
    for (const release of [() => app.current?.fiber.dispose(), disposeProxy]) {
      try { await release() } catch (error) { failures.push(error) }
    }
    if (failures.length === 1) throw failures[0]
    if (failures.length > 1) throw new AggregateError(failures, 'dsh: profile cleanup failed')
  })()
  try {
    const composed = await composeProfile(
      options.patchFiles, options.resolvedProfile,
    )
    const appReady = createAppReady()
    const shutdown = createProcessShutdown(dispose)
    const signalShutdown = new AbortController()
    const interrupt = (code: number): void => {
      signalShutdown.abort()
      shutdown.interrupt(code)
    }
    // Signals own teardown throughout the startup window, not only after boot()
    // settles: an inserted provider can publish before sibling rows finish mounting.
    // SIGTERM is a supervisor's ordinary stop request and exits 0 on every
    // surface — the launcher does not know whether the app considered its work
    // complete; SIGINT is a user interrupt and reports 130.
    process.on('SIGTERM', () => { interrupt(0) })
    process.on('SIGINT', () => { interrupt(130) })
    installFailLoud(NAME, process, async () => {
      await app.current?.fiber.dispose()
    })

    const rootConfig = join(composed.profile.dir, PROFILE_ROOT_FILENAME)
    const profileContext: ProfileContext = {
      name: options.profile,
      ...(options.packageManager === undefined ? {} : { packageManager: options.packageManager }),
      dir: composed.profile.dir, patchPath: composed.profile.patchPath,
      installAnchor: options.resolvedProfile.installAnchor,
      startedBundles: composed.profile.layers.map(layer => layer.packageName),
      cwd: process.cwd(), home: resolveDshHome(),
      overlays: composed.overlays,
    }
    const ctx = await boot(NAME, rootConfig, readProfilePatches(NAME, profileContext, composed.profile), async (hostCtx) => {
      app.current = hostCtx
      hostCtx.provide('profileContext', profileContext)
      // Before any config-tree entry mounts, so plugins resolve all launch-time
      // environment values from the same immutable launch snapshot.
      hostCtx.provide(DSH_LAUNCH_ENVIRONMENT_KEY, options.environment)
      await hostCtx.plugin(PluginPackages, {
        resolution: composed.resolution,
      })
      // The command line and bounded exit request are launcher facts available
      // to every app plugin that injects the argument snapshot.
      provideCmdline(hostCtx, {
        args: options.args,
        exit: code => void shutdown.shutdown(code),
        ready: appReady.service,
      })
    })
    app.current = ctx
    if (!signalShutdown.signal.aborted
      && ctx.fiber.state === FiberState.ACTIVE
      && ctx.get('loader') !== undefined) {
      appReady.commit()
    }
    return { ctx, shutdown }
  } catch (error) {
    try { await dispose() } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'dsh: profile startup and cleanup failed')
    }
    throw error
  }
}
