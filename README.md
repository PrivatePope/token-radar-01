# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/PrivatePope/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/PrivatePope/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar: 198 pre-token protocols ranked by expected value, built for make.fun's
"Build the best token launch radar" bounty — https://make.fun/bounty/token-radar-01

## What it does

`main.ts` (Node 22, standard library only) reads the sealed DefiLlama snapshot
(758 protocols at or above $5M TVL, as of 2026-11-14), scores every pre-token protocol with the
model below, and writes the ranked board to `/output/board.json`, the dashboard's data to
`/output/data.js`, and the judge's dossier to `/output/dossier.json`. The dashboard is a static
page — sortable and filterable board, a detail view per protocol with the model's full breakdown
and a six-step farm plan, a live-token reference kept apart from the ranking, an "All 758" view
that accounts for every protocol in the snapshot, and a model sandbox that re-ranks the board live
from the snapshot figures.

A protocol "records no token" — never "has none". Expected values are this radar's own claim,
never make.fun's. The board ranks; it does not price.

## The model (radar-5)

```
EV = TVL^0.8 x 8 x (1 + 0.9 x clamp(7d%, -50..+150)) x (0.6 + 0.7 x min(ageDays, 1460) / 1460)
     x (1 + 0.015 x min(chains, 10)) x odds(age)
odds(age) = 1 / (1 + exp(-(-3.595 + 0.604 x ln(ageDays))))
```

Four signals from the snapshot, and nothing else. Size: TVL raised to 0.8, so a protocol twice
as big is not worth twice as much. Momentum: the last seven days' TVL change, clamped to
-50%..+150% and weighted 0.9. Patience: how many days the protocol has run with no token, from
0.6 for a brand-new listing to 1.3 for one listed 1,460 days or more. Reach: how many chains it
runs on, up to ten. The launch odds are a logistic fit on log age over the whole snapshot: the
share of protocols of that age that record a token. A protocol with no listing date takes the
median age of the pre-token set (513 days); a missing seven-day change counts as zero.

The board ranks every protocol that passes the house watchlist's exclusion rule, without its
$50M floor: pre-token (both `gecko_id` and `symbol` null), not a wrapped, staked or bridged
product of a token that already trades (excluded categories, versioned names, exchange names),
and not a versioned deployment. That is 198 protocols, covering all 40 watchlist slugs.
Live-token protocols are set aside into a separate reference view and never ranked.

Farm plans are template-generated from each protocol's own record: a category-specific action,
capital by TVL tier ($50 under $100M, $100 up to $1B, $250 above), the main chain with a gas
budget, a weekly cadence, a hold of 30–60 days scaled by listing age, and claim safety plus a
farm log. Six steps each, each ending with an explicit `Cost: … · Time: …`. The detail view adds
a "Why this protocol" line from the row's own figures and a Farm / Watch / Skip verdict from a
stated rule.

## How we know the model works

The traded market, fitted: log(market cap) = 6.965 + 0.522 × log(TVL) on 128 traded peers,
R² = 0.194; held out (5-fold) the median error is ×3.67 and only 30% of predictions land within
2× — no formula prices a launch precisely. The agreement check: replacing the hand-set TVL term
with the fitted curve leaves the top 8 in the same order, top-10 9/10, Spearman 0.991. The
launch odds fit: −3.595 + 0.604 × ln(age), Brier 0.229 against a base-rate 0.248. The odds are
the share of protocols of that age that record a token, not a forward probability that a
protocol still waiting will launch.

## The board (top 10, expected value)

| # | Protocol | Expected value |
|---|----------|--------------:|
| 1 | Steakhouse Financial | $152.6M |
| 2 | Sentora Curator | $125.0M |
| 3 | Gauntlet | $104.8M |
| 4 | Veda | $100.1M |
| 5 | USDD | $68.6M |
| 6 | Upshift | $50.0M |
| 7 | Polymarket International | $48.0M |
| 8 | CIAN Yield Layer | $29.8M |
| 9 | Symbiotic | $24.5M |
| 10 | OpenTrade | $23.3M |

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../kit/token-radar-01-kit/input/snapshot.json
```

That writes `out/board.json`, `out/data.js`, `out/dashboard/`, `out/screenshots/` and
`out/dossier.json`. The program runs twice and writes identical bytes both times. The three
screenshots in `screenshots/` are rendered from the dashboard with headless Chromium at
1440x900: the board, the detail view for the #1 protocol, and the board filtered to Lending.

## Layout

- `main.ts` — entrypoint: read the snapshot, score the board, write the outputs and the dossier.
- `lib/model.ts` — the model, the watchlist rule, the farm-plan templates, the board builder.
- `dashboard/` — `index.html`, `app.css`, `app.js`: the static board, detail view, live-token
  reference, All 758 view and model sandbox. No framework, no network.
- `vendor/makefun-board.ts` — make.fun's dossier library, copied byte for byte from the kit.
- `screenshots/` — the three dashboard screenshots, 1440x900.
