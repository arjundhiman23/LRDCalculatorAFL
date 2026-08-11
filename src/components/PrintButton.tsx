"use client";

export function PrintButton() {
  return (
    <button
      className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
      onClick={() => window.print()}
    >
      Print / Save as PDF
    </button>
  );
}
