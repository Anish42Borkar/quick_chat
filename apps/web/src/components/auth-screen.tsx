"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { io, type Socket } from "socket.io-client";
import { apiRequest } from "@/lib/api";
import { useChatStore, type ChatMessage, type Conversation, type User } from "@/lib/chat-store";

type OtpResult = { message: string; developmentOtp?: string };
type PageResult = { messages: ChatMessage[]; nextCursor: string | null };
type ChatAck = { ok: true; data: { message?: ChatMessage } } | { ok: false; error: string };
const SOCKET_BASE = process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/api\/v1$/, "") ?? "http://localhost:4000";

export default function AuthScreen() {
  const user = useChatStore((s) => s.user), conversations = useChatStore((s) => s.conversations), selectedId = useChatStore((s) => s.selectedId), messages = useChatStore((s) => s.messages), onlineIds = useChatStore((s) => s.onlineIds), connected = useChatStore((s) => s.connected);
  const setUser = useChatStore((s) => s.setUser), setConversations = useChatStore((s) => s.setConversations), selectConversation = useChatStore((s) => s.selectConversation), setMessages = useChatStore((s) => s.setMessages), addMessage = useChatStore((s) => s.addMessage), setOnline = useChatStore((s) => s.setOnline), setConnected = useChatStore((s) => s.setConnected);
  const [number, setNumber] = useState(""), [otp, setOtp] = useState(""), [authStep, setAuthStep] = useState<"number" | "otp">("number"), [devOtp, setDevOtp] = useState("");
  const [authReady, setAuthReady] = useState(false);
  const [resendIn, setResendIn] = useState(0);
  const [error, setError] = useState(""), [notice, setNotice] = useState(""), [busy, setBusy] = useState(false), [query, setQuery] = useState(""), [searchResults, setSearchResults] = useState<User[]>([]), [searchOpen, setSearchOpen] = useState(false), [draft, setDraft] = useState(""), [cursor, setCursor] = useState<string | null>(null), [hasOlder, setHasOlder] = useState(false), [loadingOlder, setLoadingOlder] = useState(false);
  const socketRef = useRef<Socket | null>(null), messageListRef = useRef<HTMLDivElement>(null), scrollBottomRef = useRef(true);
  const selected = useMemo(() => conversations.find((item) => item.id === selectedId) ?? null, [conversations, selectedId]);

  const loadConversations = useCallback(async () => {
    const result = await apiRequest<{ conversations: Conversation[] }>("/conversations");
    setConversations(result.conversations);
    if (!useChatStore.getState().selectedId && result.conversations[0]) selectConversation(result.conversations[0].id);
  }, [selectConversation, setConversations]);

  useEffect(() => {
    let active = true;
    apiRequest<{ authenticated: boolean; user?: User }>("/auth/me").then((r) => { if (active && r.authenticated && r.user) setUser(r.user); }).catch(() => undefined).finally(() => { if (active) setAuthReady(true); });
    return () => { active = false; };
  }, [setUser]);

  useEffect(() => {
    if (!user) return;
    void loadConversations().catch((e: unknown) => setError(e instanceof Error ? e.message : "Could not load conversations."));
    const socket = io(`${SOCKET_BASE}/chat`, { withCredentials: true, transports: ["websocket", "polling"] });
    socketRef.current = socket;
    socket.on("connect", () => setConnected(true)); socket.on("disconnect", () => setConnected(false));
    socket.on("connect_error", () => setConnected(false));
    socket.on("presence:update", (event: { userId: string; online: boolean }) => setOnline(event.userId, event.online));
    socket.on("presence:snapshot", (ids: string[]) => { for (const id of ids) setOnline(id, true); });
    socket.on("message:new", (message: ChatMessage) => { if (useChatStore.getState().selectedId === message.conversationId) addMessage(message); void loadConversations(); });
    return () => { socket.disconnect(); socketRef.current = null; setConnected(false); };
  }, [user, loadConversations, addMessage, setConnected, setOnline]);

  useEffect(() => {
    if (!user || !selectedId) return;
    let active = true;
    selectConversation(selectedId);
    setCursor(null); setHasOlder(false);
    apiRequest<PageResult>(`/conversations/${selectedId}/messages?limit=30`).then((page) => {
      if (!active) return; setMessages(page.messages); setCursor(page.nextCursor); setHasOlder(Boolean(page.nextCursor));
    }).catch((e: unknown) => setError(e instanceof Error ? e.message : "Could not load messages."));
    socketRef.current?.emit("conversation:join", { conversationId: selectedId });
    return () => { active = false; socketRef.current?.emit("conversation:leave", { conversationId: selectedId }); };
  }, [user, selectedId, setMessages, selectConversation]);

  useEffect(() => { if (scrollBottomRef.current && messageListRef.current) messageListRef.current.scrollTop = messageListRef.current.scrollHeight; }, [messages]);
  useEffect(() => { if (resendIn <= 0) return; const timer = window.setTimeout(() => setResendIn((remaining) => Math.max(0, remaining - 1)), 1000); return () => window.clearTimeout(timer); }, [resendIn]);

  async function requestOtp(e?: FormEvent<HTMLFormElement>) {
    e?.preventDefault(); setBusy(true); setError(""); setNotice("");
    try { const r = await apiRequest<OtpResult>("/auth/request-otp", { method: "POST", body: JSON.stringify({ mobileNumber: number }) }); setAuthStep("otp"); setDevOtp(r.developmentOtp ?? ""); setNotice(r.message); setResendIn(60); }
    catch (e) { setError(e instanceof Error ? e.message : "OTP request failed."); } finally { setBusy(false); }
  }
  async function verifyOtp(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true); setError("");
    try { const r = await apiRequest<{ user: User }>("/auth/verify-otp", { method: "POST", body: JSON.stringify({ mobileNumber: number, otp }) }); setUser(r.user); setNotice(""); }
    catch (e) { setError(e instanceof Error ? e.message : "Verification failed."); } finally { setBusy(false); }
  }
  async function logout() {
    setBusy(true); setError("");
    try { await apiRequest("/auth/logout", { method: "POST", body: "{}" }); socketRef.current?.disconnect(); setUser(null); setConversations([]); selectConversation(null); setMessages([]); setAuthStep("number"); setOtp(""); setNotice("Signed out successfully."); }
    catch (e) { setError(e instanceof Error ? e.message : "Logout failed."); } finally { setBusy(false); }
  }
  async function searchUsers(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setError("");
    try { const r = await apiRequest<{ users: User[] }>(`/users?q=${encodeURIComponent(query)}`); setSearchResults(r.users); }
    catch (e) { setError(e instanceof Error ? e.message : "Search failed."); }
  }
  async function openConversation(target: User) {
    setBusy(true); setError("");
    try { const r = await apiRequest<{ conversation: { id: string } }>("/conversations", { method: "POST", body: JSON.stringify({ userId: target.id }) }); await loadConversations(); selectConversation(r.conversation.id); setSearchOpen(false); setSearchResults([]); setQuery(""); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not open conversation."); } finally { setBusy(false); }
  }
  function sendMessage(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); const content = draft.trim();
    if (!selectedId || !content || !socketRef.current?.connected || content.length > 4000) return;
    const clientMessageId = crypto.randomUUID(); setDraft(""); setError("");
    socketRef.current.emit("message:send", { conversationId: selectedId, clientMessageId, content }, (ack: ChatAck) => {
      if (ack?.ok && ack.data.message) addMessage(ack.data.message);
      else { setDraft(content); setError(ack && !ack.ok ? ack.error : "Message failed. Please retry."); }
    });
  }
  async function loadOlder() {
    if (!selectedId || !cursor || loadingOlder || !messageListRef.current) return;
    setLoadingOlder(true); const el = messageListRef.current, before = el.scrollHeight;
    try { const page = await apiRequest<PageResult>(`/conversations/${selectedId}/messages?limit=30&cursor=${encodeURIComponent(cursor)}`); setMessages([...page.messages, ...useChatStore.getState().messages]); setCursor(page.nextCursor); setHasOlder(Boolean(page.nextCursor)); requestAnimationFrame(() => { if (messageListRef.current) messageListRef.current.scrollTop = messageListRef.current.scrollHeight - before; }); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not load older messages."); } finally { setLoadingOlder(false); }
  }

  if (!authReady) return <main className="login-shell"><section className="login-panel"><div className="brand-lockup"><span className="brand-mark">q</span><span>quickchat</span></div><div className="loading-session"><span className="spinner-border spinner-border-sm text-success" role="status"/><span>Restoring your session…</span></div></section><aside className="login-art"><div className="art-orbit orbit-one"/><div className="art-orbit orbit-two"/></aside></main>;
  if (!user) return <main className="login-shell"><section className="login-panel"><div className="brand-lockup"><span className="brand-mark">q</span><span>quickchat</span></div><p className="eyebrow">PRIVATE MESSAGING, MADE SIMPLE</p><h1>{authStep === "number" ? "Your conversations start here." : "Check your messages."}</h1><p className="login-copy">Sign in securely with a one-time code sent to your phone.</p>
    {authStep === "number" ? <form onSubmit={requestOtp}><label className="form-label" htmlFor="mobile">Phone number</label><input id="mobile" className="form-control form-control-lg" type="tel" autoComplete="tel" placeholder="+1 555 000 0000" value={number} onChange={(e) => setNumber(e.target.value)} required minLength={7} maxLength={25}/><button className="btn btn-primary btn-lg w-100 mt-3" disabled={busy}>{busy ? "Sending code…" : "Send a sign-in code"}</button></form> : <form onSubmit={verifyOtp}><p className="mb-3 text-secondary">Sent to <strong>{number}</strong></p><label className="form-label" htmlFor="otp">Six-digit code</label><input id="otp" className="form-control form-control-lg otp-input" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))} required/><button className="btn btn-primary btn-lg w-100 mt-3" disabled={busy || otp.length !== 6}>{busy ? "Verifying…" : "Verify and continue"}</button><button type="button" className="btn btn-link w-100 mt-2" onClick={() => { setAuthStep("number"); setOtp(""); setError(""); }}>Use a different number</button><button type="button" className="btn btn-link w-100" disabled={busy || resendIn > 0} onClick={() => { void requestOtp(); }}>{resendIn > 0 ? `Resend code in ${resendIn}s` : "Resend code"}</button></form>}
    {devOtp && <div className="alert alert-warning mt-3 mb-0">Development code: <strong>{devOtp}</strong></div>}{notice && <div className="alert alert-success mt-3 mb-0">{notice}</div>}{error && <div className="alert alert-danger mt-3 mb-0" role="alert">{error}</div>}<p className="login-footnote">Your session is protected with an HTTP-only cookie.</p></section><aside className="login-art"><div className="art-orbit orbit-one"/><div className="art-orbit orbit-two"/><div className="art-card"><div className="art-avatar">M</div><div><strong>A little closer</strong><span>Good conversations begin with a hello.</span></div><span className="art-dot"/></div><div className="art-caption">A calmer place to catch up.</div></aside></main>;

  return <main className="chat-app"><header className="topbar"><div className="brand-lockup"><span className="brand-mark">q</span><span>quickchat</span></div><div className="topbar-right"><span className={`connection-pill ${connected ? "is-online" : ""}`}><i/> {connected ? "Connected" : "Reconnecting"}</span><span className="account-number">{user.mobileNumber}</span><button className="signout-button" onClick={logout} disabled={busy}>Sign out</button></div></header>
    {error && <div className="toast-error" role="alert">{error}<button onClick={() => setError("")} aria-label="Dismiss">×</button></div>}
    <div className="chat-layout"><aside className={`sidebar ${selectedId ? "mobile-hidden" : ""}`}><div className="sidebar-heading"><div><p className="eyebrow mb-1">YOUR SPACE</p><h1>Messages</h1></div><button className="new-chat-button" aria-label="Start a new conversation" onClick={() => { setSearchOpen((v) => !v); setError(""); }}>＋</button></div>
      {searchOpen && <form className="search-form" onSubmit={searchUsers}><input className="form-control" aria-label="Search users" placeholder="Find people by name or phone" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus/><button className="btn btn-primary" aria-label="Search">⌕</button></form>}
      {searchOpen && searchResults.length > 0 && <div className="search-results">{searchResults.map((person) => <button key={person.id} className="search-result" onClick={() => void openConversation(person)} disabled={busy}><span className="avatar">{person.displayName?.[0]?.toUpperCase() || "•"}</span><span><strong>{person.displayName || person.mobileNumber}</strong><small>{person.mobileNumber}</small></span><span className="result-arrow">↗</span></button>)}</div>}
      <div className="conversation-list">{conversations.length === 0 ? <div className="empty-sidebar"><span className="empty-icon">✳</span><strong>No conversations yet</strong><p>Search for someone to start chatting.</p><button className="btn btn-outline-primary btn-sm" onClick={() => setSearchOpen(true)}>Find a person</button></div> : conversations.map((conversation) => <button key={conversation.id} onClick={() => selectConversation(conversation.id)} className={`conversation-item ${selectedId === conversation.id ? "selected" : ""}`}><span className="avatar">{conversation.participant.displayName?.[0]?.toUpperCase() || conversation.participant.mobileNumber.slice(-2)}</span><span className="conversation-copy"><span className="conversation-name">{conversation.participant.displayName || conversation.participant.mobileNumber}</span><span className="conversation-preview">{conversation.lastMessage?.content || "Start a conversation"}</span></span><span className="conversation-meta"><span className={`presence-dot ${onlineIds.has(conversation.participant.id) ? "online" : ""}`}/>{conversation.lastMessage ? new Date(conversation.lastMessage.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : ""}</span></button>)}</div><div className="sidebar-bottom"><span className="presence-dot online"/> Your account is ready</div></aside>
      <section className={`conversation-pane ${!selectedId ? "mobile-hidden" : ""}`}>{selected ? <><div className="conversation-header"><button className="back-button" onClick={() => selectConversation(null)} aria-label="Back to conversations">‹</button><span className="avatar">{selected.participant.displayName?.[0]?.toUpperCase() || selected.participant.mobileNumber.slice(-2)}</span><div className="participant-info"><strong>{selected.participant.displayName || selected.participant.mobileNumber}</strong><span><i className={`presence-dot ${onlineIds.has(selected.participant.id) ? "online" : ""}`}/>{onlineIds.has(selected.participant.id) ? "Online" : "Offline"}</span></div><span className="private-label">Private conversation</span></div>
        <div className="message-list" ref={messageListRef} onScroll={(e) => { const el = e.currentTarget; scrollBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; if (el.scrollTop < 60 && hasOlder && !loadingOlder) void loadOlder(); }}>
          {loadingOlder && <div className="history-loading">Loading older messages…</div>}{messages.length === 0 ? <div className="empty-chat"><span className="empty-chat-icon">✳</span><h2>Say hello</h2><p>This is the beginning of your conversation with {selected.participant.displayName || "this person"}.</p></div> : messages.map((message) => <div key={message.id} className={`message-row ${message.senderId === user.id ? "outgoing" : "incoming"}`}><div className="message-bubble">{message.content}<time>{new Date(message.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</time></div></div>)}
        </div><form className="composer" onSubmit={sendMessage}><textarea aria-label="Write a message" placeholder={connected ? "Write a message…" : "Reconnecting to send messages…"} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }} maxLength={4000} rows={1} disabled={!connected}/><span className="composer-hint">Enter to send · Shift + Enter for a new line</span><button className="send-button" aria-label="Send message" disabled={!draft.trim() || !connected}>↑</button></form></> : <div className="welcome-pane"><div className="welcome-symbol">q</div><h2>Your messages, all in one place.</h2><p>Choose a conversation or find someone new to say hello.</p><button className="btn btn-primary" onClick={() => setSearchOpen(true)}>Start a conversation</button></div>}</section></div>
  </main>;
}
