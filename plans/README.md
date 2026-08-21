# Animation Improvement Plans

Audit dilakukan dengan skill `improve-animations` (read-only). Semua rencana di bawah siap dieksekusi secara mandiri — masing-masing berisi path file, kode saat ini, nilai target, dan verifikasi.

> Catatan: folder project ini bukan repo git, sehingga kolom Commit tidak terisi.

## Status

| # | Rencana | Severity | Status |
| --- | --- | --- | --- |
| 001 | Ganti animasi drawer sidebar mobile dari `left` ke `transform` | HIGH | TODO |
| 002 | Gate hover transform tombol primary dengan media query pointer | MEDIUM | TODO |
| 003 | Konsistensi easing token pada modal backdrop + hapus keyframes `rise` mati | LOW | TODO |
| 004 | Transisi mikro pada tab, guide progress, item notifikasi, pagination | LOW | TODO |

## Urutan eksekusi yang disarankan

1. **003 → 004** (paling aman, murni CSS kecil, tidak ada risiko) — kerjakan dulu untuk membangun keyakinan.
2. **002** (gate hover) — satu aturan CSS, perbaikan aksesibilitas nyata di perangkat sentuh.
3. **001** (drawer transform) — paling berdampak secara performa (HIGH); simpan terakhir karena menyentuh tata letak mobile yang perlu uji visual viewport sempit.

## Dependensi

Tidak ada dependensi antar rencana — semuanya independen, bisa dieksekusi dalam urutan apa pun. Namun semuanya menyentuh `app/globals.css`, jadi hindari eksekusi paralel pada file yang sama; jalankan berurutan.

## Cara eksekusi

Untuk setiap rencana: baca file rencana, terapkan Steps-nya persis (termasuk nilai easing dari AUDIT skill — sudah di-inline di setiap rencana), lalu jalankan:

```bash
npm run typecheck
npm run build
```

Diikuti verifikasi feel-check sesuai bagian Verification tiap rencana.

## Temuan yang sengaja TIDAK direncanakan (dokumentasi)

- `page-in` memakai keyframes (bukan transition) — diterima: navigasi jarang diulang cepat, dan `prefers-reduced-motion` global sudah menetralkannya.
- `transform-origin: center` pada modal — benar, modal tidak terikat trigger.
- `prefers-reduced-motion` global yang mematikan semua — keputusan disengaja agar aman; perbaikan lebih bernuansa bisa jadi rencana masa depan.
- Peluang terlewat (chart bar `scaleY`, stagger baris tabel) — ditawarkan ke user, dipilih untuk tidak dikerjakan sekarang.
