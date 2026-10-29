import { useEffect, useState } from "react";
import { Platform, Text, View } from "react-native";
import { MCP_URL, lastUsedLine, listAgentKeys, makeAgentKey, revokeAgentKey, type AgentKey } from "../../lib/agent-keys";
import { useAuth } from "../../lib/auth";
import { haptic } from "../../lib/motion";
import { fonts, layout, type, usePalette } from "../../lib/theme";
import { Field } from "../inputs";
import { ErrorLine, PrimaryButton, QuietButton } from "../lux";
import { Card, Row } from "./kit";

/** The key in a box anyone can select, and on the web a Copy button too. */
function Secret({ value }: { value: string }) {
  const p = usePalette();
  const [copied, setCopied] = useState(false);
  const clip = Platform.OS === "web" ? (globalThis.navigator as Navigator | undefined)?.clipboard : undefined;
  return (
    <View style={{ gap: layout.stack.tight }}>
      <Text selectable style={[type.footnote, { fontFamily: fonts.figure, color: p.ink, backgroundColor: p.track, padding: 12, borderRadius: 10 }]}>
        {value}
      </Text>
      {clip ? (
        <QuietButton
          label={copied ? "Copied" : "Copy"}
          onPress={() =>
            void clip.writeText(value).then(
              () => setCopied(true),
              () => setCopied(false),
            )
          }
          style={{ alignSelf: "flex-start" }}
        />
      ) : null}
    </View>
  );
}

/**
 * Agents (owner, 2026-10-29: "Build mcp for agent", "Needs full control (secure security for each account no bleed)"):
 * the MCP server's address, a key for each agent the person connects, made here and shown once, and Revoke, which
 * cuts that agent off at once. A key reaches this account only.
 */
export function AgentKeys() {
  const p = usePalette();
  const { api } = useAuth();
  const [keys, setKeys] = useState<AgentKey[] | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);
  const [arming, setArming] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    listAgentKeys(api).then(
      (k) => live && setKeys(k),
      (e: Error) => live && setError(e.message),
    );
    return () => {
      live = false;
    };
  }, [api]);

  const make = async () => {
    if (busy || !name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const made = await makeAgentKey(api, name);
      setFresh(made.key);
      setKeys((k) => [made.record, ...(k ?? [])]);
      setName("");
      haptic.success();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // Two taps: the first only arms it.
  const revoke = async (id: string) => {
    if (arming !== id) return setArming(id);
    setArming(null);
    setError(null);
    try {
      await revokeAgentKey(api, id);
      setKeys((k) => (k ?? []).filter((x) => x.id !== id));
      haptic.success();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <View style={{ gap: layout.stack.base }}>
      <Card>
        <Row first label="MCP server" detail={MCP_URL} />
        {(keys ?? []).map((k) => (
          <Row
            key={k.id}
            label={k.name}
            detail={`${k.prefix}... · ${lastUsedLine(k.lastUsedAt)}`}
            accessory={<QuietButton label={arming === k.id ? "Tap again to revoke" : "Revoke"} color={arming === k.id ? p.danger : undefined} onPress={() => void revoke(k.id)} />}
          />
        ))}
      </Card>
      {fresh ? (
        <View style={{ gap: layout.stack.tight }}>
          <Text style={[type.body, { color: p.ink }]}>Your new key</Text>
          <Secret value={fresh} />
          <Text style={[type.footnote, { color: p.ink3 }]}>Copy it now. It won't be shown again.</Text>
          <QuietButton label="Done" onPress={() => setFresh(null)} style={{ alignSelf: "flex-start" }} />
        </View>
      ) : (
        <View style={{ gap: layout.stack.tight }}>
          <Field label="Agent name" value={name} onChangeText={setName} onSubmitEditing={() => void make()} placeholder="Claude on my laptop" maxLength={60} autoCapitalize="sentences" />
          <PrimaryButton label="Make a key" busyLabel="Making a key..." busy={busy} disabled={!name.trim()} onPress={() => void make()} />
        </View>
      )}
      <ErrorLine>{error}</ErrorLine>
    </View>
  );
}
