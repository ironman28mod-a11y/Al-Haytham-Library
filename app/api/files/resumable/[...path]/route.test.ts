import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/drive", () => ({
  uploadDriveChunk: vi.fn(),
}));

import { PUT } from "./route";

const validSession = encodeURIComponent("https://www.googleapis.com/upload/drive/v3/files/session-123");
const params = { params: Promise.resolve({ path: [validSession] }) };

describe("resumable file upload", () => {
  it("rejects a session URL outside Google Drive", async () => {
    const request = new Request("http://localhost/api/files/resumable/session", {
      method: "PUT",
      headers: { "Content-Range": "bytes 0-3/4", "Content-Type": "application/pdf" },
      body: new Blob(["test"], { type: "application/pdf" }),
    });

    const response = await PUT(request, { params: Promise.resolve({ path: [encodeURIComponent("https://example.com/session")] }) });

    expect(response.status).toBe(400);
  });

  it("rejects chunks larger than the bounded proxy size", async () => {
    const request = new Request("http://localhost/api/files/resumable/session", {
      method: "PUT",
      headers: { "Content-Range": "bytes 0-2097152/2097153", "Content-Type": "application/pdf" },
      body: new Uint8Array(2097153),
    });

    const response = await PUT(request, params);

    expect(response.status).toBe(400);
  });

  it("accepts a valid bounded chunk and forwards it to Drive", async () => {
    const { uploadDriveChunk } = await import("@/lib/drive");
    vi.mocked(uploadDriveChunk).mockResolvedValue({ complete: false, nextOffset: 4 });
    const request = new Request("http://localhost/api/files/resumable/session", {
      method: "PUT",
      headers: { "Content-Range": "bytes 0-3/8", "Content-Type": "application/pdf" },
      body: new Uint8Array([116, 101, 115, 116]),
    });

    const response = await PUT(request, params);

    expect(response.status, await response.clone().text()).toBe(200);
    expect(uploadDriveChunk).toHaveBeenCalledWith(decodeURIComponent(validSession), expect.any(Buffer), "bytes 0-3/8", "application/pdf");
  });
});
