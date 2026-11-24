import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool, query, withTransaction } from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const FIRST = [
  "Avery", "Jordan", "Sam", "Ada", "Sage", "Skyler", "Yael", "Rowan",
  "Hayden", "Quinn", "Riley", "Taylor", "Morgan", "Casey", "Reese",
  "Ari", "Jamie", "Alex", "Charlie", "Drew", "Emerson", "Finley",
  "Harper", "Indigo", "Jules", "Kendall", "Logan", "Marlowe", "Noa",
  "Oakley", "Parker", "River", "Sutton", "Tatum", "Vesper", "Wren",
  "Zion", "Adair", "Blair", "Cameron", "Dakota", "Eden", "Frankie",
  "Gray", "Lennon", "Phoenix", "Sterling", "Wynn",
];
const LAST = [
  "Chen", "Patel", "Rivera", "Kim", "Reyes", "Ito", "Garcia", "Wozniak",
  "Hayes", "Brooks", "Nguyen", "Adams", "Khan", "Silva", "Bennett",
  "Cole", "Diaz", "Evans", "Foster", "Hall", "Iyer", "Jansen",
];
const PRODUCTS = [
  { name: "Drift Pour-Over Kettle", category: "Kitchen", price: 129 },
  { name: "Trail 30L Backpack", category: "Outdoor", price: 159 },
  { name: "Aurora Throw Blanket", category: "Home", price: 79 },
  { name: "Helio Solar Lantern", category: "Outdoor", price: 64 },
  { name: "Linen Apron", category: "Kitchen", price: 39 },
  { name: "Mesa Ceramic Mug Set", category: "Kitchen", price: 49 },
  { name: "Quartz Desk Lamp", category: "Office", price: 89 },
  { name: "Bramble Wool Socks", category: "Apparel", price: 24 },
  { name: "Cove Wireless Speaker", category: "Electronics", price: 199 },
  { name: "Echo Standing Desk", category: "Office", price: 449 },
  { name: "Field Journal", category: "Stationery", price: 22 },
  { name: "Glacier Insulated Bottle", category: "Outdoor", price: 34 },
  { name: "Harbor Canvas Tote", category: "Apparel", price: 45 },
  { name: "Iris Linen Shirt", category: "Apparel", price: 89 },
  { name: "Juniper Diffuser", category: "Home", price: 56 },
  { name: "Knoll Pour Coffee Beans", category: "Kitchen", price: 18 },
  { name: "Loft Acoustic Panel", category: "Office", price: 72 },
  { name: "Marrow Cast Iron Pan", category: "Kitchen", price: 88 },
];
const STATUSES = ["pending", "paid", "shipped", "refunded", "cancelled"];
const STATUS_WEIGHTS = [0.12, 0.38, 0.27, 0.13, 0.1];
const CUSTOMER_COUNT = 60;

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}
function pickWeighted(arr, weights) {
  let r = Math.random();
  for (let i = 0; i < arr.length; i++) {
    r -= weights[i];
    if (r <= 0) return arr[i];
  }
  return arr[arr.length - 1];
}
function rand(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
/** Build "($1,$2),($3,$4)" style placeholders for a multi-row INSERT. */
function placeholders(rows, cols) {
  const out = [];
  for (let r = 0; r < rows; r++) {
    const row = [];
    for (let c = 0; c < cols; c++) row.push(`$${r * cols + c + 1}`);
    out.push(`(${row.join(",")})`);
  }
  return out.join(",");
}

const ALL_TABLES =
  "stock_log, order_items, orders, products, categories, customers, users, session";

/**
 * Create every table, view, function and trigger from schema.sql.
 * If a database from the old, un-normalized version of this project is found
 * (orders.customer_name still exists) it is dropped and rebuilt first.
 */
export async function ensureSchema() {
  const legacy = await query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'orders' AND column_name = 'customer_name'`,
  );
  if (legacy.rowCount > 0) {
    console.log("[schema] old un-normalized schema found, rebuilding...");
    await query(`DROP TABLE IF EXISTS ${ALL_TABLES} CASCADE`);
  }

  const sql = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf-8");
  await query(sql);

  await query(
    `INSERT INTO session (id, role) VALUES ('default', 'admin')
     ON CONFLICT (id) DO NOTHING`,
  );
}

async function populateDemoData() {
  await withTransaction(async (client) => {
    // Tell the stock trigger to stand down while we bulk-load history.
    await client.query(`SELECT set_config('app.seeding', 'on', true)`);

    // ---- users (dashboard staff accounts) -------------------------------
    console.log("Seeding users...");
    const usedEmails = new Set();
    let userCount = 0;
    for (let i = 0; i < 48; i++) {
      const first = pick(FIRST);
      const last = pick(LAST);
      const email = `${first}.${last}`.toLowerCase() + `${i}@example.com`;
      if (usedEmails.has(email)) continue;
      usedEmails.add(email);
      userCount++;
      const role = i === 0 ? "admin" : i < 6 ? "manager" : "user";
      const status = pickWeighted(
        ["active", "invited", "suspended"],
        [0.78, 0.16, 0.06],
      );
      const createdAt = new Date();
      createdAt.setDate(createdAt.getDate() - rand(0, 90));
      await client.query(
        `INSERT INTO users (name, email, role, status, avatar_url, last_active_at, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          `${first} ${last}`,
          email,
          role,
          status,
          `https://api.dicebear.com/9.x/notionists/svg?seed=${encodeURIComponent(first)}&backgroundColor=transparent`,
          createdAt,
          createdAt,
        ],
      );
    }

    // ---- customers -------------------------------------------------------
    console.log("Seeding customers...");
    const customerIds = [];
    const usedCustomerEmails = new Set();
    for (let i = 0; i < CUSTOMER_COUNT; i++) {
      const first = pick(FIRST);
      const last = pick(LAST);
      const email = `${first}.${last}`.toLowerCase() + `${i}@shop.example.com`;
      if (usedCustomerEmails.has(email)) continue;
      usedCustomerEmails.add(email);
      const createdAt = new Date();
      createdAt.setDate(createdAt.getDate() - rand(30, 120));
      const r = await client.query(
        `INSERT INTO customers (name, email, created_at)
         VALUES ($1, $2, $3) RETURNING id`,
        [`${first} ${last}`, email, createdAt],
      );
      customerIds.push(r.rows[0].id);
    }

    // ---- categories + products -------------------------------------------
    console.log("Seeding categories and products...");
    const categoryIds = new Map();
    for (const name of [...new Set(PRODUCTS.map((p) => p.category))]) {
      const r = await client.query(
        `INSERT INTO categories (name) VALUES ($1) RETURNING id`,
        [name],
      );
      categoryIds.set(name, r.rows[0].id);
    }
    const products = [];
    for (let i = 0; i < PRODUCTS.length; i++) {
      const p = PRODUCTS[i];
      const r = await client.query(
        `INSERT INTO products (name, sku, category_id, price, stock)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [p.name, `SKU-${1000 + i}`, categoryIds.get(p.category), p.price, rand(0, 80)],
      );
      products.push({ id: r.rows[0].id, price: p.price });
    }

    // ---- orders + order_items (one batch of each per day) ---------------
    console.log("Seeding orders...");
    let orderCount = 0;
    let itemCount = 0;
    for (let day = 90; day >= 0; day--) {
      const ordersToday = rand(10, 22);
      const dayOrders = [];
      for (let n = 0; n < ordersToday; n++) {
        const created = new Date();
        created.setDate(created.getDate() - day);
        created.setHours(rand(8, 22), rand(0, 59));
        const orderNumber = `ORD-${created.toISOString().slice(0, 10).replace(/-/g, "")}-${String(n + 1).padStart(4, "0")}`;

        // 1-3 different products per order
        const lineCount = rand(1, 3);
        const chosen = new Set();
        while (chosen.size < lineCount) chosen.add(pick(products));
        dayOrders.push({
          orderNumber,
          customerId: pick(customerIds),
          status: pickWeighted(STATUSES, STATUS_WEIGHTS),
          created,
          lines: [...chosen].map((p) => ({ product: p, qty: rand(1, 3) })),
        });
      }

      const orderParams = [];
      for (const o of dayOrders) {
        orderParams.push(o.orderNumber, o.customerId, o.status, o.created);
      }
      const inserted = await client.query(
        `INSERT INTO orders (order_number, customer_id, status, created_at)
         VALUES ${placeholders(dayOrders.length, 4)}
         RETURNING id, order_number`,
        orderParams,
      );
      const idByNumber = new Map(
        inserted.rows.map((r) => [r.order_number, r.id]),
      );

      const itemParams = [];
      let itemRows = 0;
      for (const o of dayOrders) {
        for (const line of o.lines) {
          itemParams.push(
            idByNumber.get(o.orderNumber),
            line.product.id,
            line.qty,
            line.product.price,
          );
          itemRows++;
        }
      }
      await client.query(
        `INSERT INTO order_items (order_id, product_id, quantity, unit_price)
         VALUES ${placeholders(itemRows, 4)}`,
        itemParams,
      );
      orderCount += dayOrders.length;
      itemCount += itemRows;
    }

    console.log(
      `Seeded: ${userCount} users, ${customerIds.length} customers, ` +
        `${categoryIds.size} categories, ${products.length} products, ` +
        `${orderCount} orders, ${itemCount} order items`,
    );
  });
}

export async function seedIfEmpty() {
  await ensureSchema();
  const r = await query(`SELECT COUNT(*)::int AS c FROM users`);
  if (r.rows[0].c > 0) {
    console.log("[seed] database already populated, skipping");
    return false;
  }
  console.log("[seed] database empty, seeding demo data...");
  await populateDemoData();
  return true;
}

export async function seedReset() {
  console.log("Resetting tables...");
  await query(`DROP TABLE IF EXISTS ${ALL_TABLES} CASCADE`);
  await ensureSchema();
  await populateDemoData();
}

const isMain =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  seedReset()
    .then(() => pool.end())
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
