"use client";

import { useEffect, useMemo, useState } from "react";
import * as api from "../lib/api";

type PortalMember = api.Member;

type PortalState = {
  member: PortalMember | null;
  books: api.Book[];
  ebooks: api.EBook[];
  loans: api.Loan[];
  reservations: api.Reservation[];
};

function formatDate(value?: string) {
  if (!value) return "-";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Intl.DateTimeFormat("id-ID", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(`${value}T00:00:00`)).replace(/\./g, "");
  }
  return value;
}

function fileLink(id: string) {
  return `/api/files/${encodeURIComponent(id)}`;
}

export default function MemberPortal({ memberCode, onLogout }: { memberCode: string; onLogout: () => void }) {
  const [state, setState] = useState<PortalState>({ member: null, books: [], ebooks: [], loans: [], reservations: [] });
  const [activeTab, setActiveTab] = useState<"home" | "ebooks" | "books" | "activity">("home");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    Promise.all([
      api.fetchMembers(),
      api.fetchBooks(),
      api.fetchEbooks(),
      api.fetchLoans(),
      api.fetchReservations(),
    ]).then(([members, books, ebooks, loans, reservations]) => {
      if (!active) return;
      const member = members.find((item) => item.code === memberCode) ?? null;
      setState({
        member,
        books,
        ebooks,
        loans: loans.filter((item) => item.memberCode === memberCode),
        reservations: reservations.filter((item) => item.memberCode === memberCode),
      });
      if (!member) setError("Data akun anggota belum ditemukan. Hubungi petugas perpustakaan.");
    }).catch(() => {
      if (active) setError("Data portal belum dapat dimuat. Silakan coba lagi.");
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [memberCode]);

  const normalizedSearch = search.trim().toLowerCase();
  const filteredBooks = useMemo(() => state.books.filter((book) => `${book.title} ${book.author} ${book.category}`.toLowerCase().includes(normalizedSearch)), [state.books, normalizedSearch]);
  const filteredEbooks = useMemo(() => state.ebooks.filter((ebook) => `${ebook.title} ${ebook.author} ${ebook.category}`.toLowerCase().includes(normalizedSearch)), [state.ebooks, normalizedSearch]);
  const activeLoans = state.loans.filter((loan) => loan.status !== "Dikembalikan");
  const readyReservations = state.reservations.filter((item) => item.status === "Tersedia");
  const displayMember = state.member ?? { name: "Anggota Demo", code: memberCode, className: "Portal Anggota", initials: "AD", color: "#cfe4da" };

  const openTab = (tab: typeof activeTab) => {
    setActiveTab(tab);
    setSearch("");
  };

  return <div className="member-portal">
    <header className="member-portal-header">
      <div className="member-portal-brand"><img src="/logo.png" alt="Al-Haytham Library" width="38" height="38" /><span>Al-Haytham <b>Library</b></span></div>
      <div className="member-portal-account"><span className="avatar" style={{ backgroundColor: displayMember.color }}>{displayMember.initials}</span><span><strong>{displayMember.name}</strong><small>{displayMember.className} · {displayMember.code}</small></span><button type="button" className="button button-outline" onClick={onLogout}>Keluar</button></div>
    </header>
    <nav className="member-portal-nav" aria-label="Menu portal anggota">
      <button className={activeTab === "home" ? "active" : ""} onClick={() => openTab("home")}>Beranda</button>
      <button className={activeTab === "ebooks" ? "active" : ""} onClick={() => openTab("ebooks")}>E-Book</button>
      <button className={activeTab === "books" ? "active" : ""} onClick={() => openTab("books")}>Buku</button>
      <button className={activeTab === "activity" ? "active" : ""} onClick={() => openTab("activity")}>Aktivitas</button>
    </nav>
    <main className="member-portal-main">
      {loading && <div className="member-portal-loading">Memuat portal anggota...</div>}
      {error && <div className="form-error"><span>!</span>{error}</div>}
      {!loading && <>
        {activeTab === "home" && <>
          <section className="member-portal-welcome"><div><span className="eyebrow">PORTAL ANGGOTA</span><h1>Selamat datang, {displayMember.name.split(" ")[0]}.</h1><p>Temukan bacaan baru dan pantau aktivitas peminjaman Anda.</p></div><span className="member-portal-code">{displayMember.code}<small>KODE ANGGOTA</small></span></section>
          <div className="member-portal-stats"><div><strong>{activeLoans.length}</strong><span>Peminjaman aktif</span></div><div><strong>{state.ebooks.length}</strong><span>E-Book tersedia</span></div><div><strong>{readyReservations.length}</strong><span>Reservasi siap</span></div></div>
          <section className="member-portal-section"><div className="member-portal-section-heading"><div><h2>E-Book terbaru</h2><p>Baca langsung dari perangkat Anda.</p></div><button type="button" className="text-button" onClick={() => openTab("ebooks")}>Lihat semua</button></div><div className="member-portal-grid">{state.ebooks.slice(0, 3).map((ebook) => <article className="member-portal-item" key={ebook.code}><div className="member-portal-item-cover" style={{ backgroundColor: ebook.color }}>{ebook.fileId && ebook.format === "PDF" ? <img src={`/api/covers/${encodeURIComponent(ebook.fileId)}`} alt={`Cover ${ebook.title}`} loading="lazy" /> : ebook.initials}</div><strong>{ebook.title}</strong><small>{ebook.author}</small>{ebook.fileId && <a href={fileLink(ebook.fileId)} target="_blank" rel="noreferrer">Baca E-Book</a>}</article>)}</div></section>
        </>}
        {activeTab === "ebooks" && <section className="member-portal-section"><div className="member-portal-section-heading"><div><h1>Katalog E-Book</h1><p>Baca koleksi digital kapan saja.</p></div><label className="member-portal-search"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Cari E-Book" /></label></div><div className="member-portal-grid">{filteredEbooks.map((ebook) => <article className="member-portal-item" key={ebook.code}><div className="member-portal-item-cover" style={{ backgroundColor: ebook.color }}>{ebook.fileId && ebook.format === "PDF" ? <img src={`/api/covers/${encodeURIComponent(ebook.fileId)}`} alt={`Cover ${ebook.title}`} loading="lazy" /> : ebook.initials}</div><strong>{ebook.title}</strong><small>{ebook.author} · {ebook.format}</small>{ebook.fileId && <a href={fileLink(ebook.fileId)} target="_blank" rel="noreferrer">Baca E-Book</a>}</article>)}</div>{filteredEbooks.length === 0 && <div className="empty-state"><h3>E-Book tidak ditemukan</h3></div>}</section>}
        {activeTab === "books" && <section className="member-portal-section"><div className="member-portal-section-heading"><div><h1>Katalog Buku</h1><p>Telusuri koleksi buku perpustakaan.</p></div><label className="member-portal-search"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Cari buku" /></label></div><div className="member-portal-grid">{filteredBooks.map((book) => <article className="member-portal-item" key={book.code}><div className="member-portal-item-cover" style={{ backgroundColor: book.color }}>{book.coverId ? <img src={`/api/covers/${encodeURIComponent(book.coverId)}`} alt={`Cover ${book.title}`} loading="lazy" /> : book.initials}</div><strong>{book.title}</strong><small>{book.author} · {book.available > 0 ? `${book.available} tersedia` : "Sedang dipinjam"}</small><span className="member-portal-status">{book.category}</span></article>)}</div></section>}
        {activeTab === "activity" && <section className="member-portal-section"><div className="member-portal-section-heading"><div><h1>Aktivitas saya</h1><p>Riwayat peminjaman dan reservasi akun Anda.</p></div></div><div className="member-activity-list">{state.loans.map((loan) => <div className="member-activity-row" key={loan.id}><span className="mini-icon green">▣</span><span><strong>{loan.book}</strong><small>Dipinjam {formatDate(loan.borrowedDate ?? loan.borrowed)} · Jatuh tempo {formatDate(loan.dueDate ?? loan.due)}</small></span><em className={loan.status === "Terlambat" ? "late-text" : ""}>{loan.status}</em></div>)}{state.reservations.map((reservation) => <div className="member-activity-row" key={reservation.id}><span className="mini-icon orange">◷</span><span><strong>Reservasi: {reservation.book}</strong><small>Dibuat {formatDate(reservation.reservedAt)}</small></span><em>{reservation.status}</em></div>)}{state.loans.length === 0 && state.reservations.length === 0 && <div className="empty-state"><h3>Belum ada aktivitas</h3></div>}</div></section>}
      </>}
    </main>
  </div>;
}
