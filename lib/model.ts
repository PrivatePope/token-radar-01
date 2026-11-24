// lib/model.ts — the token-radar value model (radar-2), written fresh.
//
// Every pre-token protocol in the sealed snapshot is ranked by an implied
// token value derived only from the snapshot's own figures: its TVL, its
// 7-day TVL change, how long it has been listed, and how many chains it
// runs on. No protocol name is special-cased anywhere; the same arithmetic
// scores every row, and the same templates write every farm plan.

export interface SnapshotProtocol {
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
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** One ranked row of the board. */
export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  category: string | null;
  tvl_usd: number;
  change_7d_pct: number | null;
  age_days: number;
  chains: string[];
  watchlist: boolean;
  growth_factor: number;
  age_factor: number;
  chain_factor: number;
  farm_steps: string[];
}

/** One live-token protocol, for the dashboard's reference view only. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  tvl_usd: number;
  mcap_usd: number;
}

export interface RadarResult {
  board: BoardRow[];
  live: LiveRow[];
  early_size: number;
  live_size: number;
  median_age_days: number;
}

// ---------------------------------------------------------------- the model

/** The model's constants, stated once so the README and the dashboard can quote them. */
export const MODEL = {
  tvlExponent: 0.8,
  tvlScale: 8,
  growthWeight: 0.6,
  growthLow: -0.5,
  growthHigh: 1.5,
  ageBase: 0.7,
  ageSpan: 0.5,
  ageCapDays: 1460,
  chainWeight: 0.015,
  chainCap: 10,
} as const;

export const MODEL_FORMULA =
  'implied = TVL^0.8 x 8 x (1 + 0.6 x clamp(7d%, -50..+150)) x (0.7 + 0.5 x min(ageDays, 1460) / 1460) x (1 + 0.015 x min(chains, 10))';

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

/** Days between two YYYY-MM-DD dates, never below zero. */
export function ageDays(listedAt: string, asOf: string): number {
  const listed = Date.parse(`${listedAt}T00:00:00Z`);
  const as = Date.parse(`${asOf}T00:00:00Z`);
  return Math.max(0, Math.round((as - listed) / 86_400_000));
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 0) return 0;
  return n % 2 === 1 ? sorted[(n - 1) / 2]! : (sorted[n / 2 - 1]! + sorted[n / 2]!) / 2;
}

/** A protocol records no token when both token fields are null. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.gecko_id === null && p.symbol === null;
}

// ------------------------------------------------------- the watchlist rule

/** Categories the house rule leaves out: wrapped, staked and bridged products, and exchanges. */
const EXCLUDED_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

/** Exchange names a launch candidate's name must not begin with. */
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/** A trailing version marker: " V2", " v2", " 2.0" and the like. */
const VERSION_SUFFIX = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
/** A whole word that marks a wrapped, staked or bridged product. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/**
 * The house watchlist's exclusion rule, without its $50M floor: the board
 * ranks every rule-passing pre-token protocol, not only the watchlist's
 * forty. A protocol the rule leaves out is not ranked, even if it is
 * pre-token — a wrapped or staked product of a token that already trades
 * is not a token that does not exist yet.
 */
export function isEligible(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (VERSION_SUFFIX.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_PREFIXES.some((e) => p.name.startsWith(e))) return false;
  return true;
}

/** The implied token value of one protocol, in whole dollars. */
export function impliedValue(p: SnapshotProtocol, medianAgeDays: number, asOf: string): number {
  const age = p.listed_at === null ? medianAgeDays : ageDays(p.listed_at, asOf);
  const growth = clamp((p.change_7d ?? 0) / 100, MODEL.growthLow, MODEL.growthHigh);
  const growthF = 1 + growth * MODEL.growthWeight;
  const ageF = MODEL.ageBase + (Math.min(age, MODEL.ageCapDays) / MODEL.ageCapDays) * MODEL.ageSpan;
  const chainF = 1 + MODEL.chainWeight * Math.min(p.chains.length, MODEL.chainCap);
  return Math.round(
    Math.pow(p.tvl_usd, MODEL.tvlExponent) * MODEL.tvlScale * growthF * ageF * chainF,
  );
}

/** The three factors of one protocol's implied value, for the detail view. */
export function modelFactors(
  p: SnapshotProtocol,
  medianAgeDays: number,
  asOf: string,
): { growth: number; age: number; chain: number; ageDays: number } {
  const age = p.listed_at === null ? medianAgeDays : ageDays(p.listed_at, asOf);
  const growth = clamp((p.change_7d ?? 0) / 100, MODEL.growthLow, MODEL.growthHigh);
  return {
    growth: 1 + growth * MODEL.growthWeight,
    age: MODEL.ageBase + (Math.min(age, MODEL.ageCapDays) / MODEL.ageCapDays) * MODEL.ageSpan,
    chain: 1 + MODEL.chainWeight * Math.min(p.chains.length, MODEL.chainCap),
    ageDays: age,
  };
}

// ---------------------------------------------------------------- farm plans

/** What to do first on a protocol, by its category. */
const CATEGORY_ACTIONS: Record<string, string> = {
  Dexs: 'swap a small amount through its highest-volume pool and, if it offers one, add liquidity to that pair',
  Lending: 'supply an accepted asset as collateral and borrow a small amount against it',
  Yield: 'deposit into its highest-TVL vault and note the quoted yield',
  RWA: 'join its tokenized-asset offering after reading the underlying asset documentation',
  'Basis Trading': 'open a small delta-neutral position through its basis vault',
  'Risk Curators': 'allocate to a curator vault and read the curator strategy note before depositing',
  Derivatives: 'open a small position on its main derivatives market and set a firm exit',
  CDP: 'mint a small amount of its stable asset against collateral and watch the ratio',
  'Yield Aggregator': 'deposit into its top auto-compounding vault',
  'Liquidity Manager': 'deposit into its managed liquidity position on the busiest pair',
  'Staking Pool': 'stake a small amount in its main pool and confirm rewards accrue',
  Restaking: 'restake a small amount through its main restaking vault',
  'Cross Chain Bridge': 'bridge a small test amount across its busiest route and confirm arrival',
  'Prediction Market': 'take a small position on a high-volume market and track the odds',
  Insurance: 'buy a small cover policy on its main product and read the payout terms',
  Indexes: 'buy a small amount of its index token and track the constituents',
  Payments: 'run a small payment through its rails and confirm settlement',
  Privacy: 'use its privacy product with a small test amount and verify the flow',
  'Options Vault': 'deposit a small amount into its main options vault',
  Farm: 'deposit into its highest-TVL farm and note the reward rate',
  'Leveraged Farming': 'open a small leveraged farm position and watch the liquidation level',
  'Onchain Capital Allocator': 'allocate a small amount to its top strategy and read the allocation note',
  'Uncollateralized Lending': 'lend a small amount through its main credit pool',
  'Interest Rate Derivatives': 'take a small position on its main rate market',
  'Decentralized BTC': 'use its BTC product with a small test amount',
  'Anchor BTC': 'deposit a small amount into its anchor BTC vault',
  'Stablecoin Wrapper': 'wrap a small amount through its wrapper and confirm the peg',
  'Dual-Token Stablecoin': 'mint a small amount of its stable asset against collateral',
  'OTC Marketplace': 'place a small order on its OTC desk and confirm settlement',
  'Governance Incentives': 'participate in its governance program with a small stake',
  'Crypto Card Issuer': 'order its card and run a small test payment',
  'Collateral Markets': 'supply collateral to its main market and track the rate',
  CeDeFi: 'deposit a small amount into its CeDeFi vault',
  'CDP Manager': 'open a small managed CDP position',
  Chain: 'use its chain with a small test transaction and confirm finality',
};

const DEFAULT_ACTION = 'use its main product with a small test position and confirm the flow end to end';

/** Rough gas for one week's transactions on a chain, in whole dollars. */
const CHAIN_GAS_USD: Record<string, number> = {
  Ethereum: 15,
  Solana: 1,
  Base: 1,
  Arbitrum: 2,
  BSC: 1,
  Polygon: 1,
  Avalanche: 2,
  Optimism: 1,
  Linea: 1,
  Blast: 1,
  Scroll: 1,
  Mantle: 1,
  Berachain: 1,
  Sui: 1,
  Aptos: 1,
  Tron: 2,
  Fantom: 1,
  Gnosis: 1,
};

/** Position size by TVL tier: under $100M gets $50, $100M to $1B gets $100, over $1B gets $250. */
function capitalFor(tvlUsd: number): number {
  if (tvlUsd < 100_000_000) return 50;
  if (tvlUsd < 1_000_000_000) return 100;
  return 250;
}

/** Hold length by how long the protocol has been listed: 30, 45 or 60 days. */
function holdDaysFor(ageDays: number): number {
  if (ageDays < 180) return 30;
  if (ageDays < 730) return 45;
  return 60;
}

/**
 * Six farm steps for one board row, generated from the protocol's own
 * record — its category, its main chain, its TVL tier and its age. No
 * protocol name is special-cased; the same templates write every plan.
 */
export function farmSteps(row: {
  name: string;
  category: string | null;
  tvl_usd: number;
  age_days: number;
  chains: string[];
}): string[] {
  const action = row.category !== null ? (CATEGORY_ACTIONS[row.category] ?? DEFAULT_ACTION) : DEFAULT_ACTION;
  const mainChain = row.chains.length > 0 ? row.chains[0]! : 'its main chain';
  const capital = capitalFor(row.tvl_usd);
  const gas = CHAIN_GAS_USD[mainChain] ?? 3;
  const hold = holdDaysFor(row.age_days);
  const venue = row.category === null ? 'venue' : `${row.category} venue`;
  return [
    `Use ${row.name} on ${mainChain} as a ${venue}: ${action}. Start with the smallest position the venue accepts and confirm the transaction settles before adding more.`,
    `Fund the position with $${capital}. That size matches the protocol's TVL tier (under $100M gets $50, $100M to $1B gets $100, over $1B gets $250). Keep the rest of your farming budget in stables until the first week settles.`,
    `Do the work on ${mainChain} first — it is the protocol's main chain. Budget about $${gas} for gas across the week's transactions; if gas spikes, wait for a quiet hour instead of paying a premium.`,
    `Check the position once a week: confirm the TVL is still growing, the 7-day change has not collapsed, and no token has been announced. Rebalance only if one leg of the plan stops working.`,
    `Hold the position for ${hold} days — the hold scales with how long the protocol has been listed (under 6 months gets 30 days, 6 to 24 months gets 45, over 24 months gets 60). Do not chase a token announcement; the farm is the position and any token is a bonus.`,
    `Claim anything only from the protocol's official site and its official social accounts — never from a link in a direct message or a reply. Keep a farm log: the date, the chain, the amount in, the amount out, and the transaction hash of every step.`,
  ];
}

// ---------------------------------------------------------------- the board

/** Parse and validate the sealed snapshot. */
export function parseSnapshot(text: string): Snapshot {
  const parsed = JSON.parse(text) as Snapshot;
  if (typeof parsed.as_of !== 'string' || !Array.isArray(parsed.protocols) || !Array.isArray(parsed.watchlist)) {
    throw new Error('snapshot: expected as_of, protocols and watchlist');
  }
  for (const p of parsed.protocols) {
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Array.isArray(p.chains)) {
      throw new Error(`snapshot: protocol ${String(p.slug)} is missing slug, name, tvl_usd or chains`);
    }
  }
  return parsed;
}

/** Build the ranked board and the live-token reference from one snapshot. */
export function buildRadar(snapshot: Snapshot): RadarResult {
  const preToken = snapshot.protocols.filter(isPreToken);
  const listedAges = preToken
    .filter((p) => p.listed_at !== null)
    .map((p) => ageDays(p.listed_at as string, snapshot.as_of));
  const medianAgeDays = Math.round(median(listedAges));
  const watch = new Set(snapshot.watchlist);

  const ranked = snapshot.protocols
    .filter(isEligible)
    .map((p) => {
      const factors = modelFactors(p, medianAgeDays, snapshot.as_of);
      const row: BoardRow = {
        slug: p.slug,
        name: p.name,
        rank: 0,
        implied_value_usd: impliedValue(p, medianAgeDays, snapshot.as_of),
        category: p.category,
        tvl_usd: p.tvl_usd,
        change_7d_pct: p.change_7d,
        age_days: factors.ageDays,
        chains: p.chains,
        watchlist: watch.has(p.slug),
        growth_factor: Math.round(factors.growth * 1000) / 1000,
        age_factor: Math.round(factors.age * 1000) / 1000,
        chain_factor: Math.round(factors.chain * 1000) / 1000,
        farm_steps: [],
      };
      row.farm_steps = farmSteps(row);
      return row;
    })
    .sort((a, b) => b.implied_value_usd - a.implied_value_usd);
  ranked.forEach((r, i) => {
    r.rank = i + 1;
  });

  const liveAll = snapshot.protocols
    .filter((p) => !isPreToken(p) && p.mcap_usd !== null)
    .sort((a, b) => b.tvl_usd - a.tvl_usd);
  const live: LiveRow[] = liveAll.slice(0, 40).map((p) => ({
    slug: p.slug,
    name: p.name,
    category: p.category,
    tvl_usd: p.tvl_usd,
    mcap_usd: p.mcap_usd as number,
  }));

  return {
    board: ranked,
    live,
    early_size: ranked.length,
    live_size: liveAll.length,
    median_age_days: medianAgeDays,
  };
}

/**
 * The gate's board rules, checked locally before anything is written: ranks
 * 1..N exactly once, implied values non-increasing, every watchlist slug
 * covered, farm steps 3–12 strings of 20–600 chars each. Returns the first
 * problem, or null when the board is clean.
 */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `board has ${board.length} rows, needs 100–4000`;
  const slugs = new Set<string>();
  for (let i = 0; i < board.length; i++) {
    const r = board[i]!;
    if (r.rank !== i + 1) return `row ${r.slug} has rank ${r.rank}, expected ${i + 1}`;
    if (i > 0 && r.implied_value_usd > board[i - 1]!.implied_value_usd) {
      return `row ${r.slug} is out of order: ${r.implied_value_usd} above ${board[i - 1]!.implied_value_usd}`;
    }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 1e14) {
      return `row ${r.slug} has an implied value that is not a safe positive integer`;
    }
    if (slugs.has(r.slug)) return `duplicate slug ${r.slug}`;
    slugs.add(r.slug);
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) {
      return `row ${r.slug} has ${r.farm_steps.length} farm steps, needs 3–12`;
    }
    for (const step of r.farm_steps) {
      const len = step.trim().length;
      if (len < 20 || len > 600) return `row ${r.slug} has a farm step of ${len} chars, needs 20–600`;
    }
  }
  if (board.every((r) => r.implied_value_usd === board[0]!.implied_value_usd)) {
    return 'every implied value is the same';
  }
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `watchlist slugs missing from the board: ${missing.slice(0, 5).join(', ')}`;
  return null;
}

// ------------------------------------------------------------- the dashboard

/** The dashboard's data file: the board rows and the live reference, compact. */
export function dataScript(result: RadarResult, snapshot: Snapshot): string {
  const rows = result.board.map((r) => ({
    s: r.slug,
    n: r.name,
    c: r.category,
    t: r.tvl_usd,
    g: r.change_7d_pct,
    a: r.age_days,
    ch: r.chains.join(','),
    v: r.implied_value_usd,
    r: r.rank,
    w: r.watchlist ? 1 : 0,
    f: [r.growth_factor, r.age_factor, r.chain_factor],
  }));
  const live = result.live.map((p) => ({ s: p.slug, n: p.name, c: p.category, t: p.tvl_usd, m: p.mcap_usd }));
  return `window.RADAR = ${JSON.stringify({
    as_of: snapshot.as_of,
    count: result.board.length,
    model: MODEL_FORMULA,
    median_age_days: result.median_age_days,
    rows,
    live,
  })};\n`;
}
