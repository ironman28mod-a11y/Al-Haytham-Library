import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
}));

vi.mock("drizzle-orm", () => ({ eq: () => "eq", or: () => "or" }));
vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({ where: () => ({ limit: async () => state.rows }) }),
    }),
  },
}));
vi.mock("@/lib/db/schema", () => ({ members: {} }));

import { POST } from "./route";

function loginRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const ADMIN = {
  code: "ADM-001",
  name: "Rina",
  username: "admin.alhaytham",
  password: "rahasia!",
  role: "Admin",
  status: "Aktif",
};

const SISWA = {
  code: "AG-2024-001",
  name: "Nadia",
  username: "nadia.putri",
  password: "rahasia!",
  role: "Siswa",
  status: "Aktif",
};

beforeEach(() => {
  state.rows = [];
  process.env.SESSION_SECRET = "unit-test-secret";
});

describe("POST /api/auth/login", () => {
  it("menerbitkan cookie sesi httpOnly 7 hari untuk petugas", async () => {
    state.rows = [ADMIN];
    const res = await POST(loginRequest({ username: "admin.alhaytham", password: "rahasia!", type: "staff" }));
    expect(res.status).toBe(200);

    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("alhaytham_session=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain(`Max-Age=${60 * 60 * 24 * 7}`);

    const body = await res.json() as Record<string, unknown>;
    expect(body).toMatchObject({ ok: true, role: "staff", code: "ADM-001" });
  });

  it("memperpanjang cookie menjadi 30 hari saat ingat saya", async () => {
    state.rows = [SISWA];
    const res = await POST(loginRequest({ username: "nadia.putri", password: "rahasia!", type: "member", remember: true }));
    expect(res.status).toBe(200);
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`Max-Age=${60 * 60 * 24 * 30}`);
    expect(cookie).toContain("alhaytham_session=");
  });

  it("token yang diterbitkan valid dan membawa peran yang benar", async () => {
    state.rows = [SISWA];
    const { verifySessionToken } = await import("@/lib/session");
    const res = await POST(loginRequest({ username: "nadia.putri", password: "rahasia!", type: "member" }));
    const cookie = res.headers.get("set-cookie") ?? "";
    const token = decodeURIComponent(cookie.match(/alhaytham_session=([^;]+)/)?.[1] ?? "");
    const session = await verifySessionToken(token, "unit-test-secret");
    expect(session).toMatchObject({ code: "AG-2024-001", role: "member", name: "Nadia" });
  });

  it("menolak password salah tanpa menerbitkan cookie", async () => {
    state.rows = [ADMIN];
    const res = await POST(loginRequest({ username: "admin.alhaytham", password: "salah", type: "staff" }));
    expect(res.status).toBe(401);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("menolak anggota biasa masuk sebagai petugas", async () => {
    state.rows = [SISWA];
    const res = await POST(loginRequest({ username: "nadia.putri", password: "rahasia!", type: "staff" }));
    expect(res.status).toBe(403);
  });

  it("gagal keras (500) bila SESSION_SECRET belum diatur", async () => {
    state.rows = [ADMIN];
    delete process.env.SESSION_SECRET;
    const res = await POST(loginRequest({ username: "admin.alhaytham", password: "rahasia!", type: "staff" }));
    expect(res.status).toBe(500);
    expect(res.headers.get("set-cookie")).toBeNull();
  });
});
