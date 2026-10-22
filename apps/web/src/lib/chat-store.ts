import { create } from "zustand";

export type User = { id: string; mobileNumber: string; displayName: string };
export type ChatMessage = { id: string; conversationId: string; senderId: string; clientMessageId: string; content: string; createdAt: string };
export type Conversation = { id: string; participant: User; lastMessage: Pick<ChatMessage, "content" | "senderId" | "createdAt"> | null };
type ChatState = {
  user: User | null; conversations: Conversation[]; selectedId: string | null; messages: ChatMessage[]; onlineIds: Set<string>; connected: boolean;
  setUser: (user: User | null) => void; setConversations: (items: Conversation[]) => void; selectConversation: (id: string | null) => void;
  setMessages: (items: ChatMessage[]) => void; addMessage: (message: ChatMessage) => void; setOnline: (id: string, online: boolean) => void; setConnected: (connected: boolean) => void;
};
export const useChatStore = create<ChatState>((set) => ({
  user: null, conversations: [], selectedId: null, messages: [], onlineIds: new Set(), connected: false,
  setUser: (user) => set({ user }), setConversations: (conversations) => set({ conversations }),
  selectConversation: (selectedId) => set({ selectedId, messages: [] }), setMessages: (messages) => set({ messages }),
  addMessage: (message) => set((state) => {
    if (state.messages.some((item) => item.id === message.id || item.clientMessageId === message.clientMessageId)) return state;
    return { messages: [...state.messages, message] };
  }),
  setOnline: (id, online) => set((state) => {
    const onlineIds = new Set(state.onlineIds);
    if (online) onlineIds.add(id);
    else onlineIds.delete(id);
    return { onlineIds };
  }),
  setConnected: (connected) => set({ connected }),
}));
