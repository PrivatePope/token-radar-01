# Token Radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/PrivatePope/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/PrivatePope/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

An entry for the [token-radar-01 bounty on make.fun](https://make.fun/bounty/token-radar-01).

## What it is

A radar for pre-token protocols: 198 protocols with no token, ranked by
expected value — the launch's implied value times the share of protocols of
that age that record a token. The dashboard is a single self-contained page
(`dashboard/`): a sortable, filterable board, a model sandbox that re-ranks
live, a compare view, a budget planner, per-protocol detail with the value as
one equation, honest farm economics (break-even, T-bill comparison, minimum
viable capital), and a validation section that shows the blind tests the model
was put through — including the ones it failed.

## The model

```
EV = TVL^0.8 × 8 × (1 + 0.9 × clamp(7d%, −50, +150))
   × (0.6 + 0.7 × min(age, 1460)/1460)
   × (1 + 0.015 × min(chains, 10))
   × odds(age)
odds(age) = 1 / (1 + exp(−(−3.595 + 0.604 × ln(age))))
```

Four signals from the snapshot and nothing else: size (TVL, concave),
momentum (7-day growth), patience (age with no token), reach (chains). No
protocol name is special-cased; the same function scores every row.

## How we know it works

On the 128 traded peers, log(market cap) = 6.965 + 0.522 × log(TVL),
R² = 0.194; held out, the median error is ×3.67 (30% within 2×) against
×4.01 for guessing the median. The agreement check: replacing the hand-set
TVL term with the fitted curve leaves the top 8 in the same order (Spearman
0.991). The blind tests are honest: only size survives both of them —
growth and chains make the held-out error worse on leave-one-out and on the
50/50 walk-forward, and age is mixed. The terms stay because the ranking
must follow from TVL, growth and age with no token, and they do real work
(EV vs pure TVL order: Spearman 0.894, 84 rows move more than 10 ranks).
The launch odds are age alone: adding TVL, chains or growth moves the
held-out Brier by at most 0.0005 (0.230 vs 0.248 base). Rank ranges are
P10–P90 over 200 bootstrap refits of the curve and the odds — a stability
check on the ranking, not a confidence interval: the range holds the true
market cap for only 15% of traded peers held out.

## Coverage

758 of 758 protocols in the snapshot are accounted for: 198 ranked on the
board, 144 pre-token protocols excluded with their reasons, 24 live tokens
in the Live view, and 392 live tokens beyond it. Nothing is dropped
silently.

## Running it

```sh
node main.ts --input <snapshot.json> --output out/
```

`main.ts` reads the DefiLlama protocol snapshot, builds the board
(`board.json`, 198 rows), writes the dashboard data (`dashboard/data.js`),
and assembles the dossier (`dossier.json`). The dashboard needs no network:
every byte it shows is in `data.js` or in the dashboard files.

## Layout

- `main.ts` — entrypoint: snapshot in, board + dashboard data + dossier out
- `lib/model.ts` — the model, the board, the farm plans, the bootstrap
- `dashboard/` — the page: `index.html`, `app.css`, `app.js`
- `vendor/makefun-board.ts` — the dossier builder, copied from the kit
- `screenshots/` — the three board screenshots the dossier carries
