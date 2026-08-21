import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { books } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    const { code } = await params;
    const body = await req.json();
    const updates: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(body)) {
      if (key === "code") continue;
      updates[key] = value;
    }
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }
    await db.update(books).set(updates).where(eq(books.code, code));
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("PUT /api/books/[code] error:", err);
    return NextResponse.json({ error: "Failed to update book" }, { status: 500 });
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    const { code } = await params;
    await db.delete(books).where(eq(books.code, code));
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("DELETE /api/books/[code] error:", err);
    return NextResponse.json({ error: "Failed to delete book" }, { status: 500 });
  }
}
