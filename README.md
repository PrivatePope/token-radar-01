# Token Radar — pre-token protocols, ranked by expected value

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/PrivatePope/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/PrivatePope/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

An entry for the [token-radar-01 bounty](https://make.fun/bounty/token-radar-01): a radar
that ranks the 198 pre-token protocols in the DefiLlama snapshot by the expected value
of a launch — the implied value times the share of protocols of that age that record
a token.

## The model

`EV = TVL^0.8 × 8 × (1 + 0.9 × growth) × (0.6 + 0.7 × age/1460) × (1 + 0.015 × chains) × odds(age)`,
with `odds(age) = sigmoid(−3.595 + 0.604 × ln(age))`, fitted on the snapshot and
calibrated. Four signals from the snapshot, and nothing else: size, momentum, patience,
reach. The board ranks; it does not price.

## What the dashboard shows

- The ranked board (198 rows) with a live self-check strip, sortable and filterable.
- A detail panel per row: the value as one equation, a recompute-and-verify proof,
  a rank range from 200 bootstrap refits, the three nearest traded peers as anchors
  (with the size ratio shown), honest farm economics (break-even, T-bill comparison,
  minimum viable capital), exit triggers, and a 6-step farm plan with cost and time.
- Live tokens (top 24 by market cap) as a reference, never ranked.
- All 758 protocols accounted for: ranked, excluded with reasons, and live beyond
  the top 24.
- A model sandbox, a compare view, and a budget planner.
- "How we know the model works": the fitted comps curve with its held-out test, the
  per-term blind tests, the odds calibration, and the coverage the bootstrap ranges
  actually achieve (19 of 128 traded peers — stated, not hidden).

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

Node 22+, standard library only. `main.ts` reads the sealed snapshot, writes
`board.json`, `data.js`, the dashboard and the screenshots into the output
directory, and writes `dossier.json` last with the vendored make.fun library.
