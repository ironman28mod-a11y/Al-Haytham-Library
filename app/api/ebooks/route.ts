import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ebooks } from "@/lib/db/schema";
import { desc } from "drizzle-orm";

export async function GET() {
  try {
    const rows = await db.select().from(ebooks).orderBy(desc(ebooks.code));
    return NextResponse.json(rows);
  } catch (err) {
    console.error("GET /api/ebooks error:", err);
    return NextResponse.json({ error: "Failed to fetch ebooks" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (!body.code || !body.title) {
      return NextResponse.json({ error: "code and title are required" }, { status: 400 });
    }
    await db.insert(ebooks).values({
      code: body.code,
      title: body.title,
      author: body.author || "",
      category: body.category || "",
      stock: body.stock ?? 0,
      available: body.available ?? 0,
      color: body.color || "#dcefe6",
      initials: body.initials || "",
      format: body.format || "PDF",
      size: body.size || "0 KB",
      access: body.access || "Baca online",
      fileName: body.fileName || null,
      fileId: body.fileId || null,
    });
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (err) {
    console.error("POST /api/ebooks error:", err);
    return NextResponse.json({ error: "Failed to create ebook" }, { status: 500 });
  }
}
