import { createElement } from "react";

/** A full-size embedded page. On the web it's an iframe; `embed.native.tsx` is the phone version. */
export function Embed({ uri, title, onLoad }: { uri: string; title: string; onLoad?: () => void }) {
  return createElement("iframe", {
    title,
    src: uri,
    allow: "autoplay; fullscreen; xr-spatial-tracking",
    onLoad,
    style: { border: 0, width: "100%", height: "100%", background: "transparent" },
  });
}
