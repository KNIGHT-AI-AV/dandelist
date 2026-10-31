import { Dimensions } from "react-native";
import { captureScreen } from "react-native-view-shot";

/** Wide enough to read every word on a phone screen, small enough to send in a second or two. */
const WIDTH = 750;

/** The screen as it is now, as a JPEG in base64, for a help report (lib/help.ts); null when it can't be taken. */
export async function screenShot(): Promise<string | null> {
  const { width, height } = Dimensions.get("window");
  try {
    return await captureScreen({ format: "jpg", quality: 0.6, result: "base64", width: WIDTH, height: Math.round((WIDTH * height) / width) });
  } catch {
    return null;
  }
}
