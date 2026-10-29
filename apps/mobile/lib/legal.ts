import type { LegalSection } from "../components/legal";

/**
 * Public privacy policy and terms, shown together at /legal. The wording is outward-facing: the October 27 text passed
 * aitextclean.com before shipping; the October 28 additions (Facebook, the profile, deleting your data) must pass it
 * too before this ships (owner rule, 2026-10-14). Meta's app dashboard points at the "deletion" section:
 * https://dandelist.knightaiav.com/legal?section=deletion
 */

export const PRIVACY_UPDATED = "Last updated October 28, 2026";
export const PRIVACY: LegalSection[] = [
  {
    heading: "What Dandelist is",
    body: [
      "Dandelist is a free, open-source app from Knight AI+AV. You list the things you want, an AI agent looks up their real prices, and the app shows what they cost and when you could have them.",
    ],
  },
  {
    heading: "What we collect",
    body: [
      "Your email address, so you can sign in. If you sign in with Apple, Google, GitHub or Facebook, we receive your email address and, when the service shares it, your name. From Facebook we ask only for your public profile and your email address.",
      "If you add them in Settings, a display name, a profile photo and where you would like to live. You can change or remove each of them at any time.",
      "The wishes you add: what you describe, the prices and sources the agent found, and the choices you make, such as your monthly amount, your timeline and your theme.",
      "Before you create an account, your picks stay on your device. They are sent to us only when you save them to an account.",
    ],
  },
  {
    heading: "How the agent uses your words",
    body: [
      "To price a wish, we send what you typed, and the answers you give to its questions, to Meta's Model API, which runs the Muse Spark model. The agent then searches the web and reads sellers' pages to check prices.",
      "When you ask for facts about your list in Settings, we send your wishes and the place you would like to live, so the agent can write them.",
      "We don't send your email address or name to Meta. We use Meta's standard models, not the modes that let Meta train on your data.",
    ],
  },
  {
    heading: "What we don't do",
    body: [
      "We don't sell your data, show ads, or share your wishes with anyone. We don't connect to your bank or ask for financial details. We don't post anything to Facebook or any other account you sign in with.",
    ],
  },
  {
    heading: "Where your data lives",
    body: [
      "Our servers and database run on Amazon Web Services in the United States. The website is served by Cloudflare. Sign-in codes are emailed through Resend.",
    ],
  },
  {
    id: "deletion",
    heading: "Deleting your data",
    body: [
      "You can delete your account at any time in the app: open Settings, choose Delete account under Account, and confirm. That removes your account and every wish on it, along with your profile, your conversations and every sign-in account linked to it, Facebook included.",
      "If you signed in with Facebook, you can also remove Dandelist under Apps and websites in your Facebook settings. That stops Facebook sharing anything more with us; to remove what we already hold, delete your account as above.",
      "If you can't open the app, email build@knightaiav.com from the address on your account and we will delete it within 30 days.",
      "Pre-account picks stored on your device are cleared when you delete the app or your browser data.",
    ],
  },
  {
    heading: "Contact",
    body: ["Questions about privacy: build@knightaiav.com."],
  },
];

export const TERMS_UPDATED = "Last updated October 27, 2026";
export const TERMS: LegalSection[] = [
  {
    heading: "Using Dandelist",
    body: [
      "Dandelist is free to use. Its source code is open under the MIT License. By using the app, you agree to these terms.",
    ],
  },
  {
    heading: "Prices are a guide",
    body: [
      "The agent checks prices on sellers' own pages and shows when each one was checked. Prices change, and some figures are estimates; the app labels them as such. Always confirm the price with the seller before you buy.",
      "Dandelist helps you plan. It is not financial, tax or legal advice, and it doesn't buy anything for you.",
    ],
  },
  {
    heading: "Your account",
    body: [
      "Keep your sign-in secure. Don't use the app to break the law, to overload it, or to get around its limits. We may limit or close accounts that do.",
    ],
  },
  {
    heading: "Other sites",
    body: ["Links and images come from sellers and other sites. We don't control those sites and aren't responsible for them."],
  },
  {
    heading: "No warranty",
    body: [
      "The app is provided as is, without warranties of any kind. To the extent the law allows, Knight AI+AV isn't liable for losses that come from using it.",
    ],
  },
  {
    heading: "Changes and contact",
    body: ["We may update these terms and will change the date above when we do. Questions: build@knightaiav.com."],
  },
];
