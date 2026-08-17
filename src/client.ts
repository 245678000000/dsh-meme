/**
 * The browser-side entry: the Conversation Node Definition and its renderer.
 * @module dsh-meme/client
 */

export type {
  MemeNodeEnvironment, MemeNodeState, MemeReactionChatData,
} from './ui/conversation-node.ts'
export {
  MEME_NODE_KIND, NO_PRIOR_STATE, createMemeConversationNode, registerMemeConversationNode,
} from './ui/conversation-node.ts'
export type {
  ChatConversationViewNode, ClientSessionEvent, ConversationEventRegistry,
  ConversationNodeDefinition,
} from './ui/client-contract.ts'
export { conversationContextKey } from './ui/client-contract.ts'
export type { MemeReactionProps } from './ui/MemeReaction.tsx'
export { MemeReaction } from './ui/MemeReaction.tsx'
