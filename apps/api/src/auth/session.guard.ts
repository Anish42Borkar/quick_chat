import { CanActivate, ExecutionContext, Injectable, UnauthorizedException, ForbiddenException, createParamDecorator } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Request } from "express";
import { AuthService } from "./auth.service";

export type AuthenticatedRequest = Request & { user: { id: string; mobileNumber: string; displayName: string } };

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly auth: AuthService, private readonly config: ConfigService) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const origin = request.headers.origin;
    const allowedOrigin = this.config.get<string>("WEB_ORIGIN", "http://localhost:3000");
    if (origin && origin !== allowedOrigin) throw new ForbiddenException("Request origin is not allowed.");
    const user = await this.auth.getUser(request.cookies?.quickchat_session);
    if (!user) throw new UnauthorizedException("Authentication required.");
    request.user = user;
    return true;
  }
}

export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext) =>
  context.switchToHttp().getRequest<AuthenticatedRequest>().user,
);
