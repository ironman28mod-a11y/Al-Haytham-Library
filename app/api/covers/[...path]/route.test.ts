import { beforeEach, describe, expect, it, vi } from "vitest";

const drive = vi.hoisted(() => ({
  isDriveConfigured: vi.fn(() => true),
  streamDriveThumbnail: vi.fn(),
}));

vi.mock("@/lib/drive", () => drive);

import { GET } from "./route";

const params = { params: Promise.resolve({ path: ["book-cover:BK-001"] }) };

beforeEach(() => {
  vi.clearAllMocks();
  drive.isDriveConfigured.mockReturnValue(true);
});

describe("cover thumbnail route", () => {
  it("returns a cacheable image stream", async () => {
    drive.streamDriveThumbnail.mockResolvedValue(new Response(new Blob(["image-data"], { type: "image/webp" }), {
      status: 200,
      headers: { "content-type": "image/webp", "content-length": "10" },
    }));

    const response = await GET(new Request("http://localhost/api/covers/book-cover%3ABK-001"), params);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/webp");
    expect(response.headers.get("cache-control")).toContain("public");
    expect(response.headers.get("cache-control")).toContain("s-maxage=86400");
    await expect(response.arrayBuffer()).resolves.toEqual(new TextEncoder().encode("image-data").buffer);
    expect(drive.streamDriveThumbnail).toHaveBeenCalledWith("book-cover:BK-001");
  });

  it("does not access Drive when Drive is not configured", async () => {
    drive.isDriveConfigured.mockReturnValue(false);

    const response = await GET(new Request("http://localhost/api/covers/book-cover%3ABK-001"), params);

    expect(response.status).toBe(503);
    expect(drive.streamDriveThumbnail).not.toHaveBeenCalled();
  });

  it("returns 404 when Drive has no thumbnail", async () => {
    drive.streamDriveThumbnail.mockResolvedValue(null);

    const response = await GET(new Request("http://localhost/api/covers/book-cover%3ABK-001"), params);

    expect(response.status).toBe(404);
  });
});
