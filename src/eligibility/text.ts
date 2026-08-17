/**
 * Shared text utilities for the local classifier.
 *
 * The whole eligibility layer reads text through this module so that one rule
 * holds everywhere: a keyword only counts when it is not negated. A bare regex
 * would read "测试没有失败" ("the tests did not fail") as a failure, which is
 * exactly the misfire that makes a meme layer feel stupid.
 * @module dsh-meme/eligibility/text
 */

/** Longest negation cue considered, in characters, when scanning backwards. */
const NEGATION_WINDOW = 12

/**
 * Negation cues placed BEFORE the keyword. Chinese negation is preposed
 * ("没有失败"), and so is English ("did not fail", "no errors").
 */
const NEGATION_CUES: readonly string[] = [
  '没有', '没', '不再', '不会', '不是', '不曾', '未曾', '未', '无', '别', '不',
  'not ', "n't ", 'no ', 'never ', 'without ', 'avoid ', 'avoids ', 'avoided ',
  'zero ', 'free of ', 'free from ',
]

/**
 * Normalize text for matching: lowercased and whitespace-collapsed.
 *
 * Case folding is applied to the whole string; Chinese is unaffected by it, and
 * English keywords are authored lowercase.
 * @param text - raw text.
 * @returns normalized text safe to run keyword scans against.
 */
export function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim()
}

/**
 * Whether the keyword occurrence at `index` is negated by a preceding cue.
 * @param text - normalized haystack.
 * @param index - start offset of the keyword occurrence.
 * @returns true when a negation cue sits immediately before the occurrence.
 */
export function isNegatedAt(text: string, index: number): boolean {
  const start = Math.max(0, index - NEGATION_WINDOW)
  const before = text.slice(start, index)
  return NEGATION_CUES.some(cue => before.endsWith(cue))
}

/**
 * Count non-negated occurrences of a keyword.
 * @param text - normalized haystack.
 * @param keyword - normalized needle.
 * @returns how many times the keyword appears un-negated.
 */
export function countUnnegated(text: string, keyword: string): number {
  if (keyword.length === 0) return 0
  let count = 0
  let from = 0
  for (;;) {
    const index = text.indexOf(keyword, from)
    if (index === -1) return count
    if (!isNegatedAt(text, index)) count += 1
    from = index + keyword.length
  }
}

/**
 * Whether any keyword appears un-negated.
 * @param text - normalized haystack.
 * @param keywords - normalized needles.
 * @returns true when at least one keyword appears un-negated.
 */
export function matchesAny(text: string, keywords: readonly string[]): boolean {
  return keywords.some(keyword => countUnnegated(text, keyword) > 0)
}

/**
 * Fenced code block spans in the text, as `[start, end)` offsets.
 * @param text - raw text.
 * @returns the character length covered by fenced code blocks.
 */
export function fencedCodeLength(text: string): number {
  const fence = /```[\s\S]*?(?:```|$)/g
  let total = 0
  for (const match of text.matchAll(fence)) total += match[0].length
  return total
}

/**
 * The share of the text occupied by fenced code, in 0..1.
 * @param text - raw assistant text.
 * @returns the code ratio; 0 for empty text.
 */
export function codeRatio(text: string): number {
  if (text.length === 0) return 0
  return Math.min(1, fencedCodeLength(text) / text.length)
}
