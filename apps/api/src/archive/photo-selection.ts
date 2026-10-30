/**
 * Select from already-approved photos for one entity. A single explicit hero is sufficient; missing or
 * ambiguous selection stays withheld. Preserve gallery order and metadata without mutating stored approval.
 */
export function selectHeroPhotos<T extends { hero: boolean }>(photos: T[]): T[] | null {
  const heroes = photos.filter((photo) => photo.hero === true);
  if (heroes.length !== 1) return null;
  const hero = heroes[0]!;
  return [hero, ...photos.filter((photo) => photo !== hero)];
}
