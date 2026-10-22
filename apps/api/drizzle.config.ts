import dotenv from "dotenv";
import { defineConfig } from "drizzle-kit";

dotenv.config({ path: "../../.env" });

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is missing. Configure it in the repository root .env file.");
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/database/schema/*.ts",
  out: "./src/database/migrations",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
  strict: true,
  verbose: true,
});
