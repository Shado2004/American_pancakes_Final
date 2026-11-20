import { Pool, PoolClient, QueryResult, QueryResultRow, types } from 'pg';

// Parse Postgres NUMERIC (OID 1700) directly into JavaScript number (float)
// to maintain exact compatibility with SQLite REAL numeric behavior
types.setTypeParser(1700, (val: string) => parseFloat(val));

let pool: Pool | null = null;

export function getPgPool(): Pool {
  if (pool) return pool;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL environment variable is required to connect to PostgreSQL');
  }

  const isLocalhost = connectionString.includes('localhost') || connectionString.includes('127.0.0.1');
  const useSsl = process.env.PGSSL === 'true' || (!isLocalhost && process.env.PGSSL !== 'false');

  pool = new Pool({
    connectionString,
    max: parseInt(process.env.PGPOOL_MAX || '5', 10),
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
    application_name: process.env.PGAPPNAME || 'american-pancakes-pos',
    ssl: useSsl ? { rejectUnauthorized: false } : undefined,
  });

  pool.on('error', (err) => {
    console.error('[PostgreSQL] Unexpected pool error on idle client:', err);
  });

  return pool;
}

/**
 * Execute a query and return all resulting rows.
 */
export async function query<T extends QueryResultRow = any>(
  text: string,
  params?: any[],
  client?: PoolClient,
): Promise<QueryResult<T>> {
  const p = client || getPgPool();
  return p.query<T>(text, params);
}

/**
 * Execute a query and return all matching rows.
 */
export async function many<T extends QueryResultRow = any>(
  text: string,
  params?: any[],
  client?: PoolClient,
): Promise<T[]> {
  const result = await query<T>(text, params, client);
  return result.rows;
}

/**
 * Execute a query and return a single row, or null if no row matched.
 */
export async function one<T extends QueryResultRow = any>(
  text: string,
  params?: any[],
  client?: PoolClient,
): Promise<T | null> {
  const result = await query<T>(text, params, client);
  return result.rows.length > 0 ? result.rows[0] : null;
}

/**
 * Execute a statement (INSERT/UPDATE/DELETE/DDL) and return row count changed.
 */
export async function execute(
  text: string,
  params?: any[],
  client?: PoolClient,
): Promise<number> {
  const result = await query(text, params, client);
  return result.rowCount || 0;
}

/**
 * Run a multi-statement transaction with automatic BEGIN, COMMIT, and ROLLBACK.
 */
export async function withTransaction<T>(
  callback: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const p = getPgPool();
  const client = await p.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      console.error('[PostgreSQL] Rollback failed:', rollbackErr);
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Close the PostgreSQL connection pool (for graceful shutdown).
 */
export async function closePgPool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
