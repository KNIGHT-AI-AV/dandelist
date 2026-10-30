// Local notifications need no push entitlement, but expo-notifications' config plugin writes aps-environment on iOS
// (expo/expo sdk-57, withNotificationsIOS.ts). Expo runs the plugins' file changes in reverse list order, so this one is
// listed BEFORE expo-notifications in app.json: its change then runs after that one's and removes the key, and the App ID
// and its profile need no Push capability. Checked with `npx expo config --type introspect` (ios.entitlements).
const { withEntitlementsPlist } = require("expo/config-plugins");

module.exports = function withoutPushEntitlement(config) {
  return withEntitlementsPlist(config, (c) => {
    delete c.modResults["aps-environment"];
    return c;
  });
};
