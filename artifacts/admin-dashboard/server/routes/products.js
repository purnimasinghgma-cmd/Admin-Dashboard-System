import { Router } from "express";
import { query, withTransaction } from "../db.js";
import { HttpError } from "../http-error.js";

export const productsRouter = Router();

// products JOIN categories  (category is its own table)
const SELECT_PRODUCT = `
  SELECT p.id, p.name, p.sku, c.name AS category, p.price, p.stock, p.created_at
    FROM products p
    JOIN categories c ON c.id = p.category_id`;

function mapProduct(row) {
  return {
    id: row.id,
    name: row.name,
    sku: row.sku,
    category: row.category,
    price: Number(row.price),
    stock: row.stock,
    createdAt: row.created_at,
  };
}

/** Find the category by name, creating it if it is new. */
async function categoryId(client, name) {
  const r = await client.query(
    `INSERT INTO categories (name) VALUES ($1)
     ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [name.trim()],
  );
  return r.rows[0].id;
}

productsRouter.get("/", async (req, res, next) => {
  try {
    const { category, q } = req.query;
    const conds = [];
    const params = [];
    if (category) {
      params.push(category);
      conds.push(`c.name = $${params.length}`);
    }
    if (q) {
      params.push(`%${q}%`);
      conds.push(
        `(p.name ILIKE $${params.length} OR p.sku ILIKE $${params.length})`,
      );
    }
    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    const r = await query(
      `${SELECT_PRODUCT} ${where} ORDER BY p.created_at DESC`,
      params,
    );
    res.json(r.rows.map(mapProduct));
  } catch (e) {
    next(e);
  }
});

productsRouter.post("/", async (req, res, next) => {
  try {
    const { name, sku, category, price, stock } = req.body || {};
    if (!name?.trim() || !sku?.trim() || !category?.trim()) {
      throw new HttpError(400, "Name, SKU and category are required");
    }
    const row = await withTransaction(async (client) => {
      const cid = await categoryId(client, category);
      const ins = await client.query(
        `INSERT INTO products (name, sku, category_id, price, stock)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [name.trim(), sku.trim(), cid, price, stock || 0],
      );
      const r = await client.query(`${SELECT_PRODUCT} WHERE p.id = $1`, [
        ins.rows[0].id,
      ]);
      return r.rows[0];
    });
    res.status(201).json(mapProduct(row));
  } catch (e) {
    next(e);
  }
});

productsRouter.patch("/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { name, sku, category, price, stock } = req.body || {};
    const row = await withTransaction(async (client) => {
      const cid = category?.trim() ? await categoryId(client, category) : null;
      const upd = await client.query(
        `UPDATE products SET
           name = COALESCE($2, name),
           sku = COALESCE($3, sku),
           category_id = COALESCE($4, category_id),
           price = COALESCE($5, price),
           stock = COALESCE($6, stock)
         WHERE id = $1
         RETURNING id`,
        [id, name, sku, cid, price, stock],
      );
      if (upd.rowCount === 0) return null;
      const r = await client.query(`${SELECT_PRODUCT} WHERE p.id = $1`, [id]);
      return r.rows[0];
    });
    if (!row) throw new HttpError(404, "Product not found");
    res.json(mapProduct(row));
  } catch (e) {
    next(e);
  }
});

productsRouter.delete("/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    try {
      await query(`DELETE FROM products WHERE id = $1`, [id]);
    } catch (e) {
      // order_items.product_id is ON DELETE RESTRICT
      if (e.code === "23503") {
        throw new HttpError(
          409,
          "This product appears in existing orders, so it cannot be deleted.",
        );
      }
      throw e;
    }
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});
