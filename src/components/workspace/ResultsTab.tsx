"use client";

import { useState } from "react";
import type { CalculationResult, ScheduleRow, TenureResult } from "@/lib/engine/types";
import { dfLabel, formatCrore, formatDate, formatINR } from "@/lib/format";
import type { ApplicationPayload } from "@/lib/validation";
import { Badge, Button, Card, NumberInput, Select, Spinner } from "../ui";

export function ResultsTab({
  app,
  result,
  stale,
  standardTenures,
  onCalculate,
  calculating,
  update,
}: {
  app: ApplicationPayload;
  result: CalculationResult | null;
  stale: boolean;
  standardTenures: number[];
  onCalculate: () => void;
  calculating: boolean;
  update: (fn: (a: ApplicationPayload) => ApplicationPayload) => void;
}) {
  if (!result) {
    return (
      <Card>
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <p className="text-sm text-slate-500">
            No results yet. Fill in the inputs, then run the calculation — the
            equivalent of the workbook&apos;s <em>Reset → Eligibility</em> buttons.
          </p>
          <Button onClick={onCalculate} disabled={calculating}>
            {calculating ? "Calculating…" : "Calculate eligibility"}
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {stale && (
        <div className="flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          Inputs changed since this calculation — results may be outdated.
          <Button variant="secondary" onClick={onCalculate} disabled={calculating}>
            {calculating ? "Recalculating…" : "Recalculate"}
          </Button>
        </div>
      )}
      {result.warnings.map((w, i) => (
        <div
          key={i}
          className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800"
        >
          {w}
        </div>
      ))}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {result.tenureResults.map((r) => (
          <TenureCard
            key={r.tenureMonths}
            r={r}
            custom={!standardTenures.includes(r.tenureMonths)}
          />
        ))}
      </div>

      <div className="rounded-lg bg-slate-50 px-4 py-3 text-sm text-slate-600">
        Total net rent {formatINR(result.totalNetRentMonthly)}/month · discounted cash
        flow {formatINR(result.totalCashMonthly)}/month (first period)
      </div>

      {result.uniqueTenure && <UniqueTenureSection ut={result.uniqueTenure} />}

      <LtvTrendCard result={result} />
      <ScheduleCard result={result} />
      <ProposedAmountCard app={app} result={result} update={update} />
    </div>
  );
}

function TenureCard({ r, custom }: { r: TenureResult; custom: boolean }) {
  return (
    <Card>
      <div className="flex items-start justify-between">
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-slate-400">
            {r.tenureMonths} months {custom && <Badge tone="blue">custom</Badge>}
          </div>
          <div className="mt-1 text-2xl font-semibold text-slate-900">
            {formatCrore(r.adjustedEligibility)}
          </div>
          <div className="text-xs text-slate-400">
            {formatINR(r.adjustedEligibility)}
          </div>
        </div>
        {r.wasAdjusted ? (
          <Badge tone="amber">adjusted</Badge>
        ) : (
          <Badge tone="green">clean</Badge>
        )}
      </div>
      <dl className="mt-4 space-y-1.5 text-sm">
        {r.wasAdjusted && (
          <div className="flex justify-between">
            <dt className="text-slate-500">Unadjusted maximum</dt>
            <dd className="text-slate-400 line-through">
              {formatCrore(r.maxEligibility)}
            </dd>
          </div>
        )}
        <div className="flex justify-between">
          <dt className="text-slate-500">Discounting factor</dt>
          <dd className="font-medium text-slate-700">
            {dfLabel(r.discountFactorRange)}
          </dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-slate-500">Closure date</dt>
          <dd className="text-slate-700">{formatDate(r.closureDate)}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-slate-500">NPV ratio</dt>
          <dd className="text-slate-700">{r.npvRatio.toFixed(4)}</dd>
        </div>
      </dl>
    </Card>
  );
}

function UniqueTenureSection({
  ut,
}: {
  ut: NonNullable<CalculationResult["uniqueTenure"]>;
}) {
  return (
    <Card title="Unique tenure (per-lessee)">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
            <th className="py-1.5 pr-3 font-medium">Lessee</th>
            <th className="py-1.5 pr-3 font-medium">Tenure</th>
            <th className="py-1.5 pr-3 font-medium">Eligibility</th>
            <th className="py-1.5 pr-3 font-medium">Disc. factor</th>
            <th className="py-1.5 font-medium">Notes</th>
          </tr>
        </thead>
        <tbody>
          {ut.perLessee.map((l) => (
            <tr key={l.lesseeName} className="border-t border-slate-50">
              <td className="py-2 pr-3 font-medium text-slate-700">{l.lesseeName}</td>
              <td className="py-2 pr-3 text-slate-600">{l.tenureMonths} months</td>
              <td className="py-2 pr-3 text-slate-800">
                {formatINR(l.adjustedEligibility)}
              </td>
              <td className="py-2 pr-3 text-slate-600">
                {dfLabel(l.discountFactorRange)}
              </td>
              <td className="py-2">
                {l.wasAdjusted ? (
                  <Badge tone="amber">adjusted</Badge>
                ) : (
                  <Badge tone="green">clean</Badge>
                )}
              </td>
            </tr>
          ))}
          <tr className="border-t border-slate-200 font-semibold">
            <td className="py-2 pr-3 text-slate-800">Total</td>
            <td className="py-2 pr-3 text-slate-600">
              repaid by month {ut.effectiveTenureMonths}
            </td>
            <td className="py-2 pr-3 text-slate-900">{formatINR(ut.totalEligibility)}</td>
            <td colSpan={2} />
          </tr>
        </tbody>
      </table>
    </Card>
  );
}

function LtvTrendCard({ result }: { result: CalculationResult }) {
  const withLtv = result.tenureResults.filter((r) => r.ltvTrend);
  if (withLtv.length === 0) return null;
  const maxYears = Math.max(...withLtv.map((r) => r.ltvTrend!.length));
  return (
    <Card title="LTV trend (yearly minimum of outstanding / property value)">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
              <th className="py-1.5 pr-3 font-medium">Year</th>
              {withLtv.map((r) => (
                <th key={r.tenureMonths} className="py-1.5 pr-3 font-medium">
                  {r.tenureMonths}M
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: maxYears }, (_, i) => i + 1).map((year) => (
              <tr key={year} className="border-t border-slate-50">
                <td className="py-1.5 pr-3 text-slate-500">{year}</td>
                {withLtv.map((r) => {
                  const v = r.ltvTrend!.find((t) => t.year === year)?.minLtv;
                  return (
                    <td key={r.tenureMonths} className="py-1.5 pr-3 text-slate-700">
                      {v === undefined ? "—" : v.toFixed(3)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export function ScheduleTable({ rows }: { rows: ScheduleRow[] }) {
  return (
    <div className="max-h-[480px] overflow-auto rounded-lg border border-slate-100">
      <table className="w-full min-w-[860px] text-xs">
        <thead className="sticky top-0 bg-slate-50 text-left uppercase tracking-wide text-slate-400">
          <tr>
            <th className="px-3 py-2 font-medium">#</th>
            <th className="px-3 py-2 font-medium">Due date</th>
            <th className="px-3 py-2 font-medium">Days</th>
            <th className="px-3 py-2 text-right font-medium">Net rent</th>
            <th className="px-3 py-2 text-right font-medium">DF</th>
            <th className="px-3 py-2 text-right font-medium">Disc. CF</th>
            <th className="px-3 py-2 text-right font-medium">Opening</th>
            <th className="px-3 py-2 text-right font-medium">Interest</th>
            <th className="px-3 py-2 text-right font-medium">Principal</th>
            <th className="px-3 py-2 text-right font-medium">Instalment</th>
            <th className="px-3 py-2 text-right font-medium">POS</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.monthIndex}
              className={`border-t border-slate-50 ${
                r.principal < 0 && r.monthIndex > 0 ? "bg-amber-50/60" : ""
              }`}
            >
              <td className="px-3 py-1.5 text-slate-400">{r.monthIndex}</td>
              <td className="px-3 py-1.5">{formatDate(r.dueDate)}</td>
              <td className="px-3 py-1.5 text-slate-400">{r.days}</td>
              <td className="px-3 py-1.5 text-right">{formatINR(r.netRent)}</td>
              <td className="px-3 py-1.5 text-right text-slate-400">
                {r.discountFactor.toFixed(2)}
              </td>
              <td className="px-3 py-1.5 text-right">{formatINR(r.cash)}</td>
              <td className="px-3 py-1.5 text-right">{formatINR(r.openingBalance)}</td>
              <td className="px-3 py-1.5 text-right">{formatINR(r.interest)}</td>
              <td
                className={`px-3 py-1.5 text-right ${r.principal < 0 ? "text-amber-700" : ""}`}
              >
                {formatINR(r.principal)}
              </td>
              <td className="px-3 py-1.5 text-right">{formatINR(r.instalment)}</td>
              <td className="px-3 py-1.5 text-right font-medium">
                {formatINR(r.closingBalance)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ScheduleCard({ result }: { result: CalculationResult }) {
  const options = result.tenureResults.map((r) => ({
    value: String(r.tenureMonths),
    label: `${r.tenureMonths} months — ${formatCrore(r.adjustedEligibility)}`,
  }));
  const [selected, setSelected] = useState(options[0]?.value ?? "");
  const [basis, setBasis] = useState<"adjusted" | "max">("adjusted");
  const chosen = result.tenureResults.find((r) => String(r.tenureMonths) === selected);
  if (!chosen) return null;
  const showMax = basis === "max" && chosen.wasAdjusted;
  const rows = showMax ? chosen.schedule : chosen.adjustedSchedule;
  return (
    <Card
      title={`Repayment schedule (at ${showMax ? "unadjusted maximum" : "eligibility"}: ${formatCrore(
        showMax ? chosen.maxEligibility : chosen.adjustedEligibility,
      )})`}
      actions={
        <div className="flex items-center gap-2">
          {chosen.wasAdjusted && (
            <div className="w-52">
              <Select
                value={basis}
                onChange={(v) => setBasis(v as "adjusted" | "max")}
                options={[
                  { value: "adjusted", label: "Adjusted eligibility" },
                  { value: "max", label: "Unadjusted maximum" },
                ]}
              />
            </div>
          )}
          <div className="w-64">
            <Select value={selected} onChange={setSelected} options={options} />
          </div>
        </div>
      }
    >
      <ScheduleTable rows={rows} />
      <p className="mt-2 text-xs text-slate-400">
        {showMax
          ? "Amber rows have a negative principal component (rent doesn't cover interest that month — the balance temporarily grows). The eligibility is reduced to remove them."
          : "Every month recovers a positive principal at this amount."}
      </p>
    </Card>
  );
}

function ProposedAmountCard({
  app,
  result,
  update,
}: {
  app: ApplicationPayload;
  result: CalculationResult;
  update: (fn: (a: ApplicationPayload) => ApplicationPayload) => void;
}) {
  const tenureOptions = result.tenureResults.map((r) => ({
    value: String(r.tenureMonths),
    label: `${r.tenureMonths} months`,
  }));
  const [tenure, setTenure] = useState(
    String(app.proposedTenure ?? result.tenureResults[0]?.tenureMonths ?? 180),
  );
  const [amount, setAmount] = useState<number | null>(app.proposedAmount);
  const [out, setOut] = useState<{
    schedule: ScheduleRow[];
    fullyRepaid: boolean;
    negativeMonths: number;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  async function run() {
    if (!amount) return;
    setBusy(true);
    update((a) => ({ ...a, proposedAmount: amount, proposedTenure: Number(tenure) }));
    const res = await fetch("/api/simulate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        application: { ...app, proposedAmount: amount, proposedTenure: Number(tenure) },
        loanAmount: amount,
        tenureMonths: Number(tenure),
      }),
    });
    setBusy(false);
    if (res.ok) setOut(await res.json());
  }

  return (
    <Card title="Proposed amount — what-if schedule">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-64">
          <span className="mb-1 block text-xs font-medium text-slate-500">
            Proposed loan amount
          </span>
          <NumberInput value={amount} min={0} onChange={setAmount} />
        </div>
        <div className="w-44">
          <span className="mb-1 block text-xs font-medium text-slate-500">Tenure</span>
          <Select value={tenure} onChange={setTenure} options={tenureOptions} />
        </div>
        <Button onClick={run} disabled={busy || !amount}>
          {busy ? (
            <span className="flex items-center gap-2">
              <Spinner /> Simulating…
            </span>
          ) : (
            "Simulate"
          )}
        </Button>
        {result.tenureResults[0] && (
          <button
            className="text-xs font-medium text-blue-600 hover:text-blue-800"
            onClick={() => {
              const r = result.tenureResults.find(
                (t) => String(t.tenureMonths) === tenure,
              );
              if (r) setAmount(Math.floor(r.adjustedEligibility));
            }}
          >
            Use computed eligibility
          </button>
        )}
      </div>
      {out && (
        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap gap-2 text-sm">
            {out.fullyRepaid ? (
              <Badge tone="green">Fully repaid within tenure</Badge>
            ) : (
              <Badge tone="red">NOT fully repaid within tenure</Badge>
            )}
            {out.negativeMonths > 0 ? (
              <Badge tone="amber">{out.negativeMonths} month(s) with negative principal</Badge>
            ) : (
              <Badge tone="green">No negative amortization</Badge>
            )}
          </div>
          <ScheduleTable rows={out.schedule} />
        </div>
      )}
    </Card>
  );
}
