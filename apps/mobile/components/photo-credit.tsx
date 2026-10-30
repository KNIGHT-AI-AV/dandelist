import { UNSPLASH_HOME } from "@dandelist/catalogue";
import { Linking, Platform, Text, type GestureResponderEvent, type StyleProp, type TextStyle } from "react-native";
import { type, usePalette } from "../lib/theme";

/** What a credit needs to know about a photo: catalogue images and saved wish media both fit. */
export interface CreditedImage {
  credit?: string;
  license?: string;
  generated?: boolean;
  author?: { name: string; url: string };
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
 * photographer and Unsplash to its home page, as Unsplash's API guidelines ask; any other photo gives its credit and
 * licence. Nothing for a generated image or one without a credit.
 */
export function PhotoCredit({ image, style }: { image?: CreditedImage | null; style?: StyleProp<TextStyle> }) {
  const p = usePalette();
  if (!image || image.generated) return null;
  const base = [type.figure, { color: p.ink3 }, style];
  if (image.author) {
    return (
      <Text numberOfLines={1} style={base}>
        {"Photo by "}
        <Link url={image.author.url} color={p.ink2}>
          {image.author.name}
        </Link>
        {" on "}
        <Link url={UNSPLASH_HOME} color={p.ink2}>
          Unsplash
        </Link>
      </Text>
    );
  }
  const plain = [image.credit, image.license].filter(Boolean).join(" · ");
  return plain ? (
    <Text numberOfLines={1} style={base}>
      {plain}
    </Text>
  ) : null;
}
