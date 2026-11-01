import { Image } from "expo-image";
import { useState } from "react";
import { Text, View } from "react-native";
import { useAuth } from "../../lib/auth";
import { avatarUri, initialOf, useProfile } from "../../lib/profile";
import { fonts, type, usePalette } from "../../lib/theme";

/**
 * The signed-in person in a disc: the picture they chose in settings, else the first letter of their name (or their
 * email). Small sizes set the letter as a label; large ones, as on the settings page, in the house serif.
 */
export function ProfileAvatar({ size, preview }: { size: number; preview?: string | null }) {
  const p = usePalette();
  const auth = useAuth();
  const { profile } = useProfile();
  // A just-chosen picture shows at once while it uploads; the stored one takes over when it's saved.
  const uri = preview ?? avatarUri(profile?.avatarKey);
  const [failed, setFailed] = useState<string | null>(null);
  const initial = initialOf(profile ?? { email: auth.user?.email });
  const large = size > 48;
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, borderWidth: 1, borderColor: p.line, backgroundColor: p.surface, alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
      {uri && failed !== uri ? (
        <Image source={{ uri }} accessibilityLabel="" style={{ width: size, height: size }} contentFit="cover" transition={{ duration: 200, effect: "cross-dissolve" }} onError={() => setFailed(uri)} accessibilityIgnoresInvertColors accessible={false} />
      ) : (
        <Text style={large ? { fontFamily: fonts.title, fontSize: size * 0.44, lineHeight: size * 0.56, color: p.ink } : [type.label, { color: p.ink2 }]}>{initial}</Text>
      )}
    </View>
  );
}
