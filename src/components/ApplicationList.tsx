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
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editLessor, setEditLessor] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  async function remove(id: string, name: string) {
    if (!window.confirm(`Delete "${name}"? This cannot be undone.`)) return;
    setDeleting(id);
    await fetch(`/api/applications/${id}`, { method: "DELETE" });
    setDeleting(null);
    router.refresh();
  }

  function startEdit(a: Row) {
    setEditingId(a.id);
    setEditName(a.name);
    setEditLessor(a.lessorName);
  }

  async function saveEdit() {
    if (!editingId || !editName.trim()) return;
    setSavingEdit(true);
    await fetch(`/api/applications/${editingId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: editName.trim(), lessorName: editLessor.trim() }),
    });
    setSavingEdit(false);
    setEditingId(null);
    router.refresh();
  }

  async function createNew() {
    const name = window.prompt(
      "Name for the new application (e.g. borrower / property):",
      "",
    );
    if (name === null) return; // cancelled
    setBusy(true);
    const res = await fetch("/api/applications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    setBusy(false);
    if (res.ok) {
      const { id } = await res.json();
      router.push(`/applications/${id}`);
    }
  }

  const inputCls =
    "w-full rounded-lg border border-blue-300 bg-white px-2 py-1 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-slate-800">Applications</h1>
        <Button onClick={createNew} disabled={busy}>
          {busy ? "Creating…" : "+ New application"}
        </Button>
      </div>
      <Card className="overflow-hidden !p-0">
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
            {applications.map((a) => {
              const isEditing = editingId === a.id;
              return (
                <tr
                  key={a.id}
                  className={`border-b border-slate-50 ${
                    isEditing ? "bg-blue-50/40" : "cursor-pointer hover:bg-blue-50/40"
                  }`}
                  onClick={() => !isEditing && router.push(`/applications/${a.id}`)}
                >
                  <td className="px-4 py-3 font-medium text-slate-800">
                    {isEditing ? (
                      <input
                        className={inputCls}
                        value={editName}
                        autoFocus
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveEdit();
                          if (e.key === "Escape") setEditingId(null);
                        }}
                      />
                    ) : (
                      a.name
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-500">
                    {isEditing ? (
                      <input
                        className={inputCls}
                        value={editLessor}
                        placeholder="Lessor name"
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => setEditLessor(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveEdit();
                          if (e.key === "Escape") setEditingId(null);
                        }}
                      />
                    ) : (
                      a.lessorName || "—"
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-500">{a.lesseeCount}</td>
                  <td className="px-4 py-3 text-slate-700">{formatCrore(a.totalGrossRent)}</td>
                  <td className="px-4 py-3 text-slate-500">
                    {formatDate(a.updatedAt.slice(0, 10))}
                  </td>
                  <td className="px-4 py-3 text-slate-500">{a.createdBy}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    {isEditing ? (
                      <>
                        <button
                          className="rounded px-2 py-1 text-xs font-medium text-blue-600 hover:bg-blue-100 disabled:opacity-50"
                          disabled={savingEdit || !editName.trim()}
                          onClick={(e) => {
                            e.stopPropagation();
                            saveEdit();
                          }}
                        >
                          {savingEdit ? "Saving…" : "Save"}
                        </button>
                        <button
                          className="rounded px-2 py-1 text-xs text-slate-400 hover:bg-slate-100"
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingId(null);
                          }}
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          className="rounded px-2 py-1 text-xs text-slate-400 hover:bg-blue-50 hover:text-blue-600"
                          onClick={(e) => {
                            e.stopPropagation();
                            startEdit(a);
                          }}
                        >
                          Edit
                        </button>
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
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
