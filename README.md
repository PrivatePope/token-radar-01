# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/PrivatePope/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/PrivatePope/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar: 198 pre-token protocols ranked by implied token value, built for make.fun's
"Build the best token launch radar" bounty — https://make.fun/bounty/token-radar-01

## What it does

`main.ts` (Node 22, standard library only) reads the sealed DefiLlama snapshot
(758 protocols at or above $5M TVL, as of 2026-11-14), scores every pre-token protocol with the
model below, and writes the ranked board to `/output/board.json`, the dashboard's data to
`/output/data.js`, and the judge's dossier to `/output/dossier.json`. The dashboard is a static
page — sortable and filterable board, a slide-over detail view per protocol with the model's full
breakdown and a six-step farm plan, a live-token reference kept apart from the ranking, and a model
sandbox that re-ranks the board live from the snapshot figures.

A protocol "records no token" — never "has none". Implied values are this radar's own claim,
never make.fun's.

## The model (radar-4)

```
implied = TVL^0.8 x 8 x (1 + 0.9 x clamp(7d%, -50..+150)) x (0.6 + 0.7 x min(ageDays, 1460) / 1460) x (1 + 0.015 x min(chains, 10))
```

Three signals from the snapshot, and nothing else. Size: TVL raised to 0.8, so a protocol twice
as big is not worth twice as much. Momentum: the last seven days' TVL change, clamped to
-50%..+150% so one wild week cannot decide a rank. Patience: how many days the protocol has run
with no token, up to four years — a launch that has waited is worth more than one that appeared
yesterday. A protocol with no listing date takes the median age of the pre-token set (513 days);
a missing seven-day change counts as zero. No protocol name is special-cased: every input is a
snapshot figure and the same function scores every row.

The board ranks every protocol that passes the house watchlist's exclusion rule, without its
$50M floor: pre-token (both `gecko_id` and `symbol` null), not a wrapped, staked or bridged
product of a token that already trades (excluded categories, versioned names, exchange names).
That is 198 protocols, covering all 40 watchlist slugs. Live-token protocols are set aside into
a separate reference view and never ranked.

Farm plans are template-generated from each protocol's own record: a category-specific action,
capital by TVL tier ($50 under $100M, $100 up to $1B, $250 above), the main chain with a gas
budget, a weekly cadence, a hold of 30–60 days scaled by listing age, and claim safety plus a
farm log. Six steps each, every step ending with an explicit cost and time.

## The board (top 10)

| # | Protocol | Implied value |
|---|----------|--------------:|
| 1 | Steakhouse Financial | $277M |
| 2 | Sentora Curator | $246M |
| 3 | Gauntlet | $190M |
| 4 | Veda | $174M |
| 5 | USDD | $120M |
| 6 | Upshift | $85M |
| 7 | Polymarket International | $67M |
| 8 | CIAN Yield Layer | $50M |
| 9 | Nonce Capital | $43M |
| 10 | OnRe | $42M |

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../kit/token-radar-01-kit/input/snapshot.json
```

That writes `out/board.json`, `out/data.js`, `out/dashboard/`, `out/screenshots/` and
`out/dossier.json`. The program runs twice and writes identical bytes both times. The three
screenshots in `screenshots/` are rendered from the dashboard with headless Chromium at
1440x900: the board from the top of the page, the slide-over detail for the #1 protocol, and
the board filtered to Lending.

## Layout

- `main.ts` — entrypoint: read the snapshot, score the board, write the outputs and the dossier.
- `lib/model.ts` — the model, the watchlist rule, the farm-plan templates, the board builder.
- `dashboard/` — `index.html`, `app.css`, `app.js`: the static board, slide-over detail view, live-token
  reference and model sandbox. No framework, no network.
- `vendor/makefun-board.ts` — make.fun's dossier library, copied byte for byte from the kit.
- `screenshots/` — the three dashboard screenshots, 1440x900.
