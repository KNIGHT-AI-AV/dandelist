import type { ReactNode } from "react";
import { View } from "react-native";

/**
 * Web version of the odometer's edge fade: a CSS mask that fades the top and bottom `pad` pixels, so digits slide
 * in and out of soft edges instead of a hard cut (UI audit §2.5, after NumberFlow). `odometer-mask.native.tsx` is
 * the phone version.
 */
export function EdgeMask({ pad, children }: { pad: number; children: ReactNode }) {
  const mask = `linear-gradient(to bottom, transparent 0, #000 ${pad}px, #000 calc(100% - ${pad}px), transparent 100%)`;
  return <View style={{ maskImage: mask, WebkitMaskImage: mask } as object}>{children}</View>;
}
