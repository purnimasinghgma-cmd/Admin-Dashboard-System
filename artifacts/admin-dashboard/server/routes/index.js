import { Router } from "express";
import { authRouter } from "./auth.js";
import { usersRouter } from "./users.js";
import { productsRouter } from "./products.js";
import { ordersRouter } from "./orders.js";
import { dashboardRouter } from "./dashboard.js";
import { databaseRouter } from "./database.js";

export const apiRouter = Router();

apiRouter.get("/healthz", (_req, res) => res.json({ ok: true }));
apiRouter.use("/auth", authRouter);
apiRouter.use("/users", usersRouter);
apiRouter.use("/products", productsRouter);
apiRouter.use("/orders", ordersRouter);
apiRouter.use("/dashboard", dashboardRouter);
apiRouter.use("/database", databaseRouter);

// Turn database constraint errors into clear messages for the UI.
const PG_ERRORS = {
  "23505": [409, "That value already exists (it must be unique)."],
  "23503": [409, "That record is linked to other records, so the change was refused."],
  "23514": [400, "A value is outside the allowed range."],
  "23502": [400, "A required field is missing."],
  "22P02": [400, "A value has the wrong format."],
  P0001: [409, null], // raised by our triggers, e.g. "Insufficient stock ..."
};

apiRouter.use((err, _req, res, _next) => {
  if (err.status) {
    return res.status(err.status).json({ error: err.message });
  }
  const mapped = PG_ERRORS[err.code];
  if (mapped) {
    return res
      .status(mapped[0])
      .json({ error: mapped[1] || err.message });
  }
  console.error("[api error]", err);
  res.status(500).json({ error: err.message || "Internal server error" });
});
