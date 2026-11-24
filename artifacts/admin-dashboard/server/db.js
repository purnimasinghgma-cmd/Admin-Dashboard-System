import pg from "pg";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required");
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export async function query(text, params) {
  return pool.query(text, params);
}

/**
 * Run several statements as ONE transaction (all-or-nothing).
 *
 *   await withTransaction(async (client) => {
 *     await client.query("INSERT ...");
 *     await client.query("UPDATE ...");
 *   });
 *
 * If anything throws, ROLLBACK undoes every statement; otherwise COMMIT.
 */
export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // connection already broken; nothing more to undo
    }
    throw err;
  } finally {
    client.release();
  }
}
