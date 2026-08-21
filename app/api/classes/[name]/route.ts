import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { classes, members } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ name: string }> }
) {
  try {
    const { name } = await params;
    const decodedName = decodeURIComponent(name);

    // Check if class is in use by students
    const inUse = await db
      .select()
      .from(members)
      .where(and(eq(members.className, decodedName), eq(members.role, "Siswa")))
      .limit(1);

    if (inUse.length > 0) {
      return NextResponse.json({ error: "Kelas masih digunakan oleh Siswa." }, { status: 409 });
    }

    await db.delete(classes).where(eq(classes.name, decodedName));
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("DELETE /api/classes/[name] error:", err);
    return NextResponse.json({ error: "Failed to delete class" }, { status: 500 });
  }
}
