import { describe, it, expect, afterAll } from "vitest";
import { api, testEbook } from "./helpers";

describe("E-Books API", () => {
  const ebook = testEbook();
  const createdEbooks: string[] = [];

  afterAll(async () => {
    for (const code of createdEbooks) {
      await api(`/api/ebooks/${encodeURIComponent(code)}`, { method: "DELETE" });
    }
  });

  describe("POST /api/ebooks", () => {
    it("creates a new ebook", async () => {
      const { status, data } = await api("/api/ebooks", {
        method: "POST",
        body: JSON.stringify(ebook),
      });

      expect(status).toBe(201);
      expect(data).toEqual({ ok: true });
      createdEbooks.push(ebook.code);
    });

    it("returns 400 when code is missing", async () => {
      const { status, data } = await api<{ error: string }>("/api/ebooks", {
        method: "POST",
        body: JSON.stringify({ title: "No Code Ebook" }),
      });

      expect(status).toBe(400);
      expect(data.error).toContain("code");
    });
  });

  describe("GET /api/ebooks", () => {
    it("returns an array of ebooks", async () => {
      const { status, data } = await api<Array<{ code: string }>>("/api/ebooks");

      expect(status).toBe(200);
      expect(Array.isArray(data)).toBe(true);
    });

    it("includes the newly created ebook", async () => {
      const { data } = await api<Array<{ code: string }>>("/api/ebooks");
      const found = data.find((e) => e.code === ebook.code);

      expect(found).toBeDefined();
    });
  });

  describe("PUT /api/ebooks/[code]", () => {
    it("updates the ebook", async () => {
      const { status, data } = await api(
        `/api/ebooks/${encodeURIComponent(ebook.code)}`,
        {
          method: "PUT",
          body: JSON.stringify({ title: "Updated Test Ebook", format: "EPUB" }),
        },
      );

      expect(status).toBe(200);
      expect(data).toEqual({ ok: true });
    });

    it("reflects the update on GET", async () => {
      const { data } = await api<Array<{ code: string; title: string; format: string }>>("/api/ebooks");
      const found = data.find((e) => e.code === ebook.code);

      expect(found?.title).toBe("Updated Test Ebook");
      expect(found?.format).toBe("EPUB");
    });
  });

  describe("DELETE /api/ebooks/[code]", () => {
    it("deletes the ebook", async () => {
      const { status, data } = await api(
        `/api/ebooks/${encodeURIComponent(ebook.code)}`,
        { method: "DELETE" },
      );

      expect(status).toBe(200);
      expect(data).toEqual({ ok: true });
      createdEbooks.length = 0;
    });

    it("no longer returns the ebook", async () => {
      const { data } = await api<Array<{ code: string }>>("/api/ebooks");
      const found = data.find((e) => e.code === ebook.code);

      expect(found).toBeUndefined();
    });
  });
});
