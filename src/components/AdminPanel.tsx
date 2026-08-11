"use client";

import { useState } from "react";
import { Badge, Button, Card, Field, PercentInput, Select, TextInput } from "./ui";

interface SettingsData {
  defaultRoi: number;
  defaultCashCover: number;
  defaultTdsRate: number;
  defaultDueDay: 5 | 15;
  standardTenures: number[];
}

interface UserRow {
  id: string;
  email: string;
  name: string;
  role: string;
}

export function AdminPanel({
  initialSettings,
  initialUsers,
}: {
  initialSettings: SettingsData;
  initialUsers: UserRow[];
}) {
  const [settings, setSettings] = useState(initialSettings);
  const [tenuresText, setTenuresText] = useState(initialSettings.standardTenures.join(", "));
  const [users, setUsers] = useState(initialUsers);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const [newUser, setNewUser] = useState({ email: "", name: "", password: "", role: "RM" });
  const [creating, setCreating] = useState(false);
  const [userError, setUserError] = useState<string | null>(null);

  async function saveSettings() {
    const tenures = tenuresText
      .split(",")
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isInteger(n) && n > 0);
    setSaving(true);
    setMessage(null);
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...settings, standardTenures: tenures }),
    });
    setSaving(false);
    setMessage(res.ok ? "Settings saved." : "Save failed.");
    if (res.ok) setSettings((s) => ({ ...s, standardTenures: tenures }));
  }

  async function createUser() {
    setCreating(true);
    setUserError(null);
    const res = await fetch("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newUser),
    });
    setCreating(false);
    if (res.ok) {
      const { user } = await res.json();
      setUsers((u) => [...u, user]);
      setNewUser({ email: "", name: "", password: "", role: "RM" });
    } else {
      const body = await res.json().catch(() => null);
      setUserError(body?.error ?? body?.issues?.[0]?.message ?? "Failed to create user");
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Product defaults (applied to new applications)">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Default ROI">
            <PercentInput
              value={settings.defaultRoi}
              onChange={(v) => setSettings({ ...settings, defaultRoi: v })}
            />
          </Field>
          <Field label="Default TDS">
            <PercentInput
              value={settings.defaultTdsRate}
              onChange={(v) => setSettings({ ...settings, defaultTdsRate: v })}
            />
          </Field>
          <Field label="Default cash cover">
            <PercentInput
              value={settings.defaultCashCover}
              onChange={(v) => setSettings({ ...settings, defaultCashCover: v })}
            />
          </Field>
          <Field label="Default due day">
            <Select
              value={String(settings.defaultDueDay)}
              onChange={(v) =>
                setSettings({ ...settings, defaultDueDay: Number(v) as 5 | 15 })
              }
              options={[
                { value: "5", label: "5th" },
                { value: "15", label: "15th" },
              ]}
            />
          </Field>
        </div>
        <div className="mt-3">
          <Field
            label="Standard tenures (months, comma-separated)"
            hint="Each is evaluated on every calculation, like the workbook's 180/144/120 sheets"
          >
            <TextInput
              value={tenuresText}
              onChange={(e) => setTenuresText(e.target.value)}
            />
          </Field>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <Button onClick={saveSettings} disabled={saving}>
            {saving ? "Saving…" : "Save settings"}
          </Button>
          {message && <span className="text-sm text-slate-500">{message}</span>}
        </div>
      </Card>

      <Card title="Users">
        <table className="mb-4 w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
              <th className="py-1.5 pr-3 font-medium">Name</th>
              <th className="py-1.5 pr-3 font-medium">Email</th>
              <th className="py-1.5 font-medium">Role</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-t border-slate-50">
                <td className="py-2 pr-3 text-slate-700">{u.name}</td>
                <td className="py-2 pr-3 text-slate-500">{u.email}</td>
                <td className="py-2">
                  <Badge tone={u.role === "ADMIN" ? "blue" : "slate"}>{u.role}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
          Add user
        </h4>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name">
            <TextInput
              value={newUser.name}
              onChange={(e) => setNewUser({ ...newUser, name: e.target.value })}
            />
          </Field>
          <Field label="Email">
            <TextInput
              value={newUser.email}
              onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
            />
          </Field>
          <Field label="Password (min 8 chars)">
            <TextInput
              value={newUser.password}
              onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
            />
          </Field>
          <Field label="Role">
            <Select
              value={newUser.role}
              onChange={(v) => setNewUser({ ...newUser, role: v })}
              options={[
                { value: "RM", label: "RM" },
                { value: "ADMIN", label: "Admin" },
              ]}
            />
          </Field>
        </div>
        {userError && <p className="mt-2 text-sm text-red-600">{userError}</p>}
        <div className="mt-3">
          <Button
            onClick={createUser}
            disabled={creating || !newUser.email || !newUser.name || newUser.password.length < 8}
          >
            {creating ? "Creating…" : "Create user"}
          </Button>
        </div>
      </Card>
    </div>
  );
}
