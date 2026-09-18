"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { formatINR } from "@/lib/format";
import { Spinner } from "./ui";

type Phase = "upload" | "processing" | "done" | "error";

interface FileRow {
  file: File;
  status: "pending" | "done" | "failed";
  lesseeName?: string;
  grossRent?: number;
  error?: string;
}

interface LoiImportModalProps {
  onClose: () => void;
}

export function LoiImportModal({ onClose }: LoiImportModalProps) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  const [phase, setPhase] = useState<Phase>("upload");
  const [rows, setRows] = useState<FileRow[]>([]);
  const [dragging, setDragging] = useState(false);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [createdName, setCreatedName] = useState<string>("");
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [partialErrors, setPartialErrors] = useState<string[]>([]);

  // ─── File selection ───────────────────────────────────────────────────────
  function addFiles(newFiles: File[]) {
    const valid = newFiles.filter((f) =>
      /\.(pdf|zip|jpe?g|png)$/i.test(f.name)
    );
    if (!valid.length) return;
    setRows((prev) => {
      const existing = new Set(prev.map((r) => r.file.name));
      const fresh = valid.filter((f) => !existing.has(f.name));
      return [...prev, ...fresh.map((file) => ({ file, status: "pending" as const }))];
    });
  }

  function removeRow(idx: number) {
    setRows((prev) => prev.filter((_, i) => i !== idx));
  }

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      addFiles(Array.from(e.dataTransfer.files));
    },
    []
  );

  // ─── Submit ───────────────────────────────────────────────────────────────
  async function handleImport() {
    if (!rows.length) return;
    setPhase("processing");
    setGlobalError(null);
    setPartialErrors([]);

    // Mark all pending
    setRows((prev) => prev.map((r) => ({ ...r, status: "pending" as const })));

    const formData = new FormData();
    for (const row of rows) {
      formData.append("files", row.file);
    }

    let res: Response;
    try {
      res = await fetch("/api/import-loi", { method: "POST", body: formData });
    } catch {
      setPhase("error");
      setGlobalError("Network error — could not reach the server.");
      return;
    }

    const body = await res.json().catch(() => null);

    if (!body) {
      setPhase("error");
      setGlobalError("Server returned an unexpected response.");
      return;
    }

    // Hard failure — no application created
    if (res.status === 400 || res.status === 401 || res.status === 500) {
      setPhase("error");
      setGlobalError(body.error ?? "Import failed.");
      // Surface per-file errors if available
      if (Array.isArray(body.errors)) {
        setRows((prev) =>
          prev.map((row) => {
            const err = body.errors.find(
              (e: { fileName: string; error?: string }) => e.fileName === row.file.name
            );
            return err ? { ...row, status: "failed", error: err.error } : row;
          })
        );
      }
      return;
    }

    // Full or partial success (200 / 207)
    const successRows: Array<{ fileName: string; lesseeName?: string; grossRent?: number }> =
      body.lesseesSummary ?? [];
    const errorRows: Array<{ fileName: string; error?: string }> = body.errors ?? [];

    setRows((prev) =>
      prev.map((row) => {
        const ok = successRows.find((s) => s.fileName === row.file.name);
        const err = errorRows.find((e) => e.fileName === row.file.name);
        if (ok)
          return { ...row, status: "done", lesseeName: ok.lesseeName, grossRent: ok.grossRent };
        if (err) return { ...row, status: "failed", error: err.error };
        return row;
      })
    );

    if (errorRows.length) {
      setPartialErrors(
        errorRows.map((e) => `${e.fileName}: ${e.error ?? "extraction failed"}`)
      );
    }

    setCreatedId(body.id);
    setCreatedName(body.name ?? "Imported application");
    setPhase("done");
  }

  // ─── Go to workspace ─────────────────────────────────────────────────────
  function goToWorkspace() {
    if (!createdId) return;
    onClose();
    router.push(`/applications/${createdId}`);
  }

  // ─── Render ───────────────────────────────────────────────────────────────
  const totalRent = rows
    .filter((r) => r.status === "done" && r.grossRent)
    .reduce((s, r) => s + (r.grossRent ?? 0), 0);

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && phase !== "processing") onClose();
      }}
    >
      {/* Panel */}
      <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-slate-800">Import from LOI / Lease Deed</h2>
            <p className="mt-0.5 text-xs text-slate-400">
              One file per lessee — PDF, scanned ZIP, JPEG or PNG
            </p>
          </div>
          {phase !== "processing" && (
            <button
              onClick={onClose}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4">

          {/* ── Upload phase ─────────────────────────────────────────────── */}
          {(phase === "upload" || phase === "processing") && (
            <>
              {/* Drop zone */}
              {phase === "upload" && (
                <div
                  onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={onDrop}
                  onClick={() => inputRef.current?.click()}
                  className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-8 text-center transition-colors ${
                    dragging
                      ? "border-blue-400 bg-blue-50"
                      : "border-slate-200 bg-slate-50 hover:border-blue-300 hover:bg-blue-50/50"
                  }`}
                >
                  <svg className="h-8 w-8 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                      d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                  <p className="text-sm font-medium text-slate-600">
                    Drop LOI files here, or <span className="text-blue-600">browse</span>
                  </p>
                  <p className="text-xs text-slate-400">
                    PDF · ZIP (scanned) · JPEG · PNG &nbsp;·&nbsp; one file = one lessee
                  </p>
                  <input
                    ref={inputRef}
                    type="file"
                    multiple
                    accept=".pdf,.zip,.jpg,.jpeg,.png"
                    className="hidden"
                    onChange={(e) => addFiles(Array.from(e.target.files ?? []))}
                  />
                </div>
              )}

              {/* File list */}
              {rows.length > 0 && (
                <div className="space-y-1.5">
                  {rows.map((row, idx) => (
                    <div
                      key={row.file.name}
                      className="flex items-center gap-3 rounded-lg border border-slate-100 bg-white px-3 py-2 text-sm"
                    >
                      {/* Status icon */}
                      <span className="shrink-0">
                        {phase === "processing" && row.status === "pending" && (
                          <Spinner />
                        )}
                        {row.status === "done" && (
                          <span className="flex h-4 w-4 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
                            <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                            </svg>
                          </span>
                        )}
                        {row.status === "failed" && (
                          <span className="flex h-4 w-4 items-center justify-center rounded-full bg-red-100 text-red-600">
                            <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </span>
                        )}
                        {phase === "upload" && row.status === "pending" && (
                          <span className="h-4 w-4 rounded-full border-2 border-slate-200" />
                        )}
                      </span>

                      {/* File name / extracted info */}
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium text-slate-700">{row.file.name}</p>
                        {row.lesseeName && (
                          <p className="truncate text-xs text-slate-400">
                            {row.lesseeName}
                            {row.grossRent ? ` · ${formatINR(row.grossRent)}/mo` : ""}
                          </p>
                        )}
                        {row.error && (
                          <p className="truncate text-xs text-red-500">{row.error}</p>
                        )}
                      </div>

                      {/* Remove (only in upload phase) */}
                      {phase === "upload" && (
                        <button
                          onClick={() => removeRow(idx)}
                          className="shrink-0 rounded p-0.5 text-slate-300 hover:text-red-400"
                        >
                          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Processing note */}
              {phase === "processing" && (
                <p className="text-center text-xs text-slate-400">
                  Extracting with Claude Vision — this may take 20–40 seconds per file…
                </p>
              )}
            </>
          )}

          {/* ── Done phase ───────────────────────────────────────────────── */}
          {phase === "done" && (
            <>
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-4 text-sm">
                <p className="font-semibold text-emerald-800">Application created!</p>
                <p className="mt-0.5 text-emerald-700 truncate">{createdName}</p>
              </div>

              {/* Per-file summary */}
              <div className="space-y-1.5">
                {rows.map((row) => (
                  <div
                    key={row.file.name}
                    className="flex items-start gap-3 rounded-lg border border-slate-100 bg-white px-3 py-2 text-sm"
                  >
                    <span className="mt-0.5 shrink-0">
                      {row.status === "done" ? (
                        <span className="flex h-4 w-4 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
                          <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                          </svg>
                        </span>
                      ) : (
                        <span className="flex h-4 w-4 items-center justify-center rounded-full bg-amber-100 text-amber-600">
                          <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01" />
                          </svg>
                        </span>
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      {row.lesseeName && (
                        <p className="font-medium text-slate-700">{row.lesseeName}</p>
                      )}
                      <p className="truncate text-xs text-slate-400">
                        {row.file.name}
                        {row.grossRent ? ` · ${formatINR(row.grossRent)}/mo` : ""}
                      </p>
                      {row.error && (
                        <p className="text-xs text-amber-600">{row.error}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Total */}
              {totalRent > 0 && (
                <div className="flex items-center justify-between rounded-lg bg-slate-50 px-4 py-2 text-sm">
                  <span className="text-slate-500">Total gross rent</span>
                  <span className="font-semibold text-slate-800">{formatINR(totalRent)} / month</span>
                </div>
              )}

              {/* Partial error note */}
              {partialErrors.length > 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                  <p className="font-medium mb-1">Some files could not be extracted:</p>
                  {partialErrors.map((e, i) => (
                    <p key={i} className="truncate">{e}</p>
                  ))}
                  <p className="mt-1 text-amber-600">
                    The application was created with the successful extractions. Add the missing lessees manually in the workspace.
                  </p>
                </div>
              )}
            </>
          )}

          {/* ── Error phase ──────────────────────────────────────────────── */}
          {phase === "error" && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-4 text-sm">
              <p className="font-semibold text-red-800">Import failed</p>
              <p className="mt-1 text-red-700">{globalError}</p>
              <button
                onClick={() => { setPhase("upload"); setGlobalError(null); }}
                className="mt-3 text-xs text-red-600 underline hover:text-red-800"
              >
                Try again
              </button>
            </div>
          )}

        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 border-t border-slate-100 px-6 py-4">
          {phase !== "processing" && phase !== "done" && (
            <button
              onClick={onClose}
              className="rounded-lg border border-slate-300 bg-white px-4 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
          )}

          {phase === "upload" && (
            <button
              disabled={!rows.length}
              onClick={handleImport}
              className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:bg-blue-300"
            >
              Extract &amp; Create Application
            </button>
          )}

          {phase === "processing" && (
            <span className="flex items-center gap-2 text-sm text-slate-500">
              <Spinner /> Extracting…
            </span>
          )}

          {phase === "done" && (
            <>
              <button
                onClick={onClose}
                className="rounded-lg border border-slate-300 bg-white px-4 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Close
              </button>
              <button
                onClick={goToWorkspace}
                className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
              >
                Open in workspace →
              </button>
            </>
          )}

          {phase === "error" && (
            <button
              onClick={onClose}
              className="rounded-lg border border-slate-300 bg-white px-4 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
