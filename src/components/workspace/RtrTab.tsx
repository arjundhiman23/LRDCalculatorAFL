"use client";

import { useEffect, useState } from "react";
import type { ScheduleRow } from "@/lib/engine/types";
import { Button, Card, DateInput, Field, NumberInput, PercentInput, Spinner } from "../ui";
import { ScheduleTable } from "./ResultsTab";

interface RtrConfig {
  openingBalance: number;
  roi: number;
  cashCover: number;
  startDate: string;
  months: number;
}

/** The "Manual RTR" sheet: run off a manually entered balance against the
 * application's rent stream with its own cash cover and ROI — used for part
 * disbursement / repayment track record scenarios. */
export function RtrTab({ applicationId }: { applicationId: string }) {
  const [config, setConfig] = useState<RtrConfig | null>(null);
  const [schedule, setSchedule] = useState<ScheduleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch(`/api/applications/${applicationId}/manual-rtr`);
      if (!res.ok || cancelled) return;
      const body = await res.json();
      if (cancelled) return;
      setConfig(body.config);
      setSchedule(body.schedule);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [applicationId]);

  async function saveAndCompute() {
    if (!config) return;
    setSaving(true);
    const res = await fetch(`/api/applications/${applicationId}/manual-rtr`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    });
    setSaving(false);
    if (res.ok) {
      const body = await res.json();
      setConfig(body.config);
      setSchedule(body.schedule);
    }
  }

  if (loading || !config) {
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
      <Card title="Manual RTR — run-off of an existing balance">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <Field label="Opening balance">
            <NumberInput
              value={config.openingBalance || null}
              min={0}
              onChange={(v) => setConfig({ ...config, openingBalance: v ?? 0 })}
            />
          </Field>
          <Field label="ROI (annual)">
            <PercentInput
              value={config.roi}
              onChange={(v) => setConfig({ ...config, roi: v })}
            />
          </Field>
          <Field label="Cash cover" hint="Applied to total net rent">
            <NumberInput
              value={config.cashCover}
              min={0}
              step="0.05"
              onChange={(v) => setConfig({ ...config, cashCover: Math.min(1, v ?? 0) })}
            />
          </Field>
          <Field label="Start date">
            <DateInput
              value={config.startDate}
              onChange={(v) => v && setConfig({ ...config, startDate: v })}
            />
          </Field>
          <Field label="Months">
            <NumberInput
              value={config.months}
              min={1}
              onChange={(v) => setConfig({ ...config, months: Math.max(1, Math.round(v ?? 1)) })}
            />
          </Field>
        </div>
        <div className="mt-4">
          <Button onClick={saveAndCompute} disabled={saving || config.openingBalance <= 0}>
            {saving ? "Computing…" : "Save & compute run-off"}
          </Button>
        </div>
      </Card>

      {schedule.length > 0 && (
        <Card title="Run-off schedule">
          <ScheduleTable rows={schedule} />
        </Card>
      )}
    </div>
  );
}
