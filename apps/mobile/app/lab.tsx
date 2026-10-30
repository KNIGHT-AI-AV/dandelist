import type { Widget } from "@dandelist/catalogue/dream";
import { Redirect, useLocalSearchParams } from "expo-router";
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import Svg, { Circle, Line, Rect } from "react-native-svg";
import { SearchField } from "../components/details/search-field";
import { AddedLine } from "../components/added-line";
import { CarBuilder, HomeBuilder } from "../components/dream/builders";
import { RefinePanel } from "../components/refine";
import type { WishQuestion } from "../lib/agent";
import { PaletteButton } from "../components/home/chrome";
import { Composer } from "../components/inputs";
import { Chip, Glass, Icon, IconButton, Money, Photo, PrimaryButton, QuietButton, Wordmark, type IconName } from "../components/lux";
import { WaitingLight } from "../components/waiting-light";
import { MediaHero, type Media } from "../components/media";
import { dollars } from "../components/odometer";
import { GlassReveal } from "../components/reveal";
import type { Stage } from "../components/reveal-clock";
import { Card, Row } from "../components/settings/kit";
import { MicButton, type VoiceWish } from "../components/voice/say-wish";
import type { Mode } from "../lib/odometer-plan";
import { layout, radius, ThemeScope, type, usePalette, type ThemeId } from "../lib/theme";

/** The odometer QA cases from the UI audit (§2.11), one tap each. */
function OdometerBench() {
  const p = usePalette();
  const [cents, setCents] = useState(0);
  const [mode, setMode] = useState<Mode>("ui");
  const [landed, setLanded] = useState(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const run = (steps: [number, Mode, number][]) => {
    timers.current.forEach(clearTimeout);
    timers.current = steps.map(([c, m, at]) => setTimeout(() => { setMode(m); setCents(c); }, at));
  };
  return (
    <View style={{ gap: 12, paddingHorizontal: 16 }}>
      <Text style={[type.label, { color: p.ink2 }]}>{`Odometer · landed ${landed}`}</Text>
      <Money cents={cents} size="hero" format={dollars} mode={mode} onLand={() => setLanded((n) => n + 1)} />
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        <Chip label="QA1 0 → 107,529 cinema" onPress={() => run([[0, "instant", 0], [10_752_900, "cinema", 60]])} />
        <Chip label="QA2 9,999 → 10,000" onPress={() => run([[999_900, "instant", 0], [1_000_000, "ui", 60]])} />
        <Chip label="QA2 10,000 → 9,999" onPress={() => run([[1_000_000, "instant", 0], [999_900, "ui", 60]])} />
        <Chip label="QA3 107,529 → 107,530" onPress={() => run([[10_752_900, "instant", 0], [10_753_000, "ui", 60]])} />
        <Chip label="QA4 five in 400 ms" onPress={() => run([[10_000_000, "instant", 0], [10_100_000, "ui", 60], [10_200_000, "ui", 160], [10_300_000, "ui", 260], [10_400_000, "ui", 360], [10_500_000, "ui", 460]])} />
      </View>
    </View>
  );
}

// Development-only bench for the media views; production redirects away.
const car: Media = {
  kind: "vehicle",
  images: [],
  model3d: {
    provider: "sketchfab",
    uid: "d01b254483794de3819786d93e0e1ebf",
    name: "(FREE) Porsche 911 Carrera 4S",
    author: "Lionsharp Studios",
    license: "CC BY-SA",
    embedUrl: "https://sketchfab.com/models/d01b254483794de3819786d93e0e1ebf/embed?autostart=1&ui_theme=dark&transparent=1&ui_hint=0",
    thumbnail: "https://media.sketchfab.com/models/d01b254483794de3819786d93e0e1ebf/thumbnails/f28bf7eb32e646019bbaf886ff705679/3703397e693c47b2a66894bfb2ae7ea0.jpeg",
  },
};

const lisbon: Media = {
  kind: "place",
  images: [
    { url: "https://thumb.wikimedia.org/wikipedia/commons/thumb/6/69/Moored_Bojador%2C_Vera_Cruz%2C_and_Atyla%2C_Doca_de_Alc%C3%A2ntara%2C_Lisbon%2C_Portugal_julesvernex2.jpg/3840px-Moored_Bojador%2C_Vera_Cruz%2C_and_Atyla%2C_Doca_de_Alc%C3%A2ntara%2C_Lisbon%2C_Portugal_julesvernex2.jpg", source: "commons.wikimedia.org", credit: "Julesvernex2", license: "CC BY-SA 4.0" },
    { url: "https://thumb.wikimedia.org/wikipedia/commons/thumb/4/48/Old_Arsenal_da_Marinha_and_Doca_da_Caldeirinha%2C_Cais_do_Sodr%C3%A9%2C_Lisbon%2C_Portugal_julesvernex2.jpg/3840px-Old_Arsenal_da_Marinha_and_Doca_da_Caldeirinha%2C_Cais_do_Sodr%C3%A9%2C_Lisbon%2C_Portugal_julesvernex2.jpg", source: "commons.wikimedia.org", credit: "Julesvernex2", license: "CC BY-SA 4.0" },
    { url: "https://upload.wikimedia.org/wikipedia/commons/e/ef/Lisbon_%28Lisboa%29_historic_elevator_Santa_Justa_Luca_Galuzzi_2006.jpg", source: "commons.wikimedia.org", credit: "Luca Galuzzi", license: "CC BY-SA 2.5" },
  ],
};

const camera: Media = {
  kind: "product",
  images: [{ url: "https://upload.wikimedia.org/wikipedia/commons/thumb/6/6c/Leica_Q3.jpg/1600px-Leica_Q3.jpg", source: "commons.wikimedia.org" }],
  cutout: { url: "https://upload.wikimedia.org/wikipedia/commons/thumb/6/6c/Leica_Q3.jpg/1600px-Leica_Q3.jpg", from: "", model: "sam-3.1" },
};

const STAGES: Stage[] = ["hunting", "found", "sharpening", "clear"];
const rolex = "https://media.rolex.com/image/upload/q_auto/f_auto/t_v7-cover-majesty-landscape/c_limit,w_1920/v1/a677b2c664f6/catalogue/2026/upright-c/m126610ln-0001";

function GlassBench() {
  const p = usePalette();
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((n) => (n + 1) % (STAGES.length + 1)), 2600);
    return () => clearInterval(t);
  }, []);
  // One beat with nothing found yet, then each stage in turn.
  const stage = STAGES[Math.max(0, i - 1)]!;
  const uri = i === 0 ? null : rolex;
  return (
    <View style={{ gap: 8 }}>
      <Text style={[type.label, { color: p.ink2, paddingHorizontal: 16 }]}>{`Glass reveal · ${uri ? stage : "standby"}`}</Text>
      <View style={{ flexDirection: "row", gap: 6, paddingHorizontal: 12 }}>
        {(["swirl", "pane", "film", "frost"] as const).map((t) => (
          <View key={t} style={{ flex: 1, gap: 4 }}>
            <GlassReveal uri={uri} standby={require("../assets/standby/object.jpg")} stage={stage} treatment={t} style={{ height: 260, borderRadius: 18 }} />
            <Text style={[type.figure, { color: p.ink3, textAlign: "center" }]}>{t}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const ICONS: IconName[] = ["palette", "back", "forward", "arrow", "close", "plus", "check", "send", "mic", "search", "heart"];

/** A microphone at rest, so the composer shows it the way it does before anything is typed. */
const QUIET_VOICE: VoiceWish = { supported: true, phase: "idle", levels: [], elapsedMs: 0, toggle: () => {}, cancel: () => {} };

/** One icon as a screen sets it, with what it is and its size under it. */
function Mark({ caption, children }: { caption: string; children: ReactNode }) {
  const p = usePalette();
  return (
    <View style={{ alignItems: "center", gap: 6, minWidth: 64 }}>
      <View style={{ minHeight: 58, alignItems: "center", justifyContent: "center" }}>{children}</View>
      <Text style={[type.figure, { color: p.ink3 }]}>{caption}</Text>
    </View>
  );
}

/** Every icon where the screens use it, at their sizes and colours, built from the real controls where they're shared. */
function RealSize({ id }: { id: ThemeId }) {
  const p = usePalette();
  const box = { borderWidth: 1, borderColor: `rgba(${p.inkRgb},0.25)` };
  const disc = { width: 58, height: 58, borderRadius: 29, alignItems: "center", justifyContent: "center", borderWidth: StyleSheet.hairlineWidth } as const;
  return (
    <View testID={`icons-real-${id}`} style={{ backgroundColor: p.bg, padding: 16, gap: 18 }}>
      <Text style={[type.label, { color: p.ink2 }]}>{`${id} · real size`}</Text>
      {/* The top bar's right side as it is laid out: palette, then the profile photo. */}
      <View testID={`bench-header-${id}`} style={{ height: layout.headerBar, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Wordmark />
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <View style={box}>
            <PaletteButton />
          </View>
          <View style={[box, { width: layout.control.chip, height: layout.control.chip, alignItems: "flex-end", justifyContent: "center" }]}>
            <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: p.accent }} />
          </View>
        </View>
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "flex-start", columnGap: 10, rowGap: 14 }}>
        <Mark caption="back 17">
          <IconButton icon="back" label="Back" onPress={() => {}} />
        </Mark>
        <Mark caption="close 17">
          <IconButton icon="close" label="Close" onPress={() => {}} />
        </Mark>
        <Mark caption="pass 24">
          <View style={[disc, { backgroundColor: p.glassTint, borderColor: p.hair }]}>
            <Icon name="close" size={24} color={p.ink} />
          </View>
        </Mark>
        <Mark caption="yes 24">
          <View style={[disc, { backgroundColor: p.accent, borderColor: p.accent }]}>
            <Icon name="heart" size={24} color={p.onAccent} />
          </View>
        </Mark>
      </View>
      <Composer value="A Leica Q3" onChangeText={() => {}} onSend={() => {}} placeholder="Tell Dandy what you want..." label="Message Dandy" />
      <Composer value="" onChangeText={() => {}} onSend={() => {}} placeholder="Tell Dandy what you want..." label="Message Dandy" idleAction={<MicButton voice={QUIET_VOICE} compact />} />
      <SearchField value="Leica" onChangeText={() => {}} placeholder="Search your wishes" />
      <Card>
        <Row label="Currency" value="USD" onPress={() => {}} first />
      </Card>
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "flex-start", columnGap: 10, rowGap: 14 }}>
        <Mark caption="plus 11">
          <Glass style={{ height: 36, paddingHorizontal: 14, borderRadius: radius.pill, flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Icon name="plus" size={11} color={p.ink} />
            <Text style={[type.footnote, { color: p.ink }]}>New chat</Text>
          </Glass>
        </Mark>
        <Mark caption="plus 14">
          <Icon name="plus" size={14} color={p.accentText} />
        </Mark>
        <Mark caption="del 12">
          <View style={{ width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center", backgroundColor: `rgba(${p.inkRgb}, ${p.scheme === "dark" ? 0.07 : 0.05})` }}>
            <Icon name="close" size={12} color={p.ink2} />
          </View>
        </Mark>
        <Mark caption="remove 15">
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Icon name="close" size={15} color={p.danger} />
            <Text style={[type.label, { color: p.danger }]}>Remove</Text>
          </View>
        </Mark>
        {[12, 13, 14].map((s) => (
          <Mark key={s} caption={`check ${s}`}>
            <Icon name="check" size={s} color={p.accentText} />
          </Mark>
        ))}
      </View>
    </View>
  );
}

/** One icon at 96 pt over its 24 grid: 2-unit lines, the 20-unit live area and the 10-unit keyline circle. */
function OnGrid({ name }: { name: IconName }) {
  const p = usePalette();
  const faint = `rgba(${p.inkRgb}, 0.1)`;
  return (
    <View style={{ alignItems: "center", gap: 4 }}>
      <View style={{ width: 96, height: 96 }}>
        <Svg width={96} height={96} viewBox="0 0 24 24" style={StyleSheet.absoluteFill}>
          {Array.from({ length: 13 }, (_, i) => i * 2).map((v) => (
            <Fragment key={v}>
              <Line x1={v} y1={0} x2={v} y2={24} stroke={faint} strokeWidth={v % 12 === 0 ? 0.1 : 0.05} />
              <Line x1={0} y1={v} x2={24} y2={v} stroke={faint} strokeWidth={v % 12 === 0 ? 0.1 : 0.05} />
            </Fragment>
          ))}
          <Rect x={2} y={2} width={20} height={20} fill="none" stroke={p.accent} strokeOpacity={0.35} strokeWidth={0.06} />
          <Circle cx={12} cy={12} r={10} fill="none" stroke={p.accent} strokeOpacity={0.35} strokeWidth={0.06} />
        </Svg>
        <View style={StyleSheet.absoluteFill}>
          <Icon name={name} size={96} color={name === "palette" ? p.accentText : p.ink} />
        </View>
      </View>
      <Text style={[type.figure, { color: p.ink3 }]}>{name}</Text>
    </View>
  );
}

function AtNinetySix({ id }: { id: ThemeId }) {
  const p = usePalette();
  return (
    <View testID={`icons-96-${id}`} style={{ backgroundColor: p.bg, padding: 16, gap: 14 }}>
      <Text style={[type.label, { color: p.ink2 }]}>{`${id} · 96 pt on the 24 grid`}</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: 16 }}>
        {ICONS.map((n) => (
          <OnGrid key={n} name={n} />
        ))}
      </View>
    </View>
  );
}

/** The icon audit (owner, 2026-10-29): every icon at its real size and at 96 pt, in a dark and a light theme. */
function IconBench() {
  const p = usePalette();
  const box = { borderWidth: 1, borderColor: `rgba(${p.inkRgb},0.25)` };
  return (
    <View testID="icon-bench" style={{ gap: 20, paddingHorizontal: 16 }}>
      <Text style={[type.label, { color: p.ink2 }]}>Icons and buttons</Text>
      {(["emerald", "ivory"] as const).map((id) => (
        <ThemeScope key={id} id={id}>
          <View style={{ gap: 12 }}>
            <RealSize id={id} />
            <AtNinetySix id={id} />
          </View>
        </ThemeScope>
      ))}
      <View testID="bench-buttons" style={{ gap: 12 }}>
        <PrimaryButton label="Add to my list" onPress={() => {}} />
        <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
          <Chip label="Must" selected onPress={() => {}} />
          <Chip label="Nice" onPress={() => {}} />
          <QuietButton label="Retake photo" onPress={() => {}} />
        </View>
      </View>
      <View testID="bench-wordmark" style={{ gap: 12, alignItems: "flex-start" }}>
        <View style={box}>
          <Wordmark height={48} />
        </View>
      </View>
    </View>
  );
}

const VILLA: Extract<Widget, { kind: "home_builder" }> = {
  kind: "home_builder",
  id: "bench-villa",
  region: "Malta",
  styles: [
    { id: "modern", label: "Modern", on: true, imageUrl: lisbon.images[0]!.url },
    { id: "mediterranean", label: "Mediterranean", imageUrl: lisbon.images[2]!.url },
  ],
  features: [
    { id: "pool", label: "Pool", on: true },
    { id: "sea-view", label: "Sea view", on: true },
    { id: "garden", label: "Garden", on: false },
  ],
  bedrooms: 4,
  budgetCents: 300_000_000,
  currency: "EUR",
};

const G_CLASS: Extract<Widget, { kind: "car_builder" }> = {
  kind: "car_builder",
  id: "bench-car",
  currency: "USD",
  steps: [
    { id: "model", title: "Model", choices: [{ id: "g", label: "Mercedes-Benz G-Class", imageUrl: car.images[0]?.url }], selected: "g" },
    { id: "trim", title: "Trim", choices: [{ id: "g550", label: "G 550", priceCents: 14800000, detail: "Included" }, { id: "amg", label: "AMG G 63", priceCents: 18655000 }] },
    { id: "colour", title: "Colour", choices: [{ id: "red", label: "Hyacinth Red", priceCents: 75000 }, { id: "black", label: "Obsidian Black", priceCents: 0, detail: "Included" }] },
    { id: "interior", title: "Interior", choices: [] },
    { id: "options", title: "Options", choices: [{ id: "night", label: "Night Package", priceCents: 130000 }, { id: "burmester", label: "Burmester sound", priceCents: 640000 }] },
  ],
};

const WATCH: WishQuestion[] = [
  { id: "bracelet", label: "Which bracelet?", options: ["Oyster", "President"], picked: "Oyster" },
  { id: "condition", label: "New or pre-owned?", options: ["New", "Pre-owned"], picked: "Pre-owned" },
];

/**
 * The builders with sample widgets, opened as if the Dandy had just asked (one question at a time, its clock running),
 * the refine questions, and what each would send.
 */
function BuilderBench() {
  const p = usePalette();
  const [sent, setSent] = useState("");
  const [carSent, setCarSent] = useState("");
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [refined, setRefined] = useState("");
  const [refining, setRefining] = useState(true);
  return (
    <View style={{ gap: 8, paddingHorizontal: 12 }}>
      <Text style={[type.label, { color: p.ink2, paddingHorizontal: 4 }]}>Home builder</Text>
      <HomeBuilder w={VILLA} live waiting onApply={(v) => setSent(JSON.stringify(v))} onSearchNow={() => setSent("just search")} />
      <Text testID="builder-sent" style={[type.figure, { color: p.ink3, paddingHorizontal: 4 }]}>{sent}</Text>
      <Text style={[type.label, { color: p.ink2, paddingHorizontal: 4 }]}>Car builder</Text>
      <CarBuilder w={G_CLASS} live waiting onApply={(v) => setCarSent(JSON.stringify(v))} />
      <Text testID="car-sent" style={[type.figure, { color: p.ink3, paddingHorizontal: 4 }]}>{carSent}</Text>
      <Text style={[type.label, { color: p.ink2, paddingHorizontal: 4 }]}>Refine</Text>
      <Glass style={{ padding: 18, gap: 10, borderRadius: radius.lg }}>
        {refining ? (
          <RefinePanel
            questions={WATCH}
            edits={edits}
            onEdit={(q, a) => setEdits((e) => ({ ...e, [q]: a }))}
            onHunt={(e) => {
              setRefining(false);
              setRefined(`hunt again: ${JSON.stringify(e)}`);
            }}
            onClose={(line) => {
              setRefining(false);
              setRefined(`closed: ${line ?? ""}`);
            }}
          />
        ) : (
          <QuietButton label="Refine it" onPress={() => setRefining(true)} style={{ alignSelf: "flex-start" }} />
        )}
        <AddedLine onPress={() => setRefined("show on list")} />
      </Glass>
      <Text testID="refine-sent" style={[type.figure, { color: p.ink3, paddingHorizontal: 4 }]}>{refined}</Text>
    </View>
  );
}

/** One photo frame as the screens hold it: the waiting light while the picture is made, then the picture over it. */
function WaitFrame({ landed }: { landed: boolean }) {
  const p = usePalette();
  return (
    <View style={{ aspectRatio: 4 / 3, borderRadius: radius.lg, overflow: "hidden", backgroundColor: p.bg }}>
      <Photo />
      <WaitingLight active={!landed} />
      {landed ? <Photo uri={camera.images[0]!.url} /> : null}
    </View>
  );
}

/** The waiting light (owner, 2026-10-30): a picture being made for 8 s, then landing for 4, in a dark and a light theme. */
function WaitBench() {
  const p = usePalette();
  const [landed, setLanded] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setLanded((v) => !v), landed ? 4000 : 8000);
    return () => clearTimeout(t);
  }, [landed]);
  return (
    <View testID="wait-bench" style={{ gap: 12, paddingHorizontal: 12 }}>
      <Text style={[type.label, { color: p.ink2, paddingHorizontal: 4 }]}>{`Waiting light · ${landed ? "landed" : "making"}`}</Text>
      {(["emerald", "ivory"] as const).map((id) => (
        <ThemeScope key={id} id={id}>
          <WaitFrame landed={landed} />
        </ThemeScope>
      ))}
    </View>
  );
}

export default function Lab() {
  const p = usePalette();
  // /lab?only=icons shows the icon bench alone, without the photographs and the 3D viewer; /lab?only=wait the waiting light.
  const { only } = useLocalSearchParams<{ only?: string }>();
  if (!__DEV__) return <Redirect href="/" />;
  return (
    <ScrollView style={{ flex: 1, backgroundColor: p.bg }} contentContainerStyle={{ gap: 24, paddingVertical: 40, maxWidth: 520, width: "100%", alignSelf: "center" }}>
      {only === "icons" ? (
        <IconBench />
      ) : only === "wait" ? (
        <WaitBench />
      ) : (
        <>
          <WaitBench />
          <BuilderBench />
          <IconBench />
          <OdometerBench />
          <GlassBench />
          {[
            ["Vehicle · 3D", car],
            ["Place · slideshow", lisbon],
            ["Product · turnable cutout", camera],
          ].map(([label, media]) => (
            <View key={label as string} style={{ gap: 8 }}>
              <Text style={[type.label, { color: p.ink2, paddingHorizontal: 16 }]}>{label as string}</Text>
              <MediaHero media={media as Media} style={{ height: 420, borderRadius: 26, overflow: "hidden", marginHorizontal: 12 }} />
            </View>
          ))}
        </>
      )}
    </ScrollView>
  );
}
