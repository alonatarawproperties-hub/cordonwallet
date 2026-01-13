import { sql } from "drizzle-orm";
import { pgTable, text, varchar, bigint } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const mobileAuthSessions = pgTable("mobile_auth_sessions", {
  sessionId: varchar("session_id", { length: 64 }).primaryKey(),
  status: varchar("status", { length: 20 }).notNull().default("pending"),
  code: text("code"),
  codeVerifier: text("code_verifier"),
  idToken: text("id_token"),
  accessToken: text("access_token"),
  error: text("error"),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
