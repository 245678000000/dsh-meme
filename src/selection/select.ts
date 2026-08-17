/**
 * Candidate filtering and final meme selection.
 *
 * Filtering is layered so that scarcity degrades instead of failing: the
 * category filter relaxes to `generic` and then to the whole library, and the
 * no-repeat window shrinks until something remains. A small library must still
 * produce reactions; it must never reach "no meme forever".
 * @module dsh-meme/selection/select
 */

import type { Meme, MemeAssetType, MemeCategory, MemeLibrary } from '../domain/meme.ts'
import type { Rng } from './rng.ts'
import { weightedPick } from './weighted.ts'

/** Everything the selector needs to narrow the library for one turn. */
export interface SelectionRequest {
  /** The classified category this reaction is for. */
  readonly category: MemeCategory
  /** Restrict to animated assets when the user asked for a GIF. */
  readonly gifOnly: boolean
  /** Recently shown meme ids, most recent first. */
  readonly recent: readonly string[]
  /** Meme id shown by the previous reaction, which a follow-up must not repeat. */
  readonly exclude: string | undefined
}

/** Selectable memes: enabled, positively weighted, and of an allowed type. */
function usable(library: MemeLibrary, gifOnly: boolean): readonly Meme[] {
  const allowed: MemeAssetType | undefined = gifOnly ? 'gif' : undefined
  return library.memes.filter(meme =>
    meme.enabled
    && meme.weight > 0
    && (allowed === undefined || meme.type === allowed))
}

/**
 * Progressively relaxed category tiers.
 *
 * An exact category match is best; `generic` memes are the designed fallback;
 * the whole pool is the last resort so a sparse library still reacts.
 *
 * `generic` is not a mood, it is the absence of one, so it does NOT narrow to
 * the generic-tagged subset. Treating it as an exact match would confine every
 * moodless request ("来张表情包" with nothing to react to) to whichever few
 * memes happen to carry the tag, and the user would see the same two images
 * forever.
 */
function categoryTiers(pool: readonly Meme[], category: MemeCategory): readonly (readonly Meme[])[] {
  if (category === 'generic') return [pool]
  const exact = pool.filter(meme => meme.categories.includes(category))
  const generic = pool.filter(meme => meme.categories.includes('generic'))
  return [exact, generic, pool]
}

/**
 * Drop recently shown memes, relaxing the window until something survives.
 * @param candidates - candidates for one tier.
 * @param recent - recently shown ids, most recent first.
 * @param exclude - id that must never be returned, when possible.
 * @returns the largest non-empty filtered set, or the input when nothing survives.
 */
function applyRecency(
  candidates: readonly Meme[],
  recent: readonly string[],
  exclude: string | undefined,
): readonly Meme[] {
  if (candidates.length === 0) return candidates

  // A follow-up must not repeat the previous meme; honour it whenever the tier
  // holds anything else at all.
  const withoutExcluded = exclude === undefined
    ? candidates
    : candidates.filter(meme => meme.id !== exclude)
  const base = withoutExcluded.length > 0 ? withoutExcluded : candidates

  for (let window = recent.length; window > 0; window -= 1) {
    const blocked = new Set(recent.slice(0, window))
    const remaining = base.filter(meme => !blocked.has(meme.id))
    if (remaining.length > 0) return remaining
  }
  return base
}

/**
 * Select one meme for a turn.
 *
 * Exactly one value is drawn from `rng`, and only after the candidate set is
 * final, so the draw is reproducible for a given library and history.
 * @param library - the validated meme library.
 * @param request - category, media constraint, and history.
 * @param rng - deterministic generator.
 * @returns the selected meme, or undefined when nothing is selectable.
 */
export function selectMeme(
  library: MemeLibrary,
  request: SelectionRequest,
  rng: Rng,
): Meme | undefined {
  const pool = usable(library, request.gifOnly)
  if (pool.length === 0) return undefined

  for (const tier of categoryTiers(pool, request.category)) {
    if (tier.length === 0) continue
    const candidates = applyRecency(tier, request.recent, request.exclude)
    const picked = weightedPick(candidates, rng)
    if (picked !== undefined) return picked
  }
  return undefined
}

/**
 * The bounded candidate shortlist handed to the model in `agent` selection mode.
 *
 * Bounded on purpose: a library of 500 assets must never become 500 lines of
 * model context. Only id, label, and category travel; no paths, no file bytes.
 * @param library - the validated meme library.
 * @param request - category and media constraint.
 * @param limit - maximum candidates to return.
 * @returns the shortlist, best-matching tier first.
 */
export function shortlistCandidates(
  library: MemeLibrary,
  request: SelectionRequest,
  limit: number,
): readonly Meme[] {
  const pool = usable(library, request.gifOnly)
  const shortlist: Meme[] = []
  const seen = new Set<string>()
  for (const tier of categoryTiers(pool, request.category)) {
    for (const meme of applyRecency(tier, request.recent, request.exclude)) {
      if (seen.has(meme.id)) continue
      seen.add(meme.id)
      shortlist.push(meme)
      if (shortlist.length >= limit) return shortlist
    }
  }
  return shortlist
}
