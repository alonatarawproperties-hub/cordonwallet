import { sql } from "drizzle-orm";
import { pgTable, text, varchar, bigint, integer, jsonb } from "drizzle-orm/pg-core";
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

export const tokenSafetyCache = pgTable("token_safety_cache", {
  mint: varchar("mint", { length: 64 }).primaryKey(),
  chain: varchar("chain", { length: 16 }).notNull().default("solana"),
  verdictLevel: varchar("verdict_level", { length: 16 }).notNull(),
  report: jsonb("report").notNull(),
  scanVersion: integer("scan_version").notNull().default(2),
  scannedAt: bigint("scanned_at", { mode: "number" }).notNull(),
  expiresAt: bigint("expires_at", { mode: "number" }).notNull(),
});

export type TokenSafetyCacheRow = typeof tokenSafetyCache.$inferSelect;

export const cordonSessions = pgTable("cordon_sessions", {
  id: varchar("id", { length: 64 }).primaryKey(),
  userId: varchar("user_id", { length: 128 }).notNull(),
  email: varchar("email", { length: 256 }).notNull(),
  name: text("name"),
  jwt: text("jwt").notNull(),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  expiresAt: bigint("expires_at", { mode: "number" }).notNull(),
});

export const activityLogs = pgTable("activity_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id", { length: 128 }),
  email: varchar("email", { length: 256 }),
  method: varchar("method", { length: 10 }).notNull(),
  path: text("path").notNull(),
  statusCode: integer("status_code"),
  action: varchar("action", { length: 64 }),
  details: jsonb("details"),
  ip: varchar("ip", { length: 64 }),
  userAgent: text("user_agent"),
  durationMs: integer("duration_ms"),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});

export type ActivityLog = typeof activityLogs.$inferSelect;

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
