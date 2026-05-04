import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';

const prismaDir = path.join(__dirname, '..', 'prisma');
const migrationsDir = path.join(prismaDir, 'migrations');
const tempE2eDir = path.join(os.tmpdir(), 'a11ybot-e2e');

function normalizeFileUrlPath(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

function pointRelativeSqliteUrlToTempDir(): void {
  const databaseUrl = process.env.DATABASE_URL ?? 'file:./dev-e2e.db';
  if (!databaseUrl.startsWith('file:./')) {
    return;
  }

  fs.mkdirSync(tempE2eDir, { recursive: true });
  const dbName = path.basename(databaseUrl.slice('file:./'.length));
  process.env.DATABASE_URL = `file:${normalizeFileUrlPath(
    path.join(tempE2eDir, dbName),
  )}`;
}

function getE2eDbPath(): string {
  const databaseUrl = process.env.DATABASE_URL ?? 'file:./dev-e2e.db';
  if (!databaseUrl.startsWith('file:')) {
    throw new Error(
      'Las pruebas e2e requieren DATABASE_URL con esquema file:.',
    );
  }

  const filePath = databaseUrl.slice('file:'.length);
  return path.isAbsolute(filePath)
    ? filePath
    : path.resolve(prismaDir, filePath);
}

function getMigrationFiles(): string[] {
  return fs
    .readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((entry) => path.join(migrationsDir, entry.name, 'migration.sql'))
    .filter((filePath) => fs.existsSync(filePath));
}

function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index];
    const next = sql[index + 1] ?? '';

    if (inLineComment) {
      current += char;
      if (char === '\n') {
        inLineComment = false;
      }
      continue;
    }

    if (inBlockComment) {
      current += char;
      if (char === '*' && next === '/') {
        current += next;
        index += 1;
        inBlockComment = false;
      }
      continue;
    }

    if (!inSingleQuote && !inDoubleQuote) {
      if (char === '-' && next === '-') {
        current += char;
        current += next;
        index += 1;
        inLineComment = true;
        continue;
      }
      if (char === '/' && next === '*') {
        current += char;
        current += next;
        index += 1;
        inBlockComment = true;
        continue;
      }
    }

    current += char;

    if (char === "'" && !inDoubleQuote) {
      const escaped = sql[index + 1] === "'";
      if (escaped) {
        current += sql[index + 1];
        index += 1;
      } else {
        inSingleQuote = !inSingleQuote;
      }
      continue;
    }

    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }

    if (char === ';' && !inSingleQuote && !inDoubleQuote) {
      const statement = current.trim();
      if (statement.length > 1) {
        statements.push(statement);
      }
      current = '';
    }
  }

  const tail = current.trim();
  if (tail.length > 0) {
    statements.push(tail);
  }

  return statements;
}

export async function prepareE2eDatabase() {
  pointRelativeSqliteUrlToTempDir();
  const e2eDbPath = getE2eDbPath();

  if (fs.existsSync(e2eDbPath)) {
    fs.unlinkSync(e2eDbPath);
  }

  const prisma = new PrismaClient();

  try {
    for (const filePath of getMigrationFiles()) {
      const sql = fs.readFileSync(filePath, 'utf8');
      for (const statement of splitSqlStatements(sql)) {
        await prisma.$executeRawUnsafe(statement);
      }
    }
  } finally {
    await prisma.$disconnect();
  }
}
