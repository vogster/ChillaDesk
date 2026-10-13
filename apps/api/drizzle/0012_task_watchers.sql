ALTER TYPE "public"."notification_type" ADD VALUE 'task_moved';--> statement-breakpoint
CREATE TABLE "task_watchers" (
	"task_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_watchers_task_id_user_id_pk" PRIMARY KEY("task_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "task_watchers" ADD CONSTRAINT "task_watchers_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_watchers" ADD CONSTRAINT "task_watchers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "task_watchers_user_id_idx" ON "task_watchers" USING btree ("user_id");--> statement-breakpoint
-- Whoever created a task or is assigned to it has been told about its comments so far;
-- as watchers they keep being told.
INSERT INTO "task_watchers" ("task_id", "user_id") SELECT "id", "reporter_id" FROM "tasks" WHERE "reporter_id" IS NOT NULL ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "task_watchers" ("task_id", "user_id") SELECT "id", "assignee_id" FROM "tasks" WHERE "assignee_id" IS NOT NULL ON CONFLICT DO NOTHING;