import { describe, it, expect, afterAll } from "vitest";
import { api, testMember } from "./helpers";

describe("Members API", () => {
  const member = testMember();
  const createdMembers: string[] = [];

  afterAll(async () => {
    for (const code of createdMembers) {
      await api(`/api/members/${encodeURIComponent(code)}`, { method: "DELETE" });
    }
  });

  describe("POST /api/members", () => {
    it("creates a new member", async () => {
      const { status, data } = await api("/api/members", {
        method: "POST",
        body: JSON.stringify(member),
      });

      expect(status).toBe(201);
      expect(data).toEqual({ ok: true });
      createdMembers.push(member.code);
    });

    it("returns 400 when code is missing", async () => {
      const { status, data } = await api<{ error: string }>("/api/members", {
        method: "POST",
        body: JSON.stringify({ name: "No Code Member" }),
      });

      expect(status).toBe(400);
      expect(data.error).toContain("code");
    });

    it("returns 400 when name is missing", async () => {
      const { status, data } = await api<{ error: string }>("/api/members", {
        method: "POST",
        body: JSON.stringify({ code: "AG-NO-NAME" }),
      });

      expect(status).toBe(400);
      expect(data.error).toContain("name");
    });
  });

  describe("GET /api/members", () => {
    it("returns an array of members", async () => {
      const { status, data } = await api<Array<{ code: string }>>("/api/members");

      expect(status).toBe(200);
      expect(Array.isArray(data)).toBe(true);
    });

    it("includes the newly created member", async () => {
      const { data } = await api<Array<{ code: string }>>("/api/members");
      const found = data.find((m) => m.code === member.code);

      expect(found).toBeDefined();
    });
  });

  describe("PUT /api/members/[code]", () => {
    it("updates the member", async () => {
      const { status, data } = await api(
        `/api/members/${encodeURIComponent(member.code)}`,
        {
          method: "PUT",
          body: JSON.stringify({ name: "Updated Student", status: "Nonaktif" }),
        },
      );

      expect(status).toBe(200);
      expect(data).toEqual({ ok: true });
    });

    it("reflects the update on GET", async () => {
      const { data } = await api<Array<{ code: string; name: string; status: string }>>("/api/members");
      const found = data.find((m) => m.code === member.code);

      expect(found?.name).toBe("Updated Student");
      expect(found?.status).toBe("Nonaktif");
    });
  });

  describe("DELETE /api/members/[code]", () => {
    it("deletes the member", async () => {
      const { status, data } = await api(
        `/api/members/${encodeURIComponent(member.code)}`,
        { method: "DELETE" },
      );

      expect(status).toBe(200);
      expect(data).toEqual({ ok: true });
      createdMembers.length = 0;
    });

    it("no longer returns the member", async () => {
      const { data } = await api<Array<{ code: string }>>("/api/members");
      const found = data.find((m) => m.code === member.code);

      expect(found).toBeUndefined();
    });
  });
});
