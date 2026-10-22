import { Body, Controller, Get, Inject, Module, Param, Post, UseGuards, NotFoundException, BadRequestException, ParseUUIDPipe, Query } from "@nestjs/common";
import { and, desc, eq, lt, or } from "drizzle-orm";
import { IsUUID } from "class-validator";
import { DATABASE, AppDatabase } from "../database/database.module";
import { conversations, messages, users } from "../database/schema";
import { CurrentUser, SessionGuard } from "../auth/session.guard";
import { AuthModule } from "../auth/auth.module";
import type { SafeUser } from "../auth/auth.service";

class OpenConversationDto { @IsUUID() userId!: string; }

@Controller("conversations")
@UseGuards(SessionGuard)
class ConversationsController {
  constructor(@Inject(DATABASE) private readonly db: AppDatabase) {}
  @Get()
  async list(@CurrentUser() user: SafeUser) {
    const rows = await this.db.select().from(conversations)
      .where(or(eq(conversations.userAId, user.id), eq(conversations.userBId, user.id)))
      .orderBy(desc(conversations.updatedAt)).limit(100);
    return { conversations: await Promise.all(rows.map(async (conversation) => {
      const otherId = conversation.userAId === user.id ? conversation.userBId : conversation.userAId;
      const [participant] = await this.db.select({ id: users.id, mobileNumber: users.mobileNumber, displayName: users.displayName }).from(users).where(eq(users.id, otherId)).limit(1);
      const [lastMessage] = await this.db.select({ id: messages.id, content: messages.content, senderId: messages.senderId, createdAt: messages.createdAt }).from(messages).where(eq(messages.conversationId, conversation.id)).orderBy(desc(messages.createdAt), desc(messages.id)).limit(1);
      return { ...conversation, participant, lastMessage: lastMessage ?? null };
    })) };
  }
  @Post()
  async open(@CurrentUser() user: SafeUser, @Body() body: OpenConversationDto) {
    const targetId = body.userId.toLowerCase();
    if (!targetId || targetId === user.id) throw new BadRequestException("Choose another user.");
    const [target] = await this.db.select({ id: users.id }).from(users).where(eq(users.id, targetId)).limit(1);
    if (!target) throw new NotFoundException("User not found.");
    const [userAId, userBId] = [user.id, targetId].sort();
    await this.db.insert(conversations).values({ userAId, userBId }).onConflictDoNothing();
    const [conversation] = await this.db.select().from(conversations).where(and(eq(conversations.userAId, userAId), eq(conversations.userBId, userBId))).limit(1);
    return { conversation };
  }
  @Get(":id/messages")
  async history(@CurrentUser() user: SafeUser, @Param("id", new ParseUUIDPipe()) id: string, @Query("cursor") cursor?: string, @Query("limit") limitRaw?: string) {
    const [conversation] = await this.db.select({ id: conversations.id }).from(conversations).where(and(eq(conversations.id, id), or(eq(conversations.userAId, user.id), eq(conversations.userBId, user.id)))).limit(1);
    if (!conversation) throw new NotFoundException("Conversation not found.");
    const limit = Math.max(1, Math.min(100, Number.parseInt(limitRaw ?? "30", 10) || 30));
    let before: { createdAt: Date; id: string } | undefined;
    if (cursor) { try { if (cursor.length > 512) throw new Error(); const decoded = JSON.parse(Buffer.from(cursor, "base64url").toString()) as { createdAt: string; id: string }; before = { createdAt: new Date(decoded.createdAt), id: decoded.id }; if (!Number.isFinite(before.createdAt.getTime()) || !/^[0-9a-f-]{36}$/i.test(before.id)) throw new Error(); } catch { throw new BadRequestException("Invalid message cursor."); } }
    const clauses = [eq(messages.conversationId, id)];
    if (before) clauses.push(or(lt(messages.createdAt, before.createdAt), and(eq(messages.createdAt, before.createdAt), lt(messages.id, before.id)))!);
    const rows = await this.db.select().from(messages).where(and(...clauses)).orderBy(desc(messages.createdAt), desc(messages.id)).limit(limit + 1);
    const more = rows.length > limit, page = rows.slice(0, limit).reverse();
    const first = page[0];
    return { messages: page, nextCursor: more && first ? Buffer.from(JSON.stringify({ createdAt: first.createdAt.toISOString(), id: first.id })).toString("base64url") : null };
  }
}
@Module({ imports: [AuthModule], controllers: [ConversationsController], providers: [SessionGuard] })
export class ConversationsModule {}
