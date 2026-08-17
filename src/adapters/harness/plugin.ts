/**
 * The DeepSeek Harness host plugin.
 *
 * Responsibilities, in order of importance:
 *
 *  1. Never break the agent. Every entry point here is wrapped so that a
 *     manifest problem, a classifier bug, or a bad config degrades into "no
 *     meme" and nothing else. The plugin has no place on the critical path.
 *  2. Never touch the answer. This plugin appends nothing to the session
 *     surface and registers no model-facing tool, so the assistant's text is
 *     byte-identical whether or not it is loaded.
 *  3. Cost nothing per turn. The library is built once at load; a turn that
 *     produces no reaction only folds a few small in-memory records.
 *
 * @module dsh-meme/adapters/harness/plugin
 */

import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
// The root entry carries the `session/event` augmentation on Cordis `Events`
// and the `Session` class; `/types` is the client-safe face and has neither.
import type { Session } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import type { MemeConfigInput } from '../../domain/config.ts'
import { resolveConfig } from '../../domain/config.ts'
import type { ResolvedLibrary } from '../../assets/manifest.ts'
import { DEFAULT_ASSET_SUBDIR, EMPTY_RESOLVED_LIBRARY, loadLibrary } from '../../assets/manifest.ts'
import { assetIdFromPath, serveAsset } from '../../assets/server.ts'
import type { AssetLookup } from '../../assets/server.ts'
import { foldSessionLog } from '../../engine/fold.ts'
import type { LogEvent } from '../../engine/fold.ts'
import { createLogger } from '../../log/logger.ts'
import type { ReactionLogger } from '../../log/logger.ts'
import type { ReactionDecision } from '../../domain/reaction.ts'

/** Cordis plugin name. */
export const name = 'dsh-meme'

/**
 * No services are injected.
 *
 * The plugin listens to `session/event`, which every Context exposes, and needs
 * nothing else. Declaring an injection the reaction layer does not truly
 * require would let a missing optional service keep the whole agent from
 * composing, which is exactly the failure mode this plugin must not have.
 */
export const inject: readonly string[] = []

/** Public config type for `cordis.yml`. */
export type Config = MemeConfigInput

/** The runtime a loaded plugin exposes to its host, and to tests. */
export interface MemeRuntime {
  /** The validated library, or an empty one when loading failed. */
  readonly library: ResolvedLibrary
  /**
   * Reaction decisions for one session, recomputed from its durable log.
   * @param session - the session to fold.
   * @returns decisions keyed by turn.
   */
  decisionsFor(session: Session): ReadonlyMap<number, ReactionDecision>
  /**
   * Resolve an HTTP request path to asset bytes.
   * @param pathname - the request pathname.
   * @returns the lookup outcome, or undefined when the route is not ours.
   */
  handleAssetRequest(pathname: string): AssetLookup | undefined
}

/** Resolve the asset root: explicit config, then the documented default. */
function resolveAssetRoot(configured: string | undefined): string {
  return configured ?? join(homedir(), DEFAULT_ASSET_SUBDIR)
}

/**
 * Run `operation`, converting any failure into a logged notice.
 *
 * This is the containment boundary named in the module docs: the meme layer
 * fails by producing no meme, never by propagating into the agent loop.
 * @param logger - where the failure is reported.
 * @param what - short label naming the failed stage.
 * @param operation - the work to contain.
 * @param fallback - the value to use when the work throws.
 * @returns the operation's result, or `fallback`.
 */
function contained<T>(logger: ReactionLogger, what: string, operation: () => T, fallback: T): T {
  try {
    return operation()
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    logger.notice(`${what} failed, skipping reaction: ${reason}`)
    return fallback
  }
}

/**
 * Build the plugin runtime without registering anything.
 *
 * Exported so tests can exercise the real load path (config resolution,
 * manifest validation, folding, asset serving) without a Cordis context.
 * @param config - raw config.
 * @param sink - where log lines go.
 * @returns the runtime.
 */
export function createRuntime(config: Config | undefined, sink: (line: string) => void): MemeRuntime {
  const { config: resolved, warnings } = resolveConfig(config)
  const logger = createLogger({ sink, enabled: resolved.log, debug: resolved.debug })
  for (const warning of warnings) logger.notice(warning)

  const root = resolveAssetRoot(resolved.assetRoot)
  const loaded = contained(
    logger,
    'manifest load',
    () => loadLibrary(root),
    { library: EMPTY_RESOLVED_LIBRARY, error: 'manifest load threw' },
  )
  if (loaded.error !== undefined) {
    // Reported as a notice, not thrown: a broken manifest disables the meme
    // layer and leaves the agent untouched.
    logger.notice(`disabled: ${loaded.error}`)
  }
  for (const warning of loaded.library.warnings) logger.notice(`manifest: ${warning}`)

  const { library } = loaded

  return {
    library,
    decisionsFor(session) {
      return contained(logger, 'decision fold', () => {
        const events = session.events as readonly LogEvent[]
        return foldSessionLog(events, library, resolved, String(session.id)).byTurn
      }, new Map())
    },
    handleAssetRequest(pathname) {
      const id = assetIdFromPath(pathname)
      if (id === undefined) return undefined
      return contained<AssetLookup>(
        logger,
        'asset lookup',
        () => serveAsset(library, id),
        { status: 404, reason: 'unreadable' },
      )
    },
  }
}

/**
 * Register the reaction layer on a Harness context.
 *
 * Every registration goes through `ctx.effect`, so a hot reload disposes the
 * previous listener before installing the new one. Without that, an HMR cycle
 * would leave two listeners folding the same turn and the user would get a
 * burst of duplicate reactions.
 * @param ctx - the plugin's Cordis context.
 * @param config - config from `cordis.yml`.
 */
export function apply(ctx: Context, config?: Config): void {
  const runtime = createRuntime(config, line => { console.info(line) })
  const { config: resolved } = resolveConfig(config)
  const logger = createLogger({
    sink: line => { console.info(line) },
    enabled: resolved.log,
    debug: resolved.debug,
  })

  // Decisions already reported for a session, so a re-fold on each turn logs
  // only what is new. Keyed by session id and dropped when the session is.
  const reported = new WeakMap<Session, Set<number>>()

  ctx.effect(() => {
    const dispose = ctx.on('session/event', (session: Session, event: SessionEvent) => {
      // Only a closed turn can be decided; every other event is ignored
      // without doing any work, which keeps the per-event cost negligible.
      if (event.type !== 'turn/end') return
      const decisions = runtime.decisionsFor(session)
      let seen = reported.get(session)
      if (seen === undefined) {
        seen = new Set()
        reported.set(session, seen)
      }
      for (const [turn, decision] of decisions) {
        if (seen.has(turn)) continue
        seen.add(turn)
        logger.decision(decision)
      }
    })
    return () => { dispose() }
  }, 'dsh-meme session/event listener')
}

export default { name, inject, apply }
