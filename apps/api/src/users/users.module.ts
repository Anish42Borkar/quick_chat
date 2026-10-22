import { Controller, Get, Inject, Module, Query, UseGuards } from "@nestjs/common";
import { and, ilike, ne, or } from "drizzle-orm";
import { DATABASE, AppDatabase } from "../database/database.module";
import { users } from "../database/schema";
import { CurrentUser, SessionGuard } from "../auth/session.guard";
import { AuthModule } from "../auth/auth.module";
import type { SafeUser } from "../auth/auth.service";

@Controller("users")
@UseGuards(SessionGuard)
class UsersController {
  constructor(@Inject(DATABASE) private readonly db: AppDatabase) {}
  @Get()
  async list(@CurrentUser() current: SafeUser, @Query("q") query = "") {
    const term = query.trim().slice(0, 80);
    const filter = term ? or(ilike(users.displayName, `%${term}%`), ilike(users.mobileNumber, `%${term}%`)) : undefined;
    const rows = await this.db.select({ id: users.id, mobileNumber: users.mobileNumber, displayName: users.displayName })
      .from(users).where(filter ? and(ne(users.id, current.id), filter) : ne(users.id, current.id)).limit(50);
    return { users: rows };
  }
}

@Module({ imports: [AuthModule], controllers: [UsersController], providers: [SessionGuard] })
export class UsersModule {}
