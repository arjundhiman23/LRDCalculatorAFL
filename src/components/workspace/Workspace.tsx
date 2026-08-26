"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import type { CalculationResult } from "@/lib/engine/types";
import type { ApplicationPayload } from "@/lib/validation";
import { Badge, Button, Spinner } from "../ui";
import { InputsTab } from "./InputsTab";
import { LeaseDetailsTab } from "./LeaseDetailsTab";
import { PostDisbursementTab } from "./PostDisbursementTab";
import { RecoTab } from "./RecoTab";
import { ResultsTab } from "./ResultsTab";
import { RtrTab } from "./RtrTab";

const TABS = [
  { key: "inputs", label: "Inputs" },
  { key: "lease", label: "Lease details" },
  { key: "results", label: "Eligibility results" },
  { key: "postDisbursement", label: "Post disbursement" },
  { key: "reco", label: "Rental break-up & reco" },
  { key: "rtr", label: "Manual RTR" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export function Workspace({
  applicationId,
  initial,
  standardTenures,
}: {
  applicationId: string;
  initial: ApplicationPayload & { id: string; updatedAt: string };
  standardTenures: number[];
}) {
  const [app, setApp] = useState<ApplicationPayload>(initial);
  const [tab, setTab] = useState<TabKey>("inputs");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [calculating, setCalculating] = useState(false);
  const [result, setResult] = useState<CalculationResult | null>(null);
  const [resultStale, setResultStale] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = useCallback((fn: (a: ApplicationPayload) => ApplicationPayload) => {
    setApp((prev) => fn(prev));
    setDirty(true);
    setResultStale(true);
  }, []);

  const save = useCallback(async (): Promise<boolean> => {
    setSaving(true);
    setError(null);
    const res = await fetch(`/api/applications/${applicationId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(app),
    });
    setSaving(false);
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(
        body?.issues?.[0]
          ? `${body.issues[0].path.join(".")}: ${body.issues[0].message}`
          : (body?.error ?? "Save failed"),
      );
      return false;
    }
    setDirty(false);
    return true;
  }, [app, applicationId]);

  const runCalculation = useCallback(async () => {
    setCalculating(true);
    setError(null);
    const saved = await save();
    if (!saved) {
      setCalculating(false);
      return;
    }
    const res = await fetch("/api/calculate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(app),
    });
    setCalculating(false);
    if (res.ok) {
      const body = await res.json();
      setResult(body.result);
      setResultStale(false);
      setTab("results");
    } else {
      const body = await res.json().catch(() => null);
      setError(body?.error ?? "Calculation failed");
    }
  }, [app, save]);

  const totalGross = useMemo(
    () => app.lessees.reduce((s, l) => s + l.grossRent, 0),
    [app.lessees],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <input
            className="w-full max-w-lg truncate rounded-lg border border-transparent bg-transparent px-2 py-1 text-lg font-semibold text-slate-800 hover:border-slate-200 focus:border-blue-500 focus:bg-white focus:outline-none"
            value={app.name}
            onChange={(e) => update((a) => ({ ...a, name: e.target.value }))}
          />
          <div className="mt-0.5 flex items-center gap-2 px-2 text-xs text-slate-400">
            {dirty ? <Badge tone="amber">Unsaved changes</Badge> : <Badge tone="green">Saved</Badge>}
            {result && resultStale && (
              <Badge tone="amber">Results outdated — recalculate</Badge>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={`/api/applications/${applicationId}/export`}
            className="rounded-lg border border-slate-300 bg-white px-4 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Export Excel
          </a>
          <Link
            href={`/applications/${applicationId}/report`}
            className="rounded-lg border border-slate-300 bg-white px-4 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Printable report
          </Link>
          <Button variant="secondary" onClick={save} disabled={saving || !dirty}>
            {saving ? "Saving…" : "Save"}
          </Button>
          <Button onClick={runCalculation} disabled={calculating || totalGross <= 0}>
            {calculating ? (
              <span className="flex items-center gap-2">
                <Spinner /> Calculating…
              </span>
            ) : (
              "Calculate eligibility"
            )}
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="flex gap-1 border-b border-slate-200">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-t-lg px-4 py-2 text-sm font-medium transition-colors ${
              tab === t.key
                ? "border border-b-0 border-slate-200 bg-white text-blue-700"
                : "text-slate-500 hover:text-slate-800"
            }`}
          >
            {t.label}
            {t.key === "results" && result && resultStale && (
              <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-amber-500 align-middle" />
            )}
          </button>
        ))}
      </div>

      {tab === "inputs" && <InputsTab app={app} update={update} />}
      {tab === "lease" && <LeaseDetailsTab app={app} update={update} />}
      {tab === "results" && (
        <ResultsTab
          result={result}
          stale={resultStale}
          standardTenures={standardTenures}
          onCalculate={runCalculation}
          calculating={calculating}
        />
      )}
      {tab === "postDisbursement" && (
        <PostDisbursementTab app={app} update={update} standardTenures={standardTenures} />
      )}
      {tab === "reco" && <RecoTab applicationId={applicationId} app={app} />}
      {tab === "rtr" && <RtrTab app={app} update={update} />}
    </div>
  );
}

