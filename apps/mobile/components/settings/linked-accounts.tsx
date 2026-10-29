import { useState } from "react";
import { Text } from "react-native";
import { PROVIDER_ORDER, providerName, useAuth, type LinkedIdentity, type ProviderId, type SignInOption } from "../../lib/auth";
import { haptic } from "../../lib/motion";
import { unlinkProvider } from "../../lib/profile";
import { type, usePalette } from "../../lib/theme";
import { ErrorLine } from "../lux";
import { ProviderMark } from "../sign-in-options";
import { Card, Row, RowAction } from "./kit";

/**
 * The sign-in accounts on this account (owner: "link multiple sign-in accounts, Apple plus Google on one account").
 * Each of Apple, Google, Facebook and GitHub shows whether it is linked; Link adds one, Unlink removes it. Unlinking
 * is always safe: an email code to their address still signs them in.
 */
export function LinkedAccounts({
  identities,
  options,
  email,
  onChange,
  notice,
}: {
  identities: LinkedIdentity[] | null;
  /** The sign-in options the server offers on this device; null while loading. */
  options: SignInOption[] | null;
  email: string;
  onChange(next: LinkedIdentity[]): void;
  /** What came back from a link that left the app (the web), if anything. */
  notice: string | null;
}) {
  const p = usePalette();
  const auth = useAuth();
  const [pending, setPending] = useState<ProviderId | null>(null);
  const [error, setError] = useState<string | null>(null);

  const link = async (option: SignInOption) => {
    setPending(option.id);
    setError(null);
    try {
      const next = await auth.linkWith(option);
      if (next) {
        onChange(next);
        haptic.success();
      }
    } catch (e) {
      haptic.error();
      setError(e instanceof Error ? e.message : "That didn't go through. Try again.");
    } finally {
      setPending(null);
    }
  };
  const unlink = async (id: ProviderId) => {
    setPending(id);
    setError(null);
    try {
      onChange(await unlinkProvider(auth.api, id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't unlink that account. Try again.");
    } finally {
      setPending(null);
    }
  };

  return (
    <>
      <Card>
        {PROVIDER_ORDER.map((id, i) => {
          const linked = (identities ?? []).filter((x) => x.provider === id);
          const option = options?.find((o) => o.id === id) ?? null;
          const who = linked.map((x) => x.email ?? x.name).filter(Boolean)[0];
          const detail = identities === null ? " " : linked.length ? (who ? `Linked as ${who}` : "Linked") : option ? "Not linked" : "Not available yet";
          return (
            <Row
              key={id}
              first={i === 0}
              leading={<ProviderMark id={id} />}
              label={providerName(id)}
              detail={detail}
              accessory={
                identities === null ? null : linked.length ? (
                  <RowAction label="Unlink" tone="quiet" busy={pending === id} onPress={() => unlink(id)} accessibilityLabel={`Unlink ${providerName(id)}`} />
                ) : option ? (
                  <RowAction label="Link" busy={pending === id} onPress={() => link(option)} accessibilityLabel={`Link ${providerName(id)}`} />
                ) : null
              }
            />
          );
        })}
      </Card>
      <ErrorLine>{error ?? notice}</ErrorLine>
      <Text style={[type.footnote, { color: p.ink3 }]}>{`An email code to ${email} always signs you in, whatever is linked here.`}</Text>
    </>
  );
}
