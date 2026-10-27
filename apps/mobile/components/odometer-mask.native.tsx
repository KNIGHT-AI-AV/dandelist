import MaskedView from "@react-native-masked-view/masked-view";
import { LinearGradient } from "expo-linear-gradient";
import { useState, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";

/** Phone version of the odometer's edge fade: the row is masked by a vertical gradient (`odometer-mask.tsx`). */
export function EdgeMask({ pad, children }: { pad: number; children: ReactNode }) {
  const [h, setH] = useState(0);
  const edge = h > 0 ? Math.min(0.45, pad / h) : 0.2;
  return (
    <MaskedView
      onLayout={(e) => setH(e.nativeEvent.layout.height)}
      maskElement={
        <View style={StyleSheet.absoluteFill}>
          <LinearGradient colors={["transparent", "#000", "#000", "transparent"]} locations={[0, edge, 1 - edge, 1]} style={StyleSheet.absoluteFill} />
        </View>
      }
    >
      {children}
    </MaskedView>
  );
}
