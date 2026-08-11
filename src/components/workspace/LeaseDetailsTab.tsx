"use client";

import type { ApplicationPayload, LesseePayload } from "@/lib/validation";
import { Card, DateInput, Field, NumberInput, TextInput } from "../ui";

const COLUMNS_PER_BLOCK = 5;

/** Mirrors the workbook's "Lease details" sheet: descriptive metadata that
 * appears on the report but does not feed the eligibility math. Lessees are
 * laid out five to a block, wrapping into further blocks below. */
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
      <Card title="Property (applies to all lessees)">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <Field label="Lessor name" hint="Default when a lessee has none of its own">
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
                <tr>
                  <td className="text-slate-500">Lessor name (if specific)</td>
                  {block.map((l) => (
                    <td key={l.position}>
                      <TextInput
                        value={l.lessorName}
                        placeholder={app.lessorName || "Same as property lessor"}
                        onChange={(e) =>
                          setLessee(l.position, { lessorName: e.target.value })
                        }
                      />
                    </td>
                  ))}
                </tr>
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
                <tr>
                  <td className="text-slate-500">Fit-out period</td>
                  {block.map((l) => (
                    <td key={l.position}>
                      <TextInput
                        value={l.fitOutPeriod}
                        onChange={(e) =>
                          setLessee(l.position, { fitOutPeriod: e.target.value })
                        }
                      />
                    </td>
                  ))}
                </tr>
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
                <tr>
                  <td className="text-slate-500">Rent on monthly sales</td>
                  {block.map((l) => (
                    <td key={l.position}>
                      <TextInput
                        value={l.rentOnMonthlySales}
                        onChange={(e) =>
                          setLessee(l.position, { rentOnMonthlySales: e.target.value })
                        }
                      />
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="text-slate-500">Renewal clause</td>
                  {block.map((l) => (
                    <td key={l.position}>
                      <TextInput
                        value={l.renewalClause}
                        onChange={(e) =>
                          setLessee(l.position, { renewalClause: e.target.value })
                        }
                      />
                    </td>
                  ))}
                </tr>
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
                <tr>
                  <td className="text-slate-500">Same lessee occupancy since</td>
                  {block.map((l) => (
                    <td key={l.position}>
                      <TextInput
                        value={l.occupancySince}
                        onChange={(e) =>
                          setLessee(l.position, { occupancySince: e.target.value })
                        }
                      />
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="text-slate-500">
                    GST, taxes & maintenance borne by
                  </td>
                  {block.map((l) => (
                    <td key={l.position}>
                      <TextInput
                        value={l.gstTaxesBorneBy}
                        onChange={(e) =>
                          setLessee(l.position, { gstTaxesBorneBy: e.target.value })
                        }
                      />
                    </td>
                  ))}
                </tr>
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
        These fields describe the lease for the report; the eligibility math uses the
        rentals, deductions and escalations from the Inputs tab. Add or remove lessees
        on the Inputs tab.
      </p>
    </div>
  );
}
