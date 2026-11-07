CREATE TABLE "deals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"event_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"price_amount" integer NOT NULL,
	"price_currency" text NOT NULL,
	"quantity" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "deals_price_amount_non_negative" CHECK ("deals"."price_amount" >= 0),
	CONSTRAINT "deals_quantity_positive" CHECK ("deals"."quantity" > 0)
);
--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "deals_event_name_uq" ON "deals" USING btree ("event_id",lower("name"));--> statement-breakpoint
CREATE INDEX "deals_event_idx" ON "deals" USING btree ("event_id","created_at");