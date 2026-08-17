/**
 * Weighted selection over a candidate set, driven by an injected {@link Rng}.
 * @module dsh-meme/selection/weighted
 */

import type { Meme } from '../domain/meme.ts'
import type { Rng } from './rng.ts'

/**
 * Pick one meme with probability proportional to its weight.
 *
 * Candidates are consumed in the order given, and exactly one value is drawn
 * from `rng`, so a caller replaying the same list with the same seed always
 * gets the same meme.
 * @param candidates - non-empty candidate list; non-positive weights are ignored.
 * @param rng - deterministic generator.
 * @returns the selected meme, or undefined when no candidate has positive weight.
 */
export function weightedPick(candidates: readonly Meme[], rng: Rng): Meme | undefined {
  let total = 0
  for (const candidate of candidates) {
    if (candidate.weight > 0) total += candidate.weight
  }
  if (total <= 0) return undefined

  let threshold = rng.next() * total
  for (const candidate of candidates) {
    if (candidate.weight <= 0) continue
    threshold -= candidate.weight
    if (threshold < 0) return candidate
  }
  // Floating-point drift can exhaust the loop; the last positive-weight
  // candidate is the correct answer rather than a failure.
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const candidate = candidates[index]
    if (candidate !== undefined && candidate.weight > 0) return candidate
  }
  return undefined
}
