/**
 * The meme reaction Conversation Node.
 *
 * This is where "ANSWER != REACTION" is actually enforced. The Definition is a
 * peer of the assistant's own node, not a decorator on it: it owns a separate
 * `chat` view node with its own key, anchored just after the turn's closing
 * event. The assistant's markdown is never read, rewritten, or appended to.
 *
 *     turn/start ... assistant/message ... turn/end
 *                                              |
 *                                              +-- meme-reaction node
 *
 * Replay safety comes from the Definition being a pure fold over the turn's own
 * durable events: `buildViewNode` re-derives the decision with
 * {@link decideTurn} every time it runs, seeded from the session id and turn
 * number. Nothing is drawn at render time, so re-mounting, reloading, or
 * resuming reproduces the identical meme.
 * @module dsh-meme/ui/conversation-node
 */

import type { MemeConfig } from '../domain/config.ts'
import type { MemeLibrary } from '../domain/meme.ts'
import type { MemeReaction } from '../domain/reaction.ts'
import { decideTurn } from '../engine/decide.ts'
import type { TurnInput } from '../engine/decide.ts'
import { groupTurns } from '../engine/fold.ts'
import type { LogEvent } from '../engine/fold.ts'
import { INITIAL_STATE } from '../session/state.ts'
import type { SessionReactionState } from '../session/state.ts'
import type {
  ChatConversationViewNode,
  ClientSessionEvent,
  ConversationEventRegistry,
  ConversationMatch,
  ConversationNodeContext,
  ConversationNodeDefinition,
} from './client-contract.ts'

/** The node kind, and the renderer key the chat slot dispatches on. */
export const MEME_NODE_KIND = 'meme-reaction'

/** Where the reaction node sits relative to the turn's closing event. */
const ANCHOR_OFFSET = 0.2

/** The payload the React renderer receives. */
export interface MemeReactionChatData {
  readonly reaction: MemeReaction
  /** Ready-to-use asset URL for this meme. */
  readonly src: string
  /** Accessible description; never empty. */
  readonly alt: string
}

/** Definition state: the turn's events, accumulated in log order. */
export interface MemeNodeState {
  readonly turn: number
  readonly events: readonly LogEvent[]
}

/** Everything the Definition needs from its host to decide a reaction. */
export interface MemeNodeEnvironment {
  /** The validated library, mirrored into the client. */
  readonly library: MemeLibrary
  /** Resolved plugin config. */
  readonly config: MemeConfig
  /** Durable session id; seeds the deterministic draw. */
  readonly sessionId: string
  /**
   * Reaction state accumulated over turns before this one.
   *
   * The conversation engine assembles one Context per turn, so a Definition
   * cannot see earlier turns' Contexts. The host supplies the prior state,
   * folded from the same durable log.
   * @param turn - the turn being rendered.
   * @returns the state as of just before `turn`.
   */
  stateBefore(turn: number): SessionReactionState
  /**
   * Build the asset URL for a meme id.
   * @param memeId - the selected meme.
   * @returns a URL the browser can load.
   */
  assetUrl(memeId: string): string
}

/** Read a finite turn number from an event payload. */
function turnOf(event: ClientSessionEvent): number | undefined {
  const data = event.data
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return undefined
  const turn = (data as Record<string, unknown>)['turn']
  return typeof turn === 'number' && Number.isFinite(turn) ? turn : undefined
}

/** The events this Definition folds. `assistant/chunk` is deliberately absent. */
const MATCHED_TYPES: ReadonlySet<string> = new Set([
  'turn/start',
  'turn/end',
  'user/message',
  'assistant/message',
  'tool/call',
  'tool/result',
])

/** Reduce a Context's matches to the turn input, in log order. */
function inputForContext(context: ConversationNodeContext<MemeNodeState>): TurnInput | undefined {
  const events = context.state?.events
    ?? context.matches.map(match => match.event as LogEvent)
  const grouped = groupTurns([...events].sort((left, right) => left.seq - right.seq))
  return grouped[0]
}

/**
 * Build the meme reaction Definition.
 *
 * @param environment - library, config, session identity, and URL builder.
 * @returns the Definition to hand to `ctx.conversationEvents.register`.
 */
export function createMemeConversationNode(
  environment: MemeNodeEnvironment,
): ConversationNodeDefinition<MemeNodeState> {
  return {
    kind: MEME_NODE_KIND,
    target: 'chat',

    match(event) {
      if (!MATCHED_TYPES.has(event.type)) return null
      const turn = turnOf(event)
      if (turn === undefined) return null
      // `turn/start` opens the Context so the fold sees the turn from its
      // first event; everything else updates it.
      return { id: String(turn), role: event.type === 'turn/start' ? 'start' : 'update' }
    },

    start(_context, match: ConversationMatch) {
      const turn = turnOf(match.event) ?? 0
      return { turn, events: [match.event as LogEvent] }
    },

    update(context, match: ConversationMatch) {
      return {
        ...context.state,
        events: [...context.state.events, match.event as LogEvent],
      }
    },

    buildViewNode(context): ChatConversationViewNode | null {
      const input = inputForContext(context)
      // An open turn has no answer yet: render nothing rather than a
      // placeholder that would pop into a meme mid-stream.
      if (input === undefined || !input.complete) return null

      const outcome = decideTurn(
        environment.stateBefore(input.turn),
        input,
        environment.library,
        environment.config,
        environment.sessionId,
      )
      if (outcome.decision.kind !== 'reaction') return null

      const { reaction } = outcome.decision
      const data: MemeReactionChatData = {
        reaction,
        src: environment.assetUrl(reaction.memeId),
        alt: reaction.label,
      }
      return {
        key: context.key,
        kind: MEME_NODE_KIND,
        id: context.id,
        target: 'chat',
        // Sits just after the turn's closing event so the reaction reads as a
        // response to the finished turn, never as part of the answer above it.
        anchorSeq: reaction.anchorSeq + ANCHOR_OFFSET,
        location: context.start?.location ?? { kind: 'unresolved' },
        visibility: 'visible',
        data,
      }
    },
  }
}

/**
 * Register the Definition for the caller's lifetime.
 *
 * The registry returns an idempotent disposer backed by `ctx.effect`, so a hot
 * reload removes the previous Definition before the new one registers. Skipping
 * that is what produces two, then three, meme nodes per turn after a few HMR
 * cycles.
 * @param registry - the client runtime's `conversationEvents` registry.
 * @param environment - library, config, session identity, and URL builder.
 * @returns the disposer.
 */
export function registerMemeConversationNode(
  registry: ConversationEventRegistry,
  environment: MemeNodeEnvironment,
): () => void {
  return registry.register(
    createMemeConversationNode(environment) as unknown as ConversationNodeDefinition<never>,
  )
}

/** The state supplier used when no prior-turn state is available. */
export const NO_PRIOR_STATE = (): SessionReactionState => INITIAL_STATE
