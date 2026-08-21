import { NextResponse } from "next/server";
import { testConnection } from "@/lib/db";

export async function GET() {
  const ok = await testConnection();
  if (ok) {
    return NextResponse.json({ status: "ok", timestamp: new Date().toISOString() });
  }
  return NextResponse.json({ status: "error", message: "Database connection failed" }, { status: 500 });
}
