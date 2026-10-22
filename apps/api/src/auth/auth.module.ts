import { Module } from "@nestjs/common";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { ConfiguredSmsProvider } from "./sms-provider";
@Module({ controllers: [AuthController], providers: [AuthService, ConfiguredSmsProvider], exports: [AuthService] })
export class AuthModule {}
