/**
 * The reaction pipeline: one pure function from a finished turn to a decision.
 *
 * Purity is the whole design. The host runs this to log a decision and the
 * browser runs it to render one; because both consume the same durable session
 * facts and a seed derived from them, they cannot disagree, and a page reload
 * cannot re-roll a meme that was already shown.
 *
 *     TURN FINISHED -> ELIGIBLE? -> TRIGGER -> CLASSIFY -> FILTER
 *                                                -> RECENCY -> SELECT -> DECISION
 * @module dsh-meme/engine/decide
 */

import type { MemeConfig } from '../domain/config.ts'
import type { MemeLibrary } from '../domain/meme.ts'
import type {
  ReactionDecision, ReactionDiagnostics, ReactionTrigger, SkipReason,
} from '../domain/reaction.ts'
import { memeAltText } from '../domain/meme.ts'
import type { TurnFacts } from '../eligibility/classifier.ts'
import { classifyTurn } from '../eligibility/classifier.ts'
import type { UserIntent } from '../eligibility/explicit.ts'
import { detectIntent } from '../eligibility/explicit.ts'
import { isSeriousContent } from '../eligibility/serious.ts'
import { isCodeHeavy, isStructuredOutputRequest } from '../eligibility/structured.ts'
import { selectMeme } from '../selection/select.ts'
import { turnRng } from '../selection/rng.ts'
import type { SessionReactionState } from '../session/state.ts'
import { withDisabled, withReaction, withSkip } from '../session/state.ts'

/** One finished turn, reduced to exactly what the decision needs. */
export interface TurnInput extends TurnFacts {
  /** Turn number from `turn/start` / `turn/end`. */
  readonly turn: number
  /** Log seq of the turn's closing event; the UI anchors the node here. */
  readonly anchorSeq: number
  /** False while the turn is still open; an open turn is never decided. */
  readonly complete: boolean
}

/** A decision plus the state it produces and the diagnostics explaining it. */
export interface DecisionOutcome {
  readonly decision: ReactionDecision
  readonly state: SessionReactionState
  readonly diagnostics: ReactionDiagnostics
}

/** Build the skip half of an outcome, keeping diagnostics consistent. */
function skip(
  turn: number,
  reason: SkipReason,
  state: SessionReactionState,
  config: MemeConfig,
  partial: Partial<ReactionDiagnostics> = {},
): DecisionOutcome {
  return {
    decision: { kind: 'skip', turn, reason },
    // A turn that was never a candidate (disabled, or still open) does not
    // advance warmup: warmup counts turns the user actually experienced with
    // the layer live.
    state: reason === 'turn-incomplete' ? state : withSkip(state),
    diagnostics: {
      turn,
      eligible: false,
      trigger: undefined,
      category: undefined,
      probability: config.probability,
      roll: undefined,
      candidateCount: 0,
      selected: undefined,
      reason,
      ...partial,
    },
  }
}

/**
 * Resolve which trigger, if any, applies to this turn.
 *
 * A follow-up phrase only counts as a follow-up when the previous turn actually
 * showed a meme; otherwise "还有吗" is an ordinary question about the answer and
 * must not be hijacked.
 */
function resolveTrigger(
  intent: UserIntent,
  state: SessionReactionState,
  turn: number,
): ReactionTrigger {
  if (intent.followup && state.lastReactionTurn === turn - 1) return 'followup'
  if (intent.explicit) return 'explicit'
  // A bare "来个动图" is an explicit request even without the word "表情包".
  if (intent.gifOnly && intent.followup) return 'followup'
  return 'automatic'
}

/**
 * Decide whether one finished turn gets a reaction.
 * @param state - reaction state accumulated from earlier turns.
 * @param input - the finished turn's durable facts.
 * @param library - the validated meme library.
 * @param config - resolved plugin config.
 * @param sessionId - durable session id; seeds the deterministic draw.
 * @returns the decision, the next state, and privacy-safe diagnostics.
 */
export function decideTurn(
  state: SessionReactionState,
  input: TurnInput,
  library: MemeLibrary,
  config: MemeConfig,
  sessionId: string,
): DecisionOutcome {
  const { turn } = input

  // An open turn has no answer to react to yet.
  if (!input.complete) return skip(turn, 'turn-incomplete', state, config)

  const intent = detectIntent(input.userText)

  // Session-scoped opt-out is honoured before anything else, and opt-in
  // restores the layer without touching global config.
  if (intent.optOut) {
    return { ...skip(turn, 'user-opt-out', withDisabled(state, true), config) }
  }
  const live = intent.optIn ? withDisabled(state, false) : state

  if (!config.enabled) return skip(turn, 'disabled', live, config)
  if (live.disabled) return skip(turn, 'user-opt-out', live, config)

  const trigger = resolveTrigger(intent, live, turn)
  const explicitish = trigger !== 'automatic'

  const serious = config.seriousSuppression
    && isSeriousContent(input.userText, input.assistantText)
  // Serious content suppresses automatic reactions always, and explicit ones
  // too when the deployment asked for strict handling.
  if (serious && (!explicitish || config.strictSeriousSuppression)) {
    return skip(turn, 'serious', live, config)
  }

  // Automatic reactions alone are gated on rhythm and output shape; a user who
  // asked for a meme gets one regardless of warmup, cooldown, and probability.
  if (!explicitish) {
    if (isStructuredOutputRequest(input.userText)) return skip(turn, 'structured-output', live, config)
    if (isCodeHeavy(input.assistantText)) return skip(turn, 'code-heavy', live, config)
    if (live.turnsSeen < config.warmupTurns) return skip(turn, 'warmup', live, config)
    if (
      live.lastReactionTurn !== undefined
      && turn - live.lastReactionTurn <= config.cooldownTurns
    ) {
      return skip(turn, 'cooldown', live, config)
    }
  }

  if (library.memes.length === 0) return skip(turn, 'no-assets', live, config)

  const classification = classifyTurn(input)
  // An explicit request always resolves to a category: the user asked, so a
  // thin mood signal falls back to the library's generic pool rather than
  // refusing. An automatic reaction needs real evidence.
  const category = classification?.category
    ?? (explicitish ? (live.lastCategory ?? 'generic') : undefined)
  if (category === undefined) return skip(turn, 'no-category-match', live, config)

  // The probability roll happens last among the gates so that a skipped turn
  // costs nothing but the classification, and so the roll is only consumed for
  // turns that were otherwise going to react.
  const rng = turnRng(sessionId, turn)
  let roll: number | undefined
  if (!explicitish) {
    roll = rng.next()
    if (roll >= config.probability) {
      return skip(turn, 'probability', live, config, { trigger, category, roll })
    }
  }

  const meme = selectMeme(library, {
    category,
    gifOnly: intent.gifOnly && config.allowGif,
    recent: live.recent.slice(0, config.recentHistory),
    exclude: trigger === 'followup' ? live.lastMemeId : undefined,
  }, rng)

  if (meme === undefined) {
    return skip(turn, 'no-assets', live, config, { trigger, category, roll })
  }

  return {
    decision: {
      kind: 'reaction',
      reaction: {
        reactionId: `${sessionId}:${turn}`,
        turn,
        anchorSeq: input.anchorSeq,
        memeId: meme.id,
        assetType: meme.type,
        category,
        trigger,
        label: memeAltText(meme),
      },
    },
    state: withReaction(live, turn, meme.id, category, config.recentHistory),
    diagnostics: {
      turn,
      eligible: true,
      trigger,
      category,
      probability: config.probability,
      roll,
      candidateCount: library.memes.length,
      selected: meme.id,
      reason: undefined,
    },
  }
}
