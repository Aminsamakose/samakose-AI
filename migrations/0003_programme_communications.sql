SET search_path TO public;
CREATE TABLE "notification_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"notification_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"status" text DEFAULT 'QUEUED' NOT NULL,
	"provider" text,
	"provider_message_id" text,
	"attempts" text DEFAULT '0' NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"error" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_delivery_channel_ck" CHECK ("notification_deliveries"."channel" in ('IN_APP','EMAIL','SMS','WHATSAPP')),
	CONSTRAINT "notification_delivery_status_ck" CHECK ("notification_deliveries"."status" in ('QUEUED','SENDING','SENT','DELIVERED','FAILED','RETRYING'))
);
--> statement-breakpoint
CREATE TABLE "notification_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"programme_id" uuid,
	"cohort_id" uuid,
	"event_type" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"programme_id" uuid,
	"channel" text NOT NULL,
	"enabled" text DEFAULT 'true' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_pref_channel_ck" CHECK ("notification_preferences"."channel" in ('IN_APP','EMAIL','SMS','WHATSAPP'))
);
--> statement-breakpoint
CREATE TABLE "notification_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"programme_id" uuid,
	"key" text NOT NULL,
	"channel" text DEFAULT 'IN_APP' NOT NULL,
	"subject" text,
	"body" text NOT NULL,
	"active" text DEFAULT 'true' NOT NULL,
	"version" text DEFAULT '1' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_template_channel_ck" CHECK ("notification_templates"."channel" in ('IN_APP','EMAIL','SMS','WHATSAPP'))
);
--> statement-breakpoint
CREATE TABLE "programme_notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid,
	"programme_id" uuid,
	"cohort_id" uuid,
	"recipient_user_id" uuid NOT NULL,
	"channel" text DEFAULT 'IN_APP' NOT NULL,
	"template_key" text,
	"subject" text,
	"body" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"read_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "programme_notification_channel_ck" CHECK ("programme_notifications"."channel" in ('IN_APP','EMAIL','SMS','WHATSAPP')),
	CONSTRAINT "programme_notification_status_ck" CHECK ("programme_notifications"."status" in ('PENDING','SENT','DELIVERED','FAILED','READ','CANCELLED'))
);
--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_notification_id_programme_notifications_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."programme_notifications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_events" ADD CONSTRAINT "notification_events_programme_id_programmes_id_fk" FOREIGN KEY ("programme_id") REFERENCES "public"."programmes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_events" ADD CONSTRAINT "notification_events_cohort_id_cohorts_id_fk" FOREIGN KEY ("cohort_id") REFERENCES "public"."cohorts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_events" ADD CONSTRAINT "notification_events_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_programme_id_programmes_id_fk" FOREIGN KEY ("programme_id") REFERENCES "public"."programmes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_templates" ADD CONSTRAINT "notification_templates_programme_id_programmes_id_fk" FOREIGN KEY ("programme_id") REFERENCES "public"."programmes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_templates" ADD CONSTRAINT "notification_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "programme_notifications" ADD CONSTRAINT "programme_notifications_event_id_notification_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."notification_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "programme_notifications" ADD CONSTRAINT "programme_notifications_programme_id_programmes_id_fk" FOREIGN KEY ("programme_id") REFERENCES "public"."programmes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "programme_notifications" ADD CONSTRAINT "programme_notifications_cohort_id_cohorts_id_fk" FOREIGN KEY ("cohort_id") REFERENCES "public"."cohorts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "programme_notifications" ADD CONSTRAINT "programme_notifications_recipient_user_id_users_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notification_delivery_idx" ON "notification_deliveries" USING btree ("notification_id","status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "notification_event_scope_idx" ON "notification_events" USING btree ("programme_id","cohort_id","event_type","created_at");--> statement-breakpoint
CREATE INDEX "notification_pref_user_idx" ON "notification_preferences" USING btree ("user_id","programme_id","channel");--> statement-breakpoint
CREATE INDEX "notification_template_programme_idx" ON "notification_templates" USING btree ("programme_id","key","channel");--> statement-breakpoint
CREATE INDEX "programme_notification_recipient_idx" ON "programme_notifications" USING btree ("recipient_user_id","status","created_at");--> statement-breakpoint
CREATE INDEX "programme_notification_scope_idx" ON "programme_notifications" USING btree ("programme_id","cohort_id","status");--> statement-breakpoint
ALTER TABLE "notification_deliveries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notification_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notification_preferences" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notification_templates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "programme_notifications" ENABLE ROW LEVEL SECURITY;