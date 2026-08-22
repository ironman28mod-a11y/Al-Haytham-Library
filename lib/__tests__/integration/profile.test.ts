import { describe, it, expect } from "vitest";
import { api } from "./helpers";

describe("Profile API", () => {
  const defaultProfile = {
    name: "Rina Nuraini",
    email: "rina.nuraini@alhaytham.sch.id",
  };

  describe("GET /api/profile", () => {
    it("returns a profile object", async () => {
      const { status, data } = await api<{
        id?: number;
        name: string;
        email: string;
        role: string;
      }>("/api/profile");

      expect(status).toBe(200);
      expect(data.name).toBeTruthy();
      expect(data.email).toBeTruthy();
      expect(data.role).toBeTruthy();
    });
  });

  describe("PUT /api/profile", () => {
    const originalName = "Integration Test Admin";
    const updatedName = "Integration Test Updated";

    it("creates or updates the profile", async () => {
      const { status, data } = await api("/api/profile", {
        method: "PUT",
        body: JSON.stringify({
          name: originalName,
          email: "integration@test.com",
          phone: "081234567890",
          bio: "Test bio",
          role: "staff",
          detail: "Administrator",
        }),
      });

      expect(status).toBe(200);
      expect(data).toEqual({ ok: true });
    });

    it("reflects the update on GET", async () => {
      const { data } = await api<{ name: string; email: string }>("/api/profile");

      expect(data.name).toBe(originalName);
      expect(data.email).toBe("integration@test.com");
    });

    it("updates the profile again", async () => {
      const { status } = await api("/api/profile", {
        method: "PUT",
        body: JSON.stringify({
          name: updatedName,
          email: "integration-updated@test.com",
          phone: "089999999999",
          bio: "Updated bio",
          role: "staff",
          detail: "Super Admin",
        }),
      });

      expect(status).toBe(200);
    });

    it("reflects the second update on GET", async () => {
      const { data } = await api<{ name: string; email: string }>("/api/profile");

      expect(data.name).toBe(updatedName);
      expect(data.email).toBe("integration-updated@test.com");
    });
  });
});
