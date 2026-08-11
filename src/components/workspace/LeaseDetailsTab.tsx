"use client";

import type { ApplicationPayload, LesseePayload } from "@/lib/validation";
import { Card, DateInput, Field, NumberInput, TextInput } from "../ui";

/** Mirrors the workbook's "Lease details" sheet: descriptive metadata that
 * appears on the report but does not feed the eligibility math. */
export function LeaseDetailsTab({
  app,
  update,
}: {
  app: ApplicationPayload;
  update: (fn: (a: ApplicationPayload) => ApplicationPayload) => void;
}) {
  const setLessee = (idx: number, patch: Partial<LesseePayload>) =>
    update((a) => ({
      ...a,
      lessees: a.lessees.map((l, i) => (i === idx ? { ...l, ...patch } : l)),
    }));

  return (
    <div className="space-y-4">
      <Card title="Property & lessor">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Field label="Lessor name">
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
          <Field label="GST, taxes & maintenance borne by">
            <TextInput
              value={app.gstTaxesBorneBy}
              onChange={(e) => update((a) => ({ ...a, gstTaxesBorneBy: e.target.value }))}
            />
          </Field>
          <Field label="Address of property">
            <TextInput
              value={app.propertyAddress}
              onChange={(e) => update((a) => ({ ...a, propertyAddress: e.target.value }))}
            />
          </Field>
        </div>
        <div className="mt-3">
          <Field label="Remark">
            <TextInput
              value={app.remark}
              onChange={(e) => update((a) => ({ ...a, remark: e.target.value }))}
            />
          </Field>
        </div>
      </Card>

      <Card title="Per-lessee lease terms">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-400">
                <th className="py-2 pr-3 font-medium">Field</th>
                {app.lessees.map((l) => (
                  <th key={l.position} className="py-2 pr-3 font-medium text-slate-600">
                    {l.name || `Lessee ${l.position}`}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="[&_td]:py-1.5 [&_td]:pr-3 [&_tr]:border-t [&_tr]:border-slate-50">
              <tr>
                <td className="text-slate-500">Agreement date</td>
                {app.lessees.map((l, i) => (
                  <td key={l.position}>
                    <DateInput
                      value={l.agreementDate}
                      onChange={(v) => setLessee(i, { agreementDate: v })}
                    />
                  </td>
                ))}
              </tr>
              <tr>
                <td className="text-slate-500">Fit-out period</td>
                {app.lessees.map((l, i) => (
                  <td key={l.position}>
                    <TextInput
                      value={l.fitOutPeriod}
                      onChange={(e) => setLessee(i, { fitOutPeriod: e.target.value })}
                    />
                  </td>
                ))}
              </tr>
              <tr>
                <td className="text-slate-500">Lease start date</td>
                {app.lessees.map((l, i) => (
                  <td key={l.position}>
                    <DateInput
                      value={l.leaseStartDate}
                      onChange={(v) => setLessee(i, { leaseStartDate: v })}
                    />
                  </td>
                ))}
              </tr>
              <tr>
                <td className="text-slate-500">Lease end date</td>
                {app.lessees.map((l, i) => (
                  <td key={l.position}>
                    <DateInput
                      value={l.leaseEndDate}
                      onChange={(v) => setLessee(i, { leaseEndDate: v })}
                    />
                  </td>
                ))}
              </tr>
              <tr>
                <td className="text-slate-500">Lock-in period (months)</td>
                {app.lessees.map((l, i) => (
                  <td key={l.position}>
                    <NumberInput
                      value={l.lockInMonths}
                      min={0}
                      onChange={(v) =>
                        setLessee(i, { lockInMonths: v === null ? null : Math.round(v) })
                      }
                    />
                  </td>
                ))}
              </tr>
              <tr>
                <td className="text-slate-500">Area (sq.ft)</td>
                {app.lessees.map((l, i) => (
                  <td key={l.position}>
                    <NumberInput
                      value={l.areaSqft}
                      min={0}
                      onChange={(v) => setLessee(i, { areaSqft: v })}
                    />
                  </td>
                ))}
              </tr>
              <tr>
                <td className="text-slate-500">Rent on monthly sales</td>
                {app.lessees.map((l, i) => (
                  <td key={l.position}>
                    <TextInput
                      value={l.rentOnMonthlySales}
                      onChange={(e) => setLessee(i, { rentOnMonthlySales: e.target.value })}
                    />
                  </td>
                ))}
              </tr>
              <tr>
                <td className="text-slate-500">Renewal clause</td>
                {app.lessees.map((l, i) => (
                  <td key={l.position}>
                    <TextInput
                      value={l.renewalClause}
                      onChange={(e) => setLessee(i, { renewalClause: e.target.value })}
                    />
                  </td>
                ))}
              </tr>
              <tr>
                <td className="text-slate-500">Security deposit</td>
                {app.lessees.map((l, i) => (
                  <td key={l.position}>
                    <NumberInput
                      value={l.securityDeposit}
                      min={0}
                      onChange={(v) => setLessee(i, { securityDeposit: v })}
                    />
                  </td>
                ))}
              </tr>
              <tr>
                <td className="text-slate-500">Same lessee occupancy since</td>
                {app.lessees.map((l, i) => (
                  <td key={l.position}>
                    <TextInput
                      value={l.occupancySince}
                      onChange={(e) => setLessee(i, { occupancySince: e.target.value })}
                    />
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-slate-400">
          These fields describe the lease for the report; the eligibility math uses the
          rentals, deductions and escalations from the Inputs tab.
        </p>
      </Card>
    </div>
  );
}
