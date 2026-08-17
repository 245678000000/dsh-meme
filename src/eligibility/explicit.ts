/**
 * User-intent detection: explicit meme requests, GIF-only requests, follow-up
 * requests, and opt-out. These read the user's own message only, never the
 * assistant's answer.
 * @module dsh-meme/eligibility/explicit
 */

import { matchesAny, normalize } from './text.ts'

/** Phrases that explicitly ask for a reaction image. */
const EXPLICIT_REQUEST: readonly string[] = [
  '来张表情包', '来个表情包', '来点表情包', '来张表情', '来个表情',
  '配个图', '配张图', '来张图', '来个图', '发个表情', '发张表情包',
  '来个梗图', '来张梗图', '整个表情包', '整个梗图',
  '来个meme', '来张meme', '来个动图', '来张动图', '来个gif', '来张gif',
  'send a meme', 'send meme', 'meme please', 'give me a meme', 'gimme a meme',
  'post a meme', 'drop a meme', 'react with a meme', 'a meme please',
]

/** Phrases that constrain the request to animated assets. */
const GIF_REQUEST: readonly string[] = [
  '动图', 'gif', 'gifs', '动态图', '会动的图',
]

/** Phrases asking for another reaction after one was shown. */
const FOLLOWUP_REQUEST: readonly string[] = [
  '还有吗', '还有么', '换一个', '换一张', '再来一个', '再来一张', '再来个', '下一个',
  '别的呢', '还有别的吗',
  'another one', 'another meme', 'one more', 'next one', 'got any more',
  'any more', 'something else', 'different one',
]

/** Phrases turning reactions off for this session. */
const OPT_OUT: readonly string[] = [
  '不要表情包', '别发表情包', '别发图', '不要发图', '不要梗图', '别整表情包',
  '关掉表情包', '关闭表情包', '安静点',
  'no memes', 'no meme', 'stop memes', 'disable memes', 'serious mode',
  'turn off memes', 'without memes',
]

/** Phrases turning reactions back on for this session. */
const OPT_IN: readonly string[] = [
  '开启表情包', '打开表情包', '可以发表情包', '恢复表情包',
  'enable memes', 'memes on', 'turn on memes', 'allow memes',
]

/** What the user's message asks of the reaction layer. */
export interface UserIntent {
  /** The user explicitly asked for a reaction this turn. */
  readonly explicit: boolean
  /** The request is limited to animated assets. */
  readonly gifOnly: boolean
  /** The user asked for a different reaction than the previous one. */
  readonly followup: boolean
  /** The user asked to stop reacting in this session. */
  readonly optOut: boolean
  /** The user asked to resume reacting in this session. */
  readonly optIn: boolean
}

/** No signal at all: the value used when a turn carries no user text. */
export const NEUTRAL_INTENT: UserIntent = {
  explicit: false,
  gifOnly: false,
  followup: false,
  optOut: false,
  optIn: false,
}

/**
 * Read reaction intent from one user message.
 *
 * A follow-up phrase like "还有吗" is reported here purely as a phrase match.
 * Whether it actually means "another meme" depends on whether the previous turn
 * showed one, which only the decision engine knows; it is resolved there.
 * @param userText - the user's raw message text for this turn.
 * @returns the detected intent.
 */
export function detectIntent(userText: string): UserIntent {
  const text = normalize(userText)
  if (text.length === 0) return NEUTRAL_INTENT

  const optOut = matchesAny(text, OPT_OUT)
  const explicit = !optOut && matchesAny(text, EXPLICIT_REQUEST)
  return {
    explicit,
    // "来个动图" is both an explicit request and a GIF constraint; a bare "gif"
    // only constrains a request that is already explicit or a follow-up.
    gifOnly: !optOut && matchesAny(text, GIF_REQUEST),
    followup: !optOut && matchesAny(text, FOLLOWUP_REQUEST),
    optOut,
    optIn: !optOut && matchesAny(text, OPT_IN),
  }
}
