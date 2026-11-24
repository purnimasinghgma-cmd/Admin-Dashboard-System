import { Router } from "express";
import { query, withTransaction } from "../db.js";
import { HttpError } from "../http-error.js";

export const ordersRouter = Router();

const STATUSES = ["pending", "paid", "shipped", "refunded", "cancelled"];

// Rows come from the v_orders_detail VIEW (orders JOIN customers JOIN order_items ...).
function mapOrder(row) {
  return {
    id: row.id,
    orderNumber: row.order_number,
    customerName: row.customer_name,
    customerEmail: row.customer_email,
    productName: row.product_names,
    productCategory: row.category_names,
    units: row.units,
    amount: Number(row.total),
    status: row.status,
    createdAt: row.created_at,
  };
}

async function getOrderRow(runner, id) {
  const r = await runner.query(`SELECT * FROM v_orders_detail WHERE id = $1`, [
    id,
  ]);
  return r.rows[0];
}

ordersRouter.get("/", async (req, res, next) => {
  try {
    const { status, q } = req.query;
    const conds = [];
    const params = [];
    if (status) {
      params.push(status);
      conds.push(`status = $${params.length}`);
    }
    if (q) {
      params.push(`%${q}%`);
      conds.push(
        `(order_number ILIKE $${params.length} OR customer_name ILIKE $${params.length} OR product_names ILIKE $${params.length})`,
      );
    }
    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    const r = await query(
      `SELECT * FROM v_orders_detail ${where} ORDER BY created_at DESC LIMIT 500`,
      params,
    );
    res.json(r.rows.map(mapOrder));
  } catch (e) {
    next(e);
  }
});

// One order with its line items (orders JOIN order_items JOIN products).
ordersRouter.get("/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const row = await getOrderRow({ query }, id);
    if (!row) throw new HttpError(404, "Order not found");
    const items = await query(
      `SELECT oi.product_id, p.name, p.sku, oi.quantity, oi.unit_price,
              oi.quantity * oi.unit_price AS line_total
         FROM order_items oi
         JOIN products p ON p.id = oi.product_id
        WHERE oi.order_id = $1
        ORDER BY p.name`,
      [id],
    );
    res.json({
      ...mapOrder(row),
      items: items.rows.map((i) => ({
        productId: i.product_id,
        name: i.name,
        sku: i.sku,
        quantity: i.quantity,
        unitPrice: Number(i.unit_price),
        lineTotal: Number(i.line_total),
      })),
    });
  } catch (e) {
    next(e);
  }
});

/**
 * Place an order.  Body:
 *   { customerName, customerEmail, items: [{ productId, quantity }, ...] }
 *
 * Everything happens in ONE transaction:
 *   1. find-or-create the customer (by email)
 *   2. insert the order
 *   3. insert each order line at the product's current price
 * The database trigger reduces stock and raises an error if there is not
 * enough, which makes the whole transaction roll back.
 */
ordersRouter.post("/", async (req, res, next) => {
  try {
    const { customerName, customerEmail, items } = req.body || {};
    if (!customerName?.trim() || !customerEmail?.trim()) {
      throw new HttpError(400, "Customer name and email are required");
    }
    if (!Array.isArray(items) || items.length === 0) {
      throw new HttpError(400, "An order needs at least one item");
    }

    // merge duplicate products (order_items is UNIQUE per order + product)
    const wanted = new Map();
    for (const it of items) {
      const productId = Number(it.productId);
      const quantity = Number(it.quantity);
      if (!Number.isInteger(productId) || !Number.isInteger(quantity) || quantity < 1) {
        throw new HttpError(400, "Each item needs a product and a whole quantity of 1 or more");
      }
      wanted.set(productId, (wanted.get(productId) || 0) + quantity);
    }

    const row = await withTransaction(async (client) => {
      const cust = await client.query(
        `INSERT INTO customers (name, email) VALUES ($1, $2)
         ON CONFLICT (email) DO UPDATE SET email = customers.email
         RETURNING id`,
        [customerName.trim(), customerEmail.trim().toLowerCase()],
      );

      const idRow = await client.query(
        `SELECT nextval(pg_get_serial_sequence('orders', 'id')) AS id`,
      );
      const orderId = Number(idRow.rows[0].id);
      const day = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      const orderNumber = `ORD-${day}-${String(orderId).padStart(5, "0")}`;

      await client.query(
        `INSERT INTO orders (id, order_number, customer_id, status)
         VALUES ($1, $2, $3, 'pending')`,
        [orderId, orderNumber, cust.rows[0].id],
      );

      for (const [productId, quantity] of wanted) {
        const line = await client.query(
          `INSERT INTO order_items (order_id, product_id, quantity, unit_price)
           SELECT $1::int, p.id, $3::int, p.price FROM products p WHERE p.id = $2::int
           RETURNING id`,
          [orderId, productId, quantity],
        );
        if (line.rowCount === 0) {
          throw new HttpError(400, `Product ${productId} does not exist`);
        }
      }
      return getOrderRow(client, orderId);
    });

    res.status(201).json(mapOrder(row));
  } catch (e) {
    next(e);
  }
});

// Change an order's status.  A trigger returns / re-takes stock when an order
// is cancelled, refunded or re-opened.
ordersRouter.patch("/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { status } = req.body || {};
    if (!STATUSES.includes(status)) {
      throw new HttpError(400, "Invalid status");
    }
    const r = await query(`UPDATE orders SET status = $2 WHERE id = $1`, [
      id,
      status,
    ]);
    if (r.rowCount === 0) throw new HttpError(404, "Order not found");
    res.json(mapOrder(await getOrderRow({ query }, id)));
  } catch (e) {
    next(e);
  }
});

// Order lines are removed by ON DELETE CASCADE; a trigger returns the stock.
ordersRouter.delete("/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    await query(`DELETE FROM orders WHERE id = $1`, [id]);
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});
