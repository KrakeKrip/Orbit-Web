CREATE TYPE "public"."task_recurrence_rule" AS ENUM('DAILY', 'WEEKDAYS', 'WEEKLY');--> statement-breakpoint
CREATE TYPE "public"."user_theme" AS ENUM('light', 'dark', 'system');--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_id_owner_id_key" UNIQUE("id","owner_id"),
	CONSTRAINT "projects_name_not_blank" CHECK (char_length(btrim("projects"."name")) > 0),
	CONSTRAINT "projects_name_max_length" CHECK (char_length("projects"."name") <= 120)
);
--> statement-breakpoint
CREATE TABLE "task_completions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"task_id" uuid NOT NULL,
	"occurrence_date" date,
	"completed_at" timestamp with time zone NOT NULL,
	"completed_revision" integer NOT NULL,
	"idempotency_key" text NOT NULL,
	CONSTRAINT "task_completions_owner_idempotency_key" UNIQUE("owner_id","idempotency_key"),
	CONSTRAINT "task_completions_task_completed_revision_key" UNIQUE("task_id","completed_revision"),
	CONSTRAINT "task_completions_completed_revision_non_negative" CHECK ("task_completions"."completed_revision" >= 0),
	CONSTRAINT "task_completions_idempotency_key_not_blank" CHECK (char_length(btrim("task_completions"."idempotency_key")) > 0),
	CONSTRAINT "task_completions_idempotency_key_max_length" CHECK (char_length("task_completions"."idempotency_key") <= 128)
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"project_id" uuid,
	"parent_id" uuid,
	"title" text NOT NULL,
	"notes" text,
	"priority" integer DEFAULT 4 NOT NULL,
	"planned_date" date,
	"planned_time" time,
	"deadline_date" date,
	"recurrence_rule" "task_recurrence_rule",
	"sort_order" integer DEFAULT 0 NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"completed_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tasks_id_owner_id_key" UNIQUE("id","owner_id"),
	CONSTRAINT "tasks_parent_not_self" CHECK ("tasks"."parent_id" IS NULL OR "tasks"."parent_id" <> "tasks"."id"),
	CONSTRAINT "tasks_title_not_blank" CHECK (char_length(btrim("tasks"."title")) > 0),
	CONSTRAINT "tasks_title_max_length" CHECK (char_length("tasks"."title") <= 500),
	CONSTRAINT "tasks_notes_max_length" CHECK ("tasks"."notes" IS NULL OR char_length("tasks"."notes") <= 10000),
	CONSTRAINT "tasks_priority_range" CHECK ("tasks"."priority" BETWEEN 1 AND 4),
	CONSTRAINT "tasks_revision_non_negative" CHECK ("tasks"."revision" >= 0),
	CONSTRAINT "tasks_planned_time_requires_planned_date" CHECK ("tasks"."planned_time" IS NULL OR "tasks"."planned_date" IS NOT NULL),
	CONSTRAINT "tasks_recurrence_requires_planned_date" CHECK ("tasks"."recurrence_rule" IS NULL OR "tasks"."planned_date" IS NOT NULL),
	CONSTRAINT "tasks_recurrence_excludes_deadline" CHECK ("tasks"."recurrence_rule" IS NULL OR "tasks"."deadline_date" IS NULL),
	CONSTRAINT "tasks_recurring_no_permanent_completed_at" CHECK ("tasks"."recurrence_rule" IS NULL OR "tasks"."completed_at" IS NULL)
);
--> statement-breakpoint
CREATE TABLE "user_settings" (
	"user_id" text PRIMARY KEY NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"theme" "user_theme" DEFAULT 'system' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_settings_timezone_not_blank" CHECK (char_length(btrim("user_settings"."timezone")) > 0)
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "task_completions" ADD CONSTRAINT "task_completions_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "task_completions" ADD CONSTRAINT "task_completions_task_owner_fkey" FOREIGN KEY ("task_id","owner_id") REFERENCES "public"."tasks"("id","owner_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_project_owner_fkey" FOREIGN KEY ("project_id","owner_id") REFERENCES "public"."projects"("id","owner_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_parent_owner_fkey" FOREIGN KEY ("parent_id","owner_id") REFERENCES "public"."tasks"("id","owner_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "projects_owner_id_idx" ON "projects" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "task_completions_owner_completed_at_idx" ON "task_completions" USING btree ("owner_id","completed_at");--> statement-breakpoint
CREATE INDEX "tasks_owner_planned_date_idx" ON "tasks" USING btree ("owner_id","planned_date") WHERE "tasks"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "tasks_owner_deadline_date_idx" ON "tasks" USING btree ("owner_id","deadline_date") WHERE "tasks"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "tasks_owner_project_idx" ON "tasks" USING btree ("owner_id","project_id");--> statement-breakpoint
CREATE INDEX "tasks_owner_parent_idx" ON "tasks" USING btree ("owner_id","parent_id");