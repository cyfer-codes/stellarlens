ALTER TABLE "users" ADD COLUMN "session_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "indexer_checkpoints" ADD COLUMN "latest_ledger" integer;--> statement-breakpoint
ALTER TABLE "indexer_checkpoints" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;