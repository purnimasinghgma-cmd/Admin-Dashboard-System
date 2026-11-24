# NexusOps Admin Dashboard (DBMS Capstone)

An e-commerce admin dashboard (React + Express) backed by a **normalized PostgreSQL database**. Originally a 2nd-semester web development project; extended for the DBMS capstone with a proper relational schema, views, triggers, transactions and a built-in database explorer.

**Student:** Purnima Singh

## What the database part adds

- 3NF schema: `customers`, `categories`, `products`, `orders`, `order_items`, `stock_log`, `users`, `session`
- Primary keys, foreign keys, `CHECK` and `UNIQUE` constraints, indexes
- 6 views, 1 stored function, 3 triggers (stock stays correct automatically)
- Order placement as a single transaction (all-or-nothing)
- A **Database** page in the app that shows the live schema and runs 7 showcase SQL queries (joins, GROUP BY/HAVING, window functions, CTE, subquery)

Full explanation, ER diagram and demo script: [`docs/DBMS_REPORT.md`](docs/DBMS_REPORT.md)

![ER diagram](docs/er-diagram.png)

The whole SQL schema is in [`artifacts/admin-dashboard/server/schema.sql`](artifacts/admin-dashboard/server/schema.sql).

## How to run

### 1. Requirements
- Node.js 22 or newer
- pnpm (`npm install -g pnpm`)
- PostgreSQL 16 or newer, running locally

### 2. Create an empty database
In `psql` or pgAdmin:
```sql
CREATE DATABASE nexusops;
```

### 3. Start the app
From the project folder:

Mac / Linux:
```bash
export DATABASE_URL=postgres://postgres:YOURPASSWORD@localhost:5432/nexusops
pnpm install
pnpm --filter @workspace/admin-dashboard run dev
```

Windows PowerShell:
```powershell
$env:DATABASE_URL="postgres://postgres:YOURPASSWORD@localhost:5432/nexusops"
pnpm install
pnpm --filter @workspace/admin-dashboard run dev
```

Replace `postgres` and `YOURPASSWORD` with your PostgreSQL user and password.

On first start the app creates all tables, views and triggers from `schema.sql` and loads demo data (about 1,400 orders). Then open **http://localhost:22133**.

To wipe everything and reload fresh demo data:
```bash
pnpm --filter @workspace/admin-dashboard run seed
```

## Using the demo

Use the role dropdown (top right) to switch between Admin, Manager and User.

1. **Database** page (Admin/Manager): tables, keys, constraints, and runnable SQL queries
2. **Sales → New order**: place an order with several products
3. **Products**: stock for those products has dropped (trigger)
4. **Sales**: change that order to *cancelled*, and stock is returned
5. Order more than the available stock: the order is refused and nothing is saved (transaction rollback)
6. **Database → SQL queries → Latest automatic stock changes**: the audit trail from the trigger

## Tech stack

React 19, Vite, Tailwind CSS, Recharts, TanStack Query, Express, PostgreSQL (`pg`, raw SQL).
