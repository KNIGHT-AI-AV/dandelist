import type { LegalSection } from "../components/legal";

/**
 * Public privacy policy and terms, shown together at /legal. The wording is outward-facing: the October 27 text passed
 * aitextclean.com before shipping; the October 28 additions (Facebook, the profile, deleting your data) must pass it
 * too before this ships (owner rule, 2026-10-14). Meta's app dashboard points at the "deletion" section:
 * https://dandelist.knightaiav.com/legal?section=deletion
 */

export const PRIVACY_UPDATED = "Last updated November 14, 2026";
export const PRIVACY: LegalSection[] = [
  {
    heading: "What Dandelist is",
    body: [
      "Dandelist is a free, open-source app from Knight AI+AV. You list the things you want, an AI agent can read pages to help check prices, and the app shows costs and estimates for keeping them.",
    ],
  },
  {
    heading: "What we collect",
    body: [
      "Your email address, so you can sign in. If you sign in with Apple, Google, GitHub or Facebook, we receive your email address and, when the service shares it, your name. From Facebook we ask only for your public profile and your email address.",
      "Facebook sign-in is only for accounts already linked to it. New Facebook sign-ups and links are unavailable. You can use email or another available sign-in option.",
      "If you add them in Settings, a display name, a profile photo and where you would like to live. You can change or remove each of them at any time.",
      "The wishes you add: what you describe, the prices and sources the agent found, and the choices you make, such as your monthly amount, your timeline and your theme.",
      "Before you create an account, your picks and your first wish are kept on your device, not in an account. To preview your list, the app sends your picks to our server, which adds them up without AI. Nothing you add goes to an AI service until you have an account and have agreed to how Dandelist uses AI; your first wish is priced after that. We don't store your picks; they join an account only when you save your list to one.",
      "If you send us a report with Help, we keep a picture of the screen you were on, your latest conversation, your list and the app's state, so we can see what went wrong. Only our team sees them, and deleting your account deletes them.",
    ],
  },
  {
    heading: "How the agent uses your words",
    body: [
      "To help price a wish, we send what you type, your answers and relevant saved wishes, chat context and memory to Anthropic's Claude API, using Claude Haiku 5.5. Page content the agent reads and real photos it checks may also be sent to Claude.",
      "This pilot has no Meta AI fallback. Live web search, voice input, image generation, upscaling and cutouts are unavailable. The agent can still read pages to check prices. AI spending is limited to $0.05 per request and $0.25 per person per UTC day. These are service limits, not fees charged to you.",
      "When you ask for facts about your list in Settings, we send your wishes and the place you would like to live, so the agent can write them.",
      "In the chat, your Dandy keeps a few short lines about you for next time, such as who your gifts are for or what you love, read from what you tell it. It is told to leave out your health, beliefs, income, debts and contact details, and lines that look like an address, a phone number, an email or a money figure are dropped. You can see and remove each line in Settings, and they are deleted with your account.",
      "Anything you include in messages, photos or page content may be sent to Claude. Anthropic's default policy is not to train models on API inputs or outputs.",
      "Before you use AI, we ask you to agree to the current notice and confirm that you are 18 or older. A change to the AI provider or how your data is used can require a new agreement. No AI request is sent before you agree. We keep the notice version and when you agreed with your account, so your current agreement works across devices.",
    ],
  },
  {
    heading: "What we don't do",
    body: [
      "We don't sell your data or show ads. We don't connect to your bank or ask for financial details. We don't post anything to Facebook or any other account you sign in with.",
    ],
  },
  {
    heading: "How we see what works and what breaks",
    body: [
      "We use PostHog to see how the app is used and to fix what goes wrong: which screens open, where you tap, errors and crashes, and recordings of how the screens looked, with every text field hidden while you type. They're tied to your account by an ID, never your email address or name, and PostHog doesn't keep your IP address.",
      "For each request to the agent we also note which model ran, how much it read and wrote, and what it cost, but not what you wrote.",
    ],
  },
  {
    heading: "Where your data lives",
    body: [
      "Our servers and database run on Amazon Web Services in the United States. The website is served by Cloudflare. Sign-in codes are emailed through Resend. Usage analytics are kept by PostHog in the United States.",
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

export const TERMS_UPDATED = "Last updated October 29, 2026";
export const TERMS: LegalSection[] = [
  {
    heading: "Using Dandelist",
    body: [
      // 18 and over: Meta's Model API terms require it of every end user.
      "Dandelist is free to use, for anyone 18 or older. Its source code is open under the MIT License. By using the app, you agree to these terms.",
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

/** Current wording for the existing optional history section; retention and feature gates are unchanged. */
export const CHAT_CONTINUITY_PRIVACY = "We keep temporary copies of chat text and the information used to answer it on our server. This lets the app continue a conversation using saved context. Each copy expires 30 days after it is created. Continuing a conversation can create a new copy.";
