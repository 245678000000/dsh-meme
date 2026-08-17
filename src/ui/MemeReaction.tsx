/**
 * The reaction node's renderer.
 *
 * Visually subordinate on purpose. The assistant's answer is the content; this
 * is a margin note. It is small, unstyled beyond a quiet border, and it never
 * competes with the text above it.
 * @module dsh-meme/ui/MemeReaction
 */

import { useState } from 'react'
import type { ReactElement } from 'react'
import type { MemeReactionChatData } from './conversation-node.ts'

/** Props for the chat node seat, mirroring the harness `ChatNodeViewProps` shape. */
export interface MemeReactionProps {
  readonly node: { readonly data: MemeReactionChatData }
}

/** Inline styles keep the component dependency-free and themeable by the host. */
const styles = {
  frame: {
    display: 'inline-flex',
    flexDirection: 'column',
    gap: '0.375rem',
    maxWidth: 'min(320px, 100%)',
    padding: '0.5rem',
    border: '1px solid color-mix(in srgb, currentColor 15%, transparent)',
    borderRadius: '0.5rem',
    opacity: 0.95,
  },
  label: {
    fontSize: '0.6875rem',
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
    opacity: 0.55,
  },
  image: {
    display: 'block',
    width: '100%',
    height: 'auto',
    borderRadius: '0.375rem',
  },
  caption: {
    fontSize: '0.8125rem',
    opacity: 0.75,
  },
} as const

/**
 * Render one meme reaction.
 *
 * A failed image load collapses the node entirely rather than leaving a broken
 * frame: a meme that cannot be shown is simply a turn with no reaction, which
 * is the plugin's behaviour everywhere else too.
 * @param props - the chat node carrying this reaction's data.
 * @returns the reaction element, or null when the asset cannot be displayed.
 */
export function MemeReaction({ node }: MemeReactionProps): ReactElement | null {
  const [failed, setFailed] = useState(false)
  const { reaction, src, alt } = node.data
  if (failed) return null

  return (
    <figure style={styles.frame} data-dsh-meme-reaction={reaction.reactionId}>
      <figcaption style={styles.label}>
        {reaction.assetType === 'gif' ? 'Meme reaction (GIF)' : 'Meme reaction'}
      </figcaption>
      <img
        style={styles.image}
        src={src}
        alt={alt}
        loading="lazy"
        decoding="async"
        onError={() => { setFailed(true) }}
      />
      {alt.length > 0 ? <span style={styles.caption}>{alt}</span> : null}
    </figure>
  )
}

export default MemeReaction
