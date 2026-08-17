/**
 * Privacy-safe decision logging.
 *
 * The plugin sees every prompt and every answer, so the logger is written as a
 * whitelist: a log line is BUILT from named decision fields, never formatted
 * from a turn object. There is no code path that can put message text or an
 * absolute asset path into a log line, which is what makes the privacy tests
 * meaningful rather than decorative.
 * @module dsh-meme/log/logger
 */

import type { ReactionDecision, ReactionDiagnostics } from '../domain/reaction.ts'

/** The sink log lines go to. */
export interface LogSink {
  /** @param line - a fully-formed, privacy-checked line. */
  (line: string): void
}

/** One decision record, with only the fields that are safe to persist. */
export interface DecisionLogRecord {
  readonly reactionId: string | undefined
  readonly turn: number
  readonly trigger: string | undefined
  readonly category: string | undefined
  readonly memeId: string | undefined
  readonly outcome: 'selected' | 'skipped'
  readonly reason: string | undefined
  readonly timestamp: string
}

/**
 * Reduce a decision to its loggable fields.
 *
 * Note what is absent: no user text, no assistant text, no file path, no asset
 * root. A meme is identified by its manifest id, which is a name the user chose
 * and not a location on disk.
 * @param decision - the decision to record.
 * @param now - timestamp source, injected so tests are deterministic.
 * @returns the record.
 */
export function toLogRecord(decision: ReactionDecision, now: () => Date = () => new Date()): DecisionLogRecord {
  const timestamp = now().toISOString()
  if (decision.kind === 'reaction') {
    const { reaction } = decision
    return {
      reactionId: reaction.reactionId,
      turn: reaction.turn,
      trigger: reaction.trigger,
      category: reaction.category,
      memeId: reaction.memeId,
      outcome: 'selected',
      reason: undefined,
      timestamp,
    }
  }
  return {
    reactionId: undefined,
    turn: decision.turn,
    trigger: undefined,
    category: undefined,
    memeId: undefined,
    outcome: 'skipped',
    reason: decision.reason,
    timestamp,
  }
}

/** Render a record as one line. Only whitelisted fields are interpolated. */
function formatRecord(record: DecisionLogRecord): string {
  const fields = [
    `turn=${record.turn}`,
    `outcome=${record.outcome}`,
    record.trigger === undefined ? undefined : `trigger=${record.trigger}`,
    record.category === undefined ? undefined : `category=${record.category}`,
    record.memeId === undefined ? undefined : `meme=${record.memeId}`,
    record.reason === undefined ? undefined : `reason=${record.reason}`,
  ].filter((field): field is string => field !== undefined)
  return `dsh-meme ${record.timestamp} ${fields.join(' ')}`
}

/**
 * Render debug diagnostics as one line.
 *
 * Diagnostics answer "why did this turn react", so they carry the roll and the
 * probability, and still no message text.
 * @param diagnostics - the decision's diagnostics.
 * @returns one debug line.
 */
export function formatDiagnostics(diagnostics: ReactionDiagnostics): string {
  const fields = [
    `turn=${diagnostics.turn}`,
    `eligible=${String(diagnostics.eligible)}`,
    diagnostics.trigger === undefined ? undefined : `trigger=${diagnostics.trigger}`,
    diagnostics.category === undefined ? undefined : `category=${diagnostics.category}`,
    `probability=${diagnostics.probability.toFixed(2)}`,
    diagnostics.roll === undefined ? undefined : `roll=${diagnostics.roll.toFixed(4)}`,
    `candidates=${diagnostics.candidateCount}`,
    diagnostics.selected === undefined ? undefined : `selected=${diagnostics.selected}`,
    diagnostics.reason === undefined ? undefined : `reason=${diagnostics.reason}`,
  ].filter((field): field is string => field !== undefined)
  return `dsh-meme debug ${fields.join(' ')}`
}

/** A logger bound to a sink and a verbosity. */
export interface ReactionLogger {
  /** Record one decision. */
  decision(decision: ReactionDecision): void
  /** Record decision diagnostics, when debug logging is on. */
  debug(diagnostics: ReactionDiagnostics): void
  /** Record one plain operational notice (load failures and the like). */
  notice(message: string): void
}

/**
 * Build a logger.
 * @param options - sink, switches, and an injectable clock.
 * @returns the logger; a disabled logger is a no-op rather than a null check at every call site.
 */
export function createLogger(options: {
  readonly sink: LogSink
  readonly enabled: boolean
  readonly debug: boolean
  readonly now?: () => Date
}): ReactionLogger {
  const { sink, enabled, debug } = options
  const now = options.now ?? (() => new Date())
  return {
    decision(decision) {
      if (!enabled) return
      sink(formatRecord(toLogRecord(decision, now)))
    },
    debug(diagnostics) {
      if (!enabled || !debug) return
      sink(formatDiagnostics(diagnostics))
    },
    notice(message) {
      if (!enabled) return
      sink(`dsh-meme ${message}`)
    },
  }
}
