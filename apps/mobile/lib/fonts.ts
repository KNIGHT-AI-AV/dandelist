import { DMMono_400Regular } from "@expo-google-fonts/dm-mono";
import { InstrumentSerif_400Regular, InstrumentSerif_400Regular_Italic } from "@expo-google-fonts/instrument-serif";
import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold } from "@expo-google-fonts/inter";
import { InterTight_400Regular } from "@expo-google-fonts/inter-tight";
import { useFonts } from "expo-font";

/**
 * Loads the faces lib/palette.ts sets, as [loaded, error] like expo-font's useFonts. Instrument Serif (OFL), the logo's
 * face, sets every serif role since the readability pass of 2026-10-27; Bodoni Moda's six cuts stayed loaded after it,
 * set by nothing, and the first frame waited for them (Lighthouse, 2026-10-30). The web loads WOFF2 cuts of the same
 * files instead (fonts.web.ts).
 */
export function useAppFonts(): [boolean, Error | null] {
  return useFonts({
    InstrumentSerif_400Regular,
    InstrumentSerif_400Regular_Italic,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    InterTight_400Regular,
    DMMono_400Regular,
  });
}
