"use client";

import { formatINR, formatINR2 } from "@/lib/format";
import type { ApplicationPayload, LesseePayload } from "@/lib/validation";
import { Card, DateInput, Field, NumberInput, TextInput } from "../ui";

const COLUMNS_PER_BLOCK = 5;

// ─── Computed helpers ────────────────────────────────────────────────────────

/** Calendar-month difference from `from` (YYYY-MM-DD) to `to`. */
function monthsBetween(from: string | null, to: string | null): number | null {
  if (!from || !to) return null;
  const f = new Date(from + "T00:00:00Z");
  const t = new Date(to + "T00:00:00Z");
  return Math.max(0, (t.getFullYear() - f.getFullYear()) * 12 + (t.getMonth() - f.getMonth()));
}

/** Human-readable escalation summary from the Inputs-tab escalations array. */
function escalationLabel(
  escalations: Array<{ rate: number; monthsAfterPrevious: number }>
): string {
  if (!escalations.length) return "—";
  if (escalations.length === 1) {
    const e = escalations[0];
    return `${(e.rate * 100).toFixed(1)}% every ${e.monthsAfterPrevious} months`;
  }
  let cumulative = 0;
  return escalations
    .map((e) => {
      cumulative += e.monthsAfterPrevious;
      return `${(e.rate * 100).toFixed(1)}% at month ${cumulative}`;
    })
    .join(", ");
}

// ─── Shared display cell (read-only computed values) ─────────────────────────

function Display({
  value,
  className = "",
}: {
  value: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-lg bg-slate-50 px-3 py-1.5 text-sm text-slate-600 ${className}`}
    >
      {value ?? "—"}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function LeaseDetailsTab({
  app,
  update,
}: {
  app: ApplicationPayload;
  update: (fn: (a: ApplicationPayload) => ApplicationPayload) => void;
}) {
  const setLessee = (position: number, patch: Partial<LesseePayload>) =>
    update((a) => ({
      ...a,
      lessees: a.lessees.map((l) => (l.position === position ? { ...l, ...patch } : l)),
    }));

  const blocks: LesseePayload[][] = [];
  for (let i = 0; i < app.lessees.length; i += COLUMNS_PER_BLOCK) {
    blocks.push(app.lessees.slice(i, i + COLUMNS_PER_BLOCK));
  }

  return (
    <div className="space-y-4">
      {/* ── Application-level property fields ───────────────────────────── */}
      <Card title="Property (applies to all lessees)">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <Field label="Lessor name" hint="Default when a lessee has no specific lessor">
            <TextInput
              value={app.lessorName}
              onChange={(e) => update((a) => ({ ...a, lessorName: e.target.value }))}
            />
          </Field>
          <Field label="Agreement type">
            <TextInput
              value={app.agreementType}
              onChange={(e) => update((a) => ({ ...a, agreementType: e.target.value }))}
            />
          </Field>
          <Field label="Address of property">
            <TextInput
              value={app.propertyAddress}
              onChange={(e) => update((a) => ({ ...a, propertyAddress: e.target.value }))}
            />
          </Field>
        </div>
      </Card>

      {/* ── Per-lessee table blocks ──────────────────────────────────────── */}
      {blocks.map((block, blockIndex) => (
        <Card
          key={blockIndex}
          title={
            blocks.length > 1
              ? `Lease terms — lessees ${blockIndex * COLUMNS_PER_BLOCK + 1}–${
                  blockIndex * COLUMNS_PER_BLOCK + block.length
                }`
              : "Per-lessee lease terms"
          }
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-400">
                  <th className="w-56 py-2 pr-3 font-medium">Field</th>
                  {block.map((l) => (
                    <th key={l.position} className="py-2 pr-3 font-medium text-slate-600">
                      {l.name || `Lessee ${l.position}`}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="[&_td]:py-1.5 [&_td]:pr-3 [&_tr]:border-t [&_tr]:border-slate-50">

                {/* 1. Lessor Name — per-lessee override */}
                <tr>
                  <td className="text-slate-500">Lessor name</td>
                  {block.map((l) => (
                    <td key={l.position}>
                      <TextInput
                        value={l.lessorName}
                        placeholder={app.lessorName || "Same as property lessor"}
                        onChange={(e) => setLessee(l.position, { lessorName: e.target.value })}
                      />
                    </td>
                  ))}
                </tr>

                {/* 2. Lessee Name */}
                <tr>
                  <td className="text-slate-500">Lessee name</td>
                  {block.map((l) => (
                    <td key={l.position}>
                      <TextInput
                        value={l.name}
                        onChange={(e) => setLessee(l.position, { name: e.target.value })}
                      />
                    </td>
                  ))}
                </tr>

                {/* 3. Lessee Rating */}
                <tr>
                  <td className="text-slate-500">Lessee rating</td>
                  {block.map((l) => (
                    <td key={l.position}>
                      <TextInput
                        value={l.rating}
                        placeholder="e.g. BBB+"
                        onChange={(e) => setLessee(l.position, { rating: e.target.value })}
                      />
                    </td>
                  ))}
                </tr>

                {/* 4. Agreement Date */}
                <tr>
                  <td className="text-slate-500">Agreement date</td>
                  {block.map((l) => (
                    <td key={l.position}>
                      <DateInput
                        value={l.agreementDate}
                        onChange={(v) => setLessee(l.position, { agreementDate: v })}
                      />
                    </td>
                  ))}
                </tr>

                {/* 5. Agreement Type — application-level, display only */}
                <tr>
                  <td className="text-slate-500">Agreement type</td>
                  {block.map((l) => (
                    <td key={l.position}>
                      <Display value={app.agreementType || "—"} />
                    </td>
                  ))}
                </tr>

                {/* 6. Address of Property — application-level, display only */}
                <tr>
                  <td className="text-slate-500">Address of property</td>
                  {block.map((l) => (
                    <td key={l.position}>
                      <Display value={app.propertyAddress || "—"} />
                    </td>
                  ))}
                </tr>

                {/* 7. Fit-out Period */}
                <tr>
                  <td className="text-slate-500">Fit-out period</td>
                  {block.map((l) => (
                    <td key={l.position}>
                      <TextInput
                        value={l.fitOutPeriod}
                        placeholder="e.g. 30 days"
                        onChange={(e) => setLessee(l.position, { fitOutPeriod: e.target.value })}
                      />
                    </td>
                  ))}
                </tr>

                {/* 8. Lease Start Date */}
                <tr>
                  <td className="text-slate-500">Lease start date</td>
                  {block.map((l) => (
                    <td key={l.position}>
                      <DateInput
                        value={l.leaseStartDate}
                        onChange={(v) => setLessee(l.position, { leaseStartDate: v })}
                      />
                    </td>
                  ))}
                </tr>

                {/* 9. Lease End Date */}
                <tr>
                  <td className="text-slate-500">Lease end date</td>
                  {block.map((l) => (
                    <td key={l.position}>
                      <DateInput
                        value={l.leaseEndDate}
                        onChange={(v) => setLessee(l.position, { leaseEndDate: v })}
                      />
                    </td>
                  ))}
                </tr>

                {/* 10. Tenure (Months) — lease contract tenure from LOI */}
                <tr>
                  <td className="text-slate-500">Tenure (months)</td>
                  {block.map((l) => (
                    <td key={l.position}>
                      <NumberInput
                        value={l.uniqueTenureMonths}
                        min={1}
                        placeholder="e.g. 108"
                        onChange={(v) =>
                          setLessee(l.position, {
                            uniqueTenureMonths: v === null ? null : Math.round(v),
                          })
                        }
                      />
                    </td>
                  ))}
                </tr>

                {/* 11. Residual Tenure (Months) — computed from disbursement → lease end */}
                <tr>
                  <td className="text-slate-500">
                    Residual tenure (months)
                    <span className="ml-1 text-[10px] text-slate-300">from disbursement</span>
                  </td>
                  {block.map((l) => {
                    const m = monthsBetween(app.disbursementDate, l.leaseEndDate);
                    return (
                      <td key={l.position}>
                        <Display
                          value={m !== null ? String(m) : "—"}
                          className={
                            m !== null && m < 12
                              ? "bg-amber-50 text-amber-700"
                              : ""
                          }
                        />
                      </td>
                    );
                  })}
                </tr>

                {/* 12. Lock-in Period (Months) */}
                <tr>
                  <td className="text-slate-500">Lock-in period (months)</td>
                  {block.map((l) => (
                    <td key={l.position}>
                      <NumberInput
                        value={l.lockInMonths}
                        min={0}
                        onChange={(v) =>
                          setLessee(l.position, {
                            lockInMonths: v === null ? null : Math.round(v),
                          })
                        }
                      />
                    </td>
                  ))}
                </tr>

                {/* 13. Current Rent (Gross) — from Inputs tab, display only */}
                <tr>
                  <td className="text-slate-500">
                    Current rent (gross)
                    <span className="ml-1 text-[10px] text-slate-300">set in Inputs</span>
                  </td>
                  {block.map((l) => (
                    <td key={l.position}>
                      <Display value={l.grossRent > 0 ? formatINR(l.grossRent) : "—"} />
                    </td>
                  ))}
                </tr>

                {/* 14. Area (sq.ft) */}
                <tr>
                  <td className="text-slate-500">Area (sq.ft)</td>
                  {block.map((l) => (
                    <td key={l.position}>
                      <NumberInput
                        value={l.areaSqft}
                        min={0}
                        onChange={(v) => setLessee(l.position, { areaSqft: v })}
                      />
                    </td>
                  ))}
                </tr>

                {/* 15. Rent on Monthly Sales */}
                <tr>
                  <td className="text-slate-500">Rent on monthly sales</td>
                  {block.map((l) => (
                    <td key={l.position}>
                      <TextInput
                        value={l.rentOnMonthlySales}
                        placeholder="e.g. 5% of monthly sales"
                        onChange={(e) =>
                          setLessee(l.position, { rentOnMonthlySales: e.target.value })
                        }
                      />
                    </td>
                  ))}
                </tr>

                {/* 16. Rental Per sq.ft — computed */}
                <tr>
                  <td className="text-slate-500">Rental per sq.ft</td>
                  {block.map((l) => {
                    const perSqft =
                      l.areaSqft && l.areaSqft > 0
                        ? l.grossRent / l.areaSqft
                        : null;
                    return (
                      <td key={l.position}>
                        <Display
                          value={perSqft !== null ? formatINR2(perSqft) : "—"}
                        />
                      </td>
                    );
                  })}
                </tr>

                {/* 17. Renewal Clause */}
                <tr>
                  <td className="text-slate-500">Renewal clause</td>
                  {block.map((l) => (
                    <td key={l.position}>
                      <TextInput
                        value={l.renewalClause}
                        placeholder="e.g. Auto-renew for 5 years"
                        onChange={(e) =>
                          setLessee(l.position, { renewalClause: e.target.value })
                        }
                      />
                    </td>
                  ))}
                </tr>

                {/* 18. Escalation — computed display from Inputs tab escalations */}
                <tr>
                  <td className="text-slate-500">
                    Escalation
                    <span className="ml-1 text-[10px] text-slate-300">set in Inputs</span>
                  </td>
                  {block.map((l) => (
                    <td key={l.position}>
                      <Display value={escalationLabel(l.escalations)} />
                    </td>
                  ))}
                </tr>

                {/* 19. Security Deposit */}
                <tr>
                  <td className="text-slate-500">Security deposit</td>
                  {block.map((l) => (
                    <td key={l.position}>
                      <NumberInput
                        value={l.securityDeposit}
                        min={0}
                        onChange={(v) => setLessee(l.position, { securityDeposit: v })}
                      />
                    </td>
                  ))}
                </tr>

                {/* 20. GST, Taxes & Maintenance borne by */}
                <tr>
                  <td className="text-slate-500">GST, taxes &amp; maintenance borne by</td>
                  {block.map((l) => (
                    <td key={l.position}>
                      <TextInput
                        value={l.gstTaxesBorneBy}
                        placeholder="e.g. Lessee"
                        onChange={(e) =>
                          setLessee(l.position, { gstTaxesBorneBy: e.target.value })
                        }
                      />
                    </td>
                  ))}
                </tr>

                {/* 21. Same Lessee Occupancy Since */}
                <tr>
                  <td className="text-slate-500">Same lessee occupancy since</td>
                  {block.map((l) => (
                    <td key={l.position}>
                      <TextInput
                        value={l.occupancySince}
                        placeholder="e.g. Jan 2020"
                        onChange={(e) =>
                          setLessee(l.position, { occupancySince: e.target.value })
                        }
                      />
                    </td>
                  ))}
                </tr>

                {/* 22. Remark */}
                <tr>
                  <td className="text-slate-500">Remark</td>
                  {block.map((l) => (
                    <td key={l.position}>
                      <TextInput
                        value={l.remark}
                        onChange={(e) => setLessee(l.position, { remark: e.target.value })}
                      />
                    </td>
                  ))}
                </tr>

              </tbody>
            </table>
          </div>
        </Card>
      ))}

      <p className="text-xs text-slate-400">
        Computed fields (residual tenure, rental/sq.ft, current rent, escalation) update
        automatically from the Inputs tab. Agreement type and property address are shared
        across all lessees and edited in the card above.
      </p>
    </div>
  );
}
