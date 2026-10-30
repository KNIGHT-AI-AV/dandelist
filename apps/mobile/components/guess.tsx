import { Animated, Pressable, ScrollView, Text, View } from "react-native";
import type { WishCandidate } from "../lib/agent";
import type { CandidatePick } from "../lib/guess";
import { usePress } from "../lib/motion";
import { layout, radius, type, usePalette } from "../lib/theme";
import { Chip, Icon, Photo, QuietButton } from "./lux";
import { PhotoCredit } from "./photo-credit";

/**
 * Under a card the reading had to work out (owner, 2026-10-30: "one of those cats that look like a miniature lion, but
 * I forgot what they're called", then "no, not that one", "yeah, that's the one"): it says the card is a best guess,
 * "Yes, that's the one" keeps it and the row goes away, each other likely name hunts that one instead, and "Something
 * else" lets them say more. One tap does each. `center` sets it under a centred title.
 */
export function GuessRow({ others, onConfirm, onPick, onElse, center = false }: { others: string[]; onConfirm(): void; onPick(name: string): void; onElse?(): void; center?: boolean }) {
  const p = usePalette();
  return (
    <View style={{ gap: layout.stack.tight, alignItems: center ? "center" : "flex-start" }}>
      <Text style={[type.footnote, { color: p.ink2, textAlign: center ? "center" : "left" }]}>Best guess from what you said.</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, justifyContent: center ? "center" : "flex-start" }}>
        <Chip label="Yes, that's the one" selected onPress={onConfirm} />
        {others.map((name) => (
          <Chip key={name} label={name} onPress={() => onPick(name)} />
        ))}
      </View>
      {onElse ? <QuietButton label="Something else" onPress={onElse} /> : null}
    </View>
  );
}

/** A candidate's tile: a 4:3 photo this wide, then its make, model and variant. */
const TILE = 136;

/**
 * A vague wish's candidates as photos to pick from (owner, 2026-10-30: "For refining a pick. Images of multiple items
 * up to 5 with make model sub names just in case so user can pick which one they meant if it was not specific
 * enough"). Each tile is the thing's photo, its make, model and variant, and the photo's credit. The one being hunted
 * is ringed in the accent: tapping it keeps it and the row goes away, as "Yes, that's the one" does; tapping another
 * hunts that one instead; "Something else" lets them say more. The row scrolls sideways when it is wider than the card.
 */
export function CandidateRow({ pick, onConfirm, onPick, onElse, center = false }: { pick: CandidatePick; onConfirm(): void; onPick(name: string): void; onElse?(): void; center?: boolean }) {
  const p = usePalette();
  return (
    <View style={{ gap: layout.stack.tight, alignItems: center ? "center" : "flex-start", alignSelf: "stretch" }}>
      <Text style={[type.footnote, { color: p.ink2, textAlign: center ? "center" : "left" }]}>Which one did you mean?</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ alignSelf: "stretch" }} contentContainerStyle={{ gap: 10, paddingVertical: 2, ...(center ? { flexGrow: 1, justifyContent: "center" } : {}) }}>
        {pick.candidates.map((c, i) => (
          <CandidateTile key={c.name} candidate={c} current={i === pick.current} onPress={() => (i === pick.current ? onConfirm() : onPick(c.name))} />
        ))}
      </ScrollView>
      {onElse ? <QuietButton label="Something else" onPress={onElse} /> : null}
    </View>
  );
}

function CandidateTile({ candidate: c, current, onPress }: { candidate: WishCandidate; current: boolean; onPress(): void }) {
  const p = usePalette();
  const press = usePress(0.97);
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={c.name} accessibilityState={{ selected: current }} aria-selected={current} onPress={onPress} onPressIn={press.onPressIn} onPressOut={press.onPressOut}>
      <Animated.View style={{ width: TILE, gap: 2, transform: [{ scale: press.scale }] }}>
        <View style={{ width: TILE, height: (TILE * 3) / 4, borderRadius: radius.sm, overflow: "hidden", borderWidth: current ? 2 : 1, borderColor: current ? p.accent : p.line, marginBottom: 6 }}>
          <Photo uri={c.image?.url} />
          {current ? (
            <View style={{ position: "absolute", top: 6, right: 6, width: 22, height: 22, borderRadius: 11, backgroundColor: p.accent, alignItems: "center", justifyContent: "center" }}>
              <Icon name="check" size={13} color={p.onAccent} />
            </View>
          ) : null}
        </View>
        {c.make ? (
          <Text style={[type.footnote, { color: p.ink3 }]} numberOfLines={1}>
            {c.make}
          </Text>
        ) : null}
        <Text style={[type.callout, { color: p.ink }]} numberOfLines={1}>
          {c.model}
        </Text>
        {c.variant ? (
          <Text style={[type.footnote, { color: p.ink2 }]} numberOfLines={1}>
            {c.variant}
          </Text>
        ) : null}
        <PhotoCredit image={c.image} />
      </Animated.View>
    </Pressable>
  );
}
