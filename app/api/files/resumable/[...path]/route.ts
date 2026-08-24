import { NextResponse } from "next/server";
import { uploadDriveChunk } from "@/lib/drive";

export const maxDuration = 300;

const MAX_CHUNK_BYTES = 2 * 1024 * 1024;

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  try {
    const { path: pathParts } = await params;
    const encodedSessionUrl = pathParts.join("/");
    const sessionUrl = decodeURIComponent(encodedSessionUrl);
    const contentRange = req.headers.get("content-range") ?? "";
    const mimeType = req.headers.get("content-type") ?? "application/octet-stream";
    if (!sessionUrl.startsWith("https://www.googleapis.com/upload/drive/")) {
      return NextResponse.json({ error: "URL sesi upload tidak valid." }, { status: 400 });
    }
    if (!/^bytes \d+-\d+\/\d+$/.test(contentRange)) {
      return NextResponse.json({ error: "Chunk upload tidak valid." }, { status: 400 });
    }
    const range = contentRange.match(/^bytes (\d+)-(\d+)\/(\d+)$/);
    const expectedLength = range ? Number(range[2]) - Number(range[1]) + 1 : 0;
    if (!range || !Number.isSafeInteger(expectedLength) || expectedLength < 0 || expectedLength > MAX_CHUNK_BYTES) {
      return NextResponse.json({ error: "Content-Range tidak sesuai ukuran chunk." }, { status: 400 });
    }

    const chunk = Buffer.from(await req.arrayBuffer());
    const contentLength = chunk.length;
    if (contentLength !== expectedLength) {
      return NextResponse.json({ error: "Ukuran chunk tidak sesuai header." }, { status: 400 });
    }
    const result = await uploadDriveChunk(sessionUrl, chunk, contentRange, mimeType);
    return NextResponse.json(result, { status: result.complete ? 201 : 200 });
  } catch (err) {
    console.error("PUT /api/files/resumable error:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to upload chunk" }, { status: 500 });
  }
}
