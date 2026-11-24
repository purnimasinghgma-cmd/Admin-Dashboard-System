-- =====================================================================
--  NexusOps Admin Dashboard  -  DBMS Capstone
--  Database schema (PostgreSQL 16)
--
--  Normalized to 3NF:
--    * users        : staff accounts that log in to the dashboard
--    * customers    : people who buy things (separate from staff)
--    * categories   : product categories (was repeated text before)
--    * products     : catalogue, each belongs to one category
--    * orders       : one row per order, belongs to one customer
--    * order_items  : junction table  orders <-> products  (M:N)
--    * stock_log    : audit trail written by triggers
--    * session      : demo "who is logged in" row
--
--  This file is safe to run more than once (IF NOT EXISTS / OR REPLACE).
-- =====================================================================

-- ---------------------------------------------------------------------
--  1. TABLES
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS session (
  id          text PRIMARY KEY,
  role        text NOT NULL CHECK (role IN ('admin', 'manager', 'user')),
  updated_at  timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id              serial PRIMARY KEY,
  name            text NOT NULL,
  email           text NOT NULL UNIQUE,
  role            text NOT NULL CHECK (role IN ('admin', 'manager', 'user')),
  status          text NOT NULL CHECK (status IN ('active', 'invited', 'suspended')),
  avatar_url      text,
  last_active_at  timestamp,
  created_at      timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS customers (
  id          serial PRIMARY KEY,
  name        text NOT NULL,
  email       text NOT NULL UNIQUE,
  created_at  timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS categories (
  id    serial PRIMARY KEY,
  name  text NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS products (
  id           serial PRIMARY KEY,
  name         text NOT NULL,
  sku          text NOT NULL UNIQUE,
  category_id  integer NOT NULL
               REFERENCES categories (id) ON UPDATE CASCADE ON DELETE RESTRICT,
  price        numeric(10, 2) NOT NULL CHECK (price >= 0),
  stock        integer NOT NULL DEFAULT 0 CHECK (stock >= 0),
  created_at   timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS orders (
  id            serial PRIMARY KEY,
  order_number  text NOT NULL UNIQUE,
  customer_id   integer NOT NULL
                REFERENCES customers (id) ON UPDATE CASCADE ON DELETE RESTRICT,
  status        text NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'paid', 'shipped', 'refunded', 'cancelled')),
  created_at    timestamp NOT NULL DEFAULT now()
);

-- unit_price is the price *at the time of sale*; it is a real attribute of the
-- sale (products.price can change later), not a redundant copy.
CREATE TABLE IF NOT EXISTS order_items (
  id          serial PRIMARY KEY,
  order_id    integer NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
  product_id  integer NOT NULL REFERENCES products (id) ON DELETE RESTRICT,
  quantity    integer NOT NULL CHECK (quantity > 0),
  unit_price  numeric(10, 2) NOT NULL CHECK (unit_price >= 0),
  UNIQUE (order_id, product_id)
);

CREATE TABLE IF NOT EXISTS stock_log (
  id          serial PRIMARY KEY,
  product_id  integer NOT NULL REFERENCES products (id) ON DELETE CASCADE,
  change      integer NOT NULL,
  reason      text NOT NULL,
  created_at  timestamp NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
--  2. INDEXES  (foreign keys and the columns the dashboard filters on)
-- ---------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_products_category   ON products (category_id);
CREATE INDEX IF NOT EXISTS idx_orders_customer     ON orders (customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_created_at   ON orders (created_at);
CREATE INDEX IF NOT EXISTS idx_orders_status       ON orders (status);
CREATE INDEX IF NOT EXISTS idx_order_items_product ON order_items (product_id);
CREATE INDEX IF NOT EXISTS idx_stock_log_product   ON stock_log (product_id);
CREATE INDEX IF NOT EXISTS idx_users_created_at    ON users (created_at);

-- ---------------------------------------------------------------------
--  3. VIEWS
-- ---------------------------------------------------------------------

DROP VIEW IF EXISTS v_orders_detail, v_customer_ranking, v_sales_by_category,
                    v_top_products, v_low_stock, v_order_totals CASCADE;

-- Order total is derived from the line items (never stored -> no redundancy).
CREATE VIEW v_order_totals AS
SELECT order_id,
       SUM(quantity)::int          AS units,
       SUM(quantity * unit_price)  AS total
FROM order_items
GROUP BY order_id;

-- One row per order with customer + product details (used by the Sales page).
CREATE VIEW v_orders_detail AS
SELECT o.id,
       o.order_number,
       o.status,
       o.created_at,
       c.id    AS customer_id,
       c.name  AS customer_name,
       c.email AS customer_email,
       COALESCE(t.units, 0) AS units,
       COALESCE(t.total, 0) AS total,
       (SELECT string_agg(p.name, ', ' ORDER BY p.name)
          FROM order_items oi
          JOIN products p ON p.id = oi.product_id
         WHERE oi.order_id = o.id) AS product_names,
       (SELECT string_agg(DISTINCT cat.name, ', ')
          FROM order_items oi
          JOIN products   p   ON p.id   = oi.product_id
          JOIN categories cat ON cat.id = p.category_id
         WHERE oi.order_id = o.id) AS category_names
FROM orders o
JOIN customers c ON c.id = o.customer_id
LEFT JOIN v_order_totals t ON t.order_id = o.id;

-- Revenue per category (cancelled / refunded orders do not count).
CREATE VIEW v_sales_by_category AS
SELECT cat.id   AS category_id,
       cat.name AS category,
       COUNT(DISTINCT o.id)::int          AS orders,
       SUM(oi.quantity * oi.unit_price)   AS revenue
FROM orders o
JOIN order_items oi ON oi.order_id = o.id
JOIN products   p   ON p.id   = oi.product_id
JOIN categories cat ON cat.id = p.category_id
WHERE o.status NOT IN ('cancelled', 'refunded')
GROUP BY cat.id, cat.name;

-- Revenue per product.
CREATE VIEW v_top_products AS
SELECT p.id   AS product_id,
       p.name,
       SUM(oi.quantity)::int              AS units,
       COUNT(DISTINCT o.id)::int          AS orders,
       SUM(oi.quantity * oi.unit_price)   AS revenue
FROM orders o
JOIN order_items oi ON oi.order_id = o.id
JOIN products    p  ON p.id = oi.product_id
WHERE o.status NOT IN ('cancelled', 'refunded')
GROUP BY p.id, p.name;

-- Customers ranked by lifetime value (window function RANK()).
CREATE VIEW v_customer_ranking AS
SELECT c.id,
       c.name,
       c.email,
       COUNT(DISTINCT o.id)::int AS orders,
       COALESCE(SUM(oi.quantity * oi.unit_price), 0) AS lifetime_value,
       RANK() OVER (
         ORDER BY COALESCE(SUM(oi.quantity * oi.unit_price), 0) DESC
       ) AS value_rank
FROM customers c
LEFT JOIN orders o       ON o.customer_id = c.id
                        AND o.status NOT IN ('cancelled', 'refunded')
LEFT JOIN order_items oi ON oi.order_id = o.id
GROUP BY c.id, c.name, c.email;

-- Products that need restocking.
CREATE VIEW v_low_stock AS
SELECT p.id, p.name, p.sku, cat.name AS category, p.stock
FROM products p
JOIN categories cat ON cat.id = p.category_id
WHERE p.stock < 5;

-- ---------------------------------------------------------------------
--  4. STORED FUNCTION
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_customer_lifetime_value(p_customer_id integer)
RETURNS numeric
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(SUM(oi.quantity * oi.unit_price), 0)
  FROM orders o
  JOIN order_items oi ON oi.order_id = o.id
  WHERE o.customer_id = p_customer_id
    AND o.status NOT IN ('cancelled', 'refunded');
$$;

-- ---------------------------------------------------------------------
--  5. TRIGGERS  (keep products.stock correct automatically)
--
--  Seeding sets  app.seeding = 'on'  (transaction-local) to skip the stock
--  trigger so thousands of demo orders do not drain the stock.
-- ---------------------------------------------------------------------

-- 5a. New order line  ->  reduce stock, refuse if there is not enough.
CREATE OR REPLACE FUNCTION trg_order_item_stock()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_status text;
  v_number text;
BEGIN
  IF current_setting('app.seeding', true) = 'on' THEN
    RETURN NEW;
  END IF;

  SELECT status, order_number INTO v_status, v_number
  FROM orders WHERE id = NEW.order_id;

  IF v_status IN ('cancelled', 'refunded') THEN
    RETURN NEW;   -- dead orders do not hold stock
  END IF;

  UPDATE products
     SET stock = stock - NEW.quantity
   WHERE id = NEW.product_id
     AND stock >= NEW.quantity;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Insufficient stock for product %', NEW.product_id
      USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO stock_log (product_id, change, reason)
  VALUES (NEW.product_id, -NEW.quantity, 'order ' || v_number);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS order_items_stock ON order_items;
CREATE TRIGGER order_items_stock
  BEFORE INSERT ON order_items
  FOR EACH ROW EXECUTE FUNCTION trg_order_item_stock();

-- 5b. Status moves into / out of cancelled|refunded  ->  give back / take stock.
CREATE OR REPLACE FUNCTION trg_order_status_stock()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  r         record;
  was_dead  boolean := OLD.status IN ('cancelled', 'refunded');
  is_dead   boolean := NEW.status IN ('cancelled', 'refunded');
BEGIN
  IF was_dead = is_dead THEN
    RETURN NEW;
  END IF;

  FOR r IN SELECT product_id, quantity FROM order_items WHERE order_id = NEW.id LOOP
    IF is_dead THEN
      UPDATE products SET stock = stock + r.quantity WHERE id = r.product_id;
      INSERT INTO stock_log (product_id, change, reason)
      VALUES (r.product_id, r.quantity, 'order ' || NEW.order_number || ' ' || NEW.status);
    ELSE
      UPDATE products
         SET stock = stock - r.quantity
       WHERE id = r.product_id AND stock >= r.quantity;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Insufficient stock for product %', r.product_id
          USING ERRCODE = 'P0001';
      END IF;
      INSERT INTO stock_log (product_id, change, reason)
      VALUES (r.product_id, -r.quantity, 'order ' || NEW.order_number || ' reopened');
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS orders_status_stock ON orders;
CREATE TRIGGER orders_status_stock
  BEFORE UPDATE OF status ON orders
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION trg_order_status_stock();

-- 5c. Deleting a live order  ->  give its stock back (items cascade-delete).
CREATE OR REPLACE FUNCTION trg_order_delete_stock()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  r record;
BEGIN
  IF OLD.status IN ('cancelled', 'refunded') THEN
    RETURN OLD;
  END IF;

  FOR r IN SELECT product_id, quantity FROM order_items WHERE order_id = OLD.id LOOP
    UPDATE products SET stock = stock + r.quantity WHERE id = r.product_id;
    INSERT INTO stock_log (product_id, change, reason)
    VALUES (r.product_id, r.quantity, 'order ' || OLD.order_number || ' deleted');
  END LOOP;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS orders_delete_stock ON orders;
CREATE TRIGGER orders_delete_stock
  BEFORE DELETE ON orders
  FOR EACH ROW EXECUTE FUNCTION trg_order_delete_stock();
