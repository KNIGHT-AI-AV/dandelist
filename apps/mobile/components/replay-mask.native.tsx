/**
 * Hides what it wraps from the phone's session replay while people still see it and screen readers still read it:
 * posthog-react-native 4.81.2's PostHogMaskView, a native wrapper view labelled "ph-no-capture" that the replay
 * recorder masks (its recorder treats images and text separately, and this app's replays show images). The help
 * sheet's preview of the screen goes in one (review of #140, H3): its text is pixels there, out of the reach of text
 * masking, so without this a replay could carry the screen before Send, or after Cancel.
 */
export { PostHogMaskView as ReplayMask } from "posthog-react-native";
