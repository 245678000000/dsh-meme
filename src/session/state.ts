/**
 * Per-session reaction state.
 *
 * Every field is derivable from the durable session log, which is what makes a
 * replayed session reproduce its reactions exactly. The state is immutable and
 * bounded: `recent` is trimmed on every write, so a long session cannot grow
 * this structure without limit.
 * @module dsh-meme/session/state
 */

import type { MemeCategory } from '../domain/meme.ts'

/** Reaction bookkeeping for one session. */
export interface SessionReactionState {
  /** How many turns have been decided so far. Drives warmup. */
  readonly turnsSeen: number
  /** Turn number of the most recent reaction, or undefined when none landed. */
  readonly lastReactionTurn: number | undefined
  /** Meme shown by the most recent reaction. */
  readonly lastMemeId: string | undefined
  /** Category of the most recent reaction. */
  readonly lastCategory: MemeCategory | undefined
  /** Recently shown meme ids, most recent first, bounded by config. */
  readonly recent: readonly string[]
  /** Whether the user turned reactions off for this session. */
  readonly disabled: boolean
}

/** The state a session starts in. */
export const INITIAL_STATE: SessionReactionState = {
  turnsSeen: 0,
  lastReactionTurn: undefined,
  lastMemeId: undefined,
  lastCategory: undefined,
  recent: [],
  disabled: false,
}

/**
 * Record that a reaction landed.
 * @param state - state before this turn.
 * @param turn - the turn that reacted.
 * @param memeId - the meme shown.
 * @param category - the category selected.
 * @param historyLimit - how many recent ids to retain.
 * @returns the state after the reaction.
 */
export function withReaction(
  state: SessionReactionState,
  turn: number,
  memeId: string,
  category: MemeCategory,
  historyLimit: number,
): SessionReactionState {
  return {
    ...state,
    turnsSeen: state.turnsSeen + 1,
    lastReactionTurn: turn,
    lastMemeId: memeId,
    lastCategory: category,
    recent: [memeId, ...state.recent.filter(id => id !== memeId)].slice(0, Math.max(0, historyLimit)),
  }
}

/**
 * Record that a turn was decided without a reaction.
 * @param state - state before this turn.
 * @returns the state after the skipped turn.
 */
export function withSkip(state: SessionReactionState): SessionReactionState {
  return { ...state, turnsSeen: state.turnsSeen + 1 }
}

/**
 * Apply a session-scoped enable/disable request.
 *
 * Session scope is deliberate: "今天别发表情包" must not silently rewrite the
 * user's global config and mute every future session.
 * @param state - current state.
 * @param disabled - the requested session-local switch.
 * @returns the updated state.
 */
export function withDisabled(state: SessionReactionState, disabled: boolean): SessionReactionState {
  return { ...state, disabled }
}
