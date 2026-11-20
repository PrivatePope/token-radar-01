# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/PrivatePope/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/PrivatePope/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar for make.fun's "Build the best token launch radar" bounty. It reads a sealed DefiLlama snapshot of 758 protocols, finds the ones that record no token and are not a wrapped, staked or bridged product of one that trades, and ranks them by what a launch would be worth if each protocol kept its record — with the steps to farm each one.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input path/to/snapshot.json
```

Node 22 or later, standard library only. The program writes `board.json`, `data.js`, `dashboard/` and `screenshots/` into the output directory, then `dossier.json`. Open `out/dashboard/index.html` in a browser (no network needed).

## How it works

The board covers all 40 protocols on the snapshot's watchlist, then every other launch candidate the snapshot holds — 198 rows in all. The implied value follows only from the snapshot's own figures:

```
implied = TVL^0.8 × 8 × (1 + clamp(7d, −50…+150%) × 0.6)
          × (0.7 + min(age, 1460d) / 1460 × 0.5) × (1 + 0.015 × min(chains, 10))
```

Size is concave, so a launch's value does not grow in proportion to TVL. Growth is clamped so one hot week cannot carry a row. Age pays for the time a protocol has waited with no token. No name is ever special-cased: the same arithmetic scores every row, and the dashboard's model sandbox recomputes it live from the same figures.

Each row carries a six-step farm plan — a fresh wallet, the category's action with a sized position, one qualifying action a week, a hold of 30–60 days, claiming only from a link the protocol itself publishes, and a farm log — all generated from the protocol's own record.

The dashboard is a dark, no-framework page: a sortable and filterable board, a detail view for every protocol with the model's full breakdown and its farm plan, a live-tokens view kept apart for protocols that already trade, and the model sandbox.

## How it scores

An AI judge compares dashboards two at a time: a working radar that covers the whole watchlist first, then a value model that follows from the snapshot's figures, then concrete farm plans with cost and time, then the dashboard as a page. Places go by win rate; the 10 best share $1,325.

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
