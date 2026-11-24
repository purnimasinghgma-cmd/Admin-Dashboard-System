import { Router } from "express";
import { query } from "../db.js";
import { HttpError } from "../http-error.js";

/**
 * "Database" page backend: shows the live schema (tables, columns, keys,
 * constraints, row counts) and runs a fixed list of showcase SQL queries.
 *
 * Only the queries written below can be run.  The browser sends a key, never
 * SQL text, so this cannot be used for SQL injection.
 */
export const databaseRouter = Router();

// Table names are listed here (not taken from the request) so they are safe
// to place inside the COUNT(*) statements.
const TABLES = [
  "customers",
  "categories",
  "products",
  "orders",
  "order_items",
  "stock_log",
  "users",
  "session",
];

const NOT_DEAD = `o.status NOT IN ('cancelled', 'refunded')`;

const SHOWCASE_QUERIES = [
  {
    key: "orders-join",
    title: "Latest order lines (4-table JOIN)",
    concept: "INNER JOIN",
    sql: `SELECT o.order_number,
       c.name       AS customer,
       p.name       AS product,
       oi.quantity,
       oi.unit_price,
       o.status
FROM orders o
JOIN customers   c  ON c.id  = o.customer_id
JOIN order_items oi ON oi.order_id = o.id
JOIN products    p  ON p.id  = oi.product_id
ORDER BY o.created_at DESC, o.order_number
LIMIT 15;`,
  },
  {
    key: "revenue-by-category",
    title: "Revenue per category",
    concept: "GROUP BY + HAVING + aggregate functions",
    sql: `SELECT cat.name AS category,
       COUNT(DISTINCT o.id)             AS orders,
       SUM(oi.quantity)                 AS units_sold,
       SUM(oi.quantity * oi.unit_price) AS revenue
FROM orders o
JOIN order_items oi ON oi.order_id = o.id
JOIN products    p  ON p.id  = oi.product_id
JOIN categories  cat ON cat.id = p.category_id
WHERE ${NOT_DEAD}
GROUP BY cat.name
HAVING SUM(oi.quantity * oi.unit_price) > 0
ORDER BY revenue DESC;`,
  },
  {
    key: "top-customers",
    title: "Top 10 customers by lifetime value",
    concept: "VIEW + window function RANK() OVER",
    sql: `-- v_customer_ranking is a view that uses RANK() OVER (ORDER BY ...)
SELECT value_rank, name, email, orders, lifetime_value
FROM v_customer_ranking
ORDER BY value_rank, name
LIMIT 10;`,
  },
  {
    key: "monthly-revenue",
    title: "Monthly revenue and month-over-month change",
    concept: "CTE (WITH) + LAG() window function",
    sql: `WITH monthly AS (
  SELECT date_trunc('month', o.created_at)::date AS month,
         SUM(t.total)                            AS revenue
  FROM orders o
  JOIN v_order_totals t ON t.order_id = o.id
  WHERE ${NOT_DEAD}
  GROUP BY 1
)
SELECT month,
       revenue,
       ROUND(100.0 * (revenue - LAG(revenue) OVER (ORDER BY month))
             / NULLIF(LAG(revenue) OVER (ORDER BY month), 0), 1) AS change_pct
FROM monthly
ORDER BY month;`,
  },
  {
    key: "above-average-orders",
    title: "Orders bigger than the average order",
    concept: "Subquery",
    sql: `SELECT o.order_number, c.name AS customer, t.total
FROM orders o
JOIN customers c       ON c.id = o.customer_id
JOIN v_order_totals t  ON t.order_id = o.id
WHERE t.total > (SELECT AVG(total) FROM v_order_totals)
ORDER BY t.total DESC
LIMIT 10;`,
  },
  {
    key: "low-stock",
    title: "Products that need restocking",
    concept: "VIEW with a WHERE filter",
    sql: `SELECT * FROM v_low_stock ORDER BY stock, name;`,
  },
  {
    key: "stock-log",
    title: "Latest automatic stock changes",
    concept: "TRIGGER output (audit table)",
    sql: `-- stock_log rows are written by triggers whenever an order is placed,
-- cancelled, re-opened or deleted from the Sales page.
SELECT l.created_at, p.name AS product, l.change, l.reason
FROM stock_log l
JOIN products p ON p.id = l.product_id
ORDER BY l.id DESC
LIMIT 15;`,
  },
];

databaseRouter.get("/tables", async (_req, res, next) => {
  try {
    const columns = await query(
      `SELECT table_name, column_name, data_type, is_nullable, column_default
         FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = ANY($1)
        ORDER BY table_name, ordinal_position`,
      [TABLES],
    );
    const constraints = await query(
      `SELECT conrelid::regclass::text AS table_name,
              contype,
              pg_get_constraintdef(oid)  AS definition
         FROM pg_constraint
        WHERE connamespace = current_schema()::regnamespace
          AND contype IN ('p', 'f', 'u', 'c')
          AND conrelid::regclass::text = ANY($1)
        ORDER BY conrelid::regclass::text, contype, conname`,
      [TABLES],
    );

    const out = [];
    for (const name of TABLES) {
      const count = await query(`SELECT COUNT(*)::int AS c FROM ${name}`);
      out.push({
        name,
        rows: count.rows[0].c,
        columns: columns.rows
          .filter((c) => c.table_name === name)
          .map((c) => ({
            name: c.column_name,
            type: c.data_type,
            nullable: c.is_nullable === "YES",
          })),
        constraints: constraints.rows
          .filter((c) => c.table_name === name)
          .map((c) => ({
            kind: { p: "PRIMARY KEY", f: "FOREIGN KEY", u: "UNIQUE", c: "CHECK" }[
              c.contype
            ],
            definition: c.definition,
          })),
      });
    }
    res.json(out);
  } catch (e) {
    next(e);
  }
});

databaseRouter.get("/queries", (_req, res) => {
  res.json(
    SHOWCASE_QUERIES.map(({ key, title, concept, sql }) => ({
      key,
      title,
      concept,
      sql,
    })),
  );
});

databaseRouter.get("/queries/:key", async (req, res, next) => {
  try {
    const q = SHOWCASE_QUERIES.find((x) => x.key === req.params.key);
    if (!q) throw new HttpError(404, "Unknown query");
    const r = await query(q.sql);
    res.json({
      columns: r.fields.map((f) => f.name),
      rows: r.rows,
    });
  } catch (e) {
    next(e);
  }
});
