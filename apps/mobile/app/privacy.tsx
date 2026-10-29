import { Redirect, useLocalSearchParams } from "expo-router";

/** /privacy still works: it opens the combined page at the privacy policy, or at a section of it (?section=deletion). */
export default function Privacy() {
  const { section } = useLocalSearchParams<{ section?: string }>();
  return <Redirect href={{ pathname: "/legal", params: { section: typeof section === "string" && section ? section : "privacy" } }} />;
}
