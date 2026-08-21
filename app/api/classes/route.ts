import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { classes } from "@/lib/db/schema";
import { asc } from "drizzle-orm";

export async function GET() {
  try {
    const rows = await db.select({ name: classes.name }).from(classes).orderBy(asc(classes.id));
    return NextResponse.json(rows.map((r) => r.name));
  } catch (err) {
    console.error("GET /api/classes error:", err);
    return NextResponse.json({ error: "Failed to fetch classes" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (!body.name?.trim()) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }
    await db.insert(classes).values({ name: body.name.trim() });
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("unique") || message.includes("duplicate")) {
      return NextResponse.json({ error: "Class already exists" }, { status: 409 });
    }
    console.error("POST /api/classes error:", err);
    return NextResponse.json({ error: "Failed to create class" }, { status: 500 });
  }
}
