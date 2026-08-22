import { describe, it, expect, afterAll } from "vitest";
import { api, testBook, testMember, testLoan } from "./helpers";

describe("Loans API", () => {
  // Create a book and member first, since loans reference them
  const book = testBook();
  const member = testMember();
  const loan = testLoan(member, book);
  const cleanup: { type: "book" | "member" | "loan"; code: string }[] = [];

  afterAll(async () => {
    for (const item of [...cleanup].reverse()) {
      if (item.type === "loan") {
        // loans don't have a direct delete endpoint; skip
      } else if (item.type === "book") {
        await api(`/api/books/${encodeURIComponent(item.code)}`, { method: "DELETE" });
      } else {
        await api(`/api/members/${encodeURIComponent(item.code)}`, { method: "DELETE" });
      }
    }
  });

  describe("setup: create book and member", () => {
    it("creates a test book", async () => {
      const { status } = await api("/api/books", {
        method: "POST",
        body: JSON.stringify(book),
      });
      expect(status).toBe(201);
      cleanup.push({ type: "book", code: book.code });
    });

    it("creates a test member", async () => {
      const { status } = await api("/api/members", {
        method: "POST",
        body: JSON.stringify(member),
      });
      expect(status).toBe(201);
      cleanup.push({ type: "member", code: member.code });
    });
  });

  describe("POST /api/loans", () => {
    it("creates a new loan", async () => {
      const { status, data } = await api("/api/loans", {
        method: "POST",
        body: JSON.stringify(loan),
      });

      expect(status).toBe(201);
      expect(data).toEqual({ ok: true });
    });

    it("returns 400 when id is missing", async () => {
      const { status, data } = await api<{ error: string }>("/api/loans", {
        method: "POST",
        body: JSON.stringify({ member: "X", book: "Y" }),
      });

      expect(status).toBe(400);
      expect(data.error).toContain("id");
    });
  });

  describe("GET /api/loans", () => {
    it("returns an array of loans", async () => {
      const { status, data } = await api<Array<{ id: string }>>("/api/loans");

      expect(status).toBe(200);
      expect(Array.isArray(data)).toBe(true);
    });

    it("includes the newly created loan", async () => {
      const { data } = await api<Array<{ id: string }>>("/api/loans");
      const found = data.find((l) => l.id === loan.id);

      expect(found).toBeDefined();
    });
  });

  describe("POST /api/loans/[id]/return", () => {
    it("returns the loan", async () => {
      const { status, data } = await api(`/api/loans/${encodeURIComponent(loan.id)}/return`, {
        method: "POST",
      });

      expect(status).toBe(200);
      expect(data).toEqual({ ok: true });
    });

    it("marks the loan as Dikembalikan", async () => {
      const { data } = await api<Array<{ id: string; status: string; returnedDate: string | null }>>("/api/loans");
      const found = data.find((l) => l.id === loan.id);

      expect(found?.status).toBe("Dikembalikan");
      expect(found?.returnedDate).toBeTruthy();
    });

    it("increments book availability", async () => {
      const { data } = await api<Array<{ code: string; available: number }>>("/api/books");
      const found = data.find((b) => b.code === book.code);

      // Book was created with available=3; after loan was returned, should be 4
      expect(found?.available).toBe(book.available + 1);
    });
  });
});
