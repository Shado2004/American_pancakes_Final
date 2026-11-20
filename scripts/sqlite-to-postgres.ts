import Database from 'better-sqlite3';
import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';

async function main() {
  const dbPath = path.resolve('flo.db');
  if (!fs.existsSync(dbPath)) {
    console.error(`[Migration] SQLite database file not found at ${dbPath}`);
    process.exit(1);
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('[Migration] DATABASE_URL environment variable is required.');
    process.exit(1);
  }

  console.log('[Migration] Opening flo.db in read-only mode...');
  const sqlite = new Database(dbPath, { readonly: true });

  console.log('[Migration] Connecting to PostgreSQL / Supabase...');
  const pg = new Pool({
    connectionString: databaseUrl,
    ssl: databaseUrl.includes('localhost') ? undefined : { rejectUnauthorized: false },
  });

  const client = await pg.connect();
  console.log('[Migration] Connected successfully to PostgreSQL.');

  try {
    // 1. Ensure schema exists
    console.log('[Migration] Checking schema in PostgreSQL...');
    const schemaSqlPath = path.resolve('main/db/migrations/postgres/schema.sql');
    if (fs.existsSync(schemaSqlPath)) {
      console.log('[Migration] Applying schema.sql to PostgreSQL...');
      const schemaSql = fs.readFileSync(schemaSqlPath, 'utf8');
      await client.query(schemaSql);
      console.log('[Migration] Schema verified/applied.');
    }

    // 2. Fetch all SQLite tables
    const tables = (sqlite.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    ).all() as Array<{ name: string }>).map((t) => t.name);

    console.log(`[Migration] Found ${tables.length} tables in SQLite to migrate.`);

    const reconciliation: Array<{
      table: string;
      sqliteCount: number;
      pgCount: number;
      status: 'PASS' | 'FAIL';
    }> = [];

    // Temporarily defer foreign key constraints during data load if supported
    await client.query('SET session_replication_role = replica;').catch(() => {
      // In Supabase without superuser, session_replication_role might not be changeable; continue safely.
    });

    for (const table of tables) {
      const sqliteRows = sqlite.prepare(`SELECT * FROM "${table}"`).all() as Array<Record<string, any>>;
      const sqliteCount = sqliteRows.length;

      if (sqliteCount === 0) {
        reconciliation.push({ table, sqliteCount: 0, pgCount: 0, status: 'PASS' });
        continue;
      }

      console.log(`[Migration] Migrating ${table} (${sqliteCount} rows)...`);
      await client.query('BEGIN');

      try {
        // Clear existing data in target table to avoid duplicate key conflicts on re-run
        await client.query(`TRUNCATE TABLE "${table}" RESTART IDENTITY CASCADE;`).catch(() => {
          return client.query(`DELETE FROM "${table}";`);
        });

        // Insert rows in batches of 100
        const columns = Object.keys(sqliteRows[0]);
        const colList = columns.map((c) => `"${c}"`).join(', ');

        const batchSize = 100;
        for (let i = 0; i < sqliteRows.length; i += batchSize) {
          const batch = sqliteRows.slice(i, i + batchSize);
          const valueClauses: string[] = [];
          const params: any[] = [];
          let paramIdx = 1;

          for (const row of batch) {
            const placeholders: string[] = [];
            for (const col of columns) {
              placeholders.push(`$${paramIdx++}`);
              let val = row[col];
              // Convert boolean buffers or undefined to valid postgres values
              if (val === undefined) val = null;
              params.push(val);
            }
            valueClauses.push(`(${placeholders.join(', ')})`);
          }

          const insertSql = `INSERT INTO "${table}" (${colList}) VALUES ${valueClauses.join(', ')}`;
          await client.query(insertSql, params);
        }

        // Reset identity sequence if table has identity column
        try {
          const seqResult = await client.query(
            `SELECT pg_get_serial_sequence('"${table}"', 'id') AS seq`
          );
          const seqName = seqResult.rows[0]?.seq;
          if (seqName) {
            await client.query(
              `SELECT setval($1, COALESCE((SELECT MAX(id) FROM "${table}"), 1))`,
              [seqName]
            );
          }
        } catch {}

        await client.query('COMMIT');

        // Verify count
        const countRes = await client.query(`SELECT COUNT(*) AS count FROM "${table}"`);
        const pgCount = parseInt(countRes.rows[0].count, 10);
        const status = pgCount === sqliteCount ? 'PASS' : 'FAIL';
        reconciliation.push({ table, sqliteCount, pgCount, status });

        if (status === 'FAIL') {
          console.error(`[Migration] Count mismatch in ${table}: SQLite=${sqliteCount}, PG=${pgCount}`);
        }
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`[Migration] Failed on table ${table}:`, err);
        throw err;
      }
    }

    await client.query('SET session_replication_role = DEFAULT;').catch(() => {});

    console.log('\n================ RECONCILIATION REPORT ================');
    console.table(reconciliation);

    const allPassed = reconciliation.every((r) => r.status === 'PASS');
    if (allPassed) {
      console.log('\n✅ ALL TABLES RECONCILED SUCCESSFULLY! 0 DISCREPANCIES.\n');
    } else {
      console.error('\n❌ RECONCILIATION FAILED ON ONE OR MORE TABLES.\n');
      process.exit(1);
    }
  } finally {
    client.release();
    await pg.end();
    sqlite.close();
  }
}

main().catch((err) => {
  console.error('[Migration] Fatal error:', err);
  process.exit(1);
});
