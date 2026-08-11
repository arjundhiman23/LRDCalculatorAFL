"use client";

import { useState } from "react";
import type { CalculationResult, ScheduleRow } from "@/lib/engine/types";
import { formatCrore, formatDate, formatINR } from "@/lib/format";
import type { ApplicationPayload } from "@/lib/validation";
import { Badge, Button, Card, NumberInput, Select, Spinner } from "../ui";
import { ScheduleTable } from "./ResultsTab";

interface SimulationResponse {
  schedule: ScheduleRow[];
  discountFactor: number;
  achievable: boolean;
  fullyRepaid: boolean;
  negativeMonths: number;
  payoffMonth: number | null;
}

/** Proposed loan amount + tenure → the discounting factor needed for the loan
 * to close exactly at the end of that tenure, plus the resulting schedule. */
export function RepaymentScheduleTab({
  app,
  result,
  update,
}: {
  app: ApplicationPayload;
  result: CalculationResult | null;
  update: (fn: (a: ApplicationPayload) => ApplicationPayload) => void;
}) {
  const tenureOptions = (
    result?.tenureResults.map((r) => r.tenureMonths) ?? [180, 144, 120]
  ).map((t) => ({ value: String(t), label: `${t} months` }));

  const [tenure, setTenure] = useState(
    String(app.proposedTenure ?? tenureOptions[0]?.value ?? 180),
  );
  const [amount, setAmount] = useState<number | null>(app.proposedAmount);
  const [out, setOut] = useState<SimulationResponse | null>(null);
  const [busy, setBusy] = useState(false);

  const activeRent = app.lessees.reduce((s, l) => s + l.grossRent, 0);

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
    <div className="space-y-4">
      <Card title="Proposed loan — schedule at the required discounting factor">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-64">
            <span className="mb-1 block text-xs font-medium text-slate-500">
              Proposed loan amount
            </span>
            <NumberInput value={amount} min={0} onChange={setAmount} />
          </div>
          <div className="w-44">
            <span className="mb-1 block text-xs font-medium text-slate-500">
              Proposed tenure
            </span>
            <Select value={tenure} onChange={setTenure} options={tenureOptions} />
          </div>
          <Button onClick={run} disabled={busy || !amount || activeRent <= 0}>
            {busy ? (
              <span className="flex items-center gap-2">
                <Spinner /> Calculating…
              </span>
            ) : (
              "Build schedule"
            )}
          </Button>
          {result && (
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
        <p className="mt-3 text-xs text-slate-400">
          The discounting factor is solved automatically: it is the share of net rent
          that must service the loan for the balance to reach zero exactly at the end
          of the proposed tenure.
        </p>
        {!result && (
          <p className="mt-1 text-xs text-slate-400">
            Tip: run the eligibility calculation first to pick up the standard tenures
            and prefill a sanctionable amount.
          </p>
        )}
      </Card>

      {out && (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <Card>
              <div className="text-xs font-medium uppercase tracking-wide text-slate-400">
                Required discounting factor
              </div>
              <div
                className={`mt-1 text-3xl font-semibold ${
                  out.achievable ? "text-slate-900" : "text-red-600"
                }`}
              >
                {out.discountFactor.toFixed(4)}
              </div>
              <p className="mt-1 text-xs text-slate-400">
                {out.achievable
                  ? `${(out.discountFactor * 100).toFixed(2)}% of net rent services the loan`
                  : "Even 100% of the net rent cannot repay this amount in this tenure"}
              </p>
            </Card>
            <Card>
              <div className="text-xs font-medium uppercase tracking-wide text-slate-400">
                Loan / tenure
              </div>
              <div className="mt-1 text-2xl font-semibold text-slate-900">
                {formatCrore(amount ?? 0)}
              </div>
              <p className="mt-1 text-xs text-slate-400">
                over {tenure} months, closing{" "}
                {formatDate(out.schedule[out.schedule.length - 1].dueDate)}
              </p>
            </Card>
            <Card>
              <div className="text-xs font-medium uppercase tracking-wide text-slate-400">
                Checks
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {out.fullyRepaid ? (
                  <Badge tone="green">Fully repaid within tenure</Badge>
                ) : (
                  <Badge tone="red">Not fully repaid</Badge>
                )}
                {out.negativeMonths > 0 ? (
                  <Badge tone="amber">
                    {out.negativeMonths} month(s) with negative principal
                  </Badge>
                ) : (
                  <Badge tone="green">No negative amortization</Badge>
                )}
              </div>
              <p className="mt-2 text-xs text-slate-400">
                Monthly servicing:{" "}
                {formatINR(out.schedule[1]?.cash ?? out.schedule[0].cash)}
              </p>
            </Card>
          </div>

          <Card title="Repayment schedule">
            <ScheduleTable rows={out.schedule} />
          </Card>
        </>
      )}
    </div>
  );
}
