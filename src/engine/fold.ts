/**
 * Fold a durable session log into reaction decisions.
 *
 * This module is the replay guarantee. It reads only events that are already in
 * the session log, in log order, and derives every input the decision needs. The
 * host folds it to log decisions; the browser folds it to render them. Same
 * input, same pure function, same output, so a page reload cannot change a meme
 * that was already on screen.
 *
 * Events are read structurally rather than through the harness `SessionEvent`
 * union, which keeps this core dependency-free (and therefore trivially
 * testable) while staying compatible with the real event shapes.
 * @module dsh-meme/engine/fold
 */

import type { MemeConfig } from '../domain/config.ts'
import type { MemeLibrary } from '../domain/meme.ts'
import type { ReactionDecision } from '../domain/reaction.ts'
import type { TurnInput } from './decide.ts'
import { decideTurn } from './decide.ts'
import type { SessionReactionState } from '../session/state.ts'
import { INITIAL_STATE } from '../session/state.ts'

/** The structural shape this fold needs from a session log entry. */
export interface LogEvent {
  readonly type: string
  readonly seq: number
  readonly data: unknown
}

/** Read a record field without trusting its presence or type. */
function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

/** Read a finite turn number from an event payload. */
function turnOf(event: LogEvent): number | undefined {
  const turn = record(event.data)?.['turn']
  return typeof turn === 'number' && Number.isFinite(turn) ? turn : undefined
}

/**
 * Concatenate the text blocks of a message payload.
 *
 * Only `text` blocks are read. Reasoning is the model's private scratchpad and
 * must not steer a user-visible reaction; tool calls and images carry no mood.
 */
function messageText(message: unknown): string {
  const content = record(message)?.['content']
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const block of content) {
    const entry = record(block)
    if (entry?.['type'] !== 'text') continue
    const text = entry['text']
    if (typeof text === 'string') parts.push(text)
  }
  return parts.join('\n')
}

/** Whether a `user/message` event came from the human rather than an injection. */
function isHumanMessage(data: Record<string, unknown> | undefined): boolean {
  const source = record(data?.['source'])
  // Injected context (`plugin`) and tool results are not the user talking.
  return source?.['kind'] === 'user'
}

/** Mutable accumulator for one turn while its events are still arriving. */
interface TurnAccumulator {
  turn: number
  anchorSeq: number
  userText: string[]
  assistantText: string[]
  toolCalls: number
  toolErrors: number
  aborted: boolean
  complete: boolean
}

/** Start a fresh accumulator for a turn. */
function openTurn(turn: number, seq: number): TurnAccumulator {
  return {
    turn,
    anchorSeq: seq,
    userText: [],
    assistantText: [],
    toolCalls: 0,
    toolErrors: 0,
    aborted: false,
    complete: false,
  }
}

/** Freeze an accumulator into the decision engine's input. */
function toInput(accumulator: TurnAccumulator): TurnInput {
  return {
    turn: accumulator.turn,
    anchorSeq: accumulator.anchorSeq,
    complete: accumulator.complete,
    userText: accumulator.userText.join('\n'),
    assistantText: accumulator.assistantText.join('\n'),
    toolCalls: accumulator.toolCalls,
    toolErrors: accumulator.toolErrors,
    aborted: accumulator.aborted,
  }
}

/**
 * Group a session log into per-turn inputs, in turn order.
 *
 * `assistant/chunk` is deliberately ignored: the assembled `assistant/message`
 * is the durable record of what the model said, and folding chunks would make
 * a live turn and a replayed one produce different text.
 * @param events - the session log, in order.
 * @returns one input per turn seen, in ascending turn order.
 */
export function groupTurns(events: readonly LogEvent[]): readonly TurnInput[] {
  const turns = new Map<number, TurnAccumulator>()
  const ordered: TurnAccumulator[] = []

  const accumulatorFor = (turn: number, seq: number): TurnAccumulator => {
    const existing = turns.get(turn)
    if (existing !== undefined) return existing
    const created = openTurn(turn, seq)
    turns.set(turn, created)
    ordered.push(created)
    return created
  }

  for (const event of events) {
    const data = record(event.data)
    const turn = turnOf(event)
    if (turn === undefined) continue
    const accumulator = accumulatorFor(turn, event.seq)

    switch (event.type) {
      case 'user/message': {
        if (isHumanMessage(data)) accumulator.userText.push(messageText(event.data))
        break
      }
      case 'assistant/message': {
        accumulator.assistantText.push(messageText(data?.['message']))
        break
      }
      case 'tool/call': {
        accumulator.toolCalls += 1
        break
      }
      case 'tool/result': {
        if (data?.['error'] !== undefined) accumulator.toolErrors += 1
        break
      }
      case 'turn/end': {
        accumulator.complete = true
        accumulator.anchorSeq = event.seq
        const reason = record(data?.['reason'])?.['kind']
        accumulator.aborted = reason !== undefined && reason !== 'completed'
        break
      }
      default:
        break
    }
  }

  return ordered.map(toInput)
}

/** Every decision derived from one session log. */
export interface FoldResult {
  /** Decisions keyed by turn, including skips. */
  readonly byTurn: ReadonlyMap<number, ReactionDecision>
  /** Reaction state after the last decided turn. */
  readonly state: SessionReactionState
}

/**
 * Fold a whole session log into its reaction decisions.
 *
 * Deterministic in its inputs: the same log, library, config, and session id
 * always produce the same decisions.
 * @param events - the session log, in order.
 * @param library - the validated meme library.
 * @param config - resolved plugin config.
 * @param sessionId - durable session id; seeds every draw.
 * @returns the per-turn decisions and the resulting state.
 */
export function foldSessionLog(
  events: readonly LogEvent[],
  library: MemeLibrary,
  config: MemeConfig,
  sessionId: string,
): FoldResult {
  const byTurn = new Map<number, ReactionDecision>()
  let state = INITIAL_STATE
  for (const input of groupTurns(events)) {
    if (!input.complete) continue
    const outcome = decideTurn(state, input, library, config, sessionId)
    state = outcome.state
    byTurn.set(input.turn, outcome.decision)
  }
  return { byTurn, state }
}
