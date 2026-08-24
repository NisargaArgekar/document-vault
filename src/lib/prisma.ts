/**
 * Prisma Client — shared database connection
 *
 * We create ONE instance and re-use it everywhere.
 * Every resolver imports this same `prisma` object to talk to the database.
 */
import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();
