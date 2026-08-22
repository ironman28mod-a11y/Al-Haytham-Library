import { describe, it, expect, afterAll } from "vitest";
import { api, testBook } from "./helpers";

describe("Books API", () => {
  const book = testBook();
  const createdBooks: string[] = [];

  afterAll(async () => {
    for (const code of createdBooks) {
      await api(`/api/books/${encodeURIComponent(code)}`, { method: "DELETE" });
    }
  });

  describe("POST /api/books", () => {
    it("creates a new book", async () => {
      const { status, data } = await api("/api/books", {
        method: "POST",
        body: JSON.stringify(book),
      });

      expect(status).toBe(201);
      expect(data).toEqual({ ok: true });
      createdBooks.push(book.code);
    });

    it("returns 400 when code is missing", async () => {
      const { status, data } = await api<{ error: string }>("/api/books", {
        method: "POST",
        body: JSON.stringify({ title: "No Code Book" }),
      });

      expect(status).toBe(400);
      expect(data.error).toContain("code");
    });

    it("returns 400 when title is missing", async () => {
      const { status, data } = await api<{ error: string }>("/api/books", {
        method: "POST",
        body: JSON.stringify({ code: "BK-NO-TITLE" }),
      });

      expect(status).toBe(400);
      expect(data.error).toContain("title");
    });
  });

  describe("GET /api/books", () => {
    it("returns an array of books", async () => {
      const { status, data } = await api<Array<{ code: string }>>("/api/books");

      expect(status).toBe(200);
      expect(Array.isArray(data)).toBe(true);
    });

    it("includes the newly created book", async () => {
      const { data } = await api<Array<{ code: string }>>("/api/books");
      const found = data.find((b) => b.code === book.code);

      expect(found).toBeDefined();
    });
  });

  describe("PUT /api/books/[code]", () => {
    it("updates the book", async () => {
      const { status, data } = await api(
        `/api/books/${encodeURIComponent(book.code)}`,
        {
          method: "PUT",
          body: JSON.stringify({ title: "Updated Test Book", stock: 5, available: 5 }),
        },
      );

      expect(status).toBe(200);
      expect(data).toEqual({ ok: true });
    });

    it("reflects the update on GET", async () => {
      const { data } = await api<Array<{ code: string; title: string; stock: number }>>("/api/books");
      const found = data.find((b) => b.code === book.code);

      expect(found?.title).toBe("Updated Test Book");
      expect(found?.stock).toBe(5);
    });
  });

  describe("DELETE /api/books/[code]", () => {
    it("deletes the book", async () => {
      const { status, data } = await api(
        `/api/books/${encodeURIComponent(book.code)}`,
        { method: "DELETE" },
      );

      expect(status).toBe(200);
      expect(data).toEqual({ ok: true });
      // Remove from cleanup list since we already deleted it
      createdBooks.length = 0;
    });

    it("no longer returns the book", async () => {
      const { data } = await api<Array<{ code: string }>>("/api/books");
      const found = data.find((b) => b.code === book.code);

      expect(found).toBeUndefined();
    });
  });
});
