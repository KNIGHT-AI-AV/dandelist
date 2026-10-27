import { router } from "expo-router";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { fonts, usePalette } from "../lib/theme";
import { Eyebrow, Glass } from "./lux";

export interface LegalSection {
  heading: string;
  body: string[];
}

/** A plain, readable legal page: one column, Bodoni headings, Inter Tight body. */
export function LegalPage({ eyebrow, title, updated, sections }: { eyebrow: string; title: string; updated: string; sections: LegalSection[] }) {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: p.bg }}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 64, paddingBottom: insets.bottom + 48, paddingHorizontal: 24, gap: 22, maxWidth: 680, width: "100%", alignSelf: "center" }}>
        <View style={{ gap: 8 }}>
          <Eyebrow>{eyebrow}</Eyebrow>
          <Text accessibilityRole="header" style={{ fontFamily: fonts.display, fontSize: 40, lineHeight: 44, color: p.ink }}>
            {title}
          </Text>
          <Text style={{ fontFamily: fonts.figure, fontSize: 12, color: p.ink3 }}>{updated}</Text>
        </View>
        {sections.map((s) => (
          <View key={s.heading} style={{ gap: 8 }}>
            <Text accessibilityRole="header" style={{ fontFamily: fonts.display, fontSize: 22, lineHeight: 27, color: p.ink }}>
              {s.heading}
            </Text>
            {s.body.map((para, i) => (
              <Text key={i} style={{ fontFamily: fonts.body, fontSize: 15, lineHeight: 23, color: p.ink2 }}>
                {para}
              </Text>
            ))}
          </View>
        ))}
      </ScrollView>
      <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))} hitSlop={10} style={{ position: "absolute", top: insets.top + 10, left: 16 }}>
        <Glass style={{ width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ fontFamily: fonts.body, fontSize: 20, color: p.ink, marginTop: -3 }}>‹</Text>
        </Glass>
      </Pressable>
    </View>
  );
}
