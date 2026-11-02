import { Redirect } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ScrollView, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Chip, Glass, QuietButton } from "../components/lux";
import { adminDate, adminDay, adminMoney, adminNumber, adminWhen, byDay, type AdminAccounts, type AdminIssues, type AdminUsage } from "../lib/admin";
import { useAuth } from "../lib/auth";
import { MAIN } from "../lib/landmark";
import { layout, radius, type, usePalette } from "../lib/theme";

/**
 * /admin: the owner's read-only view of the service (owner, 2026-11-02: "I need a admin page for viewing usage and
 * issues and token per account and account data"). Not linked from anywhere; the API answers only the owner's accounts
 * (api/src/admin.ts), so anyone else sees the same "nothing here" as an unknown page.
 */
type Tab = "usage" | "accounts" | "issues";
type Loaded = { usage: AdminUsage; accounts: AdminAccounts; issues: AdminIssues } | "hidden" | "failed" | null;

export default function AdminScreen() {
  const auth = useAuth();
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [tab, setTab] = useState<Tab>("usage");
  const [data, setData] = useState<Loaded>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [u, a, i] = await Promise.all([auth.api("/admin/usage?days=14"), auth.api("/admin/accounts"), auth.api("/admin/issues")]);
      if ([u, a, i].some((r) => r.status === 404)) return setData("hidden");
      if (![u, a, i].every((r) => r.ok)) return setData("failed");
      setData({ usage: (await u.json()) as AdminUsage, accounts: (await a.json()) as AdminAccounts, issues: (await i.json()) as AdminIssues });
    } catch {
      setData("failed");
    } finally {
      setLoading(false);
    }
  }, [auth]);

  useEffect(() => {
    if (auth.status === "signedIn") void load();
  }, [auth.status, load]);

  if (auth.status === "signedOut") return <Redirect href="/sign-in" />;
  const pad = { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 48, paddingHorizontal: layout.gutter(width) };
  if (data === "hidden") {
    return (
      <View {...MAIN} style={[{ flex: 1, backgroundColor: p.bg, alignItems: "center", justifyContent: "center" }, pad]}>
        <Text style={[type.body, { color: p.ink2 }]}>Nothing here.</Text>
      </View>
    );
  }

  return (
    <ScrollView {...MAIN} style={{ flex: 1, backgroundColor: p.bg }} contentContainerStyle={[{ gap: 16, maxWidth: 960, width: "100%", alignSelf: "center" }, pad]}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <Text style={[type.title2, { color: p.ink }]}>Admin</Text>
        <QuietButton label={loading ? "Loading..." : "Refresh"} onPress={() => void load()} />
      </View>
      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
        {(["usage", "accounts", "issues"] as const).map((t) => (
          <Chip key={t} label={t === "usage" ? "Usage" : t === "accounts" ? "Accounts" : "Issues"} selected={tab === t} onPress={() => setTab(t)} />
        ))}
      </View>
      {data === "failed" ? <Text style={[type.body, { color: p.ink2 }]}>{"Couldn't load. Try Refresh."}</Text> : null}
      {data && typeof data === "object" ? (
        tab === "usage" ? <Usage usage={data.usage} /> : tab === "accounts" ? <Accounts accounts={data.accounts} /> : <Issues issues={data.issues} />
      ) : null}
    </ScrollView>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  const p = usePalette();
  return (
    <Glass style={{ padding: 14, borderRadius: radius.md, gap: 4, minWidth: 150, flexGrow: 1, flexBasis: 150 }}>
      <Text style={[type.eyebrow, { color: p.ink2 }]}>{label}</Text>
      <Text style={[type.figure15, { color: p.ink }]}>{value}</Text>
      {note ? <Text style={[type.footnote, { color: p.ink2 }]}>{note}</Text> : null}
    </Glass>
  );
}

function Line({ left, right, strong }: { left: string; right: string; strong?: boolean }) {
  const p = usePalette();
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}>
      <Text style={[strong ? type.label : type.footnote, { color: strong ? p.ink : p.ink2, flexShrink: 1 }]}>{left}</Text>
      <Text style={[type.figure13, { color: strong ? p.ink : p.ink2 }]}>{right}</Text>
    </View>
  );
}

function Usage({ usage }: { usage: AdminUsage }) {
  const p = usePalette();
  const { totals, caps } = usage;
  return (
    <View style={{ gap: 16 }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
        <Stat label="Today" value={adminMoney(totals.todayUsd)} note={caps.dailyUsd != null ? `of ${adminMoney(caps.dailyUsd)} a day` : undefined} />
        <Stat label="Guests today" value={adminMoney(totals.guestsTodayUsd)} note={`of ${adminMoney(caps.guestDailyUsd)} a day`} />
        <Stat label="All time" value={adminMoney(totals.totalUsd)} note={caps.totalUsd != null ? `of ${adminMoney(caps.totalUsd)} in all` : undefined} />
        <Stat label="Model calls" value={adminNumber(totals.totalCalls)} note="all time" />
      </View>
      <Text style={[type.eyebrow, { color: p.ink2 }]}>{`By UTC day since ${adminDay(usage.from)}`}</Text>
      {byDay(usage.days).map((d) => (
        <Glass key={d.day} style={{ padding: 14, borderRadius: radius.md, gap: 6 }}>
          <Line left={adminDay(d.day)} right={`${adminMoney(d.usd)} · ${adminNumber(d.calls)} calls`} strong />
          {d.kinds.map((k) => (
            <Line key={k.kind} left={`${k.kind} · ${adminNumber(k.calls)} calls · ${adminNumber(k.inputTokens)} in / ${adminNumber(k.outputTokens)} out`} right={adminMoney(k.usd)} />
          ))}
        </Glass>
      ))}
      {usage.days.length ? null : <Text style={[type.body, { color: p.ink2 }]}>No model calls in this window.</Text>}
    </View>
  );
}

function Accounts({ accounts }: { accounts: AdminAccounts }) {
  const p = usePalette();
  const g = accounts.guests;
  return (
    <View style={{ gap: 12 }}>
      <Glass style={{ padding: 14, borderRadius: radius.md, gap: 6 }}>
        <Line left="Signed-out visitors" right={adminMoney(g.usd)} strong />
        <Line left={`${adminNumber(g.calls)} calls · ${adminNumber(g.inputTokens)} in / ${adminNumber(g.outputTokens)} out`} right={`${adminMoney(g.usdWeek)} this week`} />
        <Line left="Last used" right={adminWhen(g.lastUsed)} />
      </Glass>
      <Text style={[type.eyebrow, { color: p.ink2 }]}>{`${accounts.accounts.length} accounts`}</Text>
      {accounts.accounts.map((a) => (
        <Glass key={a.id} style={{ padding: 14, borderRadius: radius.md, gap: 6 }}>
          <Line left={a.email} right={adminMoney(a.usd)} strong />
          <Line left={`Signs in with ${a.providers.length ? a.providers.join(", ") : "an emailed code"} · since ${adminDate(a.createdAt)}`} right={`${adminMoney(a.usdWeek)} this week`} />
          <Line left={`${adminNumber(a.calls)} calls · ${adminNumber(a.inputTokens)} in / ${adminNumber(a.outputTokens)} out tokens`} right="" />
          <Line left={`${a.wishes} wishes · ${a.runs} hunts · ${a.memories} memories · ${a.reports} help reports`} right="" />
          <Line left={`Last used ${adminWhen(a.lastUsed)} · last sign-in ${adminWhen(a.lastSignIn)}`} right="" />
        </Glass>
      ))}
    </View>
  );
}

function Issues({ issues }: { issues: AdminIssues }) {
  const p = usePalette();
  return (
    <View style={{ gap: 12 }}>
      <Text style={[type.eyebrow, { color: p.ink2 }]}>{`Help reports (${issues.reports.length})`}</Text>
      {issues.reports.map((r) => (
        <Glass key={r.id} style={{ padding: 14, borderRadius: radius.md, gap: 6 }}>
          <Line left={`${r.code} · ${r.email}`} right={adminWhen(r.at)} strong />
          <Line left={[r.platform, r.os, r.version && `v${r.version}`, r.build && `build ${r.build}`, r.route].filter(Boolean).join(" · ")} right={r.screen ? "with screenshot" : ""} />
          {r.lastSaid ? <Text style={[type.footnote, { color: p.ink }]}>{`Last said: ${r.lastSaid}`}</Text> : null}
          {r.logs.map((l, i) => (
            <Text key={i} style={[type.figure13, { color: l.level === "error" ? p.ink : p.ink2 }]}>{`${l.level ?? ""} ${l.text}`}</Text>
          ))}
          {r.replay ? <Text style={[type.footnote, { color: p.ink2 }]}>{`Replay ${r.replay}`}</Text> : null}
        </Glass>
      ))}
      {issues.reports.length ? null : <Text style={[type.body, { color: p.ink2 }]}>No help reports.</Text>}
      <Text style={[type.eyebrow, { color: p.ink2 }]}>{`Hunts that ended in an error (${issues.failedRuns.length})`}</Text>
      {issues.failedRuns.map((f) => (
        <Glass key={f.id} style={{ padding: 14, borderRadius: radius.md, gap: 6 }}>
          <Line left={`${f.title ?? "A hunt"} · ${f.email}`} right={adminWhen(f.at)} strong />
          {f.error ? <Text style={[type.footnote, { color: p.ink2 }]}>{f.error}</Text> : null}
        </Glass>
      ))}
    </View>
  );
}
