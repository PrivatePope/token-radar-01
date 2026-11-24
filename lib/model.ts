// The token radar's model, radar-5: expected value.
//
// One sealed snapshot of the protocol universe in, one ranked board out. The board
// covers every slug in the snapshot's watchlist (the floor, never a ceiling) and
// adds every other pre-token protocol the house rule admits: 198 rows in all.
//
// A protocol records no token when its snapshot entry carries no CoinGecko id and
// no symbol. Say it records no token, never that it has none: a record can miss a
// token that exists. The live-token protocols are kept apart and shown as the
// market's own values, never mixed into the ranked board.
//
// Expected value follows only from the snapshot's own figures:
//
//   size       = tvl_usd ^ 0.8 x 8
//   growth     = clamp(change_7d, -50, +150) per cent, null counts as 0
//   growthMult = 1 + 0.9 x growth / 100
//   patience   = 0.6 + 0.7 x min(age_days, 1460) / 1460
//   reach      = 1 + 0.015 x min(chains, 10)
//   implied    = size x growthMult x patience x reach
//   odds       = 1 / (1 + exp(-(-3.595 + 0.604 x ln(age_days))))
//   value      = max(1, round(implied x odds))
//
// Age is days from listed_at to the snapshot's as_of date; a protocol with no
// listing date takes the median age of the pre-token set. The odds are a fitted
// launch-odds curve: the share of protocols of that age that record a token,
// fitted by logistic regression on log age over the whole snapshot. The board
// ranks by expected value: the launch's implied value times those odds.
//
// No protocol name is ever special-cased: the same function scores every row.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
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

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them and the sandbox may change them. */
export interface ModelConstants {
  size_exponent: number;
  size_scale: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  patience_floor: number;
  patience_range: number;
  patience_days: number;
  reach_step: number;
  reach_chains: number;
  odds_intercept: number;
  odds_slope: number;
}

export const MODEL: ModelConstants = {
  size_exponent: 0.8,
  size_scale: 8,
  growth_weight: 0.9,
  growth_floor: -50,
  growth_cap: 150,
  patience_floor: 0.6,
  patience_range: 0.7,
  patience_days: 1460,
  reach_step: 0.015,
  reach_chains: 10,
  odds_intercept: -3.595,
  odds_slope: 0.604,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-5';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
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
  token_status: 'pre-token';
  age_days: number;
  age_known: boolean;
  implied_value_usd: number;
  implied_raw: number;
  odds: number;
  model: {
    size_term: number;
    growth_pct: number;
    growth_multiplier: number;
    patience_multiplier: number;
    reach_multiplier: number;
    odds: number;
    age_days: number;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with farm plans generated in the page. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number;
  age_known: boolean;
  implied_value_usd: number;
  implied_raw: number;
  odds: number;
  watch: boolean;
  size_term: number;
  growth_multiplier: number;
  patience_multiplier: number;
  reach_multiplier: number;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** A pre-token protocol the house rule leaves out, and the branch that leaves it out. */
export interface ExcludedRow {
  slug: string;
  name: string;
  category: string | null;
  tvl_usd: number;
  reason: string;
}

/** A live-token protocol beyond the Live token view's top 24. */
export interface LiveRestRow {
  slug: string;
  name: string;
  category: string | null;
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, the rest, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist: string[];
  watchlist_size: number;
  board_size: number;
  live_size: number;
  excluded_size: number;
  live_rest_size: number;
  total_accounted: number;
  rows: RadarRow[];
  live: LiveRow[];
  excluded: ExcludedRow[];
  live_rest: LiveRestRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** The middle of a sorted list, the mean of the middle two when it is even. */
function medianOf(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  if (s.length === 0) return 0;
  return s.length % 2 === 1 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.round((a - b) / DAY_MS));
}

/** Whether a protocol's record carries a token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.gecko_id === null && p.symbol === null;
}

/** The house rule's excluded categories: a wrapped, staked or bridged product of a token that trades. */
export const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** Exchange names a protocol must not begin with, under the house rule. */
export const EXCHANGE_NAMES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** A whole word wrapped, staked or staking anywhere in the name. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/**
 * Why the house rule leaves a pre-token protocol out of the board, or null when
 * it admits it. The branches are checked in the order the rule states them:
 * excluded category first, then a versioned name, then a wrapped or staked
 * product name, then an exchange name.
 */
export function exclusionReason(p: SnapshotProtocol): string | null {
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return `excluded category: ${p.category}`;
  if (VERSIONED.test(p.name)) return 'versioned deployment name';
  if (WRAPPED_WORD.test(p.name)) return 'wrapped/staked product name';
  if (EXCHANGE_NAMES.some((e) => p.name.startsWith(e))) return 'exchange name';
  return null;
}

/** Whether a protocol is one the board may rank: pre-token and admitted by the house rule. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && exclusionReason(p) === null;
}

/** The median age of the pre-token set, for protocols with no listing date. */
export function medianPreTokenAge(snapshot: Snapshot): number {
  const ages = snapshot.protocols.filter(isPreToken).map((p) => ageDays(snapshot.as_of, p.listed_at)).filter((a): a is number => a !== null);
  return medianOf(ages);
}

/** The four factors and the expected value one protocol gets under `model`. */
export function expectedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
  fallbackAge: number,
): { value: number; implied: number; odds: number; sizeTerm: number; growthPct: number; growthMult: number; patienceMult: number; reachMult: number; age: number; ageKnown: boolean } {
  const known = ageDays(asOf, protocol.listed_at);
  const age = known ?? fallbackAge;
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const patienceMult = model.patience_floor + (Math.min(Math.max(age, 0), model.patience_days) / model.patience_days) * model.patience_range;
  const reachMult = 1 + model.reach_step * Math.min(protocol.chains.length, model.reach_chains);
  const sizeTerm = Math.pow(protocol.tvl_usd, model.size_exponent) * model.size_scale;
  const implied = sizeTerm * growthMult * patienceMult * reachMult;
  const odds = 1 / (1 + Math.exp(-(model.odds_intercept + model.odds_slope * Math.log(Math.max(age, 1)))));
  const value = Math.max(1, Math.round(implied * odds));
  return { value, implied: Math.round(implied), odds, sizeTerm, growthPct, growthMult, patienceMult, reachMult, age, ageKnown: known !== null };
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const fallbackAge = medianPreTokenAge(snapshot);
  const scored = snapshot.protocols
    .filter(isRankable)
    .map((p) => ({ p, ...expectedValue(p, snapshot.as_of, model, fallbackAge) }));
  scored.sort((a, b) => b.value - a.value || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token' as const,
    age_days: s.age,
    age_known: s.ageKnown,
    implied_value_usd: s.value,
    implied_raw: s.implied,
    odds: Math.round(s.odds * 1e4) / 1e4,
    model: {
      size_term: Math.round(s.sizeTerm),
      growth_pct: Math.round(s.growthPct * 100) / 100,
      growth_multiplier: Math.round(s.growthMult * 1e4) / 1e4,
      patience_multiplier: Math.round(s.patienceMult * 1e4) / 1e4,
      reach_multiplier: Math.round(s.reachMult * 1e4) / 1e4,
      odds: Math.round(s.odds * 1e4) / 1e4,
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost} · Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 1_000_000_000) return 250;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number): number {
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Lend $${capital} of USDC on ${name} (${chain}) and leave the deposit working.`;
  if (c.includes('dex') || c.includes('swap') || c.includes('liquidity')) return `Add $${capital} of liquidity to ${name}'s main pool on ${chain} and leave it in place.`;
  if (c.includes('yield') || c.includes('leveraged farm')) return `Deposit $${capital} into ${name}'s main yield position on ${chain} and leave it earning.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} with ${name} and put the bridged funds to work in its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} through ${name} on ${chain} and hold the receipt token.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Post $${capital} of USDC as margin on ${name} and open one small hedged position.`;
  if (c.includes('prediction')) return `Fund $${capital} and take one market position on ${name}.`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('vault')) return `Deposit $${capital} into a ${name} vault on ${chain} and hold the shares.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield-bearing asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time. The plan is derived from
 * the protocol's own record (category, chains, TVL, age), never from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const action = actionFor(p, capital, chain);
  const gas = capital >= 250 ? 8 : 4;
  return [
    {
      text: `Open a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: 'under $3 of gas',
      time: '5 minutes',
    },
    {
      text: action,
      cost: `$${capital} capital, about $${gas} gas`,
      time: '15 minutes',
    },
    {
      text: `Do one qualifying action each week — a deposit, a borrow, a swap or a vote — so the wallet stays active.`,
      cost: 'about $2 of gas a week',
      time: '10 minutes weekly',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity spans more than one snapshot.`,
      cost: `$${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before withdrawing, open the protocol's own points or rewards page and claim only through the link it publishes.`,
      cost: 'no fee to check',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it cleanly.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p))
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** The live-token protocols beyond the Live token view, by market cap. */
export function liveRestRows(snapshot: Snapshot): LiveRestRow[] {
  const shown = new Set(liveRows(snapshot).map((r) => r.slug));
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && !shown.has(p.slug))
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** The pre-token protocols the house rule leaves out, each with its reason. */
export function excludedRows(snapshot: Snapshot): ExcludedRow[] {
  return snapshot.protocols
    .filter((p) => isPreToken(p) && exclusionReason(p) !== null)
    .sort((a, b) => b.tvl_usd - a.tvl_usd)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      tvl_usd: p.tvl_usd,
      reason: exclusionReason(p)!,
    }));
}

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export function radarRow(row: BoardRow, onWatch: boolean): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    age_days: row.age_days,
    age_known: row.age_known,
    implied_value_usd: row.implied_value_usd,
    implied_raw: row.implied_raw,
    odds: row.odds,
    watch: onWatch,
    size_term: row.model.size_term,
    growth_multiplier: row.model.growth_multiplier,
    patience_multiplier: row.model.patience_multiplier,
    reach_multiplier: row.model.reach_multiplier,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const excluded = excludedRows(snapshot);
  const liveRest = liveRestRows(snapshot);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist: [...snapshot.watchlist],
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    live_size: live.length,
    excluded_size: excluded.length,
    live_rest_size: liveRest.length,
    total_accounted: board.length + excluded.length + live.length + liveRest.length,
    rows: board.map((r) => radarRow(r, snapshot.watchlist.includes(r.slug))),
    live,
    excluded,
    live_rest: liveRest,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on expected value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same expected value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has expected value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
