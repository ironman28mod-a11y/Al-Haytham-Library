import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { settings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ key: string }> }
) {
  try {
    const { key } = await params;
    const [row] = await db.select().from(settings).where(eq(settings.key, decodeURIComponent(key))).limit(1);
    return NextResponse.json(row?.value ?? null);
  } catch (err) {
    console.error("GET /api/settings/[key] error:", err);
    return NextResponse.json({ error: "Failed to fetch setting" }, { status: 500 });
  }
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ key: string }> }
) {
  try {
    const { key } = await params;
    const body = await req.json();
    await db
      .insert(settings)
      .values({ key: decodeURIComponent(key), value: body.value })
      .onConflictDoUpdate({
        target: settings.key,
        set: { value: body.value },
      });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("PUT /api/settings/[key] error:", err);
    return NextResponse.json({ error: "Failed to save setting" }, { status: 500 });
  }
}
