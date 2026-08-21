import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { categories } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ name: string }> }
) {
  try {
    const { name } = await params;
    await db.delete(categories).where(eq(categories.name, decodeURIComponent(name)));
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("DELETE /api/categories/[name] error:", err);
    return NextResponse.json({ error: "Failed to delete category" }, { status: 500 });
  }
}
