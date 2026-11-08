import { describe, expect, test } from "bun:test";
import { CHAT_SCOPES, GMAIL_SCOPE, hasChatScope, hasGmailScope } from "./index.ts";

describe("auth scopes", () => {
  test("hasGmailScope checks for gmail.modify", () => {
    expect(hasGmailScope(null)).toBe(false);
    expect(hasGmailScope("")).toBe(false);
    expect(hasGmailScope("email profile")).toBe(false);
    expect(hasGmailScope(`email ${GMAIL_SCOPE} profile`)).toBe(true);
  });

  test("hasChatScope checks for chat scopes", () => {
    expect(hasChatScope(null)).toBe(false);
    expect(hasChatScope("")).toBe(false);
    expect(hasChatScope(GMAIL_SCOPE)).toBe(false);
    expect(hasChatScope(`${GMAIL_SCOPE} ${CHAT_SCOPES[0]}`)).toBe(true);
    expect(hasChatScope(CHAT_SCOPES.join(" "))).toBe(true);
  });
});
