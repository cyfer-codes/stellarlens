import { integer, pgTable, serial, text } from "drizzle-orm/pg-core";

export const contracts = pgTable("contracts", {
  id: serial("id").primaryKey(),
  address: text("address").notNull().unique(),
  name: text("name"),
  network: text("network").notNull(),
  decimals: integer("decimals"),
  symbol: text("symbol")
});