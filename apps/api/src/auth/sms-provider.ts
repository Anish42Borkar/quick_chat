import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
@Injectable()
export class ConfiguredSmsProvider {
  private readonly logger = new Logger(ConfiguredSmsProvider.name);
  constructor(private readonly config: ConfigService) {}
  async sendOtp(mobileNumber: string, otp: string): Promise<void> {
    const provider = this.config.get<string>("SMS_PROVIDER", "mock");
    if (provider === "mock" && this.config.get<string>("NODE_ENV") === "development") {
      this.logger.debug("Mock SMS delivery accepted.");
      return;
    }
    if (provider === "twilio") {
      const accountSid = this.config.get<string>("TWILIO_ACCOUNT_SID");
      const authToken = this.config.get<string>("TWILIO_AUTH_TOKEN");
      const from = this.config.get<string>("TWILIO_FROM_NUMBER");
      if (!accountSid || !authToken || !from) throw new Error("Twilio SMS credentials are required.");
      const credentials = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
      const body = new URLSearchParams({ To: mobileNumber, From: from, Body: `Your QuickChat sign-in code is ${otp}. It expires soon.` });
      const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`, {
        method: "POST", headers: { Authorization: `Basic ${credentials}`, "Content-Type": "application/x-www-form-urlencoded" }, body, signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new Error("Twilio rejected the SMS request.");
      return;
    }
    throw new Error("Configure a real SMS provider outside local development.");
  }
}
