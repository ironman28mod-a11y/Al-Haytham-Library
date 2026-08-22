import { describe, it, expect, afterAll } from "vitest";
import { api } from "./helpers";

describe("Categories API", () => {
  const categoryName = `Test Category ${Date.now()}`;
  const cleanup: string[] = [];

  afterAll(async () => {
    for (const name of cleanup) {
      await api(`/api/categories/${encodeURIComponent(name)}`, { method: "DELETE" });
    }
  });

  describe("POST /api/categories", () => {
    it("creates a new category", async () => {
      const { status, data } = await api("/api/categories", {
        method: "POST",
        body: JSON.stringify({ name: categoryName }),
      });

      expect(status).toBe(201);
      expect(data).toEqual({ ok: true });
      cleanup.push(categoryName);
    });

    it("returns 400 when name is missing", async () => {
      const { status, data } = await api<{ error: string }>("/api/categories", {
        method: "POST",
        body: JSON.stringify({}),
      });

      expect(status).toBe(400);
      expect(data.error).toBeTruthy();
    });

    it("rejects duplicate category", async () => {
      const { status, data } = await api<{ error: string }>("/api/categories", {
        method: "POST",
        body: JSON.stringify({ name: categoryName }),
      });

      // Server may return 409 (conflict) or 500 (unique constraint error)
      expect([409, 500]).toContain(status);
      expect(data.error).toBeTruthy();
    });
  });

  describe("GET /api/categories", () => {
    it("returns an array of category names", async () => {
      const { status, data } = await api<string[]>("/api/categories");

      expect(status).toBe(200);
      expect(Array.isArray(data)).toBe(true);
    });

    it("includes the newly created category", async () => {
      const { data } = await api<string[]>("/api/categories");

      expect(data).toContain(categoryName);
    });
  });

  describe("DELETE /api/categories/[name]", () => {
    it("deletes the category", async () => {
      const { status, data } = await api(
        `/api/categories/${encodeURIComponent(categoryName)}`,
        { method: "DELETE" },
      );

      expect(status).toBe(200);
      expect(data).toEqual({ ok: true });
      cleanup.length = 0;
    });

    it("no longer returns the category", async () => {
      const { data } = await api<string[]>("/api/categories");

      expect(data).not.toContain(categoryName);
    });
  });
});
