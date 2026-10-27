import { router } from "expo-router";
import { ScrollView, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { layout, type, usePalette, useType } from "../lib/theme";
import { EdgeFade, Eyebrow, IconButton } from "./lux";

export interface LegalSection {
  heading: string;
  body: string[];
}

/** A plain, readable legal page: one column, Bodoni headings, Inter Tight body. */
export function LegalPage({ eyebrow, title, updated, sections }: { eyebrow: string; title: string; updated: string; sections: LegalSection[] }) {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const t = useType();
  const { width } = useWindowDimensions();
  return (
    <View style={{ flex: 1, backgroundColor: p.bg }}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + layout.contentTop, paddingBottom: insets.bottom + 48, paddingHorizontal: layout.gutter(width), gap: layout.stack.section, maxWidth: 680, width: "100%", alignSelf: "center" }}>
        <View style={{ gap: 8 }}>
          <Eyebrow>{eyebrow}</Eyebrow>
          <Text accessibilityRole="header" style={[t.title1, { color: p.ink }]}>
            {title}
          </Text>
          <Text style={[type.figure, { color: p.ink3 }]}>{updated}</Text>
        </View>
        {sections.map((s) => (
          <View key={s.heading} style={{ gap: 8 }}>
            <Text accessibilityRole="header" style={[type.title3, { color: p.ink }]}>
              {s.heading}
            </Text>
            {s.body.map((para, i) => (
              <Text key={i} style={[type.body, { lineHeight: 24, color: p.ink2 }]}>
                {para}
              </Text>
            ))}
          </View>
        ))}
      </ScrollView>
      <View pointerEvents="none" style={{ position: "absolute", top: 0, left: 0, right: 0, height: insets.top + 64, transform: [{ scaleY: -1 }] }}>
        <EdgeFade height={insets.top + 64} />
      </View>
      <IconButton icon="back" label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))} style={{ position: "absolute", top: insets.top + 4, left: 16 }} />
    </View>
  );
}
