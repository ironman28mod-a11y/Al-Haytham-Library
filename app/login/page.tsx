"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

const AUTH_KEY = "al-haytham-library:auth";

const demoAccount = {
  username: "admin.alhaytham",
  password: "AlHaytham123!",
};

const demoMemberAccount = {
  code: "AG-2024-001",
  pin: "240001",
  name: "Nadia Putri",
};

export default function LoginPage() {
  const router = useRouter();
  const [showPassword, setShowPassword] = useState(false);
  const [role, setRole] = useState<"member" | "staff">("staff");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (role === "member") {
      if (username.trim().toUpperCase() !== demoMemberAccount.code || password !== demoMemberAccount.pin) {
        setLoginError("Kode anggota atau PIN belum sesuai dengan akun demo.");
        return;
      }
      setLoginError("");
      localStorage.setItem(AUTH_KEY, JSON.stringify({ role: "member", memberCode: demoMemberAccount.code }));
      router.push("/");
      return;
    }

    if (username.trim() !== demoAccount.username || password !== demoAccount.password) {
      setLoginError("Username atau password belum sesuai dengan akun demo.");
      return;
    }

    setLoginError("");
    localStorage.setItem(AUTH_KEY, JSON.stringify({ role: "staff" }));
    router.push("/");
  };

  const selectRole = (nextRole: "member" | "staff") => {
    setRole(nextRole);
    setLoginError("");
  };

  return (
    <main className="login-page">
      <section className="login-art">
        <div className="login-brand"><img src="/logo.png" alt="Al-Haytham Library" className="brand-logo" width="48" height="48" /><span>Al-Haytham <span className="brand-accent">Library</span></span></div>
        <div className="art-copy"><span className="eyebrow">PERPUSTAKAAN SEKOLAH</span><h1>Temukan cerita,<br /><em>tumbuhkan</em> imajinasi.</h1><p>Ruang sederhana untuk mengelola koleksi dan membangun kebiasaan membaca bersama.</p></div>
        <div className="art-books"><div className="floating-book book-one">Membaca<br />adalah<br />petualangan</div><div className="floating-book book-two">The<br />world<br />inside</div><div className="art-leaf">✦</div></div>
        <span className="art-footer">© 2024 Al-Haytham Library</span>
      </section>
      <section className="login-form-area">
        <div className="login-form-wrap">
          <div className="mobile-login-brand"><img src="/logo.png" alt="Al-Haytham Library" className="brand-logo" width="40" height="40" /><span>Al-Haytham <span className="brand-accent">Library</span></span></div>
          <div className="login-heading"><span className="eyebrow">SELAMAT DATANG KEMBALI</span><h2>Masuk ke Al-Haytham Library</h2><p>Gunakan akun Anda untuk melanjutkan.</p></div>
          <div className="role-switch"><button type="button" className={role === "member" ? "selected" : ""} onClick={() => selectRole("member")}>Anggota</button><button type="button" className={role === "staff" ? "selected" : ""} onClick={() => selectRole("staff")}>Petugas</button></div>
          <div className="demo-credentials"><span className="eyebrow">{role === "member" ? "AKUN DEMO ANGGOTA" : "AKUN DEMO PETUGAS"}</span><p>{role === "member" ? <><span>Kode <strong>{demoMemberAccount.code}</strong></span><span>PIN <strong>{demoMemberAccount.pin}</strong></span><span>{demoMemberAccount.name}</span></> : <><span>Username <strong>{demoAccount.username}</strong></span><span>Password <strong>{demoAccount.password}</strong></span></>}</p></div>
          <form onSubmit={handleSubmit}>
            <label>{role === "member" ? "Kode anggota" : "Username petugas"}<div className="login-input"><span>{role === "member" ? "#" : "@"}</span><input value={username} onChange={(event) => setUsername(event.target.value)} placeholder={role === "member" ? "Contoh: AG-2024-001" : "Masukkan username"} /></div></label>
            <label>{role === "member" ? "PIN" : "Password"}<div className="login-input"><span>⌁</span><input value={password} onChange={(event) => setPassword(event.target.value)} type={showPassword ? "text" : "password"} inputMode={role === "member" ? "numeric" : undefined} placeholder={role === "member" ? "Masukkan 6 digit PIN" : "Masukkan password"} maxLength={role === "member" ? 6 : undefined} /><button type="button" onClick={() => setShowPassword(!showPassword)}>{showPassword ? "Sembunyikan" : "Lihat"}</button></div></label>
            <div className="login-helper"><label className="check-label"><input type="checkbox" /> <span>Ingat saya</span></label><button type="button">Lupa password?</button></div>
            {loginError && <p className="login-error" role="alert">{loginError}</p>}
            <button type="submit" className="login-button">Masuk <span>→</span></button>
          </form>
          <p className="login-help">Belum memiliki akun? <button type="button">Hubungi petugas perpustakaan</button></p>
        </div>
      </section>
    </main>
  );
}
