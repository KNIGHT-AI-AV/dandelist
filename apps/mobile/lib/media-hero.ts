import type { Media, MediaImage, Model3d } from "../components/media";
import { cutoutSourceImage } from "./photo-credit";

type HeroSelection =
  | { kind: "model"; model: Model3d }
  | { kind: "slideshow"; images: MediaImage[] }
  | { kind: "cutout"; cutout: NonNullable<Media["cutout"]>; original?: MediaImage }
  | { kind: "photo"; image?: MediaImage };

/** The renderer and its actual source, shared by MediaHero and captions outside its image layer. */
export function selectMediaHero(media?: Media): HeroSelection {
  if (media?.model3d) return { kind: "model", model: media.model3d };
  if (media && (media.kind === "place" || media.kind === "experience") && media.images.length > 1) {
    return { kind: "slideshow", images: media.images };
  }
  if (media?.cutout) return { kind: "cutout", cutout: media.cutout, original: cutoutSourceImage(media.images, media.cutout.from) };
  return { kind: "photo", image: media?.images[0] };
}
