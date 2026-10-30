import { UNSPLASH_HOME } from "@dandelist/catalogue";
import { Linking, Platform, Text, type GestureResponderEvent, type StyleProp, type TextStyle } from "react-native";
import { photoCreditContent, type CreditedImage } from "../lib/photo-credit";
import { type, usePalette } from "../lib/theme";

export type { CreditedImage } from "../lib/photo-credit";

/** A link inside a credit: an anchor to a new tab on the web, the browser on a phone; it never also presses a card. */
function Link({ url, children, color, roomy }: { url: string; children: string; color: string; roomy?: boolean }) {
  const web = Platform.OS === "web" ? ({ href: url, hrefAttrs: { target: "_blank", rel: "noopener noreferrer" } } as object) : {};
  const press = (e: GestureResponderEvent) => {
    e.stopPropagation();
    if (Platform.OS !== "web") void Linking.openURL(url);
  };
  return (
    <Text accessibilityRole="link" onPress={press} style={{ color, ...(roomy ? { paddingVertical: 12 } : null) }} {...web}>
      {children}
    </Text>
  );
}

/**
 * A photo's credit beside the photo. An Unsplash photo reads "Photo by <name> on Unsplash", the name linked to the
 * photographer and Unsplash to its home page, as Unsplash's API guidelines ask; it links only a real Unsplash profile
 * (safeAuthor), since saved wishes come back from clients. Commons photos link their validated File page beside
 * the photographer and licence, without inventing a photographer profile. Other photos keep their plain credit.
 * Nothing for a generated image or one with no credit at all.
 */
export function PhotoCredit({ image, fallback, style, lines = 1, roomy = false }: { image?: CreditedImage | null; fallback?: string; style?: StyleProp<TextStyle>; lines?: number; roomy?: boolean }) {
  const p = usePalette();
  const content = photoCreditContent(image, fallback);
  if (!content) return null;
  const base = [type.figure, { color: p.ink3 }, style];
  if (content.kind === "unsplash") {
    const { author } = content;
    return (
      <Text numberOfLines={lines} style={base}>
        {"Photo by "}
        <Link url={author.url} color={p.ink2} roomy={roomy}>
          {author.name}
        </Link>
        {" on "}
        <Link url={UNSPLASH_HOME} color={p.ink2} roomy={roomy}>
          Unsplash
        </Link>
      </Text>
    );
  }
  if (content.kind === "commons") {
    return (
      <Text numberOfLines={lines} style={base}>
        <Link url={content.url} color={p.ink2} roomy={roomy}>
          Wikimedia Commons
        </Link>
        {content.text ? ` · ${content.text}` : ""}
      </Text>
    );
  }
  return (
    <Text numberOfLines={lines} style={base}>
      {content.text}
    </Text>
  );
}
