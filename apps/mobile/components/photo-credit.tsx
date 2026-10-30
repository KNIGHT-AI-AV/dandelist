import { safeAuthor, UNSPLASH_HOME } from "@dandelist/catalogue";
import { Linking, Platform, Text, type GestureResponderEvent, type StyleProp, type TextStyle } from "react-native";
import { photoCredit } from "../lib/gallery";
import { type, usePalette } from "../lib/theme";

/** What a credit needs to know about a photo: catalogue images and saved wish media both fit. */
export interface CreditedImage {
  credit?: string;
  license?: string;
  source?: string;
  generated?: boolean;
  author?: unknown;
}

/** A link inside a credit: an anchor to a new tab on the web, the browser on a phone; it never also presses a card. */
function Link({ url, children, color }: { url: string; children: string; color: string }) {
  const web = Platform.OS === "web" ? ({ href: url, hrefAttrs: { target: "_blank", rel: "noopener noreferrer" } } as object) : {};
  const press = (e: GestureResponderEvent) => {
    e.stopPropagation();
    if (Platform.OS !== "web") void Linking.openURL(url);
  };
  return (
    <Text accessibilityRole="link" onPress={press} style={{ color }} {...web}>
      {children}
    </Text>
  );
}

/**
 * A photo's credit beside the photo. An Unsplash photo reads "Photo by <name> on Unsplash", the name linked to the
 * photographer and Unsplash to its home page, as Unsplash's API guidelines ask; it links only a real Unsplash profile
 * (safeAuthor), since saved wishes come back from clients. Any other photo gives its credit, licence and source.
 * Nothing for a generated image or one with no credit at all.
 */
export function PhotoCredit({ image, style, lines = 1 }: { image?: CreditedImage | null; style?: StyleProp<TextStyle>; lines?: number }) {
  const p = usePalette();
  if (!image || image.generated) return null;
  const base = [type.figure, { color: p.ink3 }, style];
  const author = safeAuthor(image.author);
  if (author) {
    return (
      <Text numberOfLines={lines} style={base}>
        {"Photo by "}
        <Link url={author.url} color={p.ink2}>
          {author.name}
        </Link>
        {" on "}
        <Link url={UNSPLASH_HOME} color={p.ink2}>
          Unsplash
        </Link>
      </Text>
    );
  }
  const plain = photoCredit({ url: "", source: "", ...image } as Parameters<typeof photoCredit>[0]);
  return plain ? (
    <Text numberOfLines={lines} style={base}>
      {plain}
    </Text>
  ) : null;
}
