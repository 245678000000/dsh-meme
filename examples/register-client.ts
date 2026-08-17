/**
 * Registering the reaction node in a Harness Web Client build.
 *
 * This file lives in `examples/` rather than `src/` because this repository
 * cannot import `@deepseek-ai/dsh-client-runtime` (its published build has an
 * unresolvable dependency — see docs/harness-integration.md). Inside the
 * harness workspace the imports below resolve, and this is the whole
 * integration.
 */

import type { Context } from '@deepseek-ai/cordis'
import { MEME_NODE_KIND, registerMemeConversationNode } from 'dsh-meme/client'
import { MemeReaction } from 'dsh-meme/client'
import type { MemeConfig, MemeLibrary, SessionReactionState } from 'dsh-meme/core'
import { ASSET_ROUTE_PREFIX, INITIAL_STATE } from 'dsh-meme/core'

/** What the deployment must ship to the browser for the node to render. */
export interface MemeClientData {
  /** The validated library, mirrored from the host. */
  readonly library: MemeLibrary
  /** The resolved plugin config, mirrored from the host. */
  readonly config: MemeConfig
  /** Reaction state as of just before each turn, folded from the same log. */
  stateBefore(turn: number): SessionReactionState
}

/**
 * Register the meme reaction Definition and its renderer.
 * @param ctx - the client plugin context.
 * @param sessionId - the session being rendered.
 * @param data - library, config, and prior-turn state.
 */
export function applyMemeClient(ctx: Context, sessionId: string, data: MemeClientData): void {
  // 1. The Definition. `register` returns an idempotent disposer backed by
  //    ctx.effect, so a hot reload cannot leave two Definitions installed and
  //    render the same turn twice.
  ctx.effect(() => registerMemeConversationNode(ctx.conversationEvents, {
    library: data.library,
    config: data.config,
    sessionId,
    stateBefore: turn => data.stateBefore(turn) ?? INITIAL_STATE,
    assetUrl: memeId => `${ASSET_ROUTE_PREFIX}${encodeURIComponent(memeId)}`,
  }), 'dsh-meme conversation node')

  // 2. The renderer, behind the keyed chat node seat. The key matches the
  //    Definition's `kind`, which is how the chat slot dispatches to it.
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register(
    { name: 'conversation.chat.node', key: MEME_NODE_KIND },
    MemeReaction,
  ))
}
