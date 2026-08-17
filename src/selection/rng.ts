/**
 * Deterministic RNG. Reaction selection must reproduce exactly on replay, so
 * randomness is derived from durable session facts, never from `Math.random`.
 * @module dsh-meme/selection/rng
 */

/** A 0..1 generator. Injected everywhere randomness is consumed, so tests are never flaky. */
export interface Rng {
  /** @returns the next value in [0, 1). */
  next(): number
}

/**
 * FNV-1a over a string, returned as an unsigned 32-bit integer.
 * @param text - seed material.
 * @returns a 32-bit hash.
 */
export function hashString(text: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash >>> 0
}

/**
 * A mulberry32 generator: small, fast, and identical across host and browser,
 * which is what makes host-side logging agree with client-side rendering.
 * @param seed - unsigned 32-bit seed.
 * @returns a deterministic generator.
 */
export function createRng(seed: number): Rng {
  let state = seed >>> 0
  return {
    next(): number {
      state = (state + 0x6d2b79f5) >>> 0
      let t = state
      t = Math.imul(t ^ (t >>> 15), t | 1)
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    },
  }
}

/**
 * The generator for one turn's decision. Seeded from durable facts only, so
 * reloading the page, resuming the session, or replaying the log all reproduce
 * the same rolls: the property that keeps a rendered meme from changing.
 * @param sessionId - the session's durable id.
 * @param turn - the turn being decided.
 * @param salt - distinguishes independent draws within one turn.
 * @returns a deterministic generator for that turn.
 */
export function turnRng(sessionId: string, turn: number, salt = ''): Rng {
  return createRng(hashString(`dsh-meme ${sessionId} ${turn} ${salt}`))
}
