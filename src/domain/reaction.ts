/**
 * The reaction record and the vocabulary describing why a turn did or did not
 * get one. This is the contract the UI renders and the logger reports.
 * @module dsh-meme/domain/reaction
 */

import type { MemeAssetType, MemeCategory } from './meme.ts'

/** What caused a reaction to be considered for this turn. */
export type ReactionTrigger = 'automatic' | 'explicit' | 'followup'

/** Every reason a turn can end without a reaction. Stable strings: logs and tests match on them. */
export type SkipReason =
  | 'disabled'
  | 'warmup'
  | 'cooldown'
  | 'probability'
  | 'serious'
  | 'structured-output'
  | 'code-heavy'
  | 'user-opt-out'
  | 'no-assets'
  | 'no-category-match'
  | 'agent-declined'
  | 'turn-incomplete'

/** One decided reaction, anchored to the turn that produced it. */
export interface MemeReaction {
  /** Deterministic per-session identity: `${sessionId}:${turn}`. */
  readonly reactionId: string
  /** Turn number this reaction reacts to. */
  readonly turn: number
  /** Log seq the UI anchors the node at (the turn's closing event). */
  readonly anchorSeq: number
  /** Selected meme id; resolve against the library for the asset. */
  readonly memeId: string
  /** Media kind, so the UI can label GIFs without touching the file. */
  readonly assetType: MemeAssetType
  /** Category that drove selection. */
  readonly category: MemeCategory
  /** Why this reaction happened. */
  readonly trigger: ReactionTrigger
  /** Accessible caption for the image. */
  readonly label: string
}

/** The decision for one turn: a reaction, or a reason there is none. */
export type ReactionDecision =
  | { readonly kind: 'reaction'; readonly reaction: MemeReaction }
  | { readonly kind: 'skip'; readonly turn: number; readonly reason: SkipReason }

/** Decision diagnostics for `/meme debug`. Carries no message text, ever. */
export interface ReactionDiagnostics {
  readonly turn: number
  readonly eligible: boolean
  readonly trigger: ReactionTrigger | undefined
  readonly category: MemeCategory | undefined
  readonly probability: number
  readonly roll: number | undefined
  readonly candidateCount: number
  readonly selected: string | undefined
  readonly reason: SkipReason | undefined
}
