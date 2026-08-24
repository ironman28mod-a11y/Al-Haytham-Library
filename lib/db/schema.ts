import { pgTable, text, integer, serial } from "drizzle-orm/pg-core";

export const books = pgTable("books", {
  code: text("code").primaryKey(),
  title: text("title").notNull(),
  author: text("author").notNull(),
  category: text("category").notNull(),
  stock: integer("stock").notNull().default(1),
  available: integer("available").notNull().default(1),
  color: text("color").notNull().default("#e5f2ee"),
  initials: text("initials").notNull().default(""),
  coverId: text("cover_id"),
  coverName: text("cover_name"),
});

export const ebooks = pgTable("ebooks", {
  code: text("code").primaryKey(),
  title: text("title").notNull(),
  author: text("author").notNull(),
  category: text("category").notNull(),
  stock: integer("stock").notNull().default(0),
  available: integer("available").notNull().default(0),
  color: text("color").notNull().default("#dcefe6"),
  initials: text("initials").notNull().default(""),
  coverId: text("cover_id"),
  coverName: text("cover_name"),
  format: text("format").notNull().default("PDF"),
  size: text("size").notNull().default("0 KB"),
  access: text("access").notNull().default("Baca online"),
  fileName: text("file_name"),
  fileId: text("file_id"),
});

export const members = pgTable("members", {
  code: text("code").primaryKey(),
  name: text("name").notNull(),
  className: text("class_name").notNull(),
  joined: text("joined").notNull(),
  status: text("status").notNull().default("Aktif"),
  initials: text("initials").notNull().default(""),
  color: text("color").notNull().default("#cfe4da"),
  role: text("role").notNull().default("Siswa"),
  username: text("username").notNull(),
  password: text("password").notNull(),
  avatarData: text("avatar_data"),
  avatarName: text("avatar_name"),
  email: text("email").notNull().default(""),
  phone: text("phone").notNull().default(""),
  bio: text("bio").notNull().default(""),
});

export const loans = pgTable("loans", {
  id: text("id").primaryKey(),
  member: text("member").notNull(),
  memberCode: text("member_code").notNull(),
  book: text("book").notNull(),
  bookCode: text("book_code").notNull(),
  borrowed: text("borrowed").notNull(),
  borrowedDate: text("borrowed_date"),
  due: text("due").notNull(),
  dueDate: text("due_date"),
  returnedDate: text("returned_date"),
  status: text("status").notNull().default("Dipinjam"),
  avatar: text("avatar").notNull().default(""),
  color: text("color").notNull().default("#cfe4da"),
  avatarData: text("avatar_data"),
});

export const categories = pgTable("categories", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
});

export const classes = pgTable("classes", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
});

export const profile = pgTable("profile", {
  id: integer("id").primaryKey().default(1),
  name: text("name").notNull().default("Rina Nuraini"),
  email: text("email").notNull().default("rina.nuraini@alhaytham.sch.id"),
  phone: text("phone").notNull().default(""),
  bio: text("bio").notNull().default(""),
  role: text("role").notNull().default("staff"),
  detail: text("detail").notNull().default("Administrator"),
  avatarData: text("avatar_data"),
  avatarName: text("avatar_name"),
});

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const reservations = pgTable("reservations", {
  id: text("id").primaryKey(),
  member: text("member").notNull(),
  memberCode: text("member_code").notNull(),
  book: text("book").notNull(),
  bookCode: text("book_code").notNull(),
  reservedAt: text("reserved_at").notNull(),
  status: text("status").notNull().default("Menunggu"),
  notifiedAt: text("notified_at"),
  avatar: text("avatar").notNull().default(""),
  color: text("color").notNull().default("#cfe4da"),
  avatarData: text("avatar_data"),
});
