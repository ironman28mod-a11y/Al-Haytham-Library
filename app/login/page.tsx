"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

const AUTH_KEY = "al-haytham-library:auth";

export default function LoginPage() {
  const router = useRouter();
  const [showPassword, setShowPassword] = useState(false);
  const [role, setRole] = useState<"member" | "staff">("staff");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoginError("");

    if (!username.trim() || !password.trim()) {
      setLoginError("Username dan password wajib diisi.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: username.trim(),
          password: password.trim(),
          type: role,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setLoginError(data.error || "Login gagal. Silakan coba lagi.");
        return;
      }

      setLoginError("");
      localStorage.setItem(
        AUTH_KEY,
        JSON.stringify({
          role: data.role,
          memberCode: data.memberCode || data.code || null,
        })
      );
      router.push("/");
    } catch {
      setLoginError("Gagal terhubung ke server. Silakan coba lagi.");
    } finally {
      setLoading(false);
    }
  };

  const selectRole = (nextRole: "member" | "staff") => {
    setRole(nextRole);
    setLoginError("");
    setUsername("");
    setPassword("");
  };

  return (
    <main className="login-page">
      <section className="login-art">
        <div className="login-brand">
          <img src="/logo.png" alt="Al-Haytham Library" className="brand-logo" width="48" height="48" />
          <span>Al-Haytham <span className="brand-accent">Library</span></span>
        </div>
        <div className="art-copy">
          <span className="eyebrow">PERPUSTAKAAN SEKOLAH</span>
          <h1>Temukan cerita,<br /><em>tumbuhkan</em> imajinasi.</h1>
          <p>Ruang sederhana untuk mengelola koleksi dan membangun kebiasaan membaca bersama.</p>
        </div>
        <div className="art-books">
          <div className="floating-book book-one">Membaca<br />adalah<br />petualangan</div>
          <div className="floating-book book-two">The<br />world<br />inside</div>
          <div className="art-leaf">✦</div>
        </div>
        <span className="art-footer">© 2024 Al-Haytham Library</span>
      </section>
      <section className="login-form-area">
        <div className="login-form-wrap">
          <div className="mobile-login-brand">
            <img src="/logo.png" alt="Al-Haytham Library" className="brand-logo" width="40" height="40" />
            <span>Al-Haytham <span className="brand-accent">Library</span></span>
          </div>
          <div className="login-heading">
            <span className="eyebrow">SELAMAT DATANG KEMBALI</span>
            <h2>Masuk ke Al-Haytham Library</h2>
            <p>Gunakan akun Anda untuk melanjutkan.</p>
          </div>
          <div className="role-switch">
            <button type="button" className={role === "member" ? "selected" : ""} onClick={() => selectRole("member")}>Anggota</button>
            <button type="button" className={role === "staff" ? "selected" : ""} onClick={() => selectRole("staff")}>Petugas</button>
          </div>
          <div className="demo-credentials">
            <span className="eyebrow">{role === "member" ? "MASUK SEBAGAI ANGGOTA" : "MASUK SEBAGAI PETUGAS"}</span>
            <p>
              {role === "member"
                ? <>Gunakan <strong>username</strong> dan <strong>password</strong> akun Guru atau Siswa Anda.</>
                : <>Gunakan <strong>username</strong> dan <strong>password</strong> akun Admin Anda.</>
              }
            </p>
          </div>
          <form onSubmit={handleSubmit}>
            <label>
              {role === "member" ? "Username / Email" : "Username / Email"}
              <div className="login-input">
                <span>@</span>
                <input
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  placeholder={role === "member" ? "Contoh: nadia.putri atau email@tisa.edu" : "Contoh: sendy@tisa.edu"}
                  autoComplete="username"
                />
              </div>
            </label>
            <label>
              Password
              <div className="login-input">
                <span>⌁</span>
                <input
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  type={showPassword ? "text" : "password"}
                  placeholder="Masukkan password"
                  autoComplete="current-password"
                />
                <button type="button" onClick={() => setShowPassword(!showPassword)}>
                  {showPassword ? "Sembunyikan" : "Lihat"}
                </button>
              </div>
            </label>
            <div className="login-helper">
              <label className="check-label"><input type="checkbox" /> <span>Ingat saya</span></label>
              <button type="button">Lupa password?</button>
            </div>
            {loginError && <p className="login-error" role="alert">{loginError}</p>}
            <button type="submit" className="login-button" disabled={loading}>
              {loading ? "Memproses..." : "Masuk"} <span>→</span>
            </button>
          </form>
          <p className="login-help">Belum memiliki akun? <button type="button">Hubungi petugas perpustakaan</button></p>
        </div>
      </section>
    </main>
  );
}
