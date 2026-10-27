import type { KeepLine, Widget } from "@dandelist/catalogue/dream";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { monthlyOf } from "../../lib/dream";
import { haptic } from "../../lib/motion";
import { formatCents } from "../../lib/money";
import { fonts, radius, usePalette, type } from "../../lib/theme";
import { Eyebrow, Glass, Hairline, PrimaryButton, Shade } from "../lux";
import { Odometer } from "../odometer";
import { GlassReveal } from "../reveal";

/** The itemised cost to keep something: each line with how it was worked out and where the rate came from. */
export function KeepStatement({ lines }: { lines: KeepLine[] }) {
  const p = usePalette();
  const per = (l: KeepLine) => (l.period === "month" ? "/mo" : l.period === "year" ? "/yr" : "/wk");
  return (
    <View style={{ gap: 10 }}>
      {lines.map((l) => (
        <View key={l.label} style={{ gap: 3 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
            <Text style={[type.callout, { flexShrink: 1, color: p.ink }]}>{l.label}</Text>
            <Text style={[type.figure13, { color: p.ink }]}>{`${formatCents(l.amountCents)}${per(l)}`}</Text>
          </View>
          <Text style={[type.footnote, { color: p.ink3 }]}>{`${l.basis}${l.estimate ? " · estimate" : ""}`}</Text>
        </View>
      ))}
      <Hairline />
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Eyebrow>To keep it, every month</Eyebrow>
        <Odometer cents={monthlyOf(lines)} format={formatCents} size={24} family="bodoni" align="right" pulse />
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
export function ServiceQuote({ w, onAdd }: { w: Extract<Widget, { kind: "service_quote" }>; onAdd(): Promise<void> }) {
  const p = usePalette();
  const [added, setAdded] = useState(false);
  return (
    <Glass style={{ padding: 16, gap: 14, borderRadius: radius.lg }}>
      <Hero images={w.images} />
      <View style={{ gap: 4 }}>
        <Eyebrow color={p.accent}>{w.region}</Eyebrow>
        <Text style={[type.title2, { color: p.ink }]}>{w.service}</Text>
        <Text style={[type.callout, { color: p.ink2 }]}>{w.summary}</Text>
      </View>
      <KeepStatement lines={w.lines} />
      <PrimaryButton label={added ? "Added to your life" : "Add to my life"} disabled={added} onPress={async () => { await onAdd(); haptic.success(); setAdded(true); }} />
    </Glass>
  );
}

/** A finished find: the price, the cost to keep it, and one tap to put it on the life list. */
export function WishReady({ w, onAdd }: { w: Extract<Widget, { kind: "wish_ready" }>; onAdd(): Promise<void> }) {
  const p = usePalette();
  const [added, setAdded] = useState(false);
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
        <Odometer cents={wish.upfrontCents} format={formatCents} size={34} family="bodoni" smallPrefix tracking={-0.68} align="right" rollOnMount="cinema" />
      </View>
      {wish.keep.length ? <KeepStatement lines={wish.keep} /> : null}
      <PrimaryButton label={added ? "On your life list" : "Add to my life"} disabled={added} onPress={async () => { await onAdd(); haptic.success(); setAdded(true); }} />
    </Glass>
  );
}
