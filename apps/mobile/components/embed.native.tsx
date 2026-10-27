import { WebView } from "react-native-webview";

/** A full-size embedded page in a web view; `embed.tsx` is the web version. */
export function Embed({ uri, onLoad }: { uri: string; title: string; onLoad?: () => void }) {
  return (
    <WebView
      source={{ uri }}
      onLoadEnd={onLoad}
      style={{ flex: 1, backgroundColor: "transparent" }}
      containerStyle={{ backgroundColor: "transparent" }}
      javaScriptEnabled
      allowsInlineMediaPlayback
      mediaPlaybackRequiresUserAction={false}
      scrollEnabled={false}
      bounces={false}
      setSupportMultipleWindows={false}
    />
  );
}
