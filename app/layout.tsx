import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Al-Haytham Library — Perpustakaan Sekolah",
  description: "Dashboard pengelolaan perpustakaan sekolah yang sederhana dan modern.",
  icons: {
    icon: "/logo.png",
    apple: "/logo.png",
  },
  openGraph: {
    title: "Al-Haytham Library — Perpustakaan Sekolah",
    description: "Dashboard pengelolaan perpustakaan sekolah yang sederhana dan modern.",
    images: ["/logo.png"],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  );
}
