import { useLocalSearchParams } from "expo-router";
import { LegalPage } from "../components/legal";
import { PRIVACY, PRIVACY_UPDATED, TERMS, TERMS_UPDATED } from "../lib/legal";

const DOCUMENTS = [
  { id: "privacy", title: "Privacy", updated: PRIVACY_UPDATED, sections: PRIVACY },
  { id: "terms", title: "Terms", updated: TERMS_UPDATED, sections: TERMS },
];

/**
 * Privacy and Terms on one page (owner's walkthrough, 2026-10-28). `?section=terms` opens at the terms and
 * `?section=deletion` at how to delete your data, the address Meta's app dashboard links to.
 */
export default function Legal() {
  const { section } = useLocalSearchParams<{ section?: string }>();
  return <LegalPage eyebrow="Dandelist" title="Privacy & Terms" documents={DOCUMENTS} focus={typeof section === "string" ? section : undefined} />;
}
