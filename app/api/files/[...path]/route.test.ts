import { beforeEach, describe, expect, it, vi } from "vitest";

const drive = vi.hoisted(() => ({
  isDriveConfigured: vi.fn(() => false),
  uploadDriveFile: vi.fn(),
  downloadDriveFile: vi.fn(),
  deleteDriveFile: vi.fn(),
  hasDriveFile: vi.fn(),
  DriveFileExistsError: class DriveFileExistsError extends Error {
    readonly code = "DRIVE_FILE_EXISTS";
  },
}));

vi.mock("@/lib/drive", () => drive);

import { DELETE, GET, HEAD, PUT } from "./route";

const params = { params: Promise.resolve({ path: ["ebook:EB-TEST-001"] }) };

beforeEach(() => {
  vi.clearAllMocks();
  drive.isDriveConfigured.mockReturnValue(false);
});

describe("E-Book file storage policy", () => {
  it.each([
    ["GET", GET],
    ["HEAD", HEAD],
    ["PUT", PUT],
    ["DELETE", DELETE],
  ])("rejects %s without falling back to local storage", async (_method, handler) => {
    const request = new Request("http://localhost/api/files/ebook%3AEB-TEST-001", {
      method: _method,
      body: _method === "PUT" ? new Blob(["pdf-data"], { type: "application/pdf" }) : undefined,
    });

    const response = await handler(request, params);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Penyimpanan E-Book wajib menggunakan Google Drive. Konfigurasi Google Drive belum tersedia.",
    });
  });

  it("returns conflict when a new upload would overwrite an existing Drive file", async () => {
    drive.isDriveConfigured.mockReturnValue(true);
    drive.uploadDriveFile.mockRejectedValue(
      Object.assign(new drive.DriveFileExistsError("ebook_EB-TEST-001"), { code: "DRIVE_FILE_EXISTS" }),
    );

    const request = new Request("http://localhost/api/files/ebook%3AEB-TEST-001", {
      method: "PUT",
      headers: { "content-type": "application/pdf", "x-file-replace": "false" },
      body: new Blob(["pdf-data"], { type: "application/pdf" }),
    });

    const response = await PUT(request, params);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: "DRIVE_FILE_EXISTS" });
    expect(drive.uploadDriveFile).toHaveBeenCalledWith(
      "ebook:EB-TEST-001",
      expect.any(Buffer),
      "application/pdf",
      { replaceExisting: false },
    );
  });
});
