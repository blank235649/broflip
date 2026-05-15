CREATE TYPE "public"."round_outcome" AS ENUM('HH', 'TT', 'MIXED');--> statement-breakpoint
ALTER TYPE "public"."account_type" ADD VALUE 'affiliate';--> statement-breakpoint
ALTER TYPE "public"."transaction_kind" ADD VALUE 'refund';--> statement-breakpoint
ALTER TYPE "public"."transaction_kind" ADD VALUE 'affiliate_share';--> statement-breakpoint
CREATE TABLE "rounds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seed_period_id" uuid NOT NULL,
	"nonce" integer NOT NULL,
	"coin_a" text NOT NULL,
	"coin_b" text NOT NULL,
	"outcome" "round_outcome" NOT NULL,
	"flipped_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seed_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"period_date" date NOT NULL,
	"server_seed" text NOT NULL,
	"server_seed_hash" text NOT NULL,
	"client_seed" text NOT NULL,
	"next_nonce" integer DEFAULT 0 NOT NULL,
	"revealed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "seed_periods_period_date_unique" UNIQUE("period_date")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "display_name" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "is_admin" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "referral_code" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "referred_by_id" uuid;--> statement-breakpoint
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_seed_period_id_seed_periods_id_fk" FOREIGN KEY ("seed_period_id") REFERENCES "public"."seed_periods"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "rounds_period_nonce_uq" ON "rounds" USING btree ("seed_period_id","nonce");--> statement-breakpoint
CREATE INDEX "seed_periods_revealed_idx" ON "seed_periods" USING btree ("revealed_at");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_referred_by_id_users_id_fk" FOREIGN KEY ("referred_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_referral_code_unique" UNIQUE("referral_code");