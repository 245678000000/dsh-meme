/**
 * Structural mirror of the Client Runtime conversation contract.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The UI half of this plugin is written against `@deepseek-ai/dsh-client-runtime`,
 * but that package cannot currently be installed standalone: its published
 * `0.0.1-rc.1` has a hard dependency on `@deepseek-ai/dsh-compact`, which is not
 * on the registry (the same packaging gap makes `@deepseek-ai/dsh-type-meta`, a
 * peer of `dsh-session`, unresolvable). Depending on it directly would make this
 * repository un-installable.
 *
 * These declarations are therefore a STRUCTURAL MIRROR of the real contract,
 * transcribed from harness source rather than invented:
 *
 *   packages/client/runtime/src/client/contract/conversation.ts
 *   packages/client/ui-conversation/src/client/conversation-nodes/common.ts
 *   packages/client/runtime/src/client/conversation/event-registry.ts
 *   @ deepseek-ai/deepseek-harness commit 47f9438 (v0.1.0-rc.5)
 *
 * Because the mirror is structural, `conversation-node.ts` compiles unchanged
 * against the real package: inside the harness workspace, replace this module's
 * import with `@deepseek-ai/dsh-client-runtime/client` and nothing else moves.
 * `docs/harness-integration.md` records this seam and the upgrade step.
 * @module dsh-meme/ui/client-contract
 */

/** Mirror of the harness `SessionEvent` envelope, narrowed to what the UI reads. */
export interface ClientSessionEvent {
  readonly type: string
  readonly seq: number
  readonly time: number
  readonly data: unknown
}

/** Definition-local identity and lifecycle role extracted from one event. */
export interface ConversationMatchResult {
  readonly id: string
  readonly role: 'start' | 'update'
}

/** Engine-owned placement of one matched event in the session hierarchy. */
export type ConversationLocation =
  | { readonly kind: 'session' }
  | { readonly kind: 'turn'; readonly turn: unknown }
  | { readonly kind: 'step'; readonly turn: unknown; readonly step: unknown }
  | { readonly kind: 'unresolved' }

/** One event accepted by a Definition, with its resolved Location. */
export interface ConversationMatch {
  readonly event: ClientSessionEvent
  readonly view: unknown
  readonly role: 'start' | 'update'
  readonly location: ConversationLocation
}

/** Immutable public view of an assembled business Context. */
export interface ConversationNodeContext<State = unknown> {
  readonly key: string
  readonly kind: string
  readonly id: string
  readonly matches: readonly ConversationMatch[]
  readonly start: ConversationMatch | undefined
  readonly state: State | undefined
  readonly current: ReadonlyMap<string, ConversationViewNode | null>
}

/** Target-neutral identity returned by a business Definition. */
export interface ConversationViewNode {
  readonly key: string
  readonly kind: string
  readonly id: string
  readonly target: string
  readonly data: unknown
}

/** Final Chat render unit produced directly by a business Definition. */
export interface ChatConversationViewNode extends ConversationViewNode {
  readonly target: 'chat'
  readonly anchorSeq: number
  readonly location: ConversationLocation
  readonly visibility: 'visible' | 'hidden'
}

/** Strictly-backward Context lookup available while a start is evaluated. */
export interface ConversationContextReader {
  previous<State>(kind: string): { readonly state: Readonly<State> } | undefined
}

/** One independently registered business Event-to-Node state machine. */
export interface ConversationNodeDefinition<State = unknown> {
  readonly kind: string
  readonly target?: string
  match(event: ClientSessionEvent): ConversationMatchResult | null
  start(
    context: ConversationNodeContext<State>,
    match: ConversationMatch,
    reader: ConversationContextReader,
  ): State
  update(
    context: ConversationNodeContext<State> & { readonly state: State },
    match: ConversationMatch,
  ): State
  buildViewNode?(context: ConversationNodeContext<State>): ConversationViewNode | null
}

/**
 * Mirror of `conversationContextKey` from the runtime contract.
 * @param kind - Definition kind.
 * @param id - Definition-local business identity.
 * @returns engine-owned Context key.
 */
export function conversationContextKey(kind: string, id: string): string {
  return `${kind.length}:${kind}${id}`
}

/** The registry face this plugin uses, mirroring `ctx.conversationEvents`. */
export interface ConversationEventRegistry {
  /**
   * Register a uniquely named Definition for the caller's lifetime.
   * @param definition - the contribution.
   * @returns an idempotent disposer.
   */
  register(definition: ConversationNodeDefinition<never>): () => void
}
