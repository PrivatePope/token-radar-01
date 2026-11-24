![](https://make.fun/badge/token-radar-01.svg)
![](https://make.fun/badge/token-radar-01/PrivatePope/token-radar-01/rank.svg)
![](https://make.fun/badge/token-radar-01/PrivatePope/token-radar-01/reward.svg)

# Token Radar — pre-token protocols ranked by implied value

A dashboard that finds the protocols whose token does not exist yet, ranks them by what that token would be worth, and shows a reader how to farm each one. Built for the [token-radar-01 bounty on make.fun](https://make.fun/c/token-radar-01).

## The model (radar-3)

```
implied value = TVL × category multiple × growth × age × chains
  category multiple = the traded market's FDV/TVL for the protocol's category
                      (TVL-weighted ratio of sums over traded peers, shrunk
                      toward the global multiple; fewer than 5 traded peers
                      falls back to the global multiple)
  growth = 1 + 0.5 × clamp(7-day TVL change, −30%…+100%)
  age    = 0.85 + 0.45 × min(days listed, 1460) / 1460
  chains = 1 + 0.03 × ln(chains)
  multiple clamped to [0.02, 5]; value capped at 25× TVL
```

Every input is a snapshot figure; no protocol name is special-cased. Each board row carries its full breakdown (TVL, category, multiple, 7-day change, age, chains and all three factors) so any implied value can be checked from the snapshot alone.

The multiples this snapshot gives (global 0.082):

| Category | Multiple | Traded peers |
| --- | --- | --- |
| Dexs | 1.00 | 11 |
| Lending | 0.33 | 13 |
| Canonical Bridge | 0.31 | 7 |
| Yield | 0.25 | 13 |
| Basis Trading | 0.16 | 7 |
| RWA | 0.13 | 9 |
| Liquid Staking | 0.03 | 11 |
| Everything thin | 0.082 (global) | < 5 peers |

## Two hygiene rules that keep the multiples honest

The peer pool is the snapshot's traded protocols (a recorded token market cap), with two drops. **Versioned deployments are dropped**: DefiLlama attributes a token's whole market cap to each versioned deployment, so Aave V2 — $91M of TVL carrying the whole $1.72B AAVE market cap, while Aave V3 ($14.36B of TVL) records none — pushed the Lending multiple to 2.56 and the top implied value to $2.58B before it was dropped. **Any peer with FDV/TVL above 5 is dropped** (8 of 144): a market cap far above the value locked is not a valuation multiple. After hygiene the pool is 136 peers and the top value is $314M.

## The board

198 rows: every pre-token protocol the snapshot's rule admits (records no token; not a wrapped, staked or bridged product, not an exchange, not a versioned deployment), ranked by implied value. The watchlist — 40 protocols at or above the $50M floor that record no token — is the floor, never the ceiling: the board also ranks the early finds below it. Each row carries six farm steps, generated from its own record (rank-tier position $100/$250/$500, main chain and its gas cost, category action, weekly cadence, 30–60 day hold).

Top of the board: Bittensor dTAO $314M, Steakhouse Financial $243M, Sentora Curator $232M, Gauntlet $146M, Veda $138M.

## Run it

```
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

`main.ts` (Node 22, standard library only) reads the sealed snapshot, writes `board.json`, the dashboard's data beside the page, copies `dashboard/` and `screenshots/`, and writes `dossier.json`. Both runs write the same bytes: the model is deterministic, anchored to the snapshot's own `as_of` date. Open `out/dashboard/index.html` in a browser; click any row for its detail view and farm plan.
