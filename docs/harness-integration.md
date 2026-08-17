# Harness integration

How `dsh-meme` attaches to DeepSeek Harness, which official APIs it uses, and —
most importantly — the one constraint that shaped the entire architecture.

## Harness version studied

| | |
|---|---|
| Repository | `github.com/deepseek-ai/deepseek-harness` |
| Commit | `47f943859bef60e4160492346772ded9b24f765a` |
| Version | `0.1.0-rc.5` |
| Date | 2026-08-13 |
| Tagline | "DeepSeek Harness: Everything is a Plugin." |

Everything below was read from that source tree, not from memory. Where the
published npm packages differ from the source tree, the difference is called out.

## The constraint that decided the architecture

The obvious design is to append a `meme/reaction` event to the session log and
have the UI render it. **That design is unsafe on this build, and would corrupt
user sessions.**

`Session.append()` builds its event envelope with no way to set the `ignorable`
marker:

```ts
// packages/core/session/src/index.ts:604
append<T extends SessionEventType>(
  type: T,
  data: SessionEventMap[T],
  ...opts: T extends SurfaceEventType ? [opts: SurfaceIntent] : []
): SessionEvent<T>
```

The persistence read path then hard-refuses any log containing a type it does
not know, unless that marker is present:

```ts
// packages/session/session-persistence/src/coordinator.ts:1063
if (KNOWN_SESSION_EVENT_TYPES.has(event.type) || event.ignorable === true) continue
throw this.unsupported(meta, `session "..." contains event type "..." unknown to this harness
  and not marked ignorable; refusing to interpret the log`)
```

`KNOWN_SESSION_EVENT_TYPES` is **generated** from the `SessionEventMap` members
declared inside the harness repository. The generator's own documentation states
the gap plainly:

> Downstream (out-of-repo) plugin events are outside this list by construction; a
> registration surface for them is deferred until such a consumer exists.
> — `packages/core/session/src/known-event-types.ts`

So an out-of-repo plugin appending `meme/reaction` would write a log that **this
same harness cannot load again**. The user's session would fail to resume with a
`SessionFormatUnsupportedError`. A meme plugin that bricks sessions on restart is
the exact failure this project forbids: *meme failure must never break the agent.*

### What `dsh-meme` does instead

The reaction is **derived, not stored**. The decision is a pure deterministic
fold over events that are *already* durable:

```
turn/start · user/message · assistant/message · tool/call · tool/result · turn/end
                              |
                              v
                  decideTurn()  (pure, seeded)
                              |
                              v
                     reaction or skip
```

The seed is derived from the session id and turn number
(`turnRng(sessionId, turn)` in `src/selection/rng.ts`), and every input comes
from the durable log. Therefore:

- **The session log is never written to.** Zero pollution, zero corruption risk.
- **Replay is exact.** The host and the browser run the same function over the
  same events and cannot disagree. Reloading the page, resuming the session, or
  re-mounting the component reproduces the identical meme.
- **No sidecar store** to keep in sync, migrate, or garbage-collect.

This is strictly better than a stored event on every axis except one: if the user
edits their manifest, previously-shown reactions may re-resolve. That trade is
documented under *Known limitations*.

**Upgrade path.** When the harness ships the deferred registration surface for
out-of-repo event types (or `append` gains an `ignorable` parameter),
`meme/reaction` can become a real log event with no change to the decision
engine — only the transport would move. The engine is already isolated behind
`src/engine/`.

## Official APIs used

### Host side

| API | Source | Use |
|---|---|---|
| `apply(ctx, config)` / `export const name` | plugin convention, e.g. `packages/feedback/command-feedback/src/index.ts` | Cordis plugin entry |
| `ctx.on('session/event', (session, event) => …)` | `packages/core/session/src/index.ts:76` | Observe closed turns |
| `ctx.effect(fn, label)` | Cordis lifecycle | HMR-safe registration |
| `Session.events` | `packages/core/session/src/index.ts:554` | Immutable log snapshot for the fold |
| `SessionEventMap` | `packages/core/session/src/types.ts:207` | Event payload shapes |

`inject` is deliberately **empty**. The plugin needs no service, and declaring an
unnecessary injection would let a missing optional service block the whole agent
from composing.

### Client side

| API | Source | Use |
|---|---|---|
| `ConversationNodeDefinition` | `packages/client/runtime/src/client/contract/conversation.ts` | The reaction node's state machine |
| `ctx.conversationEvents.register(def)` | `packages/client/runtime/src/client/conversation/event-registry.ts` | Registration; returns an idempotent disposer |
| `ChatConversationViewNode` | same contract file | The separate chat node |
| `ctx.slots.inject/register('conversation.chat.node', …)` | `packages/client/ui-conversation/src/client/chat/register-node-renderers.ts` | Binding the React renderer to the node kind |

The Definition is modelled on the two in-repo precedents:
`deliverablesDefinition` (`packages/client/ui-deliverables/src/client/turn-deliverables.ts`)
for turn-scoped folding, and `compactionDefinition`
(`packages/client/ui-conversation/src/client/conversation-nodes/compaction.ts`)
for a Definition that owns a `chat` target node.

### A packaging caveat, stated honestly

The UI half imports its contract from `src/ui/client-contract.ts`, a **structural
mirror** transcribed from the harness source above, rather than from
`@deepseek-ai/dsh-client-runtime` directly. This is not a preference — the
published package cannot be installed:

```
@deepseek-ai/dsh-client-runtime@0.0.1-rc.1
  └─ @deepseek-ai/dsh-compact          → 404, not published
@deepseek-ai/dsh-session@0.0.1-rc.1
  └─ (peer) @deepseek-ai/dsh-type-meta → 404, not published
```

The host half *does* compile against the real published
`@deepseek-ai/dsh-session` and `@deepseek-ai/cordis` types (the `dsh-type-meta`
peer is skipped via `auto-install-peers=false`). Because the mirror is
structural, `src/ui/conversation-node.ts` compiles unchanged against the real
package: inside the harness workspace, repoint that one import at
`@deepseek-ai/dsh-client-runtime/client` and delete the mirror.

## Why the reaction is a separate UI node

The Definition owns its own `chat` view node, keyed and anchored independently:

```
   assistant node   (owned by ui-conversation, untouched)
        anchorSeq = turn/end.seq
   meme-reaction node   (owned by dsh-meme)
        anchorSeq = turn/end.seq + 0.2
```

The assistant's markdown is never read, rewritten, or appended to. `dsh-meme`
registers no model-facing tool and appends nothing to the session surface, so the
model's context and its output are byte-identical whether or not the plugin is
loaded. `tests/replay.spec.ts` asserts exactly this.

The `+0.2` offset follows the harness's own convention for synthetic node
placement (`CHAT_SYNTHETIC_SEQ_OFFSETS` in
`packages/client/ui-conversation/src/client/conversation-nodes/common.ts`).

## Configuration

Plugin config is a plain declared interface received by `apply`, matching the
`cordis.yml` convention documented in `docs/config-catalog.md`. See
`examples/cordis.yml`.

## Asset serving

Browsers cannot load `/Users/alice/memes/a.gif` directly, and serving arbitrary
local files is not acceptable. The endpoint is therefore **keyed by meme id**:

```
GET /dsh-meme/asset/:memeId
      → manifest lookup (id must be listed and enabled)
      → pre-validated absolute path
      → stream, MIME derived from the validated extension
```

There is no `?path=` parameter to harden. Path validation happens once at load
(`src/assets/validator.ts`): manifest-relative only, extension allow-listed,
containment checked before any `stat`, and re-checked after symlink resolution.

## Storage and state

`dsh-meme` uses **no harness storage API**. Session reaction state is derived
per-fold and bounded (`recent` is trimmed to `recentHistory`), so nothing
accumulates across sessions. Host-side per-session bookkeeping lives in a
`WeakMap` keyed by `Session`, which releases when the session does.

## HMR

Both registration sites go through effect-scoped lifecycles that return
disposers:

- host: `ctx.effect(() => { const off = ctx.on('session/event', …); return () => off() })`
- client: `ctx.conversationEvents.register(def)` returns an idempotent disposer
  backed by `ctx.effect` (`definition-registry.ts:registerDefinition`)

Without this, each hot reload would add another listener and a turn would emit
two, then three reactions. `tests/ui.spec.tsx` covers the duplication case.

## Known limitations

1. **`meme/reaction` is not a durable log event.** Reasoned above. Reactions are
   derived, so a session exported to a machine without the plugin simply shows no
   reactions — which is the correct degradation.
2. **Editing the manifest can change past reactions.** The fold resolves meme ids
   against the current library. Removing a meme that a past turn selected causes
   that turn to re-resolve. Session-scoped pinning would require the durable
   event this build cannot safely write.
3. **The client contract is mirrored, not imported.** See the packaging caveat.
4. **`selectionMode: 'agent'` is scaffolded, not wired.** The bounded shortlist
   (`shortlistCandidates`) and its metadata-only contract exist and are tested;
   the model round-trip is not implemented, and the mode falls back to `local`.
5. **The renderer is not slot-registered out of the box.** `MemeReaction` and the
   Definition are exported, and the registration call is one line, but this
   repository cannot import the client runtime to perform it. See
   `examples/register-client.ts`.
