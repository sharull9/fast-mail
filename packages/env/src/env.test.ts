import { describe, expect, test } from "bun:test";
import { parseDesktopEnv } from "./desktop.ts";
import { parseServerEnv } from "./server.ts";
import { parseWebEnv } from "./web.ts";

describe("server env", () => {
  test("defaults and coercion", () => {
    const env = parseServerEnv({ MAILFAST_PORT: "47821", MAILFAST_PARENT_PID: "123", MAILFAST_TOKEN: "" });
    expect(env.MAILFAST_PORT).toBe(47821);
    expect(env.MAILFAST_PARENT_PID).toBe(123);
    expect(env.MAILFAST_TOKEN).toBeUndefined(); // empty string treated as unset
    expect(env.NODE_ENV).toBe("development");
    expect(parseServerEnv({}).MAILFAST_PORT).toBe(0);
  });

  test("rejects bad values with a readable message", () => {
    expect(() => parseServerEnv({ MAILFAST_PORT: "99999" })).toThrow(/MAILFAST_PORT/);
    expect(() => parseServerEnv({ MAILFAST_SECRET_KEY: "short" })).toThrow(/at least 32/);
    expect(() => parseServerEnv({ GOOGLE_CLIENT_ID: "nope" })).toThrow(/GOOGLE_CLIENT_ID/);
  });

  test("Google client needs both id and secret", () => {
    expect(() => parseServerEnv({ GOOGLE_CLIENT_ID: "1.apps.googleusercontent.com" })).toThrow(/GOOGLE_CLIENT_SECRET/);
    const ok = parseServerEnv({ GOOGLE_CLIENT_ID: "1.apps.googleusercontent.com", GOOGLE_CLIENT_SECRET: "s" });
    expect(ok.GOOGLE_CLIENT_SECRET).toBe("s");
  });
});

describe("desktop and web env", () => {
  test("dev defaults", () => {
    expect(parseDesktopEnv({})).toMatchObject({ MAILFAST_DEV_URL: "http://localhost:5199", MAILFAST_PORT: 47821 });
    expect(parseWebEnv({}).MAILFAST_PORT).toBe(47821);
    expect(() => parseDesktopEnv({ MAILFAST_DEV_URL: "not a url" })).toThrow(/MAILFAST_DEV_URL/);
  });
});
