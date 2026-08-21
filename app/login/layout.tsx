import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Masuk — Al-Haytham Library",
};

export default function LoginLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
