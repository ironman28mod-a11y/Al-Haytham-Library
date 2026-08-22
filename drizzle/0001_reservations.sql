CREATE TABLE "reservations" (
	"id" text PRIMARY KEY NOT NULL,
	"member" text NOT NULL,
	"member_code" text NOT NULL,
	"book" text NOT NULL,
	"book_code" text NOT NULL,
	"reserved_at" text NOT NULL,
	"status" text DEFAULT 'Menunggu' NOT NULL,
	"notified_at" text,
	"avatar" text DEFAULT '' NOT NULL,
	"color" text DEFAULT '#cfe4da' NOT NULL,
	"avatar_data" text
);
