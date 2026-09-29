import { index, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { contracts } from "./contracts.js";

export const webhooks = pgTable(
  "webhooks",
  {
    id: serial("id").primaryKey(),
    contractId: integer("contract_id")
      .notNull()
      .references(() => contracts.id),
    url: text("url").notNull(),
    secret: text("secret").notNull(),
    eventTypes: text("event_types").array(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [index("webhooks_contract_id_idx").on(table.contractId)]
);
