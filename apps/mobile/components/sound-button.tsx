import { Pressable, type StyleProp, type ViewStyle } from "react-native";
import { haptic } from "../lib/motion";
import { useSoundsOn } from "../lib/sound";
import { layout, usePalette } from "../lib/theme";
import { Glass, Icon } from "./lux";

/**
 * Sound on and off from the top bar (owner, 2026-10-30: "click a sound icon on top to disable sound/music ! (Music
 * icon mostly)"). It is the switch in settings, one tap away: the same remembered setting, so the two always agree,
 * and turning it off stops the waiting music where it is. A bare note in its own 44 pt target, as the palette is,
 * struck through while sound is off; `glass` puts it in the glass circle Close wears over a photograph.
 */
export function SoundButton({ glass = false, style }: { glass?: boolean; style?: StyleProp<ViewStyle> }) {
  const p = usePalette();
  const [on, setOn] = useSoundsOn();
  const name = on ? "music" : "musicOff";
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel="Sound"
      accessibilityState={{ checked: on }}
      // The web reads the switch's state only from aria-checked; react-native-web drops accessibilityState's.
      aria-checked={on}
      onPress={() => {
        haptic.select();
        setOn(!on);
      }}
      style={({ pressed }) => [{ width: layout.control.icon, height: layout.control.icon, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.55 : 1 }, style]}
    >
      {glass ? (
        <Glass style={{ width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" }}>
          <Icon name={name} />
        </Glass>
      ) : (
        <Icon name={name} size={22} color={p.ink2} />
      )}
    </Pressable>
  );
}
