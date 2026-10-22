import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { DatabaseModule } from "./database/database.module";
import { HealthModule } from "./health/health.module";
import { AuthModule } from "./auth/auth.module";
import { UsersModule } from "./users/users.module";
import { ConversationsModule } from "./conversations/conversations.module";
import { ChatModule } from "./chat/chat.module";
function validateEnvironment(env: Record<string, string | undefined>) {
  if (!env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
  if (!env.OTP_HMAC_SECRET || env.OTP_HMAC_SECRET.length < 32 || env.OTP_HMAC_SECRET.includes("replace_with")) throw new Error("Set OTP_HMAC_SECRET to at least 32 random characters.");
  if (env.COOKIE_SAME_SITE === "none" && env.NODE_ENV !== "production") throw new Error("SameSite=None cookies require production HTTPS.");
  if (env.NODE_ENV === "production") {
    if (!env.WEB_ORIGIN || new URL(env.WEB_ORIGIN).protocol !== "https:") throw new Error("Set WEB_ORIGIN to the exact HTTPS frontend origin in production.");
    if (env.SMS_PROVIDER !== "twilio") throw new Error("Production requires SMS_PROVIDER=twilio.");
    if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !env.TWILIO_FROM_NUMBER) throw new Error("Twilio credentials are required in production.");
  }
  for (const key of ["OTP_TTL_MINUTES", "OTP_RESEND_COOLDOWN_SECONDS", "OTP_MAX_ATTEMPTS", "SESSION_TTL_HOURS"]) {
    const value = env[key];
    if (value !== undefined && (!Number.isFinite(Number(value)) || Number(value) <= 0)) throw new Error(`${key} must be a positive number.`);
  }
  return env;
}

@Module({ imports: [ConfigModule.forRoot({ isGlobal: true, envFilePath: "../../.env", validate: validateEnvironment }), DatabaseModule, HealthModule, AuthModule, UsersModule, ConversationsModule, ChatModule] })
export class AppModule {}
