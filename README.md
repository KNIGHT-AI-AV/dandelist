# Dandelist

Price the life you want.

Everyone keeps a list of things they want: a car, a camera, a month somewhere warm, a home by the sea. Almost nobody knows what that life actually costs, or when they could have it. Dandelist turns the list into a plan. You say what you want, an AI agent finds the real price on the seller's own page, works out what it costs to keep each month, and shows when everything can be yours.

Dandelist runs on iPhone, Android and the web from one codebase, with sign-in by email code, Apple, Google or GitHub.

- Web app: https://dandelist.knightaiav.com
- API: https://api.dandelist.knightaiav.com

## What it does

- **A first look before you sign in.** Pick a few things you'd say yes to, vote between pairs, set a monthly amount, and watch the agent price one of your picks live. You choose a theme before you make an account.
- **Real prices, checked.** For each wish the agent searches the web, opens the seller's page and checks that the price is printed there. A price it could not confirm on the seller's own site is labelled an estimate, with the page it came from and the date it was checked.
- **What it costs to keep.** Running costs are itemised: property tax, insurance, upkeep, utilities, fuel, staff. Each line shows how it was worked out and links to the published rate it used, priced for where you live.
- **A dream builder.** Describe a home, a car or a service in plain words. The agent opens the right tool in the chat: a home builder with real listings you swipe through, a car configurator priced from the maker, or a monthly quote for something like private security, priced from regional rates.
- **The plan.** Upfront cost, monthly running costs and the month when everything on the list is yours, from a tested cost engine rather than model guesses.

## How it uses Meta models

All model calls go through the Meta Model API (`https://api.meta.ai/v1`).

| Model | What it does in Dandelist |
| --- | --- |
| `muse-spark-1.3` | The price agent and the dream concierge: reads a wish, asks only the questions that change the price, runs `web_search`, calls our tools to open and check seller pages, and returns structured options. It also writes the short plain-words notes, which are checked against the computed numbers before they are shown. |
| `muse-spark-1.3` with `web_search` | Finds listings, maker price lists and published regional rates (tax, insurance, utilities, salaries) with their sources. |
| `sam-3.1` | Cuts the product out of a real photo, so the wish page can show it on its own and tilt it as you drag. |
| `muse-image-1.0` | Adds a campaign-style picture only when no real photo is sharp enough, and enlarges small product photos. Anything it makes or reworks is labelled as generated, and real photos always come first. |

Model output is treated as data. Prices count as verified only when our server finds them on the seller's page; numbers in the agent's sentences that the facts do not hold are dropped; links are accepted only as web addresses.

## Architecture

```
apps/mobile     Expo (React Native) app for iOS, Android and web; Expo Router
apps/api        Hono API on Node: auth, wishes, the price agent, the dream builder, spend caps
packages/meta   Meta Model API client (Responses API, images, segmentation)
packages/cost   The cost engine: money in cents, recurring costs, plans; fully unit tested
packages/catalogue  The onboarding catalogue and the dream builder's wire contract
infra/aws       Provisioning and deploy scripts (App Runner, RDS Postgres, S3, CodeBuild)
```

- The web app is a static export on Cloudflare Pages. The API runs on AWS App Runner with Postgres on RDS; found images are stored in S3.
- The agent streams its work to the app as it happens, so you see each search and each page it checked.
- Every Meta call passes a daily and an all-time spend cap, plus a per-person daily cap.

## Run it locally

You need Node 22 and Corepack.

```
corepack pnpm install
corepack pnpm test
```

API (uses an in-memory Postgres, prints sign-in codes to the console):

```
cp apps/api/.env.example apps/api/.env.development
MODEL_API_KEY=your-meta-key corepack pnpm --filter @dandelist/api dev
```

App on the web:

```
cd apps/mobile
npx expo start --web --port 8081
```

## Built during the event

Dandelist was built from scratch for the Meta Global AI Developer Hackathon. The repository was created empty, and all code, design and content were made during the build period.

## License

MIT. See [LICENSE](LICENSE).
