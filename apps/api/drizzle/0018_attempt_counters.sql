CREATE TABLE "attempt_counters" (
	"key" text PRIMARY KEY NOT NULL,
	"count" integer NOT NULL,
	"reset_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "attempt_counters_reset_at_idx" ON "attempt_counters" USING btree ("reset_at");