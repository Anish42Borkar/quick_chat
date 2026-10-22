import { ConflictException, Inject, Injectable, Logger } from "@nestjs/common";
import { OnGatewayConnection, OnGatewayDisconnect, SubscribeMessage, WebSocketGateway, WebSocketServer, ConnectedSocket, MessageBody } from "@nestjs/websockets";
import type { Server, Socket } from "socket.io";
import { and, eq, or } from "drizzle-orm";
import { DATABASE, AppDatabase } from "../database/database.module";
import { conversations, messages } from "../database/schema";
import { AuthService, SafeUser } from "../auth/auth.service";
import { ConfigService } from "@nestjs/config";

type ChatSocket = Socket & { data: { user?: SafeUser } };
type AckResult<T> = { ok: true; data: T } | { ok: false; error: string };
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
@WebSocketGateway({ namespace: "/chat", cors: { origin: process.env.WEB_ORIGIN ?? "http://localhost:3000", credentials: true }, maxHttpBufferSize: 20_000 })
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server!: Server;
  private readonly logger = new Logger(ChatGateway.name);
  private readonly connections = new Map<string, Set<string>>();
  constructor(@Inject(DATABASE) private readonly db: AppDatabase, private readonly auth: AuthService, private readonly config: ConfigService) {}

  private cookieToken(socket: ChatSocket): string | undefined {
    const cookie = socket.handshake.headers.cookie?.split(";").map((part) => part.trim()).find((part) => part.startsWith("quickchat_session="));
    return cookie ? decodeURIComponent(cookie.slice("quickchat_session=".length)) : undefined;
  }

  private async activeUser(socket: ChatSocket): Promise<SafeUser | null> {
    const user = await this.auth.getUser(this.cookieToken(socket));
    if (!user) socket.disconnect(true);
    else socket.data.user = user;
    return user;
  }

  async handleConnection(socket: ChatSocket): Promise<void> {
    const origin = socket.handshake.headers.origin;
    if (origin && origin !== this.config.get<string>("WEB_ORIGIN", "http://localhost:3000")) { socket.disconnect(true); return; }
    const user = await this.activeUser(socket);
    if (!user) { socket.disconnect(true); return; }
    socket.data.user = user;
    const set = this.connections.get(user.id) ?? new Set<string>();
    const wasOffline = set.size === 0;
    set.add(socket.id); this.connections.set(user.id, set);
    if (wasOffline) this.server.emit("presence:update", { userId: user.id, online: true });
    socket.emit("presence:snapshot", [...this.connections.keys()]);
  }

  handleDisconnect(socket: ChatSocket): void {
    const user = socket.data.user;
    if (!user) return;
    const set = this.connections.get(user.id); set?.delete(socket.id);
    if (set?.size === 0) { this.connections.delete(user.id); this.server.emit("presence:update", { userId: user.id, online: false }); }
  }

  @SubscribeMessage("conversation:join")
  async join(@ConnectedSocket() socket: ChatSocket, @MessageBody() body: { conversationId?: string }): Promise<AckResult<{ conversationId: string }>> {
    const user = await this.activeUser(socket);
    if (!user || typeof body?.conversationId !== "string" || !uuidPattern.test(body.conversationId)) return { ok: false, error: "Invalid request." };
    const [conversation] = await this.db.select({ id: conversations.id }).from(conversations).where(and(eq(conversations.id, body.conversationId), or(eq(conversations.userAId, user.id), eq(conversations.userBId, user.id)))).limit(1);
    if (!conversation) return { ok: false, error: "Conversation not found." };
    await socket.join(`conversation:${conversation.id}`);
    return { ok: true, data: { conversationId: conversation.id } };
  }

  @SubscribeMessage("conversation:leave")
  async leave(@ConnectedSocket() socket: ChatSocket, @MessageBody() body: { conversationId?: string }): Promise<AckResult<{ conversationId: string }>> {
    if (!await this.activeUser(socket)) return { ok: false, error: "Authentication required." };
    if (typeof body?.conversationId !== "string" || !uuidPattern.test(body.conversationId)) return { ok: false, error: "Invalid request." };
    const user = socket.data.user!;
    const [conversation] = await this.db.select({ id: conversations.id }).from(conversations).where(and(eq(conversations.id, body.conversationId), or(eq(conversations.userAId, user.id), eq(conversations.userBId, user.id)))).limit(1);
    if (!conversation) return { ok: false, error: "Conversation not found." };
    await socket.leave(`conversation:${body.conversationId}`);
    return { ok: true, data: { conversationId: body.conversationId } };
  }

  @SubscribeMessage("message:send")
  async send(@ConnectedSocket() socket: ChatSocket, @MessageBody() body: { conversationId?: string; clientMessageId?: string; content?: string }): Promise<AckResult<{ message: unknown }>> {
    const user = await this.activeUser(socket), content = typeof body?.content === "string" ? body.content.trim() : "";
    if (!user || typeof body?.conversationId !== "string" || !uuidPattern.test(body.conversationId) || typeof body.clientMessageId !== "string" || !uuidPattern.test(body.clientMessageId) || !content || content.length > 4000) return { ok: false, error: "Invalid message." };
    const [conversation] = await this.db.select({ id: conversations.id }).from(conversations).where(and(eq(conversations.id, body.conversationId), or(eq(conversations.userAId, user.id), eq(conversations.userBId, user.id)))).limit(1);
    if (!conversation) return { ok: false, error: "Conversation not found." };
    try {
      const [inserted] = await this.db.insert(messages).values({ conversationId: conversation.id, senderId: user.id, clientMessageId: body.clientMessageId, content }).onConflictDoNothing().returning();
      const [existing] = inserted ? [undefined] : await this.db.select().from(messages).where(and(eq(messages.senderId, user.id), eq(messages.clientMessageId, body.clientMessageId))).limit(1);
      const saved = inserted ?? existing;
      if (!saved || saved.conversationId !== conversation.id || saved.content !== content) throw new ConflictException("Client message ID was already used for another message.");
      await this.db.update(conversations).set({ updatedAt: new Date() }).where(eq(conversations.id, conversation.id));
      this.server.to(`conversation:${conversation.id}`).emit("message:new", saved);
      return { ok: true, data: { message: saved } };
    } catch (error) {
      this.logger.error("Message persistence failed.", error instanceof Error ? error.stack : undefined);
      return { ok: false, error: "Message could not be sent. Please retry." };
    }
  }
}
