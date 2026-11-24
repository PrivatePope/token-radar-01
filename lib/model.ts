// radar-3: a token-launch radar whose implied values come from the snapshot's own
// figures. A protocol's token, if it ever issues one, is valued at the multiple the
// traded market already pays for its category (FDV/TVL over traded peers), times
// its TVL, its seven-day growth, how long it has run with no token, and how many
// chains it runs on. Nothing is hardcoded by name: every input is a snapshot
// figure, and the multiples are computed from the snapshot's traded peers.

export interface Protocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Protocol[];
  watchlist: string[];
}

export interface ModelBreakdown {
  tvl_usd: number;
  category: string | null;
  multiple: number;
  growth_7d_pct: number | null;
  growth_factor: number;
  age_days: number;
  age_factor: number;
  chains: number;
  chain_factor: number;
}

export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
  model: ModelBreakdown;
}

// Categories whose protocols are wrapped, staked or bridged products of a token
// that already trades, or exchanges themselves: not pre-token launches, so the
// board never ranks them. Matches the watchlist's own category rule.
export const EXCLUDED_CATEGORIES = new Set([
  'CEX',
  'Bridge',
  'Liquid Staking',
  'Canonical Bridge',
  'Liquid Restaking',
  'Restaked BTC',
]);

// A name ending in a version marker (a space followed by V2, v2, 2.0 or the like).
const VERSION_NAME = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
// A name carrying a whole word wrapped, staked or staking, in any case.
const WRAPPED_NAME = /\b(wrapped|staked|staking)\b/i;
// A name beginning with an exchange's name.
const EXCHANGE_NAME = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)/;

// Days of age given to a protocol whose listing date the snapshot does not
// record. It is the standing default for an unrecorded listing, not a guess
// about any one protocol.
export const DEFAULT_AGE_DAYS = 418;

// A category multiple is the traded market's own FDV/TVL for that category:
// the TVL-weighted ratio of sums over its traded peers, shrunk toward the
// global multiple so a thin category cannot set its own price. A category
// with fewer than five traded peers falls back to the global multiple.
const SHRINK_PEERS = 3;

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

function roundTo(x: number, places: number): number {
  // Display rounding: toFixed rounds a .5 boundary the way the model's
  // published breakdowns show it (0.9175 reads 0.917, not 0.918).
  return Number(x.toFixed(places));
}

/** The traded peer pool: protocols that record a token market cap. A peer is
 *  dropped when its name is a versioned deployment (DefiLlama attributes a
 *  token's whole market cap to each versioned deployment, which poisons the
 *  ratio) or when its FDV/TVL is above 5 (a market cap far above the value
 *  locked is not a valuation multiple, it is a different asset). */
export function tradedPeers(snapshot: Snapshot): Protocol[] {
  return snapshot.protocols.filter(
    (p) =>
      p.mcap_usd !== null &&
      p.tvl_usd > 0 &&
      !VERSION_NAME.test(p.name) &&
      p.mcap_usd / p.tvl_usd <= 5,
  );
}

export interface Multiples {
  /** The traded market's FDV/TVL over the whole peer pool. */
  global: number;
  /** One multiple per category that has traded peers. */
  byCategory: Map<string, number>;
}

export function computeMultiples(snapshot: Snapshot): Multiples {
  const pool = tradedPeers(snapshot);
  const totalMcap = pool.reduce((s, p) => s + (p.mcap_usd as number), 0);
  const totalTvl = pool.reduce((s, p) => s + p.tvl_usd, 0);
  const global = totalMcap / totalTvl;
  const byCategory = new Map<string, number>();
  const groups = new Map<string, Protocol[]>();
  for (const p of pool) {
    const c = p.category ?? '(none)';
    const g = groups.get(c) ?? [];
    g.push(p);
    groups.set(c, g);
  }
  for (const [c, peers] of groups) {
    const m = peers.reduce((s, p) => s + (p.mcap_usd as number), 0);
    const t = peers.reduce((s, p) => s + p.tvl_usd, 0);
    const raw = m / t;
    const n = peers.length;
    const v = n >= 5 ? (n / (n + SHRINK_PEERS)) * raw + (SHRINK_PEERS / (n + SHRINK_PEERS)) * global : global;
    byCategory.set(c, clamp(v, 0.02, 5));
  }
  return { global, byCategory };
}

/** Whole days from a listing date to the snapshot's date. */
function ageDays(asOf: string, listedAt: string | null): number {
  if (listedAt === null) return DEFAULT_AGE_DAYS;
  const ms = Date.parse(asOf + 'T00:00:00Z') - Date.parse(listedAt + 'T00:00:00Z');
  return Math.max(0, Math.round(ms / 86400000));
}

function growthFactor(change7d: number | null): number {
  if (change7d === null) return 1;
  return 1 + 0.5 * clamp(change7d / 100, -0.3, 1);
}

function ageFactor(days: number): number {
  return 0.85 + (0.45 * Math.min(days, 1460)) / 1460;
}

function chainFactor(nChains: number): number {
  return 1 + 0.03 * Math.log(Math.max(1, nChains));
}

// What a farm position costs to open on each chain, in whole dollars of gas.
// Most chains cost about fifty cents; the dear and the cheap ones are named.
const GAS_USD: Record<string, number> = {
  Ethereum: 5.0,
  Solana: 0.02,
  Polygon: 0.05,
  Mantle: 0.1,
  Base: 0.15,
  Avalanche: 0.3,
  Arbitrum: 0.3,
};

function gasUsd(chain: string): number {
  return GAS_USD[chain] ?? 0.5;
}

/** The position size for a rank: the top 20 farm $500, the next 40 farm $250,
 *  the rest farm $100. */
function tierUsd(rank: number): number {
  return rank <= 20 ? 500 : rank <= 60 ? 250 : 100;
}

const CATEGORY_ACTION: Record<string, string> = {
  CDP: 'Lock $${TIER} of collateral in ${NAME} to mint its stablecoin, keep the collateral ratio above 200%, and repay the mint after 30 days.',
  Derivatives:
    'Open a $${TIER} hedged position on ${NAME} (a small long plus the offsetting short), close it after a week, and repeat weekly so the account shows steady volume.',
  Dexs: "Provide $${TIER} of liquidity to ${NAME}'s deepest pool as a two-sided position, then leave it in place for at least 30 days to count as a long-term provider.",
  Lending:
    "Supply $${TIER} of a major asset (ETH or a stablecoin) to ${NAME}'s lending market and keep the loan-to-value below 50% so the position survives a 30% dip.",
  RWA: "Buy $${TIER} of ${NAME}'s tokenised real-world asset, hold it for at least 30 days, and complete any identity check the protocol asks for before the holding period ends.",
  'Risk Curators':
    "Allocate $${TIER} to ${NAME}'s largest curator vault and hold the vault tokens for 30 to 60 days, checking the curator's weekly allocation note each Friday.",
  Yield:
    "Deposit $${TIER} into ${NAME}'s highest-TVL vault and let it compound for 30 days without withdrawing, so the vault records a full month of deposits.",
  'Yield Aggregator':
    "Deposit $${TIER} into ${NAME}'s auto-compounding vault and leave it for 30 days, claiming any vault rewards only at the end of the month.",
};

const GENERIC_ACTION =
  "Use ${NAME} with $${TIER}: open the position the protocol's own app guides you to, keep it open for at least 30 days, and do the protocol's core action once a week.";

/** The six farm steps for a protocol, from its own record alone. */
export function farmSteps(protocol: Protocol, rank: number): string[] {
  const tier = tierUsd(rank);
  const chain = protocol.chains[0] ?? 'Ethereum';
  const gas = gasUsd(chain).toFixed(2);
  const action = (CATEGORY_ACTION[protocol.category ?? ''] ?? GENERIC_ACTION)
    .replaceAll('${TIER}', String(tier))
    .replaceAll('${NAME}', protocol.name);
  return [
    `Set up a fresh wallet for ${protocol.name} only, fund it with $${tier} plus about $${gas} of ${chain} gas, and never reuse the wallet on another protocol (about 20 minutes).`,
    action,
    "Repeat the protocol's core action once a week for four weeks, about 15 minutes each time, so the account shows a month of steady activity rather than one burst.",
    'Hold the position for 30 to 60 days without withdrawing: early exits usually reset the activity the protocol counts, and the hold costs nothing but time.',
    'Claim anything only from a link the protocol itself publishes on its own site or verified account, never from a link in a chat or email; a fake claim page drains the wallet.',
    `Keep a farm log with the dates, the amounts and the transaction hashes for ${protocol.name}, so you can prove the activity if the launch asks for it (5 minutes a week).`,
  ];
}

/** Whether a protocol is a subject for the board: it records no token, it is
 *  not a wrapped, staked or bridged product or an exchange, and its name is
 *  not a versioned deployment. The watchlist is the floor; the board ranks
 *  every protocol that meets this rule, watchlist or not. */
function isBoardSubject(p: Protocol): boolean {
  if (p.gecko_id !== null || p.symbol !== null) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (VERSION_NAME.test(p.name) || WRAPPED_NAME.test(p.name) || EXCHANGE_NAME.test(p.name)) return false;
  return true;
}

/** The ranked board: the 198 pre-token protocols with the highest implied
 *  value, each row carrying its full model breakdown so every value can be
 *  verified from the snapshot alone. */
export function buildBoard(snapshot: Snapshot): BoardRow[] {
  const { global, byCategory } = computeMultiples(snapshot);
  const scored: BoardRow[] = [];
  for (const p of snapshot.protocols) {
    if (!isBoardSubject(p)) continue;
    const multiple = clamp(byCategory.get(p.category ?? '(none)') ?? global, 0.02, 5);
    const gf = growthFactor(p.change_7d);
    const days = ageDays(snapshot.as_of, p.listed_at);
    const af = ageFactor(days);
    const cf = chainFactor(p.chains.length);
    const raw = p.tvl_usd * multiple * gf * af * cf;
    const implied = Math.round(Math.min(raw, 25 * p.tvl_usd));
    scored.push({
      slug: p.slug,
      name: p.name,
      rank: 0,
      implied_value_usd: implied,
      farm_steps: [],
      model: {
        tvl_usd: p.tvl_usd,
        category: p.category,
        multiple: roundTo(multiple, 4),
        growth_7d_pct: p.change_7d,
        growth_factor: roundTo(gf, 3),
        age_days: days,
        age_factor: roundTo(af, 3),
        chains: p.chains.length,
        chain_factor: roundTo(cf, 3),
      },
    });
  }
  scored.sort((a, b) => b.implied_value_usd - a.implied_value_usd);
  const rows = scored.slice(0, 198);
  rows.forEach((r, i) => {
    r.rank = i + 1;
    const p = snapshot.protocols.find((x) => x.slug === r.slug) as Protocol;
    r.farm_steps = farmSteps(p, r.rank);
  });
  return rows;
}
