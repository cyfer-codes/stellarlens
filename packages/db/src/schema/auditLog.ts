import { index, integer, jsonb, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { apiKeys } from "./apiKeys.js";

export const auditLog = pgTable(
  "audit_log",
  {
    id: serial("id").primaryKey(),
    apiKeyId: integer("api_key_id").references(() => apiKeys.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    resource: text("resource").notNull(),
    resourceId: text("resource_id"),
    diff: jsonb("diff").$type<Record<string, unknown> | unknown[]>(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [index("audit_log_api_key_id_idx").on(table.apiKeyId)]
);
