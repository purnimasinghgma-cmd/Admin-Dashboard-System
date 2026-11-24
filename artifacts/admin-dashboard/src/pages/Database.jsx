import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Database as DbIcon, Play, KeyRound, Link2 } from "lucide-react";
import { api } from "../lib/api.js";
import { Card, CardHeader, CardBody } from "../components/Card.jsx";
import { Button } from "../components/Modal.jsx";
import { formatNumber } from "../lib/utils.js";

/**
 * Shows the live database: every table with its columns and constraints, plus
 * a list of SQL queries that can be run and their results.  Built for the
 * DBMS capstone demo / viva.
 */
export default function Database() {
  const [tab, setTab] = useState("schema");

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <TabButton active={tab === "schema"} onClick={() => setTab("schema")}>
          Schema
        </TabButton>
        <TabButton active={tab === "queries"} onClick={() => setTab("queries")}>
          SQL queries
        </TabButton>
      </div>
      {tab === "schema" ? <Schema /> : <Queries />}
    </div>
  );
}

function TabButton({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
        active
          ? "bg-[var(--color-brand)] text-white"
          : "border border-[var(--color-border)] bg-white hover:bg-[var(--color-bg)]"
      }`}
    >
      {children}
    </button>
  );
}

function Schema() {
  const tables = useQuery({ queryKey: ["db-tables"], queryFn: api.dbTables });

  if (tables.isLoading) return <Muted>Loading schema...</Muted>;
  if (tables.isError) return <Muted>{tables.error.message}</Muted>;

  const totalRows = tables.data.reduce((s, t) => s + t.rows, 0);

  return (
    <>
      <Card>
        <CardHeader
          title="PostgreSQL database"
          subtitle={`${tables.data.length} tables - ${formatNumber(totalRows)} rows - 6 views - 3 triggers`}
          action={<DbIcon className="h-5 w-5 text-[var(--color-muted)]" />}
        />
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        {tables.data.map((t) => (
          <Card key={t.name}>
            <CardHeader
              title={t.name}
              subtitle={`${formatNumber(t.rows)} rows`}
            />
            <CardBody className="space-y-3">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--color-border)] text-left text-xs uppercase tracking-wide text-[var(--color-muted)]">
                    <th className="py-1.5 pr-2">Column</th>
                    <th className="py-1.5 pr-2">Type</th>
                    <th className="py-1.5">Null?</th>
                  </tr>
                </thead>
                <tbody>
                  {t.columns.map((c) => (
                    <tr
                      key={c.name}
                      className="border-b border-[var(--color-border)] last:border-0"
                    >
                      <td className="py-1.5 pr-2 font-mono text-xs">{c.name}</td>
                      <td className="py-1.5 pr-2 text-xs text-[var(--color-muted)]">
                        {c.type}
                      </td>
                      <td className="py-1.5 text-xs text-[var(--color-muted)]">
                        {c.nullable ? "yes" : "no"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="space-y-1">
                {t.constraints.map((c, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs">
                    {c.kind === "FOREIGN KEY" ? (
                      <Link2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-600" />
                    ) : (
                      <KeyRound className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
                    )}
                    <span>
                      <span className="font-semibold">{c.kind}</span>{" "}
                      <span className="font-mono text-[var(--color-muted)]">
                        {c.definition}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            </CardBody>
          </Card>
        ))}
      </div>
    </>
  );
}

function Queries() {
  const list = useQuery({ queryKey: ["db-queries"], queryFn: api.dbQueries });
  const [selected, setSelected] = useState(null);
  const [runKey, setRunKey] = useState(null);

  const result = useQuery({
    queryKey: ["db-query-run", runKey],
    queryFn: () => api.runDbQuery(runKey),
    enabled: !!runKey,
    staleTime: 0,
    gcTime: 0,
  });

  if (list.isLoading) return <Muted>Loading queries...</Muted>;
  if (list.isError) return <Muted>{list.error.message}</Muted>;

  const current = list.data.find((q) => q.key === selected) || list.data[0];

  return (
    <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
      <Card>
        <CardBody className="space-y-1 p-2">
          {list.data.map((q) => (
            <button
              key={q.key}
              onClick={() => {
                setSelected(q.key);
                setRunKey(null);
              }}
              className={`w-full rounded-lg px-3 py-2 text-left transition ${
                q.key === current.key
                  ? "bg-blue-50 text-[var(--color-brand)]"
                  : "hover:bg-[var(--color-bg)]"
              }`}
            >
              <div className="text-sm font-medium">{q.title}</div>
              <div className="text-xs text-[var(--color-muted)]">{q.concept}</div>
            </button>
          ))}
        </CardBody>
      </Card>

      <div className="space-y-4">
        <Card>
          <CardHeader
            title={current.title}
            subtitle={current.concept}
            action={
              <Button onClick={() => setRunKey(current.key)}>
                <Play className="-mt-0.5 mr-1 inline h-4 w-4" /> Run query
              </Button>
            }
          />
          <CardBody>
            <pre className="overflow-x-auto rounded-lg bg-slate-900 p-4 text-xs leading-relaxed text-slate-100">
              {current.sql}
            </pre>
          </CardBody>
        </Card>

        {runKey === current.key && (
          <Card>
            <CardHeader
              title="Result"
              subtitle={
                result.data ? `${result.data.rows.length} rows` : undefined
              }
            />
            <CardBody>
              {result.isLoading && <Muted>Running...</Muted>}
              {result.isError && <Muted>{result.error.message}</Muted>}
              {result.data && <ResultTable data={result.data} />}
            </CardBody>
          </Card>
        )}
      </div>
    </div>
  );
}

function formatCell(v) {
  if (v === null || v === undefined) return "NULL";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v)) {
    return v.replace("T", " ").slice(0, 19);
  }
  return String(v);
}

function ResultTable({ data }) {
  if (!data.rows.length) return <Muted>No rows returned.</Muted>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--color-border)] text-left text-xs uppercase tracking-wide text-[var(--color-muted)]">
            {data.columns.map((c) => (
              <th key={c} className="px-3 py-2">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.rows.map((row, i) => (
            <tr
              key={i}
              className="border-b border-[var(--color-border)] last:border-0"
            >
              {data.columns.map((c) => (
                <td key={c} className="px-3 py-2 font-mono text-xs">
                  {formatCell(row[c])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Muted({ children }) {
  return (
    <div className="py-8 text-center text-sm text-[var(--color-muted)]">
      {children}
    </div>
  );
}
