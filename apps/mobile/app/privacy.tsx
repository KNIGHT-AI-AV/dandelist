import { LegalPage } from "../components/legal";
import { PRIVACY, PRIVACY_UPDATED } from "../lib/legal";

export default function Privacy() {
  return <LegalPage eyebrow="Dandelist" title="Privacy" updated={PRIVACY_UPDATED} sections={PRIVACY} />;
}
