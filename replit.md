# Workspace

## Overview

Admin Dashboard System (NexusOps) — a multi-role admin web app for an
e-commerce ops team. Built entirely in **plain JavaScript** (no TypeScript) as a
single full-stack app: Express API + React (JSX) frontend served from one
Node process, backed by PostgreSQL.

## Stack

- **Language**: Plain JavaScript (ES Modules)
- **Frontend**: React 19 + Vite + Tailwind CSS v4 + Recharts + lucide-react +
  wouter + TanStack React Query
- **Backend**: Express 5 (in the same Node process; Vite is used as middleware
  during development)
- **Database**: PostgreSQL via `pg` (raw SQL queries)
- **Package manager**: pnpm

## Project Layout

Single artifact at `artifacts/admin-dashboard/`:

```
artifacts/admin-dashboard/
├── package.json              (deps + dev/build/start/seed scripts)
├── vite.config.js            (React + Tailwind plugins, middleware mode)
├── server.js                 (Express + Vite middleware in dev, static in prod)
├── index.html                (Vite entry)
├── server/
│   ├── db.js                 (pg Pool wrapper)
│   ├── seed.js               (creates tables and seeds demo data)
│   └── routes/
│       ├── index.js          (mounts /api routes)
│       ├── auth.js           (GET /me, POST /switch-role)
│       ├── users.js          (CRUD)
│       ├── products.js       (CRUD)
│       ├── orders.js         (CRUD)
│       └── dashboard.js      (summary, charts, activity)
└── src/
    ├── main.jsx
    ├── App.jsx
    ├── index.css             (Tailwind v4 + theme tokens)
    ├── lib/                  (api fetch wrappers + utils)
    ├── hooks/useAuth.js      (current user + role switch)
    ├── components/           (Sidebar, Topbar, Layout, Card, Modal, Badge)
    └── pages/                (Dashboard, Sales, Users, Products, Analytics,
                               Settings, NotFound)
```

## Database

Normalized (3NF) schema defined in `artifacts/admin-dashboard/server/schema.sql`
and auto-created on server start (or by
`pnpm --filter @workspace/admin-dashboard run seed`). Full write-up, ER diagram
and viva demo script: `docs/DBMS_REPORT.md`.

- `users` — dashboard staff accounts (role, status)
- `customers` — people who buy (unique email)
- `categories` — product categories
- `products` — name, sku, category_id (FK), price, stock
- `orders` — order_number, customer_id (FK), status
- `order_items` — junction orders <-> products (quantity, unit_price)
- `stock_log` — audit trail written by triggers
- `session` — single-row demo session storing the active role

Also: 6 views (`v_order_totals`, `v_orders_detail`, `v_sales_by_category`,
`v_top_products`, `v_customer_ranking`, `v_low_stock`), 1 function, and 3
triggers that keep `products.stock` in sync with orders.

## Key Commands

- `pnpm --filter @workspace/admin-dashboard run dev` — start app (Express +
  Vite middleware) on port 22133
- `pnpm --filter @workspace/admin-dashboard run build` — build static frontend
- `pnpm --filter @workspace/admin-dashboard run start` — production: build
  must already exist; serves API + static dist
- `pnpm --filter @workspace/admin-dashboard run seed` — drop & reseed demo data

## Role-based UI

The active demo role is stored server-side in the `session` table and exposed
through `GET /api/auth/me`. Switching roles via `POST /api/auth/switch-role`
updates the stored role; the React Query cache is invalidated and the entire UI
re-renders with the new permissions:

- **admin** — full access, including the Users page and product deletion
- **manager** — everything except the Users page; can edit but not delete
  products
- **user** — read-only view; cannot edit orders/products; no Users/Analytics
