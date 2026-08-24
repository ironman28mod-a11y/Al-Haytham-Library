import { isDriveConfigured, streamDriveThumbnail } from "@/lib/drive";

export const maxDuration = 60;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  try {
    if (!isDriveConfigured()) {
      return Response.json({ error: "Google Drive belum dikonfigurasi." }, { status: 503 });
    }

    const { path: pathParts } = await params;
    const logicalId = pathParts.join("/");
    const thumbnail = await streamDriveThumbnail(logicalId);
    if (!thumbnail) return Response.json({ error: "Cover tidak ditemukan." }, { status: 404 });

    const headers = new Headers();
    headers.set("Content-Type", thumbnail.headers.get("content-type") || "image/jpeg");
    headers.set("Cache-Control", "public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800");
    const length = thumbnail.headers.get("content-length");
    if (length) headers.set("Content-Length", length);
    return new Response(thumbnail.body, { status: thumbnail.status, headers });
  } catch (error) {
    console.error("GET /api/covers error:", error);
    return Response.json({ error: "Cover tidak dapat dimuat." }, { status: 500 });
  }
}
