import * as assert from "node:assert/strict";
import { test } from "node:test";
import type { Request, Response } from "express";
import { AuthController } from "../src/auth/auth.controller";
import type { AuthService, SafeUser } from "../src/auth/auth.service";

const user: SafeUser = { id: "79d67a8a-c63a-4b54-a415-90947199922d", mobileNumber: "+14155552671", displayName: "" };

test("OTP verification returns only the safe profile and writes token to HTTP-only cookie", async () => {
  let cookie: { name: string; value: string; options: Record<string, unknown> } | undefined;
  const auth = {
    verifyOtp: async () => ({ user, token: "opaque-session-secret", expiresAt: new Date("2030-01-01T00:00:00Z") }),
    cookieOptions: () => ({ httpOnly: true, secure: false }),
  } as unknown as AuthService;
  const controller = new AuthController(auth);
  const response = { cookie: (name: string, value: string, options: Record<string, unknown>) => { cookie = { name, value, options }; } } as unknown as Response;

  const result = await controller.verifyOtp({ mobileNumber: user.mobileNumber, otp: "123456" }, response);

  assert.deepEqual(result, { user });
  assert.equal(cookie?.name, "quickchat_session");
  assert.equal(cookie?.value, "opaque-session-secret");
  assert.equal(cookie?.options.httpOnly, true);
  assert.equal(JSON.stringify(result).includes("opaque-session-secret"), false);
});

test("invalid session restoration expires the stale cookie", async () => {
  let cleared: { name: string; options: Record<string, unknown> } | undefined;
  const auth = {
    getUser: async () => null,
    cookieOptions: () => ({ httpOnly: true, path: "/" }),
  } as unknown as AuthService;
  const controller = new AuthController(auth);
  const response = { clearCookie: (name: string, options: Record<string, unknown>) => { cleared = { name, options }; } } as unknown as Response;

  const result = await controller.me({ cookies: { quickchat_session: "stale" } } as unknown as Request, response);

  assert.deepEqual(result, { authenticated: false });
  assert.equal(cleared?.name, "quickchat_session");
  assert.equal(cleared?.options.path, "/");
});

test("normalized phone numbers share the OTP request throttle", async () => {
  let requests = 0;
  const auth = { requestOtp: async () => { requests++; return { message: "requested" }; } } as unknown as AuthService;
  const controller = new AuthController(auth);
  const request = { ip: "test-auth-controller" } as Request;
  const variants = ["+14155552671", "+1 (415) 555-2671", "+1 415 555 2671", "+1415-555-2671", "+1.415.555.2671"];

  for (const mobileNumber of variants) await controller.requestOtp({ mobileNumber }, request);
  assert.throws(() => controller.requestOtp({ mobileNumber: "+1 415 555 2671" }, request), (error: { status?: number }) => error.status === 429);
  assert.equal(requests, 5);
});
