import {
  check,
  index,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./users";

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userAId: uuid("user_a_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    userBId: uuid("user_b_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("conversations_distinct_ordered_users", sql`${table.userAId} < ${table.userBId}`),
    uniqueIndex("conversations_user_pair_uq").on(table.userAId, table.userBId),
    index("conversations_user_a_activity_idx").on(table.userAId, table.updatedAt),
    index("conversations_user_b_activity_idx").on(table.userBId, table.updatedAt),
  ],
);
