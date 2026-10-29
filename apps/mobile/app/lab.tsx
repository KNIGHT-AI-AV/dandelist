import { Redirect } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { PaletteButton } from "../components/home/chrome";
import { Composer } from "../components/inputs";
import { Chip, Icon, IconButton, Money, PrimaryButton, QuietButton, Wordmark } from "../components/lux";
import { MediaHero, type Media } from "../components/media";
import { dollars } from "../components/odometer";
import { GlassReveal } from "../components/reveal";
import type { Stage } from "../components/reveal-clock";
import type { Mode } from "../lib/odometer-plan";
import { layout, type, usePalette } from "../lib/theme";

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

/** Every icon, button and the wordmark side by side, at their real sizes, for the icon audit (owner, 2026-10-29). */
function IconBench() {
  const p = usePalette();
  const box = { borderWidth: 1, borderColor: `rgba(${p.inkRgb},0.25)` };
  const label = (s: string) => <Text style={[type.figure, { color: p.ink3 }]}>{s}</Text>;
  return (
    <View testID="icon-bench" style={{ gap: 20, paddingHorizontal: 16 }}>
      <Text style={[type.label, { color: p.ink2 }]}>Icons and buttons</Text>
      {/* The top bar's right side as it is laid out: palette, then the profile photo. */}
      <View testID="bench-header" style={{ height: layout.headerBar, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
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
      <View testID="bench-icons" style={{ flexDirection: "row", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        {(["back", "close", "plus", "check"] as const).map((n) => (
          <View key={n} style={{ alignItems: "center", gap: 4 }}>
            <View style={box}>
              <Icon name={n} size={34} />
            </View>
            {label(n)}
          </View>
        ))}
        <IconButton icon="back" label="Back" onPress={() => {}} />
        <IconButton icon="close" label="Close" onPress={() => {}} />
      </View>
      <View testID="bench-composer">
        <Composer value="A Leica Q3" onChangeText={() => {}} onSend={() => {}} placeholder="Tell Dandy what you want..." label="Message Dandy" />
      </View>
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

export default function Lab() {
  const p = usePalette();
  if (!__DEV__) return <Redirect href="/" />;
  return (
    <ScrollView style={{ flex: 1, backgroundColor: p.bg }} contentContainerStyle={{ gap: 24, paddingVertical: 40, maxWidth: 520, width: "100%", alignSelf: "center" }}>
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
    </ScrollView>
  );
}
