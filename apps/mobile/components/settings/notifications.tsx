import { useEffect, useState } from "react";
import { Linking, Switch, Text, View } from "react-native";
import { haptic } from "../../lib/motion";
import { notifier } from "../../lib/notifications";
import { updateReminders, useReminderState } from "../../lib/reminder-state";
import { mayNotify, stepTime, timeLabel, type Permission, type ReminderPrefs } from "../../lib/reminders";
import { layout, type, usePalette } from "../../lib/theme";
import { Chip } from "../lux";
import { Card, Row, RowAction, RowRule, Section } from "./kit";

/**
 * Notifications in Settings (owner's brief, 2026-10-29): today's pick on or off and its time, and the nudge off or once
 * a week. Turning one on here is the person's yes, so the phone is asked then if it hasn't been. Shown only where the
 * phone's notifications are switched on (lib/notifications.ts); never on the web.
 */
export function NotificationSettings() {
  return notifier.available ? <Settings /> : null;
}

function Settings() {
  const p = usePalette();
  const { prefs, ask } = useReminderState();
  const [permission, setPermission] = useState<Permission | null>(null);
  useEffect(() => void notifier.permission().then(setPermission), []);
  const on = ask?.answer === "yes" && permission !== null && mayNotify(permission);
  const daily = on && prefs.daily;
  const nudges = on ? prefs.nudges : "off";

  /** Saves a change; one that turns something on while nothing is on asks the phone first, and sets only that. */
  const change = async (next: Partial<ReminderPrefs>, turnsOn: boolean) => {
    haptic.select();
    if (turnsOn && !on) {
      const allowed = await notifier.request();
      setPermission(allowed);
      if (!mayNotify(allowed)) return;
      await updateReminders((s) => ({
        ...s,
        ask: { answer: "yes", at: new Date().toISOString(), laters: s.ask?.laters ?? 0 },
        prefs: { ...s.prefs, daily: false, nudges: "off", ...next },
      }));
      return;
    }
    await updateReminders((s) => ({ ...s, prefs: { ...s.prefs, ...next } }));
  };
  const time = (by: -1 | 1) => void change(stepTime(prefs.hour, prefs.minute, by), false);

  return (
    <Section title="Notifications" hint="Picks and nudges are set on this phone.">
      <Card>
        <Row
          first
          label="Daily pick"
          detail="One new find each day"
          accessory={<Switch accessibilityLabel="Daily pick" value={daily} onValueChange={(v) => void change({ daily: v }, v)} trackColor={{ false: p.track, true: p.accent }} ios_backgroundColor={p.track} />}
        />
        {daily ? (
          <Row
            label="Time"
            value={timeLabel(prefs.hour, prefs.minute)}
            accessory={
              <View style={{ flexDirection: "row", gap: 8 }}>
                <RowAction label="Earlier" accessibilityLabel="Earlier by half an hour" tone="quiet" onPress={() => time(-1)} />
                <RowAction label="Later" accessibilityLabel="Later by half an hour" tone="quiet" onPress={() => time(1)} />
              </View>
            }
          />
        ) : null}
        <RowRule />
        <View style={{ paddingHorizontal: layout.cardPad, paddingVertical: 14, gap: 12 }}>
          <Text style={[type.body, { color: p.ink }]}>Nudges</Text>
          <View style={{ flexDirection: "row", gap: 8 }} accessibilityRole="radiogroup">
            <Chip label="Off" selected={nudges === "off"} onPress={() => void change({ nudges: "off" }, false)} style={{ flex: 1 }} />
            <Chip label="Once a week" selected={nudges === "weekly"} onPress={() => void change({ nudges: "weekly" }, true)} style={{ flex: 1 }} />
          </View>
          <Text style={[type.footnote, { color: p.ink3 }]}>A reminder to add what you've spotted, at most once a week, and never in a week you've added something.</Text>
        </View>
      </Card>
      {permission === "denied" ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <Text style={[type.footnote, { color: p.ink2, flex: 1 }]}>Notifications are off for Dandelist in this phone's settings.</Text>
          <RowAction label="Open settings" onPress={() => void Linking.openSettings()} />
        </View>
      ) : null}
    </Section>
  );
}
