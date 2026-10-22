import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const otpChallenges = pgTable(
  "otp_challenges",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    mobileNumber: varchar("mobile_number", { length: 16 }).notNull(),
    otpHash: text("otp_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    attempts: integer("attempts").notNull().default(0),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    resendAvailableAt: timestamp("resend_available_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("otp_challenges_mobile_created_idx").on(table.mobileNumber, table.createdAt),
    check("otp_challenges_attempts_nonnegative", sql`${table.attempts} >= 0`),
  ],
);
