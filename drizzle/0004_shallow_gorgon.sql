CREATE TYPE "public"."withdrawal_status" AS ENUM('pending', 'sent', 'failed');--> statement-breakpoint
CREATE TABLE "solana_deposits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"signature" text NOT NULL,
	"slot" integer NOT NULL,
	"amount_sol" numeric(38, 9) NOT NULL,
	"amount_usd" numeric(38, 8) NOT NULL,
	"credited_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "solana_deposits_signature_unique" UNIQUE("signature")
);
--> statement-breakpoint
CREATE TABLE "solana_withdrawals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"to_address" text NOT NULL,
	"amount_sol" numeric(38, 9) NOT NULL,
	"amount_usd" numeric(38, 8) NOT NULL,
	"signature" text,
	"status" "withdrawal_status" DEFAULT 'pending' NOT NULL,
	"failure_reason" text,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "solana_account_index" serial NOT NULL;--> statement-breakpoint
ALTER TABLE "solana_deposits" ADD CONSTRAINT "solana_deposits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "solana_withdrawals" ADD CONSTRAINT "solana_withdrawals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "solana_deposits_user_idx" ON "solana_deposits" USING btree ("user_id","credited_at");--> statement-breakpoint
CREATE INDEX "solana_withdrawals_user_idx" ON "solana_withdrawals" USING btree ("user_id","requested_at");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_solana_account_index_unique" UNIQUE("solana_account_index");