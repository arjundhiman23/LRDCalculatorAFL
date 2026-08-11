"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { edate, firstDueDate } from "@/lib/engine/dates";
import { netRentAt } from "@/lib/engine/engine";
import { formatINR, formatPct } from "@/lib/format";
import { lesseeToEngineInput } from "@/lib/serialize";
import type { ApplicationPayload } from "@/lib/validation";
import { Button, Card, NumberInput, Select, Spinner, TextInput } from "../ui";

interface LesseeRef {
  id: string;
  position: number;
  name: string;
}

interface Entry {
  lesseeId: string;
  dueDate: string;
  actualCredit: number;
  bankAccount: string;
}

/** The "Rental break up & reco" sheet: contribution table plus a grid of
 * expected vs actual monthly rent credits per lessee. */
export function RecoTab({
  applicationId,
  app,
}: {
  applicationId: string;
  app: ApplicationPayload;
}) {
  const [lessees, setLessees] = useState<LesseeRef[]>([]);
  const [entries, setEntries] = useState<Record<string, Entry>>({});
  const [bankAccounts, setBankAccounts] = useState<Record<string, string>>({});
  const [monthsShown, setMonthsShown] = useState("12");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch(`/api/applications/${applicationId}/reconciliation`);
      if (!res.ok || cancelled) return;
      const body = await res.json();
      if (cancelled) return;
      setLessees(body.lessees);
      const map: Record<string, Entry> = {};
      const banks: Record<string, string> = {};
      for (const e of body.entries as Entry[]) {
        map[`${e.lesseeId}|${e.dueDate}`] = e;
        if (e.bankAccount) banks[e.lesseeId] = e.bankAccount;
      }
      setEntries(map);
      setBankAccounts(banks);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [applicationId]);

  const activeLessees = useMemo(() => {
    const byPosition = new Map(app.lessees.map((l) => [l.position, l]));
    return lessees
      .filter((l) => (byPosition.get(l.position)?.grossRent ?? 0) > 0)
      .map((l) => ({
        ...l,
        payload: byPosition.get(l.position)!,
      }));
  }, [lessees, app.lessees]);

  const dueDates = useMemo(() => {
    const d0 = firstDueDate(app.disbursementDate, app.dueDay);
    return Array.from({ length: Number(monthsShown) }, (_, i) =>
      i === 0 ? d0 : edate(d0, i),
    );
  }, [app.disbursementDate, app.dueDay, monthsShown]);

  const totalGross = app.lessees.reduce((s, l) => s + l.grossRent, 0);

  const setActual = useCallback(
    (lesseeId: string, dueDate: string, actual: number | null) => {
      setEntries((prev) => ({
        ...prev,
        [`${lesseeId}|${dueDate}`]: {
          lesseeId,
          dueDate,
          actualCredit: actual ?? 0,
          bankAccount: bankAccounts[lesseeId] ?? "",
        },
      }));
      setDirty(true);
    },
    [bankAccounts],
  );

  async function save() {
    setSaving(true);
    await fetch(`/api/applications/${applicationId}/reconciliation`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        entries: Object.values(entries).map((e) => ({
          ...e,
          bankAccount: bankAccounts[e.lesseeId] ?? "",
        })),
      }),
    });
    setSaving(false);
    setDirty(false);
  }

  if (loading) {
    return (
      <Card>
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card title="Lessee-wise rental break-up (current month)">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
              <th className="py-1.5 pr-3 font-medium">Lessee</th>
              <th className="py-1.5 pr-3 text-right font-medium">Gross rent</th>
              <th className="py-1.5 pr-3 text-right font-medium">
                To credit (gross + 18% GST − TDS)
              </th>
              <th className="py-1.5 pr-3 text-right font-medium">Net excl. GST</th>
              <th className="py-1.5 text-right font-medium">Contribution</th>
            </tr>
          </thead>
          <tbody>
            {app.lessees
              .filter((l) => l.grossRent > 0)
              .map((l) => (
                <tr key={l.position} className="border-t border-slate-50">
                  <td className="py-2 pr-3 font-medium text-slate-700">
                    {l.name || `Lessee ${l.position}`}
                  </td>
                  <td className="py-2 pr-3 text-right">{formatINR(l.grossRent)}</td>
                  <td className="py-2 pr-3 text-right">
                    {formatINR(l.grossRent * 1.18 - l.grossRent * l.tdsRate)}
                  </td>
                  <td className="py-2 pr-3 text-right">
                    {formatINR(l.grossRent * (1 - l.tdsRate))}
                  </td>
                  <td className="py-2 text-right">
                    {totalGross > 0 ? formatPct(l.grossRent / totalGross, 1) : "—"}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </Card>

      <Card
        title="Rental credit reconciliation (expected vs actual)"
        actions={
          <div className="flex items-center gap-2">
            <div className="w-36">
              <Select
                value={monthsShown}
                onChange={setMonthsShown}
                options={[
                  { value: "12", label: "12 months" },
                  { value: "24", label: "24 months" },
                  { value: "36", label: "36 months" },
                ]}
              />
            </div>
            <Button onClick={save} disabled={saving || !dirty}>
              {saving ? "Saving…" : "Save credits"}
            </Button>
          </div>
        }
      >
        {activeLessees.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-400">
            No active lessees (set a gross rent on the Inputs tab first).
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-xs">
              <thead>
                <tr className="text-left uppercase tracking-wide text-slate-400">
                  <th className="px-2 py-2 font-medium">Due date</th>
                  {activeLessees.map((l) => (
                    <th key={l.id} colSpan={3} className="px-2 py-2 font-medium">
                      {l.name || `Lessee ${l.position}`}
                      <div className="mt-1 w-48 font-normal normal-case">
                        <TextInput
                          placeholder="Bank a/c"
                          value={bankAccounts[l.id] ?? ""}
                          onChange={(e) => {
                            setBankAccounts((prev) => ({
                              ...prev,
                              [l.id]: e.target.value,
                            }));
                            setDirty(true);
                          }}
                        />
                      </div>
                    </th>
                  ))}
                </tr>
                <tr className="text-left text-slate-400">
                  <th className="px-2 py-1" />
                  {activeLessees.map((l) => (
                    <FragmentHeader key={l.id} />
                  ))}
                </tr>
              </thead>
              <tbody>
                {dueDates.map((d) => (
                  <tr key={d} className="border-t border-slate-50">
                    <td className="px-2 py-1.5 text-slate-500">{d}</td>
                    {activeLessees.map((l) => {
                      const expected =
                        netRentAt(lesseeToEngineInput(l.payload), d);
                      const entry = entries[`${l.id}|${d}`];
                      const actual = entry?.actualCredit ?? null;
                      const diff = actual === null ? null : actual - expected;
                      return (
                        <Cells
                          key={l.id}
                          expected={expected}
                          actual={actual}
                          diff={diff}
                          onChange={(v) => setActual(l.id, d, v)}
                        />
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs text-slate-400">
          Expected = net rental (gross − deductions) for that due date, including
          escalations. Enter the actual escrow credit to track shortfalls.
        </p>
      </Card>
    </div>
  );
}

function FragmentHeader() {
  return (
    <>
      <th className="px-2 py-1 text-right font-medium">Expected</th>
      <th className="px-2 py-1 text-right font-medium">Actual</th>
      <th className="px-2 py-1 text-right font-medium">Diff</th>
    </>
  );
}

function Cells({
  expected,
  actual,
  diff,
  onChange,
}: {
  expected: number;
  actual: number | null;
  diff: number | null;
  onChange: (v: number | null) => void;
}) {
  return (
    <>
      <td className="px-2 py-1.5 text-right text-slate-600">{formatINR(expected)}</td>
      <td className="px-2 py-1.5">
        <div className="ml-auto w-28">
          <NumberInput value={actual} min={0} onChange={onChange} />
        </div>
      </td>
      <td
        className={`px-2 py-1.5 text-right font-medium ${
          diff === null ? "text-slate-300" : diff < 0 ? "text-red-600" : "text-emerald-600"
        }`}
      >
        {diff === null ? "—" : formatINR(diff)}
      </td>
    </>
  );
}
