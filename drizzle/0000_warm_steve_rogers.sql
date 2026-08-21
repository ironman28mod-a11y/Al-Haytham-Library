CREATE TABLE "books" (
	"code" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"author" text NOT NULL,
	"category" text NOT NULL,
	"stock" integer DEFAULT 1 NOT NULL,
	"available" integer DEFAULT 1 NOT NULL,
	"color" text DEFAULT '#e5f2ee' NOT NULL,
	"initials" text DEFAULT '' NOT NULL,
	"cover_id" text,
	"cover_name" text
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "categories_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "classes" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "classes_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "ebooks" (
	"code" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"author" text NOT NULL,
	"category" text NOT NULL,
	"stock" integer DEFAULT 0 NOT NULL,
	"available" integer DEFAULT 0 NOT NULL,
	"color" text DEFAULT '#dcefe6' NOT NULL,
	"initials" text DEFAULT '' NOT NULL,
	"cover_id" text,
	"cover_name" text,
	"format" text DEFAULT 'PDF' NOT NULL,
	"size" text DEFAULT '0 KB' NOT NULL,
	"access" text DEFAULT 'Baca online' NOT NULL,
	"file_name" text,
	"file_id" text
);
--> statement-breakpoint
CREATE TABLE "loans" (
	"id" text PRIMARY KEY NOT NULL,
	"member" text NOT NULL,
	"member_code" text NOT NULL,
	"book" text NOT NULL,
	"book_code" text NOT NULL,
	"borrowed" text NOT NULL,
	"borrowed_date" text,
	"due" text NOT NULL,
	"due_date" text,
	"returned_date" text,
	"status" text DEFAULT 'Dipinjam' NOT NULL,
	"avatar" text DEFAULT '' NOT NULL,
	"color" text DEFAULT '#cfe4da' NOT NULL,
	"avatar_data" text
);
--> statement-breakpoint
CREATE TABLE "members" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"class_name" text NOT NULL,
	"joined" text NOT NULL,
	"status" text DEFAULT 'Aktif' NOT NULL,
	"initials" text DEFAULT '' NOT NULL,
	"color" text DEFAULT '#cfe4da' NOT NULL,
	"role" text DEFAULT 'Siswa' NOT NULL,
	"username" text NOT NULL,
	"password" text NOT NULL,
	"avatar_data" text,
	"avatar_name" text
);
--> statement-breakpoint
CREATE TABLE "profile" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"name" text DEFAULT 'Rina Nuraini' NOT NULL,
	"email" text DEFAULT 'rina.nuraini@alhaytham.sch.id' NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"bio" text DEFAULT '' NOT NULL,
	"role" text DEFAULT 'staff' NOT NULL,
	"detail" text DEFAULT 'Administrator' NOT NULL,
	"avatar_data" text,
	"avatar_name" text
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL
);
