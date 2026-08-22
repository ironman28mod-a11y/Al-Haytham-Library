import { describe, it, expect } from "vitest";
import { api } from "./helpers";

describe("GET /api/health", () => {
  it("returns status ok with a timestamp", async () => {
    const { status, data } = await api<{ status: string; timestamp: string }>("/api/health");

    expect(status).toBe(200);
    expect(data.status).toBe("ok");
    expect(data.timestamp).toBeTruthy();
    expect(new Date(data.timestamp).getTime()).toBeGreaterThan(0);
  });
});
