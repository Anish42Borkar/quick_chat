import { Global, Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Pool } from "pg";
import { drizzle, NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema";
export const DATABASE = Symbol("DATABASE");
export type AppDatabase = NodePgDatabase<typeof schema>;
@Global()
@Module({ providers: [{ provide: DATABASE, inject: [ConfigService], useFactory: (config: ConfigService): AppDatabase => {
  const connectionString = config.get<string>("DATABASE_URL");
  if (!connectionString) throw new Error("DATABASE_URL is required");
  const pool = new Pool({ connectionString, max: 10 });
  return drizzle(pool, { schema });
}}], exports: [DATABASE] })
export class DatabaseModule {}
