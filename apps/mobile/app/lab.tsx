import { Redirect } from "expo-router";
import { ScrollView, Text, View } from "react-native";
import { MediaHero, type Media } from "../components/media";
import { fonts, usePalette } from "../lib/theme";

// Development-only bench for the media views; production redirects away.
const car: Media = {
  kind: "vehicle",
  images: [],
  model3d: {
    provider: "sketchfab",
    uid: "d01b254483794de3819786d93e0e1ebf",
    name: "(FREE) Porsche 911 Carrera 4S",
    author: "Lionsharp Studios",
    license: "CC BY-SA",
    embedUrl: "https://sketchfab.com/models/d01b254483794de3819786d93e0e1ebf/embed?autostart=1&ui_theme=dark&transparent=1&ui_hint=0",
    thumbnail: "https://media.sketchfab.com/models/d01b254483794de3819786d93e0e1ebf/thumbnails/f28bf7eb32e646019bbaf886ff705679/3703397e693c47b2a66894bfb2ae7ea0.jpeg",
  },
};

const lisbon: Media = {
  kind: "place",
  images: [
    { url: "https://thumb.wikimedia.org/wikipedia/commons/thumb/6/69/Moored_Bojador%2C_Vera_Cruz%2C_and_Atyla%2C_Doca_de_Alc%C3%A2ntara%2C_Lisbon%2C_Portugal_julesvernex2.jpg/3840px-Moored_Bojador%2C_Vera_Cruz%2C_and_Atyla%2C_Doca_de_Alc%C3%A2ntara%2C_Lisbon%2C_Portugal_julesvernex2.jpg", source: "commons.wikimedia.org", credit: "Julesvernex2", license: "CC BY-SA 4.0" },
    { url: "https://thumb.wikimedia.org/wikipedia/commons/thumb/4/48/Old_Arsenal_da_Marinha_and_Doca_da_Caldeirinha%2C_Cais_do_Sodr%C3%A9%2C_Lisbon%2C_Portugal_julesvernex2.jpg/3840px-Old_Arsenal_da_Marinha_and_Doca_da_Caldeirinha%2C_Cais_do_Sodr%C3%A9%2C_Lisbon%2C_Portugal_julesvernex2.jpg", source: "commons.wikimedia.org", credit: "Julesvernex2", license: "CC BY-SA 4.0" },
    { url: "https://upload.wikimedia.org/wikipedia/commons/e/ef/Lisbon_%28Lisboa%29_historic_elevator_Santa_Justa_Luca_Galuzzi_2006.jpg", source: "commons.wikimedia.org", credit: "Luca Galuzzi", license: "CC BY-SA 2.5" },
  ],
};

const camera: Media = {
  kind: "product",
  images: [{ url: "https://upload.wikimedia.org/wikipedia/commons/thumb/6/6c/Leica_Q3.jpg/1600px-Leica_Q3.jpg", source: "commons.wikimedia.org" }],
  cutout: { url: "https://upload.wikimedia.org/wikipedia/commons/thumb/6/6c/Leica_Q3.jpg/1600px-Leica_Q3.jpg", from: "", model: "sam-3.1" },
};

export default function Lab() {
  const p = usePalette();
  if (!__DEV__) return <Redirect href="/" />;
  return (
    <ScrollView style={{ flex: 1, backgroundColor: p.bg }} contentContainerStyle={{ gap: 24, paddingVertical: 40, maxWidth: 520, width: "100%", alignSelf: "center" }}>
      {[
        ["Vehicle · 3D", car],
        ["Place · slideshow", lisbon],
        ["Product · turnable cutout", camera],
      ].map(([label, media]) => (
        <View key={label as string} style={{ gap: 8 }}>
          <Text style={{ fontFamily: fonts.label, color: p.ink2, paddingHorizontal: 16 }}>{label as string}</Text>
          <MediaHero media={media as Media} style={{ height: 420, borderRadius: 26, overflow: "hidden", marginHorizontal: 12 }} />
        </View>
      ))}
    </ScrollView>
  );
}
