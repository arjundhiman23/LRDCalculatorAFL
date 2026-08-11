"use client";

import { useState } from "react";
import { netRentAt, rentSteps } from "@/lib/engine/engine";
import { firstDueDate } from "@/lib/engine/dates";
import { formatCrore, formatINR } from "@/lib/format";
import { lesseeToEngineInput } from "@/lib/serialize";
import type { ApplicationPayload, LesseePayload } from "@/lib/validation";
import { defaultManualRtr } from "@/lib/manualRtr";
import { Badge, Card, DateInput, Field, NumberInput, PercentInput, Select, TextInput } from "../ui";

export function InputsTab({
  app,
  update,
}: {
  app: ApplicationPayload;
  update: (fn: (a: ApplicationPayload) => ApplicationPayload) => void;
}) {
  const [activeLessee, setActiveLessee] = useState(0);

  const setLessee = (idx: number, patch: Partial<LesseePayload>) =>
    update((a) => ({
      ...a,
      lessees: a.lessees.map((l, i) => (i === idx ? { ...l, ...patch } : l)),
    }));

  const addLessee = () =>
    update((a) => {
      const position = Math.max(0, ...a.lessees.map((l) => l.position)) + 1;
      const template = a.lessees[a.lessees.length - 1];
      return {
        ...a,
        lessees: [
          ...a.lessees,
          {
            ...template,
            position,
            name: `Lessee ${position}`,
            rating: "",
            lessorName: "",
            grossRent: 0,
            otherDeduction: 0,
            firstEscalationDate: null,
            escalations: [],
            uniqueTenureMonths: null,
            agreementDate: null,
            fitOutPeriod: "",
            leaseStartDate: null,
            leaseEndDate: null,
            lockInMonths: null,
            areaSqft: null,
            rentOnMonthlySales: "",
            renewalClause: "",
            securityDeposit: null,
            occupancySince: "",
            gstTaxesBorneBy: "",
            remark: "",
          },
        ],
      };
    });

  const removeLessee = (idx: number) => {
    const l = app.lessees[idx];
    if (
      !window.confirm(
        `Remove ${l.name || `Lessee ${l.position}`}? Any reconciliation entries for this lessee are deleted when you save.`,
      )
    ) {
      return;
    }
    update((a) => ({ ...a, lessees: a.lessees.filter((_, i) => i !== idx) }));
    setActiveLessee((i) => Math.max(0, Math.min(i, app.lessees.length - 2)));
  };

  const lessee = app.lessees[activeLessee];
  const valuations = [app.valuation1, app.valuation2, app.valuation3].filter(
    (v): v is number => !!v && v > 0,
  );
  const valuationDiff =
    valuations.length >= 2
      ? (Math.max(...valuations) - Math.min(...valuations)) / Math.min(...valuations)
      : null;

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card title="Loan parameters" className="lg:col-span-1">
        <div className="grid grid-cols-2 gap-3">
          <Field label="ROI (annual)">
            <PercentInput
              value={app.roi}
              onChange={(v) => update((a) => ({ ...a, roi: v }))}
            />
          </Field>
          <Field label="Disbursement date">
            <DateInput
              value={app.disbursementDate}
              onChange={(v) =>
                update((a) => ({ ...a, disbursementDate: v ?? a.disbursementDate }))
              }
            />
          </Field>
          <Field label="Due day" hint="As in the Excel: 5th or 15th only">
            <Select
              value={String(app.dueDay)}
              onChange={(v) => update((a) => ({ ...a, dueDay: Number(v) as 5 | 15 }))}
              options={[
                { value: "5", label: "5th of the month" },
                { value: "15", label: "15th of the month" },
              ]}
            />
          </Field>
          <Field label="Moratorium (months)">
            <NumberInput
              value={app.moratoriumMonths}
              min={0}
              onChange={(v) =>
                update((a) => ({ ...a, moratoriumMonths: Math.max(0, Math.round(v ?? 0)) }))
              }
            />
          </Field>
          <Field label="Custom tenure (months)" hint="Evaluated besides 180/144/120">
            <NumberInput
              value={app.customTenure}
              min={1}
              onChange={(v) =>
                update((a) => ({ ...a, customTenure: v ? Math.round(v) : null }))
              }
              placeholder="e.g. 108"
            />
          </Field>
          <Field label="First due date">
            <div className="rounded-lg bg-slate-50 px-3 py-1.5 text-sm text-slate-600">
              {firstDueDate(app.disbursementDate, app.dueDay)}
            </div>
          </Field>
        </div>

        <div className="mt-5 border-t border-slate-100 pt-4">
          <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Valuation (optional)
          </h4>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Valuation 1">
              <NumberInput
                value={app.valuation1}
                min={0}
                onChange={(v) => update((a) => ({ ...a, valuation1: v }))}
              />
            </Field>
            <Field label="Valuation 2">
              <NumberInput
                value={app.valuation2}
                min={0}
                onChange={(v) => update((a) => ({ ...a, valuation2: v }))}
              />
            </Field>
            <Field label="Valuation 3">
              <NumberInput
                value={app.valuation3}
                min={0}
                onChange={(v) => update((a) => ({ ...a, valuation3: v }))}
              />
            </Field>
            <Field label="Final value (for LTV trend)">
              <NumberInput
                value={app.finalPropertyValue}
                min={0}
                onChange={(v) => update((a) => ({ ...a, finalPropertyValue: v }))}
              />
            </Field>
          </div>
          {valuationDiff !== null && (
            <p className="mt-2 text-xs text-slate-500">
              Valuations differ by {(valuationDiff * 100).toFixed(1)}%{" "}
              {valuationDiff > 0.2 && (
                <Badge tone="amber">consider a third valuation</Badge>
              )}
            </p>
          )}
        </div>

        <div className="mt-5 border-t border-slate-100 pt-4">
          <Field label="Offer a different tenure to each lessee (Unique Tenure)">
            <Select
              value={app.uniqueTenureMode ? "yes" : "no"}
              onChange={(v) => update((a) => ({ ...a, uniqueTenureMode: v === "yes" }))}
              options={[
                { value: "no", label: "No" },
                { value: "yes", label: "Yes" },
              ]}
            />
          </Field>
          <p className="mt-1 text-xs text-slate-400">
            When enabled, each lessee&apos;s rent stream supports its own loan with its
            own tenure (set per lessee below); the total is the consolidated
            eligibility.
          </p>
        </div>

        <ManualRtrSection app={app} update={update} />
      </Card>

      <Card
        title={`Lessees & rentals (${app.lessees.length})`}
        className="lg:col-span-2"
        actions={
          <button
            className="text-xs font-medium text-blue-600 hover:text-blue-800"
            onClick={addLessee}
          >
            + Add lessee
          </button>
        }
      >
        <div className="mb-4 flex flex-wrap gap-1">
          {app.lessees.map((l, i) => (
            <button
              key={l.position}
              onClick={() => setActiveLessee(i)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
                i === activeLessee
                  ? "bg-blue-600 text-white"
                  : l.grossRent > 0
                    ? "bg-blue-50 text-blue-700 hover:bg-blue-100"
                    : "bg-slate-100 text-slate-400 hover:bg-slate-200"
              }`}
            >
              {l.name || `Lessee ${l.position}`}
              {l.grossRent > 0 && (
                <span className="ml-1.5 text-[11px] opacity-75">
                  {formatCrore(l.grossRent)}
                </span>
              )}
            </button>
          ))}
        </div>

        {lessee && (
          <LesseeEditor
            key={lessee.position}
            lessee={lessee}
            uniqueTenureMode={app.uniqueTenureMode}
            canRemove={app.lessees.length > 1}
            onRemove={() => removeLessee(activeLessee)}
            onChange={(patch) => setLessee(activeLessee, patch)}
          />
        )}

        <div className="mt-5 rounded-lg bg-slate-50 px-4 py-3 text-sm">
          <span className="text-slate-500">Total across lessees (first month): </span>
          <span className="font-medium text-slate-800">
            gross {formatINR(app.lessees.reduce((s, l) => s + l.grossRent, 0))} · net{" "}
            {formatINR(
              app.lessees.reduce(
                (s, l) =>
                  s +
                  (l.grossRent > 0
                    ? netRentAt(
                        lesseeToEngineInput(l),
                        firstDueDate(app.disbursementDate, app.dueDay),
                      )
                    : 0),
                0,
              ),
            )}
          </span>
        </div>
      </Card>
    </div>
  );
}

/** Manual RTR switch and inputs, available here on the main input sheet as
 * well as on the Manual RTR tab (both edit the same saved configuration). */
export function ManualRtrSection({
  app,
  update,
}: {
  app: ApplicationPayload;
  update: (fn: (a: ApplicationPayload) => ApplicationPayload) => void;
}) {
  const rtr = app.manualRtr ?? defaultManualRtr(app);
  const setRtr = (patch: Partial<typeof rtr>) =>
    update((a) => ({ ...a, manualRtr: { ...(a.manualRtr ?? defaultManualRtr(a)), ...patch } }));

  return (
    <div className="mt-5 border-t border-slate-100 pt-4">
      <Field
        label="Manual RTR (run off an existing balance)"
        hint="For balance transfers and part-disbursement cases"
      >
        <Select
          value={rtr.enabled ? "yes" : "no"}
          onChange={(v) => setRtr({ enabled: v === "yes" })}
          options={[
            { value: "no", label: "No" },
            { value: "yes", label: "Yes" },
          ]}
        />
      </Field>
      {rtr.enabled && (
        <div className="mt-3 grid grid-cols-2 gap-3">
          <Field label="Opening balance">
            <NumberInput
              value={rtr.openingBalance || null}
              min={0}
              onChange={(v) => setRtr({ openingBalance: v ?? 0 })}
            />
          </Field>
          <Field label="ROI (annual)">
            <PercentInput value={rtr.roi} onChange={(v) => setRtr({ roi: v })} />
          </Field>
          <Field label="Discounting factor" hint="Applied to total net rent">
            <NumberInput
              value={rtr.discountFactor}
              min={0}
              step="0.05"
              onChange={(v) => setRtr({ discountFactor: Math.min(1, v ?? 0) })}
            />
          </Field>
          <Field label="Start date">
            <DateInput
              value={rtr.startDate}
              onChange={(v) => v && setRtr({ startDate: v })}
            />
          </Field>
          <Field label="Months">
            <NumberInput
              value={rtr.months}
              min={1}
              onChange={(v) => setRtr({ months: Math.max(1, Math.round(v ?? 1)) })}
            />
          </Field>
        </div>
      )}
    </div>
  );
}

function LesseeEditor({
  lessee,
  uniqueTenureMode,
  canRemove,
  onRemove,
  onChange,
}: {
  lessee: LesseePayload;
  uniqueTenureMode: boolean;
  canRemove: boolean;
  onRemove: () => void;
  onChange: (patch: Partial<LesseePayload>) => void;
}) {
  const escalations = lessee.escalations;

  const setEscalation = (
    idx: number,
    patch: Partial<{
      rate: number;
      monthsAfterPrevious: number;
      discountFactor: number | null;
    }>,
  ) =>
    onChange({
      escalations: escalations.map((e, i) => (i === idx ? { ...e, ...patch } : e)),
    });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Field label="Name">
          <TextInput
            value={lessee.name}
            onChange={(e) => onChange({ name: e.target.value })}
          />
        </Field>
        <Field label="Rating (if available)">
          <TextInput
            value={lessee.rating}
            onChange={(e) => onChange({ rating: e.target.value })}
          />
        </Field>
        <Field label="Current gross rent / month">
          <NumberInput
            value={lessee.grossRent || null}
            min={0}
            onChange={(v) => onChange({ grossRent: v ?? 0 })}
            placeholder="0 = inactive"
          />
        </Field>
        {uniqueTenureMode && (
          <Field label="Tenure for this lessee (months)">
            <NumberInput
              value={lessee.uniqueTenureMonths}
              min={1}
              onChange={(v) =>
                onChange({ uniqueTenureMonths: v ? Math.round(v) : null })
              }
            />
          </Field>
        )}
      </div>

      <div>
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
          Deductions (of gross rent)
        </h4>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <Field label="TDS">
            <PercentInput
              value={lessee.tdsRate}
              onChange={(v) => onChange({ tdsRate: v })}
            />
          </Field>
          <Field label="Property tax">
            <PercentInput
              value={lessee.propertyTaxRate}
              onChange={(v) => onChange({ propertyTaxRate: v })}
            />
          </Field>
          <Field label="Insurance">
            <PercentInput
              value={lessee.insuranceRate}
              onChange={(v) => onChange({ insuranceRate: v })}
            />
          </Field>
          <Field label="Other deduction (₹/month)">
            <NumberInput
              value={lessee.otherDeduction || null}
              min={0}
              onChange={(v) => onChange({ otherDeduction: v ?? 0 })}
            />
          </Field>
          <Field label="Discounting factor" hint="Base cash cover on net rent">
            <NumberInput
              value={lessee.discountFactor}
              min={0}
              step="0.05"
              onChange={(v) => onChange({ discountFactor: Math.min(1, v ?? 0) })}
            />
          </Field>
        </div>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Rent escalations
          </h4>
          <button
            className="text-xs font-medium text-blue-600 hover:text-blue-800"
            onClick={() =>
              onChange({
                escalations: [
                  ...escalations,
                  {
                    rate: escalations[escalations.length - 1]?.rate ?? 0.15,
                    monthsAfterPrevious: 36,
                    discountFactor: null,
                  },
                ],
              })
            }
          >
            + Add escalation
          </button>
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Field label="First escalation date">
            <DateInput
              value={lessee.firstEscalationDate}
              onChange={(v) => onChange({ firstEscalationDate: v })}
            />
          </Field>
        </div>
        {escalations.length === 0 ? (
          <p className="mt-2 text-xs text-slate-400">
            No escalations — rent stays flat for the whole tenure.
          </p>
        ) : (
          <table className="mt-2 w-full max-w-3xl text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-400">
                <th className="py-1 pr-3 font-medium">#</th>
                <th className="py-1 pr-3 font-medium">Escalation %</th>
                <th className="py-1 pr-3 font-medium">Months after previous</th>
                <th className="py-1 pr-3 font-medium">
                  Discounting factor
                  <span className="ml-1 font-normal normal-case text-slate-300">
                    (optional)
                  </span>
                </th>
                <th className="py-1" />
              </tr>
            </thead>
            <tbody>
              {escalations.map((e, i) => (
                <tr key={i}>
                  <td className="py-1 pr-3 text-slate-500">{i + 1}</td>
                  <td className="py-1 pr-3">
                    <PercentInput
                      value={e.rate}
                      onChange={(v) => setEscalation(i, { rate: v })}
                    />
                  </td>
                  <td className="py-1 pr-3">
                    <NumberInput
                      value={e.monthsAfterPrevious}
                      min={0}
                      disabled={i === 0}
                      onChange={(v) =>
                        setEscalation(i, {
                          monthsAfterPrevious: Math.max(0, Math.round(v ?? 0)),
                        })
                      }
                      placeholder={i === 0 ? "uses date above" : ""}
                    />
                  </td>
                  <td className="py-1 pr-3">
                    <NumberInput
                      value={e.discountFactor ?? null}
                      min={0}
                      step="0.05"
                      placeholder="unchanged"
                      onChange={(v) =>
                        setEscalation(i, {
                          discountFactor: v === null ? null : Math.min(1, v),
                        })
                      }
                    />
                  </td>
                  <td className="py-1">
                    <button
                      className="text-xs text-red-500 hover:text-red-700"
                      onClick={() =>
                        onChange({ escalations: escalations.filter((_, j) => j !== i) })
                      }
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="mt-1 text-[11px] text-slate-400">
          Leave the discounting factor blank to carry the previous one forward; set
          it to apply a different cash cover from that escalation date onward.
        </p>
        <EscalationPreview lessee={lessee} />
      </div>

      {canRemove && (
        <div className="border-t border-slate-100 pt-3">
          <button
            className="text-xs font-medium text-red-500 hover:text-red-700"
            onClick={onRemove}
          >
            Remove this lessee
          </button>
        </div>
      )}
    </div>
  );
}

/** Shows the resolved escalation timeline: effective dates and the gross rent
 * from each date onward (events with 0 months collapse onto the same date and
 * compound, exactly like the workbook). */
function EscalationPreview({ lessee }: { lessee: LesseePayload }) {
  if (!lessee.firstEscalationDate || lessee.escalations.length === 0 || lessee.grossRent <= 0) {
    return null;
  }
  const steps = rentSteps(lesseeToEngineInput(lessee));
  // Collapse repeated dates: only the last (fully compounded) rent applies.
  const effective = steps.filter(
    (s, i) => i === steps.length - 1 || steps[i + 1].date !== s.date,
  );
  const varies = effective.some((s) => s.discountFactor !== lessee.discountFactor);
  return (
    <div className="mt-3 rounded-lg bg-slate-50 px-4 py-3 text-xs text-slate-600">
      <span className="font-medium text-slate-500">Resulting rent timeline: </span>
      {formatINR(lessee.grossRent)} now
      {varies && <span className="text-slate-400"> (DF {lessee.discountFactor})</span>}
      {effective.map((s) => (
        <span key={s.date}>
          {" "}
          → {formatINR(s.gross)} from {s.date}
          {varies && <span className="text-slate-400"> (DF {s.discountFactor})</span>}
        </span>
      ))}
      {effective.length < steps.length && (
        <span className="ml-1 text-slate-400">
          (escalations sharing a date compound together, as in the Excel)
        </span>
      )}
    </div>
  );
}
