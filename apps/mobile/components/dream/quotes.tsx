import type { KeepLine, Widget } from "@dandelist/catalogue/dream";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { moneyIn, monthlyOf } from "../../lib/dream";
import { haptic } from "../../lib/motion";
import { fonts, radius, usePalette, type } from "../../lib/theme";
import { ErrorLine, Eyebrow, Glass, Hairline, PrimaryButton, Shade } from "../lux";
import { Odometer } from "../odometer";
import { GlassReveal } from "../reveal";

/** The itemised cost to keep something: each line with how it was worked out and where the rate came from. */
export function KeepStatement({ lines, currency }: { lines: KeepLine[]; currency?: string }) {
  const p = usePalette();
  const money = moneyIn(currency);
  const per = (l: KeepLine) => (l.period === "month" ? "/mo" : l.period === "year" ? "/yr" : "/wk");
  return (
    <View style={{ gap: 10 }}>
      {lines.map((l) => (
        <View key={l.label} style={{ gap: 3 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
            <Text style={[type.callout, { flexShrink: 1, color: p.ink }]}>{l.label}</Text>
            <Text style={[type.figure13, { color: p.ink }]}>{`${money(l.amountCents)}${per(l)}`}</Text>
          </View>
          <Text style={[type.footnote, { color: p.ink3 }]}>{`${l.basis}${l.estimate ? " · estimate" : ""}`}</Text>
        </View>
      ))}
      <Hairline />
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Eyebrow>To keep it, every month</Eyebrow>
        <Odometer cents={monthlyOf(lines)} format={money} size={24} family="bodoni" align="right" pulse />
      </View>
    </View>
  );
}

function Hero({ images, height = 220 }: { images: { url: string; generated?: boolean }[]; height?: number }) {
  return (
    <View style={{ height, borderRadius: radius.md, overflow: "hidden" }}>
      <GlassReveal uri={images[0]?.url ?? null} standby={require("../../assets/standby/object.jpg")} stage="clear" treatment={images[0]?.generated ? "film" : "swirl"} finish={!!images[0]?.generated} style={StyleSheet.absoluteFill} />
      <Shade from={0.5} />
    </View>
  );
}

/** A recurring service (private security, a chef, a driver): what it is, where, and its monthly lines. */
export function ServiceQuote({ w, onAccept }: { w: Extract<Widget, { kind: "service_quote" }>; onAccept(): Promise<void> }) {
  const p = usePalette();
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <Glass style={{ padding: 16, gap: 14, borderRadius: radius.lg }}>
      <Hero images={w.images} />
      <View style={{ gap: 4 }}>
        <Eyebrow color={p.accent}>{w.region}</Eyebrow>
        <Text style={[type.title2, { color: p.ink }]}>{w.service}</Text>
        <Text style={[type.callout, { color: p.ink2 }]}>{w.summary}</Text>
      </View>
      <KeepStatement lines={w.lines} currency={w.currency} />
      <PrimaryButton
        label={accepted ? "Quote accepted" : "Accept this quote"}
        busy={busy}
        disabled={accepted}
        onPress={async () => {
          setBusy(true);
          try {
            await onAccept();
            setAccepted(true);
          } finally {
            setBusy(false);
          }
        }}
      />
    </Glass>
  );
}

/** A finished find: the price, the cost to keep it, and one tap to put it on the life list. */
export function WishReady({ w, onAdd }: { w: Extract<Widget, { kind: "wish_ready" }>; onAdd(): Promise<void> }) {
  const p = usePalette();
  const [added, setAdded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wish = w.wish;
  return (
    <Glass style={{ padding: 16, gap: 14, borderRadius: radius.lg }}>
      <Hero images={wish.images} height={260} />
      <View style={{ gap: 4 }}>
        <Eyebrow color={p.accent}>{[wish.region, wish.seller].filter(Boolean).join(" · ") || "Found it"}</Eyebrow>
        <Text style={[type.title2, { color: p.ink }]}>{wish.name}</Text>
      </View>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Eyebrow>Upfront</Eyebrow>
        <Odometer cents={wish.upfrontCents} format={moneyIn(wish.currency)} size={34} family="bodoni" smallPrefix tracking={-0.68} align="right" rollOnMount="cinema" />
      </View>
      {wish.keep.length ? <KeepStatement lines={wish.keep} currency={wish.currency} /> : null}
      {error ? <ErrorLine>{error}</ErrorLine> : null}
      <PrimaryButton
        label={added ? "On your life list" : "Add to my life"}
        busy={busy}
        disabled={added}
        onPress={async () => {
          setBusy(true);
          setError(null);
          try {
            await onAdd();
            haptic.success();
            setAdded(true);
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      />
    </Glass>
  );
}
