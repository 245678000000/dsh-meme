/**
 * UI: the Conversation Node Definition and its renderer.
 *
 * The Definition is exercised as the conversation engine drives it — match,
 * start, update, buildViewNode — so these tests cover the real contract rather
 * than a convenience wrapper.
 * @module dsh-meme/tests/ui
 */

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  MEME_NODE_KIND, NO_PRIOR_STATE, createMemeConversationNode, registerMemeConversationNode,
} from '../src/ui/conversation-node.ts'
import type {
  ClientSessionEvent, ConversationMatch, ConversationNodeContext, ConversationNodeDefinition,
} from '../src/ui/client-contract.ts'
import type { MemeNodeEnvironment, MemeNodeState, MemeReactionChatData } from '../src/ui/conversation-node.ts'
import { MemeReaction } from '../src/ui/MemeReaction.tsx'
import { ASSET_ROUTE_PREFIX } from '../src/assets/server.ts'
import { LogBuilder, config, fixtureLibrary } from './helpers.ts'

const library = fixtureLibrary()

/** An environment wired to the fixture library. */
function environment(overrides: Partial<MemeNodeEnvironment> = {}): MemeNodeEnvironment {
  return {
    library,
    config: config({ probability: 1, warmupTurns: 0, cooldownTurns: 0 }),
    sessionId: 'session-ui',
    stateBefore: NO_PRIOR_STATE,
    assetUrl: (memeId: string) => `${ASSET_ROUTE_PREFIX}${encodeURIComponent(memeId)}`,
    ...overrides,
  }
}

/** Drive a Definition over a log the way the conversation engine would. */
function driveDefinition(
  definition: ConversationNodeDefinition<MemeNodeState>,
  events: readonly ClientSessionEvent[],
): ConversationNodeContext<MemeNodeState> | undefined {
  let state: MemeNodeState | undefined
  const matches: ConversationMatch[] = []

  for (const event of events) {
    const matched = definition.match(event)
    if (matched === null) continue
    const match: ConversationMatch = {
      event,
      view: undefined,
      role: matched.role,
      location: { kind: 'unresolved' },
    }
    matches.push(match)
    const context: ConversationNodeContext<MemeNodeState> = {
      key: `k:${matched.id}`,
      kind: MEME_NODE_KIND,
      id: matched.id,
      matches,
      start: matches[0],
      state,
      current: new Map(),
    }
    state = matched.role === 'start'
      ? definition.start(context, match, { previous: () => undefined })
      : definition.update({ ...context, state: state as MemeNodeState }, match)
  }

  if (state === undefined) return undefined
  return {
    key: 'k',
    kind: MEME_NODE_KIND,
    id: String(state.turn),
    matches,
    start: matches[0],
    state,
    current: new Map(),
  }
}

/** One completed turn's events. */
function turnEvents(user: string, assistant = '完成'): readonly ClientSessionEvent[] {
  return new LogBuilder().turn({ user, assistant }).build().map(event => ({
    ...event,
    time: 0,
  })) as readonly ClientSessionEvent[]
}

describe('conversation node', () => {
  it('produces a separate chat node rather than editing the assistant node', () => {
    const definition = createMemeConversationNode(environment())
    const context = driveDefinition(definition, turnEvents('来张表情包'))
    expect(context).toBeDefined()

    const node = definition.buildViewNode?.(context!)
    expect(node).not.toBeNull()
    expect(node?.kind).toBe(MEME_NODE_KIND)
    expect(node?.target).toBe('chat')
    // Its key is its own; it does not borrow the assistant node's identity.
    expect(node?.key).not.toContain('assistant')
  })

  it('anchors after the turn closing event so it never precedes the answer', () => {
    const definition = createMemeConversationNode(environment())
    const events = turnEvents('来张表情包')
    const closing = events.find(event => event.type === 'turn/end')
    const context = driveDefinition(definition, events)

    const node = definition.buildViewNode?.(context!) as { anchorSeq: number } | null
    expect(node?.anchorSeq).toBeGreaterThan(closing!.seq)
  })

  it('renders nothing while the turn is still open', () => {
    const definition = createMemeConversationNode(environment())
    const open = new LogBuilder().turn({ user: '来张表情包', open: true }).build()
      .map(event => ({ ...event, time: 0 })) as readonly ClientSessionEvent[]

    const context = driveDefinition(definition, open)
    expect(definition.buildViewNode?.(context!)).toBeNull()
  })

  it('renders nothing when the decision is a skip', () => {
    const definition = createMemeConversationNode(environment({
      config: config({ probability: 0, warmupTurns: 5 }),
    }))
    const context = driveDefinition(definition, turnEvents('普通问题', '普通回答'))
    expect(definition.buildViewNode?.(context!)).toBeNull()
  })

  it('is stable across repeated builds, so re-rendering cannot re-roll the meme', () => {
    const definition = createMemeConversationNode(environment())
    const context = driveDefinition(definition, turnEvents('来张表情包'))

    const first = definition.buildViewNode?.(context!)
    const second = definition.buildViewNode?.(context!)
    const third = definition.buildViewNode?.(context!)

    expect(JSON.stringify(second)).toBe(JSON.stringify(first))
    expect(JSON.stringify(third)).toBe(JSON.stringify(first))
  })

  it('carries a resolvable asset URL and non-empty alt text', () => {
    const definition = createMemeConversationNode(environment())
    const context = driveDefinition(definition, turnEvents('来张表情包'))
    const node = definition.buildViewNode?.(context!) as { data: MemeReactionChatData }

    expect(node.data.src.startsWith(ASSET_ROUTE_PREFIX)).toBe(true)
    expect(node.data.alt.length).toBeGreaterThan(0)
    expect(library.memes.some(meme => meme.id === node.data.reaction.memeId)).toBe(true)
  })

  it('serves a GIF request as a GIF node', () => {
    const definition = createMemeConversationNode(environment())
    const context = driveDefinition(definition, turnEvents('来个动图'))
    const node = definition.buildViewNode?.(context!) as { data: MemeReactionChatData }

    expect(node.data.reaction.assetType).toBe('gif')
  })
})

describe('HMR safety', () => {
  it('does not accumulate definitions across reloads', () => {
    // A registry mirroring the runtime's uniqueness rule and disposer contract.
    const registered = new Map<string, unknown>()
    const registry = {
      register(definition: { kind: string }) {
        if (registered.has(definition.kind)) {
          throw new Error(`conversation Definition "${definition.kind}" is already registered`)
        }
        registered.set(definition.kind, definition)
        return () => { registered.delete(definition.kind) }
      },
    }

    for (let reload = 0; reload < 5; reload += 1) {
      const dispose = registerMemeConversationNode(registry as never, environment())
      expect(registered.size).toBe(1)
      dispose()
      // The disposer is idempotent; calling it twice must stay safe.
      dispose()
      expect(registered.size).toBe(0)
    }
  })

  it('refuses a duplicate registration rather than silently double-rendering', () => {
    const registered = new Set<string>()
    const registry = {
      register(definition: { kind: string }) {
        if (registered.has(definition.kind)) throw new Error('already registered')
        registered.add(definition.kind)
        return () => { registered.delete(definition.kind) }
      },
    }

    registerMemeConversationNode(registry as never, environment())
    expect(() => registerMemeConversationNode(registry as never, environment())).toThrow()
  })
})

describe('renderer', () => {
  /** Build renderer data for one meme. */
  function data(assetType: 'image' | 'gif' = 'image'): MemeReactionChatData {
    return {
      reaction: {
        reactionId: 'session-ui:1',
        turn: 1,
        anchorSeq: 9,
        memeId: 'shrug',
        assetType,
        category: 'generic',
        trigger: 'explicit',
        label: '随便吧',
      },
      src: `${ASSET_ROUTE_PREFIX}shrug`,
      alt: '随便吧',
    }
  }

  it('renders an image with alt text', () => {
    const html = renderToStaticMarkup(<MemeReaction node={{ data: data() }} />)
    expect(html).toContain(`src="${ASSET_ROUTE_PREFIX}shrug"`)
    expect(html).toContain('alt="随便吧"')
    expect(html).toContain('Meme reaction')
  })

  it('labels a GIF distinctly', () => {
    const html = renderToStaticMarkup(<MemeReaction node={{ data: data('gif') }} />)
    expect(html).toContain('Meme reaction (GIF)')
  })

  it('tags the node with its reaction id for anchoring', () => {
    const html = renderToStaticMarkup(<MemeReaction node={{ data: data() }} />)
    expect(html).toContain('data-dsh-meme-reaction="session-ui:1"')
  })
})
