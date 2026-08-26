"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  PostDisbursementResult,
  PostDisbursementRow,
} from "@/lib/engine/postDisbursement";
import type { ScheduleRow } from "@/lib/engine/types";
import { formatCrore, formatDate, formatINR, formatPct } from "@/lib/format";
import type {
  ApplicationPayload,
  PostDisbursementEventPayload,
} from "@/lib/validation";
import {
  Badge,
  Button,
  Card,
  DateInput,
  Field,
  NumberInput,
  PercentInput,
  Select,
  Spinner,
  TextInput,
} from "../ui";
import { ScheduleTable } from "./ResultsTab";

/** The loan after it has been disbursed: dated changes (additional
 * disbursement, prepayment, rate reset, restated balance) are applied to the
 * running schedule. When a sanctioned tenure is set, the discounting factor
 * on the combined rental cash flow is auto-solved to hold it — starting from
 * the initial disbursement itself, not only once a later change happens. A
 * revised ROI or a repayment is the exception: it moves the closure date
 * instead of being absorbed by the cover. */
export function PostDisbursementTab({
  app,
  update,
  standardTenures,
}: {
  app: ApplicationPayload;
  update: (fn: (a: ApplicationPayload) => ApplicationPayload) => void;
  standardTenures: number[];
}) {
  // Keyed by the inputs it was computed from, so a stale run is visible
  // without having to write state from the effect body.
  const [computed, setComputed] = useState<{
    key: string;
    result: PostDisbursementResult | null;
    error: string | null;
  } | null>(null);
  const [basis, setBasis] = useState<"revised" | "original">("revised");

  const events = app.postDisbursementEvents;
  const loanAmount = app.proposedAmount ?? 0;
  const totalGross = app.lessees.reduce((s, l) => s + l.grossRent, 0);

  // Recompute whenever anything the run-off depends on changes.
  const inputsKey = useMemo(
    () =>
      JSON.stringify([
        loanAmount,
        app.roi,
        app.disbursementDate,
        app.dueDay,
        app.moratoriumMonths,
        app.finalPropertyValue,
        events,
        app.lessees.map((l) => [
          l.grossRent,
          l.tdsRate,
          l.propertyTaxRate,
          l.insuranceRate,
          l.otherDeduction,
          l.discountFactor,
          l.firstEscalationDate,
          l.escalations,
        ]),
      ]),
    [
      loanAmount,
      app.roi,
      app.disbursementDate,
      app.dueDay,
      app.moratoriumMonths,
      app.finalPropertyValue,
      app.lessees,
      events,
    ],
  );

  const canRun = loanAmount > 0 && totalGross > 0;

  useEffect(() => {
    if (!canRun) return;
    let cancelled = false;
    (async () => {
      const res = await fetch("/api/post-disbursement", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ application: app, loanAmount }),
      });
      if (cancelled) return;
      if (res.ok) {
        const body = await res.json();
        setComputed({ key: inputsKey, result: body.result, error: null });
      } else {
        const body = await res.json().catch(() => null);
        setComputed({
          key: inputsKey,
          result: null,
          error: body?.error ?? "Could not build the revised schedule",
        });
      }
    })();
    return () => {
      cancelled = true;
    };
    // `app` is read fresh inside; only the inputs key triggers a refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputsKey, canRun]);

  const fresh = computed?.key === inputsKey;
  const result = computed?.result ?? null;
  const error = fresh ? computed?.error : null;
  const loading = canRun && !fresh;

  const setEvents = (
    fn: (list: PostDisbursementEventPayload[]) => PostDisbursementEventPayload[],
  ) => update((a) => ({ ...a, postDisbursementEvents: fn(a.postDisbursementEvents) }));

  const addEvent = () =>
    setEvents((list) => [
      ...list,
      {
        effectiveDate:
          list.length > 0
            ? list[list.length - 1].effectiveDate
            : app.disbursementDate,
        outstandingBalance: null,
        additionalDisbursement: 0,
        repayment: 0,
        revisedRoi: null,
        note: "",
      },
    ]);

  return (
    <div className="space-y-4">
      <Card title="Loan as disbursed">
        <div className="grid gap-3 sm:grid-cols-4">
          <Field
            label="Disbursed amount"
            hint="The amount actually released on the disbursement date"
          >
            <NumberInput
              value={app.proposedAmount}
              min={0}
              onChange={(v) => update((a) => ({ ...a, proposedAmount: v }))}
            />
          </Field>
          <Field label="Disbursement date" hint="Set on the Inputs tab">
            <TextInput value={formatDate(app.disbursementDate)} readOnly disabled />
          </Field>
          <Field label="ROI at disbursement" hint="Set on the Inputs tab">
            <TextInput value={formatPct(app.roi)} readOnly disabled />
          </Field>
          <Field
            label="Sanctioned tenure"
            hint="The cash cover is auto-solved to hold to this, from the disbursement itself onward"
          >
            <SanctionedTenureField
              value={app.proposedTenure}
              standardTenures={standardTenures}
              onChange={(v) => update((a) => ({ ...a, proposedTenure: v }))}
            />
          </Field>
        </div>
        {!app.proposedTenure && (
          <p className="mt-3 text-xs text-amber-700">
            Set a sanctioned tenure to hold the loan to it automatically, starting from
            the disbursement itself. Without one, every change — including the initial
            disbursement&apos;s own cash flow — just runs on the lessees&apos; configured
            cash cover, and moves the closure date.
          </p>
        )}
        {loanAmount <= 0 && (
          <p className="mt-3 text-xs text-amber-700">
            Enter the disbursed amount to build the schedule.
          </p>
        )}
      </Card>

      <Card
        title="Changes after disbursement"
        actions={
          <Button variant="secondary" onClick={addEvent}>
            Add change
          </Button>
        }
      >
        {events.length === 0 ? (
          <p className="py-4 text-center text-sm text-slate-400">
            No changes recorded — the loan is running on its original schedule. Add a
            change when the borrower takes an additional disbursement, prepays, or the
            rate is reset.
          </p>
        ) : (
          <div className="space-y-4">
            {events.map((event, i) => (
              <EventRow
                key={i}
                index={i}
                event={event}
                onChange={(patch) =>
                  setEvents((list) =>
                    list.map((e, j) => (j === i ? { ...e, ...patch } : e)),
                  )
                }
                onRemove={() =>
                  setEvents((list) => list.filter((_, j) => j !== i))
                }
              />
            ))}
          </div>
        )}
        <p className="mt-4 text-xs text-slate-400">
          A change takes effect on its own date — any day of the month, not only a due
          date — and interest for that month is split at it. A revised ROI or a
          repayment moves the closure date; an additional disbursement or a restated
          outstanding balance instead holds the sanctioned tenure by automatically
          adjusting the discounting factor on the combined rental cash flow.
        </p>
      </Card>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading && (
        <div className="flex items-center gap-2 px-1 text-xs text-slate-400">
          <Spinner /> Building the revised schedule…
        </div>
      )}

      {result && (
        <div className={`space-y-4 ${loading ? "opacity-50" : ""}`}>
          {result.warnings.map((w, i) => (
            <div
              key={i}
              className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800"
            >
              {w}
            </div>
          ))}

          <SummaryCards result={result} events={events} sanctionedTenure={app.proposedTenure} />

          <Card
            title={
              basis === "revised"
                ? "Revised repayment schedule"
                : "Original schedule (before the changes)"
            }
            actions={
              events.length > 0 ? (
                <div className="flex gap-1 rounded-lg bg-slate-100 p-0.5 text-xs font-medium">
                  <button
                    className={`rounded-md px-3 py-1 ${
                      basis === "revised" ? "bg-white text-slate-800 shadow-sm" : "text-slate-500"
                    }`}
                    onClick={() => setBasis("revised")}
                  >
                    Revised
                  </button>
                  <button
                    className={`rounded-md px-3 py-1 ${
                      basis === "original" ? "bg-white text-slate-800 shadow-sm" : "text-slate-500"
                    }`}
                    onClick={() => setBasis("original")}
                  >
                    Original
                  </button>
                </div>
              ) : undefined
            }
          >
            {basis === "revised" ? (
              <RevisedScheduleTable rows={result.schedule} />
            ) : (
              <ScheduleTable rows={result.baseline as ScheduleRow[]} />
            )}
          </Card>
        </div>
      )}

      {!canRun && (
        <Card>
          <p className="py-8 text-center text-sm text-slate-400">
            Enter the disbursed amount (and at least one lessee with rent) to see the
            schedule.
          </p>
        </Card>
      )}
    </div>
  );
}

/** Sanctioned tenure picker: the standard tenures (same set used on the
 * Eligibility results tab) plus a "Custom" option that reveals a free-entry
 * field. Falls back to custom mode when the stored value doesn't match any
 * standard tenure (e.g. an older application, or one entered before this
 * picker existed). */
function SanctionedTenureField({
  value,
  standardTenures,
  onChange,
}: {
  value: number | null;
  standardTenures: number[];
  onChange: (v: number | null) => void;
}) {
  const isCustomValue = value !== null && !standardTenures.includes(value);
  const [customMode, setCustomMode] = useState(isCustomValue);

  const options = [
    { value: "", label: "Select tenure…" },
    ...standardTenures.map((t) => ({ value: String(t), label: `${t} months` })),
    { value: "custom", label: "Custom" },
  ];
  const selectValue = customMode ? "custom" : value !== null ? String(value) : "";

  return (
    <div className="space-y-2">
      <Select
        value={selectValue}
        onChange={(v) => {
          if (v === "custom") {
            setCustomMode(true);
          } else if (v === "") {
            setCustomMode(false);
            onChange(null);
          } else {
            setCustomMode(false);
            onChange(Number(v));
          }
        }}
        options={options}
      />
      {customMode && (
        <NumberInput
          value={value}
          min={1}
          placeholder="e.g. 108"
          onChange={(v) => onChange(v ? Math.round(v) : null)}
        />
      )}
    </div>
  );
}

function EventRow({
  index,
  event,
  onChange,
  onRemove,
}: {
  index: number;
  event: PostDisbursementEventPayload;
  onChange: (patch: Partial<PostDisbursementEventPayload>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="rounded-lg border border-slate-200 p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">
          Change {index + 1}
        </span>
        <Button variant="ghost" onClick={onRemove}>
          Remove
        </Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Field label="Effective date">
          <DateInput
            value={event.effectiveDate}
            onChange={(v) => onChange({ effectiveDate: v ?? event.effectiveDate })}
          />
        </Field>
        <Field label="Additional disbursement" hint="Holds the sanctioned tenure">
          <NumberInput
            value={event.additionalDisbursement}
            min={0}
            onChange={(v) => onChange({ additionalDisbursement: v ?? 0 })}
          />
        </Field>
        <Field label="Repayment received" hint="Moves the closure date">
          <NumberInput
            value={event.repayment}
            min={0}
            onChange={(v) => onChange({ repayment: v ?? 0 })}
          />
        </Field>
        <Field label="Revised ROI" hint="Blank keeps the rate; moves the closure date">
          {event.revisedRoi === null ? (
            <button
              className="w-full rounded-lg border border-dashed border-slate-300 px-3 py-1.5 text-sm text-slate-400 hover:border-slate-400 hover:text-slate-600"
              onClick={() => onChange({ revisedRoi: 0.15 })}
            >
              unchanged
            </button>
          ) : (
            <div className="flex items-center gap-1">
              <PercentInput
                value={event.revisedRoi}
                onChange={(v) => onChange({ revisedRoi: v })}
              />
              <Button variant="ghost" onClick={() => onChange({ revisedRoi: null })}>
                ×
              </Button>
            </div>
          )}
        </Field>
        <Field
          label="Outstanding on that date"
          hint="Blank uses the projected balance; holds the sanctioned tenure"
        >
          <NumberInput
            value={event.outstandingBalance}
            min={0}
            placeholder="projected"
            onChange={(v) => onChange({ outstandingBalance: v })}
          />
        </Field>
      </div>
      <div className="mt-3">
        <Field label="Note">
          <TextInput
            value={event.note}
            onChange={(e) => onChange({ note: e.target.value })}
            placeholder="e.g. sanction letter reference"
          />
        </Field>
      </div>
    </div>
  );
}

function SummaryCards({
  result,
  events,
  sanctionedTenure,
}: {
  result: PostDisbursementResult;
  events: PostDisbursementEventPayload[];
  sanctionedTenure: number | null;
}) {
  // Once a sanctioned tenure is set, that's the meaningful reference point —
  // the loan is meant to hold to it, so "change" should mean "did it hold,"
  // not "how does this compare to the unadjusted natural schedule" (which is
  // what tenureChangeMonths/baselineClosure measure and remain useful for
  // only when no sanctioned tenure exists).
  const deltaVsSanctioned =
    sanctionedTenure && result.revisedTenureMonths !== null
      ? result.revisedTenureMonths - sanctionedTenure
      : null;
  const usingSanctioned = sanctionedTenure !== null;
  const delta = usingSanctioned ? deltaVsSanctioned : result.tenureChangeMonths;
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Card>
        <div className="text-xs font-medium uppercase tracking-wide text-slate-400">
          Revised closure
        </div>
        <div className="mt-1 text-2xl font-semibold text-slate-900">
          {result.closure ? formatDate(result.closure.dueDate) : "Does not close"}
        </div>
        <p className="mt-1 text-xs text-slate-400">
          {result.revisedTenureMonths !== null
            ? `${result.revisedTenureMonths} months from disbursement`
            : "The instalment never clears the balance"}
        </p>
        {!!result.overrunMonths && (
          <p className="mt-1 text-xs text-amber-700">
            {result.overrunMonths} months beyond the sanctioned tenure
          </p>
        )}
      </Card>
      <Card>
        <div className="text-xs font-medium uppercase tracking-wide text-slate-400">
          {usingSanctioned ? "Vs. sanctioned tenure" : "Change in tenure"}
        </div>
        <div
          className={`mt-1 text-2xl font-semibold ${
            delta === null ? "text-slate-400" : delta !== 0 ? "text-amber-600" : "text-emerald-600"
          }`}
        >
          {delta === null
            ? "—"
            : delta === 0
              ? usingSanctioned
                ? "Holds the sanctioned tenure"
                : "No change"
              : `${delta > 0 ? "+" : ""}${delta} months`}
        </div>
        <p className="mt-1 text-xs text-slate-400">
          {usingSanctioned
            ? `Sanctioned for ${sanctionedTenure} months` +
              (delta !== 0
                ? " — only a revised ROI or a repayment should move this"
                : "")
            : result.baselineClosure
              ? `Originally ${formatDate(result.baselineClosure.dueDate)} (${result.baselineTenureMonths} months)`
              : "No original closure to compare"}
        </p>
      </Card>
      <Card>
        <div className="text-xs font-medium uppercase tracking-wide text-slate-400">
          Money moved
        </div>
        <div className="mt-1 text-sm">
          <div className="flex justify-between">
            <span className="text-slate-500">Additional disbursed</span>
            <span className="font-medium text-slate-800">
              {formatCrore(result.totalAdditionalDisbursement)}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Repayments received</span>
            <span className="font-medium text-slate-800">
              {formatCrore(result.totalRepayment)}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Interest over the life</span>
            <span className="font-medium text-slate-800">
              {formatCrore(result.totalInterest)}
            </span>
          </div>
        </div>
      </Card>
      <Card>
        <div className="text-xs font-medium uppercase tracking-wide text-slate-400">
          Checks
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          {result.fullyRepaid ? (
            <Badge tone="green">Balance clears</Badge>
          ) : (
            <Badge tone="red">Never clears</Badge>
          )}
          {result.negativeMonths > 0 ? (
            <Badge tone="amber">
              {result.negativeMonths} month(s) short of the interest
            </Badge>
          ) : (
            <Badge tone="green">No negative amortization</Badge>
          )}
          {events.length > 0 && <Badge tone="blue">{events.length} change(s)</Badge>}
        </div>
        {result.balanceAtLastEvent !== null && (
          <p className="mt-2 text-xs text-slate-400">
            {formatINR(result.balanceAtLastEvent)} outstanding after the last change,
            {result.residualMonths !== null
              ? ` ${result.residualMonths} months still to run`
              : " never cleared"}
            .
          </p>
        )}
      </Card>
    </div>
  );
}

function RevisedScheduleTable({ rows }: { rows: PostDisbursementRow[] }) {
  return (
    <div className="max-h-[520px] overflow-auto rounded-lg border border-slate-100">
      <table className="w-full min-w-[1120px] text-xs">
        <thead className="sticky top-0 bg-slate-50 text-left uppercase tracking-wide text-slate-400">
          <tr>
            <th className="px-3 py-2 font-medium">#</th>
            <th className="px-3 py-2 font-medium">Due date</th>
            <th className="px-3 py-2 font-medium">Days</th>
            <th className="px-3 py-2 text-right font-medium">ROI</th>
            <th className="px-3 py-2 text-right font-medium">DF</th>
            <th className="px-3 py-2 text-right font-medium">Opening</th>
            <th className="px-3 py-2 text-right font-medium">Disbursed</th>
            <th className="px-3 py-2 text-right font-medium">Repaid</th>
            <th className="px-3 py-2 text-right font-medium">Interest</th>
            <th className="px-3 py-2 text-right font-medium">Principal</th>
            <th className="px-3 py-2 text-right font-medium">Instalment</th>
            <th className="px-3 py-2 text-right font-medium">POS</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const changed =
              r.events.length > 0 ||
              r.additionalDisbursement !== 0 ||
              r.repayment !== 0 ||
              r.balanceAdjustment !== 0;
            return (
              <tr
                key={r.monthIndex}
                className={`border-t border-slate-50 ${
                  changed
                    ? "bg-blue-50/60"
                    : r.principal < 0 && r.monthIndex > 0
                      ? "bg-amber-50/60"
                      : ""
                }`}
              >
                <td className="px-3 py-1.5 text-slate-400">{r.monthIndex}</td>
                <td className="px-3 py-1.5">
                  {formatDate(r.dueDate)}
                  {r.events.map((e, i) => (
                    <span key={i} className="ml-1.5 text-[10px] text-blue-600">
                      {formatDate(e.effectiveDate)}
                    </span>
                  ))}
                </td>
                <td className="px-3 py-1.5 text-slate-400">{r.days}</td>
                <td className="px-3 py-1.5 text-right text-slate-400">
                  {formatPct(r.roi)}
                </td>
                <td className="px-3 py-1.5 text-right">
                  {r.discountFactor.toFixed(2)}
                  {r.autoAdjusted && (
                    <span className="ml-1 text-[10px] text-blue-600">auto</span>
                  )}
                </td>
                <td className="px-3 py-1.5 text-right">{formatINR(r.openingBalance)}</td>
                <td className="px-3 py-1.5 text-right text-blue-700">
                  {r.additionalDisbursement ? formatINR(r.additionalDisbursement) : "—"}
                </td>
                <td className="px-3 py-1.5 text-right text-emerald-700">
                  {r.repayment ? formatINR(r.repayment) : "—"}
                </td>
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
            );
          })}
        </tbody>
      </table>
      <p className="border-t border-slate-100 bg-white px-3 py-2 text-[11px] text-slate-400">
        Blue rows carry a change; amber rows do not cover that month&apos;s interest.
        A row where the outstanding balance was restated shows the correction in the
        opening-to-closing movement. &quot;auto&quot; marks a discounting factor solved
        automatically to hold the sanctioned tenure.
      </p>
    </div>
  );
}



