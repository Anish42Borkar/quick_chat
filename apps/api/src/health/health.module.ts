import { Controller, Get, Inject, Module } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { DATABASE, AppDatabase } from "../database/database.module";

@Controller("health")
class HealthController {
  constructor(@Inject(DATABASE) private readonly db: AppDatabase) {}
  @Get()
  async getHealth(): Promise<{ status: string; database: string }> {
    await this.db.execute(sql`select 1`);
    return { status: "ok", database: "ok" };
  }
}

@Module({
  controllers: [HealthController],
})
export class HealthModule {}
