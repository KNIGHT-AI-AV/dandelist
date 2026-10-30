// Local notifications need no push entitlement, but expo-notifications' config plugin writes aps-environment on iOS
// (expo/expo sdk-57, withNotificationsIOS.ts). Listed after it in app.json, this plugin's change runs after its one and
// removes the key, so the App ID and its profile need no Push capability.
const { withEntitlementsPlist } = require("expo/config-plugins");

module.exports = function withoutPushEntitlement(config) {
  return withEntitlementsPlist(config, (c) => {
    delete c.modResults["aps-environment"];
    return c;
  });
};
