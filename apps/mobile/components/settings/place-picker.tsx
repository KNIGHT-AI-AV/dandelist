import { useEffect, useMemo, useState } from "react";
import { FlatList, Modal, Platform, Pressable, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { haptic } from "../../lib/motion";
import { layout, radius, type, usePalette, useType } from "../../lib/theme";
import { Field } from "../inputs";
import { ErrorLine, Eyebrow, Hairline, IconButton } from "../lux";
import { cleanCity, countryName, fold, searchCities, searchCountries, type CountryHit } from "./places";

export interface Place {
  country: string;
  city: string | null;
}

/** One choice in the list: a line of text, an optional quiet line under it, a 52 pt target. */
function Choice({ label, detail, selected, onPress }: { label: string; detail?: string; selected?: boolean; onPress(): void }) {
  const p = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      onPress={onPress}
      style={({ pressed }) => [{ minHeight: 52, justifyContent: "center", paddingHorizontal: 4, borderRadius: radius.sm, backgroundColor: pressed ? p.track : "transparent" }, Platform.OS === "web" ? ({ cursor: "pointer" } as object) : null]}
    >
      <Text style={[type.body, { color: selected ? p.accentText : p.ink }]}>{label}</Text>
      {detail ? <Text style={[type.footnote, { color: p.ink3 }]}>{detail}</Text> : null}
    </Pressable>
  );
}

/**
 * Where they would like to live, in two steps: the country (search by name, another name or a city in it), then the
 * city (search the major ones, keep the country alone, or use exactly what they typed). `onSave` keeps it on the
 * account; the sheet stays open with the reason if that fails.
 */
export function PlacePicker({ open, initial, onClose, onSave }: { open: boolean; initial: Place | null; onClose(): void; onSave(place: Place): Promise<void> }) {
  const p = usePalette();
  const t = useType();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const gutter = layout.gutter(width);
  const [country, setCountry] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setCountry(null);
    setQuery("");
    setError(null);
    setBusy(false);
  }, [open]);

  const countries = useMemo(() => (country ? [] : searchCountries(query)), [country, query]);
  const cities = useMemo(() => (country ? searchCities(country, query) : []), [country, query]);
  const typed = cleanCity(query);
  const typedIsListed = !!typed && cities.some((c) => fold(c) === fold(typed));

  const save = async (place: Place) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSave(place);
      haptic.success();
      onClose();
    } catch (e) {
      haptic.error();
      setError(e instanceof Error ? e.message : "Couldn't save that place. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const pickCountry = (hit: CountryHit) => {
    if (hit.city) return void save({ country: hit.code, city: hit.city });
    setCountry(hit.code);
    setQuery("");
  };

  const name = country ? countryName(country) : "";
  return (
    <Modal visible={open} animationType={Platform.OS === "web" ? "fade" : "slide"} presentationStyle={Platform.OS === "ios" ? "pageSheet" : undefined} onRequestClose={country ? () => setCountry(null) : onClose} statusBarTranslucent>
      <View style={{ flex: 1, backgroundColor: p.bg, paddingTop: Platform.OS === "ios" ? 12 : insets.top, paddingHorizontal: gutter }}>
        <View style={{ width: "100%", maxWidth: layout.list, alignSelf: "center", flex: 1, gap: layout.stack.base }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: layout.headerBar }}>
            {country ? (
              <IconButton
                icon="back"
                label="Choose another country"
                onPress={() => {
                  setCountry(null);
                  setQuery("");
                }}
              />
            ) : (
              <View style={{ width: 44 }} />
            )}
            <Eyebrow>{country ? name : "Where you'd live"}</Eyebrow>
            <IconButton icon="close" label="Close" onPress={onClose} />
          </View>
          <Text accessibilityRole="header" style={[t.title2, { color: p.ink }]}>
            {country ? `Which city in ${name}?` : "Which country?"}
          </Text>
          <Field
            key={country ?? "country"}
            label={country ? `Search cities in ${name}` : "Search countries or cities"}
            labelHidden
            value={query}
            onChangeText={setQuery}
            placeholder={country ? "Type a city" : "Portugal, Dubai, Japan"}
            autoFocus={Platform.OS === "web"}
            autoCorrect={false}
            autoCapitalize="words"
            returnKeyType="done"
            onSubmitEditing={() => {
              if (country && typed) void save({ country, city: cities[0] && fold(cities[0]).startsWith(fold(typed)) ? cities[0] : typed });
              else if (!country && countries[0]) pickCountry(countries[0]);
            }}
          />
          <ErrorLine>{error}</ErrorLine>
          {country ? (
            <FlatList
              data={cities}
              keyExtractor={(c) => c}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingBottom: insets.bottom + layout.stack.section }}
              ItemSeparatorComponent={() => <Hairline />}
              ListHeaderComponent={
                <View>
                  {typed && !typedIsListed ? (
                    <>
                      <Choice label={`Use "${typed}"`} detail={`A city or town in ${name}`} onPress={() => save({ country, city: typed })} />
                      <Hairline />
                    </>
                  ) : null}
                  <Choice label={`Anywhere in ${name}`} detail="The country, no city" selected={initial?.country === country && !initial.city} onPress={() => save({ country, city: null })} />
                  {cities.length ? <Hairline /> : null}
                </View>
              }
              renderItem={({ item }) => <Choice label={item} selected={initial?.country === country && initial.city === item} onPress={() => save({ country, city: item })} />}
            />
          ) : (
            <FlatList
              data={countries}
              keyExtractor={(h) => `${h.code}:${h.city ?? ""}`}
              keyboardShouldPersistTaps="handled"
              initialNumToRender={24}
              contentContainerStyle={{ paddingBottom: insets.bottom + layout.stack.section }}
              ItemSeparatorComponent={() => <Hairline />}
              ListEmptyComponent={<Text style={[type.callout, { color: p.ink2, paddingVertical: 12 }]}>No country by that name. Try another spelling.</Text>}
              renderItem={({ item }) => (
                <Choice label={item.city ? `${item.city}, ${item.name}` : item.name} selected={!item.city && initial?.country === item.code} onPress={() => pickCountry(item)} />
              )}
            />
          )}
          {busy ? <Text style={[type.footnote, { color: p.ink3, textAlign: "center", paddingBottom: insets.bottom + 8 }]}>Saving</Text> : null}
        </View>
      </View>
    </Modal>
  );
}
