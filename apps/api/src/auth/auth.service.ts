import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { and, desc, eq, gt, isNull, lt, sql } from "drizzle-orm";
import {
  createHmac,
  createHash,
  randomInt,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { parsePhoneNumberFromString } from "libphonenumber-js";
import { DATABASE, AppDatabase } from "../database/database.module";
import { otpChallenges, sessions, users } from "../database/schema";
import { ConfiguredSmsProvider } from "./sms-provider";
export type SafeUser = { id: string; mobileNumber: string; displayName: string };
@Injectable()
export class AuthService {
  constructor(
    @Inject(DATABASE) private readonly db: AppDatabase,
    private readonly config: ConfigService,
    private readonly sms: ConfiguredSmsProvider,
  ) {}
  private normalize(raw: string): string {
    const phone = parsePhoneNumberFromString(raw.trim());
    if (!phone?.isValid())
      throw new BadRequestException(
        "Enter a valid mobile number including country code.",
      );
    return phone.number;
  }
  private otpHash(otp: string, number: string): string {
    const secret = this.config.get<string>("OTP_HMAC_SECRET");
    if (!secret || secret.includes("replace_with"))
      throw new Error("Set OTP_HMAC_SECRET in .env to a random secret.");
    return createHmac("sha256", secret)
      .update(`${number}:${otp}`)
      .digest("hex");
  }
  private tokenHash(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }
  async requestOtp(
    raw: string,
  ): Promise<{ message: string; developmentOtp?: string }> {
    const mobileNumber = this.normalize(raw),
      now = new Date();
    const cooldown = Number(
      this.config.get("OTP_RESEND_COOLDOWN_SECONDS", "60"),
    );
    const otp = randomInt(0, 1000000).toString().padStart(6, "0");
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${mobileNumber}, 0))`);
      const [latest] = await tx.select().from(otpChallenges)
        .where(and(eq(otpChallenges.mobileNumber, mobileNumber), gt(otpChallenges.expiresAt, now), isNull(otpChallenges.consumedAt)))
        .orderBy(desc(otpChallenges.createdAt)).limit(1);
      if (latest && latest.createdAt.getTime() + cooldown * 1000 > now.getTime())
        throw new HttpException("Please wait before requesting another OTP.", HttpStatus.TOO_MANY_REQUESTS);
      await tx.update(otpChallenges).set({ consumedAt: now })
        .where(and(eq(otpChallenges.mobileNumber, mobileNumber), isNull(otpChallenges.consumedAt)));
      await tx.insert(otpChallenges).values({
        mobileNumber,
        otpHash: this.otpHash(otp, mobileNumber),
        expiresAt: new Date(now.getTime() + Number(this.config.get("OTP_TTL_MINUTES", "5")) * 60000),
        attempts: 0,
        resendAvailableAt: new Date(now.getTime() + cooldown * 1000),
      });
    });
    try {
      await this.sms.sendOtp(mobileNumber, otp);
    } catch {
      throw new ServiceUnavailableException(
        "OTP delivery is unavailable. Configure a supported SMS provider.",
      );
    }
    const result: { message: string; developmentOtp?: string } = {
      message: "If this number can receive a code, an OTP has been requested.",
    };
    if (
      this.config.get("NODE_ENV") === "development" &&
      this.config.get("SMS_PROVIDER", "mock") === "mock"
    )
      result.developmentOtp = otp;
    return result;
  }
  async verifyOtp(
    raw: string,
    otp: string,
  ): Promise<{ user: SafeUser; token: string; expiresAt: Date }> {
    const mobileNumber = this.normalize(raw),
      now = new Date(),
      max = Number(this.config.get("OTP_MAX_ATTEMPTS", "5"));
    const [challenge] = await this.db
      .select()
      .from(otpChallenges)
      .where(
        and(
          eq(otpChallenges.mobileNumber, mobileNumber),
          isNull(otpChallenges.consumedAt),
          gt(otpChallenges.expiresAt, now),
        ),
      )
      .orderBy(desc(otpChallenges.createdAt))
      .limit(1);
    if (!challenge || challenge.attempts >= max)
      throw new UnauthorizedException("Invalid or expired OTP.");
    const supplied = Buffer.from(this.otpHash(otp, mobileNumber), "hex"),
      saved = Buffer.from(challenge.otpHash, "hex");
    if (supplied.length !== saved.length || !timingSafeEqual(supplied, saved)) {
      await this.db
        .update(otpChallenges)
        .set({ attempts: sql`${otpChallenges.attempts} + 1` })
        .where(
          and(
            eq(otpChallenges.id, challenge.id),
            isNull(otpChallenges.consumedAt),
            lt(otpChallenges.attempts, max),
          ),
        );
      throw new UnauthorizedException("Invalid or expired OTP.");
    }
    const consumed = await this.db
      .update(otpChallenges)
      .set({ consumedAt: now })
      .where(
        and(
          eq(otpChallenges.id, challenge.id),
          isNull(otpChallenges.consumedAt),
          gt(otpChallenges.expiresAt, now),
          lt(otpChallenges.attempts, max),
        ),
      )
      .returning({ id: otpChallenges.id });
    if (!consumed.length)
      throw new UnauthorizedException("Invalid or expired OTP.");
    const [user] = await this.db
      .insert(users)
      .values({ mobileNumber, displayName: "" })
      .onConflictDoUpdate({
        target: users.mobileNumber,
        set: { updatedAt: now },
      })
      .returning();
    const token = randomBytes(32).toString("base64url"),
      expiresAt = new Date(
        now.getTime() +
          Number(this.config.get("SESSION_TTL_HOURS", "168")) * 3600000,
      );
    await this.db
      .insert(sessions)
      .values({ userId: user.id, tokenHash: this.tokenHash(token), expiresAt });
    return {
      user: {
        id: user.id,
        mobileNumber: user.mobileNumber,
        displayName: user.displayName,
      },
      token,
      expiresAt,
    };
  }
  async getUser(token?: string): Promise<SafeUser | null> {
    if (!token) return null;
    const [session] = await this.db
      .select({ userId: sessions.userId })
      .from(sessions)
      .where(
        and(
          eq(sessions.tokenHash, this.tokenHash(token)),
          isNull(sessions.revokedAt),
          gt(sessions.expiresAt, new Date()),
        ),
      )
      .limit(1);
    if (!session) return null;
    const [user] = await this.db
      .select()
      .from(users)
      .where(eq(users.id, session.userId))
      .limit(1);
    return user
      ? {
          id: user.id,
          mobileNumber: user.mobileNumber,
          displayName: user.displayName,
        }
      : null;
  }
  async logout(token?: string): Promise<void> {
    if (token)
      await this.db
        .update(sessions)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(sessions.tokenHash, this.tokenHash(token)),
            isNull(sessions.revokedAt),
          ),
        );
  }
  cookieOptions(expires?: Date) {
    const sameSite = this.config.get<"lax" | "strict" | "none">("COOKIE_SAME_SITE", this.config.get("NODE_ENV") === "production" ? "none" : "lax");
    return {
      httpOnly: true,
      secure: this.config.get("NODE_ENV") === "production",
      sameSite,
      path: "/",
      ...(expires ? { expires } : {}),
    };
  }
}
