import { describe, expect, it } from "vitest";
import {
  SESSION_COOKIE,
  clearSessionCookie,
  createSessionToken,
  readSessionToken,
  sessionCookie,
  verifySessionToken,
} from "./session";

const SECRET = "test-secret-123";

describe("signed session token", () => {
  it("round-trips a valid session", async () => {
    const token = await createSessionToken(
      { code: "ADM-001", role: "staff", name: "Rina" },
      SECRET,
    );
    const session = await verifySessionToken(token, SECRET);
    expect(session).toMatchObject({ code: "ADM-001", role: "staff", name: "Rina" });
    expect(session!.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it("rejects a token signed with a different secret", async () => {
    const token = await createSessionToken(
      { code: "ADM-001", role: "staff", name: "Rina" },
      "other-secret",
    );
    expect(await verifySessionToken(token, SECRET)).toBeNull();
  });

  it("rejects a tampered payload", async () => {
    const token = await createSessionToken(
      { code: "AG-2024-001", role: "member", name: "Nadia" },
      SECRET,
    );
    const [payload, signature] = token.split(".");
    const upgraded = Buffer.from(
      JSON.stringify({
        code: "AG-2024-001",
        role: "staff",
        name: "Nadia",
        exp: Math.floor(Date.now() / 1000) + 3600,
      }),
    )
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    expect(await verifySessionToken(`${upgraded}.${signature}`, SECRET)).toBeNull();
    expect(await verifySessionToken(`${payload}.AAAA${signature.slice(4)}`, SECRET)).toBeNull();
  });

  it("rejects an expired token", async () => {
    const token = await createSessionToken(
      { code: "ADM-001", role: "staff", name: "Rina" },
      SECRET,
      -10,
    );
    expect(await verifySessionToken(token, SECRET)).toBeNull();
  });

  it("rejects garbage input", async () => {
    expect(await verifySessionToken("", SECRET)).toBeNull();
    expect(await verifySessionToken("not-a-token", SECRET)).toBeNull();
    expect(await verifySessionToken("a.b.c", SECRET)).toBeNull();
  });
});

describe("session cookie helpers", () => {
  it("sets httpOnly with remember-based max age", () => {
    const cookie = sessionCookie("token.value", false);
    expect(cookie.startsWith(`${SESSION_COOKIE}=`)).toBe(true);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain(`Max-Age=${60 * 60 * 24 * 7}`);

    const remembered = sessionCookie("token.value", true);
    expect(remembered).toContain(`Max-Age=${60 * 60 * 24 * 30}`);
  });

  it("clears the cookie on logout", () => {
    expect(clearSessionCookie()).toContain("Max-Age=0");
  });

  it("reads the token back from a cookie header", async () => {
    const token = await createSessionToken(
      { code: "ADM-001", role: "staff", name: "Rina" },
      SECRET,
    );
    const header = `other=1; ${SESSION_COOKIE}=${encodeURIComponent(token)}; theme=dark`;
    expect(readSessionToken(header)).toBe(token);
    expect(readSessionToken("other=1")).toBeNull();
    expect(readSessionToken(null)).toBeNull();
  });
});
