// lib/model.ts — radar-7: the expected-value model (radar-5, unchanged since round 5),
// the farm plans, the board builder and the bootstrap rank ranges.
// Reads only the sealed snapshot. No network, no clock beyond the snapshot's as_of.
// The model is exact: EV = TVL^0.8 x 8 x (1 + 0.9 x clamp(7d%, -50..+150))
//   x (0.6 + 0.7 x min(age,1460)/1460) x (1 + 0.015 x min(chains,10)) x odds(age),
// odds(age) = sigmoid(-3.595 + 0.604 x ln(ageDays)); null listed_at -> median pre-token age.

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

export interface Row {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number;
  odds: number;
  implied_raw: number;
  implied_value_usd: number;
  rank: number;
  rank_lo: number;
  rank_hi: number;
  watch: boolean;
  deposit: number;
  gas_total: number;
  hold_days: number;
  farm_steps: string[];
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  tvl_usd: number;
  mcap_usd: number | null;
}

export interface ExcludedRow {
  slug: string;
  name: string;
  reason: string;
}

export interface Radar {
  as_of: string;
  model: string;
  board: Row[];
  live: LiveRow[];
  excluded: ExcludedRow[];
  live_rest: LiveRow[];
  meta: {
    total: number;
    ranked: number;
    excluded: number;
    live_shown: number;
    live_rest: number;
    coverage: number;
    coverage_n: number;
    fits: number;
  };
}

const DAY = 86400000;
const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
};

export function parseSnapshot(text: string): Snapshot {
  const s = JSON.parse(text) as Snapshot;
  if (typeof s.as_of !== 'string' || !Array.isArray(s.protocols) || !Array.isArray(s.watchlist)) {
    throw new Error('snapshot: expected as_of, protocols[], watchlist[]');
  }
  return s;
}

/** Days from listed_at to the snapshot date; null when DefiLlama reports none. */
export function ageDays(p: Protocol, asOf: Date): number | null {
  if (!p.listed_at) return null;
  return Math.max(0, Math.round((asOf.getTime() - new Date(p.listed_at + 'T00:00:00Z').getTime()) / DAY));
}

export function hasToken(p: Protocol): boolean {
  return p.gecko_id !== null || p.symbol !== null;
}

const EXCL_CATS = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
const EXCH = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];
const VER_RE = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WORD_RE = /\b(wrapped|staked|staking)\b/i;

/** Why a pre-token protocol is not ranked; null when it is eligible. */
export function exclusionReason(p: Protocol): string | null {
  if (p.category !== null && EXCL_CATS.has(p.category)) return 'excluded category: ' + p.category;
  if (VER_RE.test(p.name)) return 'versioned deployment name';
  if (WORD_RE.test(p.name)) return 'wrapped/staked product name';
  if (EXCH.some((e) => p.name.startsWith(e))) return 'exchange name';
  return null;
}

export function eligible(p: Protocol): boolean {
  return !hasToken(p) && exclusionReason(p) === null;
}

/** The radar-4 implied value (before launch odds), from the row's own figures. */
export function impliedValue(p: Protocol, age: number): number {
  const g = clamp((p.change_7d ?? 0) / 100, -0.5, 1.5);
  return (
    Math.pow(p.tvl_usd, 0.8) * 8 * (1 + g * 0.9) * (0.6 + (Math.min(age, 1460) / 1460) * 0.7) * (1 + 0.015 * Math.min(p.chains.length, 10))
  );
}

/** Launch odds: the share of protocols of this age that record a token (cross-sectional base rate). */
export function launchOdds(age: number): number {
  return 1 / (1 + Math.exp(-(-3.595 + 0.604 * Math.log(age))));
}

/** Expected value and its parts, exactly as the reference board computes them. */
export function evOf(p: Protocol, age: number): { ev: number; implied: number; odds: number } {
  const implied = impliedValue(p, age);
  const odds = launchOdds(age);
  return { ev: Math.max(1, Math.round(implied * odds)), implied: Math.round(implied), odds: +odds.toFixed(4) };
}

/** The growth/age/chain factor (everything except the TVL term and the odds). */
export function otherFactor(p: Protocol, age: number): number {
  const g = clamp((p.change_7d ?? 0) / 100, -0.5, 1.5);
  return (1 + g * 0.9) * (0.6 + (Math.min(age, 1460) / 1460) * 0.7) * (1 + 0.015 * Math.min(p.chains.length, 10));
}

// ---------------------------------------------------------------- farm plans

/** Suggested deposit tier by TVL: capital at risk, not a cost. The cost is gas only. */
export function depositTier(tvl: number): number {
  if (tvl >= 1e9) return 500;
  if (tvl >= 2.5e8) return 250;
  if (tvl >= 5e7) return 100;
  return 50;
}

/** Assumed gas per on-chain action, in dollars, by chain. Template assumptions, stated on the page. */
const GAS: Record<string, number> = {
  Ethereum: 2.5,
  Solana: 0.02,
  Base: 0.05,
  Arbitrum: 0.1,
  Optimism: 0.1,
  Binance: 0.15,
  Polygon: 0.05,
  Avalanche: 0.1,
  Berachain: 0.05,
  Monad: 0.05,
};
export function gasFor(chain: string): number {
  return GAS[chain] ?? 0.5;
}

/** Hold length by age: older protocols get a longer farming window. */
export function holdDays(age: number): number {
  if (age >= 730) return 60;
  if (age >= 365) return 45;
  return 30;
}

/** The category action for farm step 2, from the protocol's own category. */
const CAT_ACTION: Record<string, string> = {
  Lending: 'Supply ${D} to the lending market; borrow nothing against it',
  Dexs: 'Provide ${D} as liquidity to the main trading pool',
  'Risk Curators': 'Deposit ${D} into the curator vault',
  'Onchain Capital Allocator': 'Allocate ${D} through the vault',
  RWA: 'Mint ${D} of the tokenised real-world asset',
  Yield: 'Stake ${D} in the yield vault',
  'Yield Aggregator': 'Deposit ${D} into the aggregator vault',
  Derivatives: 'Open a ${D} hedged derivatives position',
  CDP: 'Lock ${D} as collateral and mint the stablecoin',
  'Basis Trading': 'Deposit ${D} into the basis-trading strategy',
  Chain: 'Stake ${D} with a validator on the chain',
  Restaking: 'Restake ${D} through the protocol',
  'Staking Pool': 'Stake ${D} in the staking pool',
  Farm: 'Deposit ${D} into the farm',
  'Prediction Market': 'Provide ${D} as liquidity to the prediction market',
  Payments: 'Route ${D} through the payment rail',
  'Leveraged Farming': 'Open a ${D} leveraged farming position',
  'Liquidity Manager': 'Deposit ${D} into the managed liquidity vault',
  'CDP Manager': 'Deposit ${D} into the CDP manager vault',
  'Collateral Markets': 'Post ${D} as collateral in the market',
  CeDeFi: 'Deposit ${D} into the CeDeFi vault',
  'Anchor BTC': 'Deposit ${D} into the BTC-anchored vault',
  'Decentralized BTC': 'Deposit ${D} into the BTC vault',
  'Cross Chain Bridge': 'Bridge ${D} through the protocol',
  'Crypto Card Issuer': 'Load ${D} onto the card',
  'Dual-Token Stablecoin': 'Mint ${D} of the stablecoin pair',
  'Governance Incentives': 'Deposit ${D} to earn governance incentives',
  Indexes: 'Buy ${D} of the index',
  Insurance: 'Provide ${D} as insurance cover',
  'Interest Rate Derivatives': 'Open a ${D} rates position',
  'OTC Marketplace': 'Place ${D} in the OTC market',
  'Uncollateralized Lending': 'Lend ${D} through the protocol',
  'Stablecoin Wrapper': 'Wrap ${D} into the stablecoin',
};
const money = (n: number): string => '$' + n.toFixed(2);

/** Six farm steps per row. Every step ends with an explicit Cost and Time. */
export function farmSteps(p: Protocol, dep: number, gas: number, hold: number): string[] {
  const chain = p.chains[0] ?? 'Ethereum';
  const d = '$' + dep;
  const g = money(gas);
  const g4 = money(4 * gas);
  const act = (CAT_ACTION[p.category ?? ''] ?? "Use ${D} in the protocol's main product").replace('${D}', d);
  return [
    `Deposit ${d} into ${p.name} on ${chain} through the protocol's own app, never a link from social media. Cost: ${g} · Time: 15 min`,
    `${act}. Cost: ${g} · Time: 10 min`,
    `Check the position once a week for 4 weeks; add funds only while TVL keeps growing. Cost: ${g4} · Time: 5 min/week`,
    `Hold the position for ${hold} days and ignore short-term price moves. Cost: $0.00 · Time: ${hold} days`,
    `Before claiming, check the claim page is the protocol's own domain and revoke approvals you no longer use. Cost: ${g} · Time: 10 min`,
    `Log every transaction hash, date and amount in one place so the claim is provable. Cost: $0.00 · Time: 5 min`,
  ];
}

/** Farm / Watch / Skip, from the row's own figures. Rule is stated on the page. */
export function verdictOf(rank: number, growth: number | null, age: number): 'Farm' | 'Watch' | 'Skip' {
  if (rank <= 20 && (growth ?? 0) >= 0 && age >= 365) return 'Farm';
  if (rank <= 50) return 'Watch';
  return 'Skip';
}

// ---------------------------------------------------------------- bootstrap (rank ranges)

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function ols2(xs: number[], ys: number[]): [number, number] {
  const n = xs.length;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sx += xs[i]!;
    sy += ys[i]!;
    sxx += xs[i]! * xs[i]!;
    sxy += xs[i]! * ys[i]!;
  }
  const b = (n * sxy - sx * sy) / (n * sxx - sx * sx);
  return [(sy - b * sx) / n, b];
}

/** IRLS logistic fit y ~ sigmoid(A + B*x), 50 Newton iterations, 1e-6 ridge. */
function irlsLogit(xs: number[], ys: number[]): [number, number] {
  let A = 0;
  let B = 0;
  for (let it = 0; it < 50; it++) {
    let g00 = 1e-6;
    let g01 = 0;
    let g11 = 1e-6;
    let h0 = 0;
    let h1 = 0;
    for (let i = 0; i < xs.length; i++) {
      const x = xs[i]!;
      const z = Math.max(-30, Math.min(30, A + B * x));
      const pr = 1 / (1 + Math.exp(-z));
      const w = pr * (1 - pr) + 1e-6;
      const r = ys[i]! - pr;
      g00 += w;
      g01 += w * x;
      g11 += w * x * x;
      h0 += r;
      h1 += r * x;
    }
    const det = g00 * g11 - g01 * g01;
    A += (g11 * h0 - g01 * h1) / det;
    B += (g00 * h1 - g01 * h0) / det;
  }
  return [A, B];
}

function percentile(sorted: number[], q: number): number {
  const n = sorted.length;
  if (n === 1) return sorted[0]!;
  const pos = (n - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

/**
 * Bootstrap rank ranges: 200 resamples (seed 11) of the comps curve (OLS log mcap on
 * log TVL, 128 traded peers) and the odds fit (IRLS logistic on log age, all 758
 * protocols). Each resample re-ranks the board with the fitted TVL term in place of the
 * hand term; a row's range is its rank P10–P90 across the 200 refits. Also returns the
 * coverage: how many of the 128 traded peers have their true market cap inside the
 * fitted mcap P10–P90 (an honest, measured number — about 15%, not 80%).
 */
export function bootstrapRanges(
  snap: Snapshot,
  rows: Row[],
  bySlug: Map<string, Protocol>,
  asOf: Date,
  medAge: number,
): { coverage: number; coverageN: number } {
  const traded = snap.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0);
  const lnT = traded.map((p) => Math.log(p.tvl_usd));
  const lnM = traded.map((p) => Math.log(p.mcap_usd!));
  const allAge = snap.protocols.map((p) => Math.log(Math.max(ageDays(p, asOf) ?? medAge, 1)));
  const allTok = snap.protocols.map((p) => (hasToken(p) ? 1 : 0));
  const rng = mulberry32(11);
  const fits: [number, number, number, number][] = [];
  for (let k = 0; k < 200; k++) {
    const ii = Array.from({ length: traded.length }, () => Math.floor(rng() * traded.length));
    const [a, b] = ols2(
      ii.map((i) => lnT[i]!),
      ii.map((i) => lnM[i]!),
    );
    const jj = Array.from({ length: snap.protocols.length }, () => Math.floor(rng() * snap.protocols.length));
    const [A, B] = irlsLogit(
      jj.map((i) => allAge[i]!),
      jj.map((i) => allTok[i]!),
    );
    fits.push([a, b, A, B]);
  }
  const ranks = new Map<string, number[]>();
  for (const r of rows) ranks.set(r.slug, []);
  for (const [a, b, A, B] of fits) {
    const vals = rows.map((r) => {
      const p = bySlug.get(r.slug)!;
      const odds = 1 / (1 + Math.exp(-(A + B * Math.log(Math.max(r.age_days, 1)))));
      return { slug: r.slug, v: Math.exp(a + b * Math.log(p.tvl_usd)) * otherFactor(p, r.age_days) * odds };
    });
    vals.sort((x, y) => y.v - x.v || (x.slug < y.slug ? -1 : 1));
    vals.forEach((v, i) => ranks.get(v.slug)!.push(i + 1));
  }
  for (const r of rows) {
    const s = [...ranks.get(r.slug)!].sort((x, y) => x - y);
    r.rank_lo = Math.round(percentile(s, 0.1));
    r.rank_hi = Math.round(percentile(s, 0.9));
  }
  let covered = 0;
  for (let i = 0; i < traded.length; i++) {
    const fitted = fits.map(([a, b]) => Math.exp(a + b * lnT[i]!)).sort((x, y) => x - y);
    const lo = percentile(fitted, 0.1);
    const hi = percentile(fitted, 0.9);
    if (traded[i]!.mcap_usd! >= lo && traded[i]!.mcap_usd! <= hi) covered++;
  }
  return { coverage: covered, coverageN: traded.length };
}

// ---------------------------------------------------------------- board builder

export function buildRadar(snap: Snapshot): { board: Row[]; radar: Radar } {
  const asOf = new Date(snap.as_of + 'T00:00:00Z');
  const bySlug = new Map(snap.protocols.map((p) => [p.slug, p]));
  const pre = snap.protocols.filter((p) => !hasToken(p));
  const medAge = median(pre.map((p) => ageDays(p, asOf)).filter((a): a is number => a !== null));
  const watch = new Set(snap.watchlist);

  const rows: Row[] = snap.protocols
    .filter(eligible)
    .map((p) => {
      const age = ageDays(p, asOf) ?? medAge;
      const { ev, implied, odds } = evOf(p, age);
      const dep = depositTier(p.tvl_usd);
      const gas = gasFor(p.chains[0] ?? 'Ethereum');
      const hold = holdDays(age);
      return {
        slug: p.slug,
        name: p.name,
        category: p.category,
        chains: p.chains,
        tvl_usd: p.tvl_usd,
        change_7d: p.change_7d,
        age_days: age,
        odds,
        implied_raw: implied,
        implied_value_usd: ev,
        rank: 0,
        rank_lo: 0,
        rank_hi: 0,
        watch: watch.has(p.slug),
        deposit: dep,
        gas_total: +(7 * gas).toFixed(2),
        hold_days: hold,
        farm_steps: farmSteps(p, dep, gas, hold),
      };
    })
    .sort((a, b) => b.implied_value_usd - a.implied_value_usd || (a.slug < b.slug ? -1 : 1));
  rows.forEach((r, i) => {
    r.rank = i + 1;
  });

  const { coverage, coverageN } = bootstrapRanges(snap, rows, bySlug, asOf, medAge);

  const live = snap.protocols
    .filter(hasToken)
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .map((p) => ({ slug: p.slug, name: p.name, category: p.category, tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd }));
  const liveTop = live.slice(0, 24);
  const liveTopSlugs = new Set(liveTop.map((p) => p.slug));
  const liveRest = live.filter((p) => !liveTopSlugs.has(p.slug));
  const excluded: ExcludedRow[] = pre
    .filter((p) => exclusionReason(p) !== null)
    .map((p) => ({ slug: p.slug, name: p.name, reason: exclusionReason(p)! }));

  const radar: Radar = {
    as_of: snap.as_of,
    model: 'radar-7',
    board: rows,
    live: liveTop,
    excluded,
    live_rest: liveRest,
    meta: {
      total: snap.protocols.length,
      ranked: rows.length,
      excluded: excluded.length,
      live_shown: liveTop.length,
      live_rest: liveRest.length,
      coverage,
      coverage_n: coverageN,
      fits: 200,
    },
  };
  return { board: rows, radar };
}

/** The dashboard's data file: one script tag, the same board the page renders. */
export function dataScript(radar: Radar): string {
  return `window.RADAR = ${JSON.stringify(radar)};\n`;
}

/** The gate's shape, checked before anything is written; a string names the first problem. */
export function boardIssue(board: Row[], snap: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `board has ${board.length} rows`;
  for (let i = 0; i < board.length; i++) {
    const r = board[i]!;
    if (r.rank !== i + 1) return `rank at row ${i} is ${r.rank}, expected ${i + 1}`;
    if (i > 0 && r.implied_value_usd > board[i - 1]!.implied_value_usd) return `board not sorted at rank ${r.rank}`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 1e14) {
      return `row ${r.slug}: bad implied_value_usd`;
    }
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `row ${r.slug}: ${r.farm_steps.length} farm steps`;
    const bad = r.farm_steps.find((s) => s.trim().length < 20 || s.trim().length > 600);
    if (bad) return `row ${r.slug}: farm step of ${bad.trim().length} chars`;
  }
  const slugs = new Set(board.map((r) => r.slug));
  if (new Set(snap.protocols.map((p) => p.slug)).size !== snap.protocols.length) return 'snapshot has duplicate slugs';
  const missing = snap.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `watchlist not covered: ${missing.slice(0, 3).join(', ')}`;
  return null;
}
