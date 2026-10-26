import { Redirect } from "expo-router";
import { useState } from "react";
import { Body, Button, ErrorText, Field, Screen, Title } from "../components/ui";
import { useAuth } from "../lib/auth";

export default function SignIn() {
  const auth = useAuth();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (auth.status === "signedIn") return <Redirect href="/wishes" />;

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!sentTo) {
    return (
      <Screen>
        <Title>Dandelist</Title>
        <Body muted>Price the life you want. Sign in with your email to keep your wishes.</Body>
        <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" inputMode="email" placeholder="you@example.com" onSubmitEditing={() => run(async () => { await auth.startEmail(email); setSentTo(email.trim()); })} />
        <ErrorText>{error}</ErrorText>
        <Button label="Email me a code" busy={busy} disabled={!email.includes("@")} onPress={() => run(async () => { await auth.startEmail(email); setSentTo(email.trim()); })} />
      </Screen>
    );
  }

  return (
    <Screen>
      <Title>Check your email</Title>
      <Body muted>{`We sent a 6-digit code to ${sentTo}. It expires in 10 minutes.`}</Body>
      <Field label="Code" value={code} onChangeText={(t) => setCode(t.replace(/\D/g, "").slice(0, 6))} keyboardType="number-pad" inputMode="numeric" autoComplete="one-time-code" textContentType="oneTimeCode" placeholder="123456" onSubmitEditing={() => run(() => auth.verifyEmail(sentTo, code))} />
      <ErrorText>{error}</ErrorText>
      <Button label="Sign in" busy={busy} disabled={code.length !== 6} onPress={() => run(() => auth.verifyEmail(sentTo, code))} />
      <Button label="Use a different email" kind="quiet" onPress={() => { setSentTo(null); setCode(""); setError(null); }} />
    </Screen>
  );
}
