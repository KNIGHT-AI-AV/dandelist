import { useState } from "react";
import { View } from "react-native";
import { retakePhoto } from "../../lib/agent";
import { useAuth } from "../../lib/auth";
import { haptic } from "../../lib/motion";
import { shownPhotos, withNewPhoto } from "../../lib/photos";
import { layout } from "../../lib/theme";
import { useWishes, type Wish } from "../../lib/wishes";
import { ErrorLine, QuietButton } from "../lux";

/**
 * Retake photo (owner, 2026-10-29: "a retake for image gen that has ai find a better picture"): the AI looks again with
 * what the wish is, its kind and where it is, never offering a photo already shown, and the wish keeps the new one.
 */
export function RetakePhoto({ wish }: { wish: Wish }) {
  const { api } = useAuth();
  const { setPhoto } = useWishes();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const a = wish.details.agent;
  const shown = shownPhotos(a);

  const go = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const found = await retakePhoto(api, { title: wish.name, kind: wish.kind }, shown);
      await setPhoto(wish.id, { imageUrl: found.imageUrl, media: withNewPhoto(a?.media, found) });
      haptic.success();
    } catch (e) {
      haptic.error();
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ alignItems: "flex-start", gap: layout.stack.tight }}>
      <QuietButton label={busy ? "Finding a better photo..." : "Retake photo"} onPress={() => void go()} />
      {error ? <ErrorLine>{error}</ErrorLine> : null}
    </View>
  );
}
