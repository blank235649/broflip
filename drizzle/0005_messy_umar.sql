ALTER TABLE "users" ALTER COLUMN "password_hash" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "solana_address" text;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_solana_address_unique" UNIQUE("solana_address");