import { describe, it, expect, afterAll } from "vitest";
import { api } from "./helpers";

describe("Classes API", () => {
  const className = `X Test ${Date.now()}`;
  const cleanup: string[] = [];

  afterAll(async () => {
    for (const name of cleanup) {
      await api(`/api/classes/${encodeURIComponent(name)}`, { method: "DELETE" });
    }
  });

  describe("POST /api/classes", () => {
    it("creates a new class", async () => {
      const { status, data } = await api("/api/classes", {
        method: "POST",
        body: JSON.stringify({ name: className }),
      });

      expect(status).toBe(201);
      expect(data).toEqual({ ok: true });
      cleanup.push(className);
    });

    it("returns 400 when name is missing", async () => {
      const { status, data } = await api<{ error: string }>("/api/classes", {
        method: "POST",
        body: JSON.stringify({}),
      });

      expect(status).toBe(400);
      expect(data.error).toBeTruthy();
    });

    it("rejects duplicate class", async () => {
      const { status, data } = await api<{ error: string }>("/api/classes", {
        method: "POST",
        body: JSON.stringify({ name: className }),
      });

      // Server may return 409 (conflict) or 500 (unique constraint error)
      expect([409, 500]).toContain(status);
      expect(data.error).toBeTruthy();
    });
  });

  describe("GET /api/classes", () => {
    it("returns an array of class names", async () => {
      const { status, data } = await api<string[]>("/api/classes");

      expect(status).toBe(200);
      expect(Array.isArray(data)).toBe(true);
    });

    it("includes the newly created class", async () => {
      const { data } = await api<string[]>("/api/classes");

      expect(data).toContain(className);
    });
  });

  describe("DELETE /api/classes/[name]", () => {
    it("deletes the class", async () => {
      const { status, data } = await api(
        `/api/classes/${encodeURIComponent(className)}`,
        { method: "DELETE" },
      );

      expect(status).toBe(200);
      expect(data).toEqual({ ok: true });
      cleanup.length = 0;
    });

    it("no longer returns the class", async () => {
      const { data } = await api<string[]>("/api/classes");

      expect(data).not.toContain(className);
    });
  });
});
