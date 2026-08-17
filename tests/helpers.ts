/**
 * Test helpers: a small builder for realistic session logs.
 *
 * The event shapes mirror the harness `SessionEventMap` members this plugin
 * reads (`turn/start`, `user/message`, `assistant/message`, `tool/call`,
 * `tool/result`, `turn/end`), so the fold is exercised against the real
 * structure rather than a convenient invention.
 * @module dsh-meme/tests/helpers
 */

import { join } from 'node:path'
import type { LogEvent } from '../src/engine/fold.ts'
import type { MemeConfig } from '../src/domain/config.ts'
import { DEFAULT_CONFIG } from '../src/domain/config.ts'
import { loadLibrary } from '../src/assets/manifest.ts'
import type { ResolvedLibrary } from '../src/assets/manifest.ts'

/** Absolute path to the generated fixture asset root. */
export const FIXTURE_ROOT = join(import.meta.dirname, '..', 'fixtures', 'memes')

/** The fixture library, loaded once per test module. */
export function fixtureLibrary(): ResolvedLibrary {
  const { library, error } = loadLibrary(FIXTURE_ROOT)
  if (error !== undefined) throw new Error(`fixture library failed to load: ${error}`)
  return library
}

/** Build a config from the defaults with the given overrides. */
export function config(overrides: Partial<MemeConfig> = {}): MemeConfig {
  return { ...DEFAULT_CONFIG, ...overrides }
}

/** Options for one synthetic turn. */
export interface TurnSpec {
  /** The human's message for the turn. */
  readonly user?: string
  /** The assistant's answer. */
  readonly assistant?: string
  /** Tool calls made, and how many of them failed. */
  readonly toolCalls?: number
  readonly toolErrors?: number
  /** Leave the turn open (no `turn/end`). */
  readonly open?: boolean
  /** Close the turn with a non-completed reason. */
  readonly aborted?: boolean
}

/** Incrementally builds a session log with correct seq ordering. */
export class LogBuilder {
  private readonly events: LogEvent[] = []
  private nextTurn = 1

  /** @returns the accumulated log. */
  build(): readonly LogEvent[] {
    return [...this.events]
  }

  private push(type: string, data: unknown): void {
    this.events.push({ type, seq: this.events.length, data })
  }

  /**
   * Append one complete turn.
   * @param spec - the turn's content and outcome.
   * @returns this builder, for chaining.
   */
  turn(spec: TurnSpec = {}): this {
    const turn = this.nextTurn
    this.nextTurn += 1
    this.push('turn/start', { turn })

    if (spec.user !== undefined) {
      this.push('user/message', {
        turn,
        role: 'user',
        source: { kind: 'user' },
        content: [{ type: 'text', text: spec.user }],
      })
    }

    const calls = spec.toolCalls ?? 0
    const errors = spec.toolErrors ?? 0
    for (let index = 0; index < calls; index += 1) {
      this.push('tool/call', { turn, step: 1, callId: `c${index}`, name: 'bash', arguments: '{}' })
      this.push('tool/result', {
        turn,
        step: 1,
        message: { role: 'user', content: [] },
        ...(index < errors ? { error: { name: 'Error', code: 'FAILED' } } : {}),
      })
    }

    this.push('assistant/message', {
      turn,
      step: 1,
      message: {
        role: 'assistant',
        source: { kind: 'model' },
        content: [{ type: 'text', text: spec.assistant ?? 'Done.' }],
      },
    })

    if (spec.open !== true) {
      this.push('turn/end', {
        turn,
        reason: spec.aborted === true ? { kind: 'aborted' } : { kind: 'completed' },
      })
    }
    return this
  }

  /**
   * Append several filler turns, used to walk past warmup or cooldown.
   * @param count - how many turns to add.
   * @param spec - the content each filler turn carries.
   * @returns this builder, for chaining.
   */
  turns(count: number, spec: TurnSpec = {}): this {
    for (let index = 0; index < count; index += 1) this.turn(spec)
    return this
  }
}

/** A phrase that must never reach a log line. */
export const PRIVATE_MARKER = 'MY_PRIVATE_PROMPT_123'
