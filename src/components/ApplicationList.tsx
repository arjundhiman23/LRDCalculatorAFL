"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { formatCrore, formatDate } from "@/lib/format";
import { Button, Card } from "./ui";

interface Row {
  id: string;
  name: string;
  lessorName: string;
  updatedAt: string;
  createdBy: string;
  totalGrossRent: number;
  lesseeCount: number;
}

export function ApplicationList({ applications }: { applications: Row[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  async function remove(id: string, name: string) {
    if (!window.confirm(`Delete "${name}"? This cannot be undone.`)) return;
    setDeleting(id);
    await fetch(`/api/applications/${id}`, { method: "DELETE" });
    setDeleting(null);
    router.refresh();
  }

  async function createNew() {
    setBusy(true);
    const res = await fetch("/api/applications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "" }),
    });
    setBusy(false);
    if (res.ok) {
      const { id } = await res.json();
      router.push(`/applications/${id}`);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-slate-800">Applications</h1>
        <Button onClick={createNew} disabled={busy}>
          {busy ? "Creating…" : "+ New application"}
        </Button>
      </div>
      <Card className="overflow-hidden !p-0" >
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
              <th className="px-4 py-2 font-medium">Name</th>
              <th className="px-4 py-2 font-medium">Lessor</th>
              <th className="px-4 py-2 font-medium">Active lessees</th>
              <th className="px-4 py-2 font-medium">Gross rent / month</th>
              <th className="px-4 py-2 font-medium">Updated</th>
              <th className="px-4 py-2 font-medium">By</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {applications.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                  No applications yet. Create one to get started.
                </td>
              </tr>
            )}
            {applications.map((a) => (
              <tr
                key={a.id}
                className="cursor-pointer border-b border-slate-50 hover:bg-blue-50/40"
                onClick={() => router.push(`/applications/${a.id}`)}
              >
                <td className="px-4 py-3 font-medium text-slate-800">{a.name}</td>
                <td className="px-4 py-3 text-slate-500">{a.lessorName || "—"}</td>
                <td className="px-4 py-3 text-slate-500">{a.lesseeCount}</td>
                <td className="px-4 py-3 text-slate-700">{formatCrore(a.totalGrossRent)}</td>
                <td className="px-4 py-3 text-slate-500">{formatDate(a.updatedAt.slice(0, 10))}</td>
                <td className="px-4 py-3 text-slate-500">{a.createdBy}</td>
                <td className="px-4 py-3 text-right">
                  <button
                    className="rounded px-2 py-1 text-xs text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                    disabled={deleting === a.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      remove(a.id, a.name);
                    }}
                  >
                    {deleting === a.id ? "Deleting…" : "Delete"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
