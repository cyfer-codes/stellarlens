import { bigint, boolean, index, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { contracts } from "./contracts.js";
import { events } from "./events.js";

export const webhooks = pgTable(
  "webhooks",
  {
    id: serial("id").primaryKey(),
    contractId: integer("contract_id")
      .notNull()
      .references(() => contracts.id),
    url: text("url").notNull(),
    // Encrypted at rest with AES-256-GCM (see packages/db/src/crypto/webhook-secret.ts).
    // Stored as a versioned payload: "v1:<iv>:<tag>:<ciphertext>" (base64 segments).
    secret: text("secret").notNull(),
    eventTypes: text("event_types").array(),
    active: boolean("active").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [index("webhooks_contract_id_idx").on(table.contractId)]
);

export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: serial("id").primaryKey(),
    webhookId: integer("webhook_id")
      .notNull()
      .references(() => webhooks.id, { onDelete: "cascade" }),
    eventId: bigint("event_id", { mode: "number" })
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    // Value sent as the X-Webhook-Id header; identical for every retry of a webhook/event pair.
    idempotencyKey: text("idempotency_key"),
    status: text("status").notNull(),
    attempts: integer("attempts").default(0).notNull(),
    lastError: text("last_error"),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [
    index("webhook_deliveries_webhook_id_idx").on(table.webhookId),
    index("webhook_deliveries_event_id_idx").on(table.eventId)
  ]
);