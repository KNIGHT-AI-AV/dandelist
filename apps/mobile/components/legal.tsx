import { router } from "expo-router";
import { useEffect, useRef, type ReactNode } from "react";
import { ScrollView, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { layout, type, usePalette, useType } from "../lib/theme";
import { Chip, EdgeFade, Eyebrow, Hairline, IconButton, Wordmark } from "./lux";
import { Atmosphere } from "./atmosphere";

export interface LegalSection {
  /** For linking straight to a section, as /legal?section=<id>. */
  id?: string;
  heading: string;
  body: string[];
}

export interface LegalDocument {
  id: string;
  title: string;
  updated: string;
  sections: LegalSection[];
}

/**
 * A plain, readable legal page: one column, serif headings, Inter body. It holds one or more documents (Privacy and
 * Terms share /legal) with a quiet way to jump between them, and opens at `focus`: a document's id or a section's.
 */
export function LegalPage({ eyebrow, title, documents, focus, after }: { eyebrow: string; title: string; documents: LegalDocument[]; focus?: string; after?: ReactNode }) {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const t = useType();
  const { width } = useWindowDimensions();
  const scroll = useRef<ScrollView>(null);
  // Where each document and each section sits, measured as they lay out, so a jump lands on the right heading.
  const docAt = useRef(new Map<string, number>());
  const sectionAt = useRef(new Map<string, { doc: string; y: number }>());
  const jumped = useRef(false);
  const top = insets.top + layout.headerBar;

  const yOf = (id: string): number | null => {
    if (docAt.current.has(id)) return docAt.current.get(id)!;
    const s = sectionAt.current.get(id);
    if (!s || !docAt.current.has(s.doc)) return null;
    return docAt.current.get(s.doc)! + s.y;
  };
  const jump = (id: string, animated = true) => {
    const y = yOf(id);
    // A section's heading lands clear of the Back button and the fade under it, where a document's own heading lands
    // (UI audit, 2026-10-30: the deletion link put it flush under Back).
    const clear = docAt.current.has(id) ? 0 : layout.stack.section;
    if (y !== null) scroll.current?.scrollTo({ y: Math.max(0, y - top - clear), animated });
    return y !== null;
  };
  const tryFocus = () => {
    if (!focus || jumped.current || focus === documents[0]?.id) return;
    if (jump(focus, false)) jumped.current = true;
  };
  useEffect(() => {
    jumped.current = false;
  }, [focus]);

  return (
    <View style={{ flex: 1, backgroundColor: p.bg }}>
      <Atmosphere />
      <ScrollView ref={scroll} contentContainerStyle={{ paddingTop: insets.top + layout.contentTop, paddingBottom: insets.bottom + 48, paddingHorizontal: layout.gutter(width), gap: layout.stack.section, maxWidth: 680, width: "100%", alignSelf: "center" }}>
        <View style={{ gap: 8 }}>
          {/* The brand's own mark where the page names the brand (Taste Engine adherence check, 2026-10-29). */}
          {eyebrow === "Dandelist" ? <Wordmark height={28} /> : <Eyebrow>{eyebrow}</Eyebrow>}
          <Text accessibilityRole="header" style={[t.title1, { color: p.ink }]}>
            {title}
          </Text>
        </View>
        {documents.length > 1 ? (
          <View style={{ flexDirection: "row", gap: 8 }}>
            {documents.map((d) => (
              <Chip key={d.id} label={d.title} onPress={() => jump(d.id)} style={{ flex: 1 }} />
            ))}
          </View>
        ) : null}
        {documents.map((d, i) => (
          <View
            key={d.id}
            style={{ gap: layout.stack.section }}
            onLayout={(e) => {
              docAt.current.set(d.id, e.nativeEvent.layout.y);
              tryFocus();
            }}
          >
            {i > 0 ? <Hairline /> : null}
            <View style={{ gap: 8 }}>
              <Text accessibilityRole="header" style={[t.title2, { color: p.ink }]}>
                {d.title}
              </Text>
              <Text style={[type.figure, { color: p.ink3 }]}>{d.updated}</Text>
            </View>
            {d.sections.map((s) => (
              <View
                key={s.heading}
                style={{ gap: 8 }}
                onLayout={
                  s.id
                    ? (e) => {
                        sectionAt.current.set(s.id!, { doc: d.id, y: e.nativeEvent.layout.y });
                        tryFocus();
                      }
                    : undefined
                }
              >
                <Text accessibilityRole="header" style={[type.title3, { color: p.ink }]}>
                  {s.heading}
                </Text>
                {s.body.map((para, j) => (
                  <Text key={j} style={[type.callout, { color: p.ink2 }]}>
                    {para}
                  </Text>
                ))}
              </View>
            ))}
          </View>
        ))}
        {after}
      </ScrollView>
      <View pointerEvents="none" style={{ position: "absolute", top: 0, left: 0, right: 0, height: insets.top + 64, transform: [{ scaleY: -1 }] }}>
        <EdgeFade height={insets.top + 64} />
      </View>
      <IconButton icon="back" label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))} style={{ position: "absolute", top: insets.top + (layout.headerBar - layout.control.icon) / 2, left: layout.gutter(width) }} />
    </View>
  );
}
