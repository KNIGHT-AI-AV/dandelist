import { entries, type MediaImage } from "@dandelist/catalogue";
import { useLocalSearchParams } from "expo-router";
import { Text, View } from "react-native";
import { LegalPage } from "../components/legal";
import { Hairline } from "../components/lux";
import { PhotoCredit } from "../components/photo-credit";
import { PRIVACY, PRIVACY_UPDATED, TERMS, TERMS_UPDATED } from "../lib/legal";
import { layout, type, usePalette, useType } from "../lib/theme";

const DOCUMENTS = [
  { id: "privacy", title: "Privacy", updated: PRIVACY_UPDATED, sections: PRIVACY },
  { id: "terms", title: "Terms", updated: TERMS_UPDATED, sections: TERMS },
];

/** Each catalogue item with its photos, one credit per photograph (its crops share it). */
const CREDITS = entries
  .map((e) => {
    const seen = new Set<string>();
    const photos = (e.media?.images ?? []).filter((i: MediaImage) => {
      const key = i.unsplash?.id ?? (i.credit ? `${i.credit}|${i.license}` : i.url);
      if (i.generated || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return { id: e.id, name: e.name, photos };
  })
  .filter((c) => c.photos.length);

/** Every photograph the opening shows, with its photographer linked, as Unsplash's API guidelines ask. */
function PhotoCredits() {
  const p = usePalette();
  const t = useType();
  return (
    <View style={{ gap: layout.stack.section }}>
      <Hairline />
      <Text accessibilityRole="header" style={[t.title2, { color: p.ink }]}>
        Photo credits
      </Text>
      {CREDITS.map((c) => (
        <View key={c.id} style={{ gap: 4 }}>
          <Text style={[type.callout, { color: p.ink }]}>{c.name}</Text>
          {c.photos.map((i) => (
            <PhotoCredit key={i.url} image={i} />
          ))}
        </View>
      ))}
    </View>
  );
}

/**
 * Privacy and Terms on one page (owner's walkthrough, 2026-10-28). `?section=terms` opens at the terms and
 * `?section=deletion` at how to delete your data, the address Meta's app dashboard links to. The photo credits
 * close the page.
 */
export default function Legal() {
  const { section } = useLocalSearchParams<{ section?: string }>();
  return <LegalPage eyebrow="Dandelist" title="Privacy & Terms" documents={DOCUMENTS} focus={typeof section === "string" ? section : undefined} after={<PhotoCredits />} />;
}
