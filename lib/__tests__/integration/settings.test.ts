import { describe, it, expect } from "vitest";
import { api } from "./helpers";

describe("Settings API", () => {
  const testKey = `test-setting-${Date.now()}`;

  describe("PUT /api/settings/[key]", () => {
    it("creates or updates a setting", async () => {
      const { status, data } = await api(`/api/settings/${encodeURIComponent(testKey)}`, {
        method: "PUT",
        body: JSON.stringify({ value: "hello-world" }),
      });

      expect(status).toBe(200);
      expect(data).toEqual({ ok: true });
    });

    it("updates the setting value", async () => {
      const { status, data } = await api(`/api/settings/${encodeURIComponent(testKey)}`, {
        method: "PUT",
        body: JSON.stringify({ value: "updated-value" }),
      });

      expect(status).toBe(200);
      expect(data).toEqual({ ok: true });
    });
  });

  describe("GET /api/settings/[key]", () => {
    it("returns the stored value", async () => {
      const { status, data } = await api<string | null>(
        `/api/settings/${encodeURIComponent(testKey)}`,
      );

      expect(status).toBe(200);
      expect(data).toBe("updated-value");
    });

    it("returns null for a nonexistent key", async () => {
      const { status, data } = await api<string | null>(
        `/api/settings/${encodeURIComponent("nonexistent-key-" + Date.now())}`,
      );

      expect(status).toBe(200);
      expect(data).toBeNull();
    });
  });
});
