import {
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { conversations } from "./conversations";
import { users } from "./users";

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    senderId: uuid("sender_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    clientMessageId: uuid("client_message_id").notNull(),
    content: varchar("content", { length: 4000 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("messages_sender_client_message_uq").on(table.senderId, table.clientMessageId),
    index("messages_conversation_created_id_idx").on(
      table.conversationId,
      table.createdAt,
      table.id,
    ),
  ],
);
