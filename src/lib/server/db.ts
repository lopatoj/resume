import path from 'node:path';
import { PrismaLibSql } from '@prisma/adapter-libsql';
import { PrismaClient } from './prisma/client.ts';

// Same default as prisma.config.ts, so the CLI and the app use one database file.
const url = process.env.DATABASE_URL ?? `file:${path.resolve('data/resume.db')}`;

export const db = new PrismaClient({ adapter: new PrismaLibSql({ url }) });
