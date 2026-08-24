import { NextResponse } from "next/server";
import { DriveFileExistsError, isDriveConfigured, startResumableDriveUpload } from "@/lib/drive";

export const maxDuration = 300;

export async function POST(req: Request) {
  try {
    if (!isDriveConfigured()) {
      return NextResponse.json(
        { error: "Penyimpanan E-Book wajib menggunakan Google Drive. Konfigurasi Google Drive belum tersedia." },
        { status: 503 },
      );
    }

    const body = await req.json() as {
      id?: unknown;
      mimeType?: unknown;
      size?: unknown;
      replaceExisting?: unknown;
    };
    const id = typeof body.id === "string" ? body.id : "";
    const mimeType = typeof body.mimeType === "string" ? body.mimeType : "application/octet-stream";
    const size = typeof body.size === "number" ? body.size : Number(body.size);
    if (!id || !Number.isSafeInteger(size) || size < 0) {
      return NextResponse.json({ error: "id dan ukuran file wajib diisi dengan benar." }, { status: 400 });
    }

    const sessionUrl = await startResumableDriveUpload(id, mimeType, size, {
      replaceExisting: body.replaceExisting !== false,
    });
    return NextResponse.json({ sessionUrl });
  } catch (err) {
    if (err instanceof DriveFileExistsError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 409 });
    }
    console.error("POST /api/files/resumable error:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to start resumable upload" }, { status: 500 });
  }
}
