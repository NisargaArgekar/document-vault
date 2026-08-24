/**
 * Prisma Client — shared database connection
 *
 * We create ONE instance and re-use it everywhere.
 * Every resolver imports this same `prisma` object to talk to the database.
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

// Create a connection pool using standard postgres client
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

// Create the Prisma driver adapter
const adapter = new PrismaPg(pool);

// Instantiate PrismaClient with the adapter
export const prisma = new PrismaClient({ adapter });
