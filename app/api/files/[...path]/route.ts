import { NextResponse } from "next/server";
import {
  isDriveConfigured,
  uploadDriveFile,
  downloadDriveFile,
  streamDriveFile,
  deleteDriveFile,
  hasDriveFile,
  DriveFileExistsError,
} from "@/lib/drive";
import { readFile, writeFile, unlink, mkdir } from "fs/promises";
import { existsSync } from "fs";
import path from "path";

export const maxDuration = 300;

const STORAGE_DIR = path.join(process.cwd(), "storage", "files");
const EBOOK_FILE_PREFIX = "ebook:";

function isEbookFile(logicalId: string) {
  return logicalId.startsWith(EBOOK_FILE_PREFIX);
}

function driveRequiredResponse() {
  return NextResponse.json(
    { error: "Penyimpanan E-Book wajib menggunakan Google Drive. Konfigurasi Google Drive belum tersedia." },
    { status: 503 }
  );
}

async function ensureDir() {
  if (!existsSync(STORAGE_DIR)) {
    await mkdir(STORAGE_DIR, { recursive: true });
  }
}

/* ── Local filesystem helpers (fallback when Drive is unavailable) ── */

async function localGet(filePath: string) {
  if (!existsSync(filePath)) return null;
  const data = await readFile(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes: Record<string, string> = {
    ".pdf": "application/pdf",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".epub": "application/epub+zip",
    ".mobi": "application/x-mobipocket-ebook",
  };
  return { data, mimeType: mimeTypes[ext] || "application/octet-stream" };
}

async function localPut(filePath: string, buffer: Buffer) {
  const dir = path.dirname(filePath);
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
  await writeFile(filePath, buffer);
}

async function localDelete(filePath: string) {
  if (existsSync(filePath)) await unlink(filePath);
}

/* ── Helpers ── */

function mimeTypes(): Record<string, string> {
  return {
    ".pdf": "application/pdf",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".epub": "application/epub+zip",
    ".mobi": "application/x-mobipocket-ebook",
  };
}

/* ── Route handlers ── */

export async function HEAD(
  _req: Request,
  { params }: { params: Promise<{ path: string[] }> }
) {
  try {
    const { path: pathParts } = await params;
    const logicalId = pathParts.join("/");
    if (isEbookFile(logicalId) && !isDriveConfigured()) return driveRequiredResponse();
    if (isDriveConfigured()) {
      const exists = await hasDriveFile(logicalId);
      return new Response(null, { status: exists ? 200 : 404 });
    }
    const filePath = path.join(STORAGE_DIR, ...pathParts);
    return new Response(null, { status: existsSync(filePath) ? 200 : 404 });
  } catch (err) {
    console.error("HEAD /api/files error:", err);
    return NextResponse.json({ error: "Failed to check file" }, { status: 500 });
  }
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ path: string[] }> }
) {
  try {
    const { path: pathParts } = await params;
    const logicalId = pathParts.join("/");

    // E-Books are always read from Drive. Never fall back to ephemeral local storage.
    if (isEbookFile(logicalId) && !isDriveConfigured()) return driveRequiredResponse();

    // Drive (production / configured)
    if (isDriveConfigured()) {
      // E-Books are streamed directly to avoid Vercel's 4.5 MB response limit.
      if (isEbookFile(logicalId)) {
        const driveRes = await streamDriveFile(logicalId);
        if (!driveRes) {
          return NextResponse.json({ error: "File not found" }, { status: 404 });
        }
        return new Response(driveRes.body, {
          status: driveRes.status,
          headers: {
            "Content-Type": driveRes.headers.get("content-type") || "application/octet-stream",
            "Cache-Control": "private, no-store",
          },
        });
      }
      const result = await downloadDriveFile(logicalId);
      if (!result) {
        return NextResponse.json({ error: "File not found" }, { status: 404 });
      }
      return new Response(new Uint8Array(result.data), {
        headers: {
          "Content-Type": result.mimeType,
          "Cache-Control": "public, max-age=3600",
        },
      });
    }

    // Local filesystem fallback for non-E-Book assets only.
    const filePath = path.join(STORAGE_DIR, ...pathParts);
    const local = await localGet(filePath);
    if (!local) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }
    return new Response(new Uint8Array(local.data), {
      headers: {
        "Content-Type": local.mimeType,
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (err) {
    console.error("GET /api/files error:", err);
    return NextResponse.json({ error: "Failed to read file" }, { status: 500 });
  }
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ path: string[] }> }
) {
  try {
    const { path: pathParts } = await params;
    const logicalId = pathParts.join("/");
    const mimeType = req.headers.get("content-type") || "application/octet-stream";
    const replaceExisting = req.headers.get("x-file-replace") !== "false";
    const arrayBuffer = await req.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // E-Books must never be written to the local filesystem.
    if (isEbookFile(logicalId) && !isDriveConfigured()) return driveRequiredResponse();

    // Drive (production / configured)
    if (isDriveConfigured()) {
      await uploadDriveFile(logicalId, buffer, mimeType, { replaceExisting });
      return NextResponse.json({ ok: true, key: logicalId, storage: "google-drive" }, { status: 201 });
    }

    // Local filesystem fallback for non-E-Book assets only.
    await ensureDir();
    const filePath = path.join(STORAGE_DIR, ...pathParts);
    await localPut(filePath, buffer);
    return NextResponse.json({ ok: true, key: logicalId }, { status: 201 });
  } catch (err) {
    if (err instanceof DriveFileExistsError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 409 });
    }
    console.error("PUT /api/files error:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to write file" }, { status: 500 });
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ path: string[] }> }
) {
  try {
    const { path: pathParts } = await params;
    const logicalId = pathParts.join("/");

    // E-Books must never be deleted from or checked against local storage.
    if (isEbookFile(logicalId) && !isDriveConfigured()) return driveRequiredResponse();

    // Drive (production / configured)
    if (isDriveConfigured()) {
      await deleteDriveFile(logicalId);
      return NextResponse.json({ ok: true, storage: "google-drive" });
    }

    // Local filesystem fallback for non-E-Book assets only.
    const filePath = path.join(STORAGE_DIR, ...pathParts);
    await localDelete(filePath);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("DELETE /api/files error:", err);
    return NextResponse.json({ error: "Failed to delete file" }, { status: 500 });
  }
}