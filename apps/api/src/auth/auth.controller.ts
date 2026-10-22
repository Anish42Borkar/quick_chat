import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  HttpException,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { RequestOtpDto } from "./dto/request-otp.dto";
import { VerifyOtpDto } from "./dto/verify-otp.dto";
import { AuthService } from "./auth.service";
import { parsePhoneNumberFromString } from "libphonenumber-js";
type Limit = { count: number; resetAt: number };
const otpRequestLimits = new Map<string, Limit>(),
  otpVerifyLimits = new Map<string, Limit>();
function rateLimit(
  map: Map<string, Limit>,
  key: string,
  limit: number,
  windowMs: number,
) {
  const now = Date.now(),
    value = map.get(key);
  for (const [entryKey, entry] of map) if (entry.resetAt <= now) map.delete(entryKey);
  if (!value || value.resetAt <= now) {
    if (map.size >= 10000) {
      const oldestKey = map.keys().next().value;
      if (oldestKey) map.delete(oldestKey);
    }
    map.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  if (value.count >= limit) {
    throw new HttpException(
      "Too many attempts. Please try again later.",
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
  value.count++;
}
@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}
  @Post("request-otp")
  @HttpCode(HttpStatus.OK)
  requestOtp(@Body() dto: RequestOtpDto, @Req() req: Request) {
    const normalized = parsePhoneNumberFromString(dto.mobileNumber.trim())?.number ?? dto.mobileNumber.trim();
    rateLimit(otpRequestLimits, `ip:${req.ip ?? "unknown"}`, 10, 900000);
    rateLimit(otpRequestLimits, `number:${normalized}`, 5, 900000);
    return this.auth.requestOtp(dto.mobileNumber);
  }
  @Post("verify-otp")
  @HttpCode(HttpStatus.OK)
  async verifyOtp(
    @Body() dto: VerifyOtpDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const normalized = parsePhoneNumberFromString(dto.mobileNumber.trim())?.number ?? dto.mobileNumber.trim();
    rateLimit(otpVerifyLimits, `number:${normalized}`, 10, 900000);
    const result = await this.auth.verifyOtp(dto.mobileNumber, dto.otp);
    res.cookie(
      "quickchat_session",
      result.token,
      this.auth.cookieOptions(result.expiresAt),
    );
    return { user: result.user };
  }
  @Get("me") async me(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const user = await this.auth.getUser(
      req.cookies?.quickchat_session as string | undefined,
    );
    if (!user && req.cookies?.quickchat_session) res.clearCookie("quickchat_session", this.auth.cookieOptions());
    return user ? { authenticated: true, user } : { authenticated: false };
  }
  @Post("logout")
  @HttpCode(HttpStatus.OK)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(
      req.cookies?.quickchat_session as string | undefined,
    );
    res.clearCookie("quickchat_session", this.auth.cookieOptions());
    return { message: "Signed out successfully." };
  }
}
