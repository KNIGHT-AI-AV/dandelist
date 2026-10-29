import { FilterMode, ImageFormat, MipmapMode, Skia } from "@shopify/react-native-skia";

/**
 * The middle square of a photo, scaled down to `edge` and saved as a JPEG, on the phone with Skia (already in the app
 * for the title's glass). The picker hands over a JPEG copy of an iPhone's HEIC photo, which Skia reads like any
 * JPEG, PNG or WebP. Null when the photo can't be read.
 */
export async function squareJpeg(uri: string, edge: number): Promise<Uint8Array | null> {
  const image = Skia.Image.MakeImageFromEncoded(await Skia.Data.fromURI(uri));
  if (!image) return null;
  const w = image.width();
  const h = image.height();
  const side = Math.min(w, h);
  const out = Math.min(edge, side);
  const surface = Skia.Surface.MakeOffscreen(out, out) ?? Skia.Surface.Make(out, out);
  if (!surface) return null;
  surface.getCanvas().drawImageRectOptions(image, Skia.XYWHRect((w - side) / 2, (h - side) / 2, side, side), Skia.XYWHRect(0, 0, out, out), FilterMode.Linear, MipmapMode.Linear, null);
  surface.flush();
  const bytes = surface.makeImageSnapshot().encodeToBytes(ImageFormat.JPEG, 88);
  return bytes.length ? bytes : null;
}
