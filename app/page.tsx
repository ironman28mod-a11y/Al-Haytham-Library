"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import LibraryApp from "../components/LibraryApp";
import MemberPortal from "../components/MemberPortal";
import { logout } from "../lib/api";

const AUTH_KEY = "al-haytham-library:auth";

function LoadingScreen() {
  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      height: "100vh",
      background: "#f6f9f7",
      gap: "20px",
    }}>
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: "10px",
        fontSize: "22px",
        fontWeight: 700,
        color: "#2a4d3f",
        fontFamily: "'Playfair Display', Georgia, serif",
      }}>
        <span style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 36,
          height: 36,
          borderRadius: 10,
          background: "#4f9078",
          color: "#fff",
          fontSize: 18,
        }}>
          📚
        </span>
        Al-Haytham <span style={{ color: "#4f9078" }}>Library</span>
      </div>
      <div style={{
        width: 36,
        height: 36,
        border: "3px solid #dce8e2",
        borderTopColor: "#4f9078",
        borderRadius: "50%",
        animation: "auth-spin 0.8s linear infinite",
      }} />
      <p style={{
        color: "#8a9b93",
        fontSize: 12,
        margin: 0,
        fontWeight: 500,
      }}>Memuat...</p>
      <style>{`
        @keyframes auth-spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

export default function Home() {
  const router = useRouter();
  const [session, setSession] = useState<{ role: "staff" | "member"; memberCode?: string } | null>(null);

  useEffect(() => {
    const rawAuth = localStorage.getItem(AUTH_KEY);
    if (!rawAuth) {
      router.replace("/login");
      return;
    }
    try {
      const parsed = JSON.parse(rawAuth) as { role?: string; memberCode?: string };
      if (parsed.role === "member" && parsed.memberCode) {
        setSession({ role: "member", memberCode: parsed.memberCode });
      } else if (parsed.role === "staff") {
        setSession({ role: "staff", memberCode: parsed.memberCode || undefined });
      } else if (rawAuth === "true") {
        setSession({ role: "staff" });
      } else {
        localStorage.removeItem(AUTH_KEY);
        router.replace("/login");
      }
    } catch {
      localStorage.removeItem(AUTH_KEY);
      router.replace("/login");
    }
  }, [router]);

  if (session === null) {
    return <LoadingScreen />;
  }

  if (session.role === "member" && session.memberCode) {
    return <MemberPortal memberCode={session.memberCode} onLogout={() => { void logout(); localStorage.removeItem(AUTH_KEY); router.replace("/login"); }} />;
  }

  return <LibraryApp adminMemberCode={session.memberCode} />;
}
