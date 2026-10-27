import { LegalPage } from "../components/legal";
import { TERMS, TERMS_UPDATED } from "../lib/legal";

export default function Terms() {
  return <LegalPage eyebrow="Dandelist" title="Terms" updated={TERMS_UPDATED} sections={TERMS} />;
}
