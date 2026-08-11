"use client";

import { useEffect, useMemo, useState } from "react";
import type { ScheduleRow } from "@/lib/engine/types";
import { formatDate, formatINR } from "@/lib/format";
import type { ApplicationPayload } from "@/lib/validation";
import { Badge, Card, Spinner } from "../ui";
import { ManualRtrSection } from "./InputsTab";
import { ScheduleTable } from "./ResultsTab";

/** The "Manual RTR" sheet: run off a manually entered balance against the
 * application's rent stream with its own discounting factor and ROI — used for
 * part disbursement / repayment track record scenarios. The configuration is
 * the same one shown on the Inputs tab. */
export function RtrTab({
  app,
  update,
}: {
  app: ApplicationPayload;
  update: (fn: (a: ApplicationPayload) => ApplicationPayload) => void;
}) {
  const [schedule, setSchedule] = useState<ScheduleRow[]>([]);
  const [payoff, setPayoff] = useState<{ monthIndex: number; dueDate: string } | null>(
    null,
  );
  const [loading, setLoading] = useState(true);

  const enabled = app.manualRtr?.enabled ?? false;
  // Recompute whenever anything the run-off depends on changes.
  const inputsKey = useMemo(
    () =>
      JSON.stringify([
        app.manualRtr,
        app.dueDay,
        app.lessees.map((l) => [
          l.grossRent,
          l.tdsRate,
          l.propertyTaxRate,
          l.insuranceRate,
          l.otherDeduction,
          l.firstEscalationDate,
          l.escalations,
        ]),
      ]),
    [app.manualRtr, app.dueDay, app.lessees],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch("/api/manual-rtr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(app),
      });
      if (cancelled) return;
      if (res.ok) {
        const body = await res.json();
        setSchedule(body.schedule);
        setPayoff(body.payoff);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
    // `app` is intentionally read fresh inside; only the inputs key triggers a refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputsKey]);

  return (
    <div className="space-y-4">
      <Card title="Manual RTR — run-off of an existing balance">
        <ManualRtrSection app={app} update={update} />
        {enabled && (
          <p className="mt-3 text-xs text-slate-400">
            The run-off below updates as you edit. These same fields are also on the
            Inputs tab.
          </p>
        )}
      </Card>

      {loading && (
        <Card>
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        </Card>
      )}

      {!loading && enabled && schedule.length > 0 && (
        <Card
          title="Run-off schedule"
          actions={
            payoff ? (
              <Badge tone="green">
                Repaid at month {payoff.monthIndex} ({formatDate(payoff.dueDate)})
              </Badge>
            ) : (
              <Badge tone="amber">
                {formatINR(schedule[schedule.length - 1].closingBalance)} outstanding at
                the end of the horizon
              </Badge>
            )
          }
        >
          <ScheduleTable rows={payoff ? schedule.filter((r) => r.monthIndex <= payoff.monthIndex) : schedule} />
        </Card>
      )}

      {!loading && enabled && schedule.length === 0 && (
        <Card>
          <p className="py-6 text-center text-sm text-slate-400">
            Enter an opening balance above (and at least one lessee with rent) to see
            the run-off.
          </p>
        </Card>
      )}

      {!enabled && (
        <Card>
          <p className="py-6 text-center text-sm text-slate-400">
            Manual RTR is switched off. Set it to “Yes” above (or on the Inputs tab) to
            run off an existing balance.
          </p>
        </Card>
      )}
    </div>
  );
}
