import type { ReactNode } from "react";
import { View } from "react-native";
import { radius, space, usePalette } from "../lib/theme";
import { Photo } from "./lux";

/** The picture's side, in px: a little larger than a list row's (components/details/detail-row.tsx), beside two lines. */
export const FOUND_SHOT = 56;

/**
 * What a look brought back, with its picture beside the words (lib/found-photo.ts). With no picture, the words alone,
 * as before.
 */
export function FoundLine({ photo, children }: { photo: string | null; children: ReactNode }) {
  const p = usePalette();
  if (!photo) return <>{children}</>;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space[12] }}>
      <View style={{ width: FOUND_SHOT, height: FOUND_SHOT, borderRadius: radius.sm, borderCurve: "continuous", overflow: "hidden", backgroundColor: p.track }}>
        <Photo uri={photo} />
      </View>
      <View style={{ flex: 1 }}>{children}</View>
    </View>
  );
}
