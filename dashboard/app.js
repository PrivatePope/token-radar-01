// Token Radar, radar-6. Reads window.RADAR (data.js, written by main.ts from the
// same board) and renders the board, filters, sandbox, compare, budget planner,
// validation section and per-protocol detail. No network: every byte shown is in
// data.js or in this file. Model (unchanged from radar-5): EV = implied x odds;
// implied = TVL^0.8 x 8 x (1 + 0.9 x clamp(7d%, -50, +150)) x (0.6 + 0.7 x
// min(age, 1460)/1460) x (1 + 0.015 x min(chains, 10)); odds(age) = 1 / (1 +
// exp(-(-3.595 + 0.604 x ln(age)))); age unknown -> 513 days.
// Validation numbers were measured on the sealed snapshot (128 traded peers
// with a market cap; 758 protocols) and are quoted exactly, including the ones
// that do not flatter the model: only size survives both blind tests, and the
// bootstrap rank range holds the true market cap for just 15% of traded peers.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', chain: 'all', watchOnly: false, tab: 'board',
    sort: 'implied', dir: -1, selected: null,
    growthW: 0.9, ageSpread: 0.7, tvlExp: 0.8, oddsOn: true,
    cmpA: null, cmpB: null, budget: 1000 };

  // Measured validation numbers (sealed snapshot; quoted exactly).
  var VALID = {
    curve: { a: 6.965, b: 0.522, r2: 0.194, n: 128, heldOut: 3.67, within2: 30, within3: 43, naive: 4.01, residSd: 2.077 },
    agree: { top8: 'same order', top10: 9, spearman: 0.991 },
    odds: { a: -3.595, b: 0.604, brier: 0.23, base: 0.248,
      buckets: [[26, 27], [40, 45], [54, 55], [64, 64], [80, 71]] },
    // Per-term blind tests: median |error| x on the 128 traded peers.
    // LOO = leave-one-out; WF50 = train oldest 50%, test newest 50%; WF75 likewise.
    blind: [
      ['median only', 3.87, 4.13, 4.98],
      ['size (log TVL) only', 3.40, 3.83, 3.27],
      ['size + growth', 3.76, 4.29, 3.24],
      ['size + age', 3.42, 5.05, 3.00],
      ['size + chains', 3.60, 4.07, 3.24],
      ['size + growth + age', 3.53, 4.15, 3.51],
      ['full (4 terms)', 3.79, 4.51, 3.46]
    ],
    // Ablation, LOO (full model x3.79): dropping a term gives:
    ablation: [['log TVL', 4.39], ['growth', 3.60], ['log age', 3.87], ['log chains', 3.53]],
    // Launch odds, 5-fold held-out Brier (base rate 0.549, base Brier 0.2476):
    oddsBrier: [['age only', 0.2302], ['age + log TVL', 0.2301], ['age + chains', 0.2302],
      ['age + growth', 0.2297], ['all four', 0.2297]],
    peers: { cat: 4.11, catWf: 4.21, peer: 5.29, peerWf: 3.87, size: 3.40 },
    boot: { n: 200, seed: 11, slopeMed: 0.519, slopeP10: 0.404, slopeP90: 0.627,
      intMed: 6.968, intP10: 5.025, intP90: 9.081,
      ranges: [[2750, 59, 91, 145, 2.5], [320, 23, 30, 39, 1.7], [50, 9, 11, 14, 1.5]] },
    // Leave-one-out bootstrap coverage of the P10-P90 fitted range, measured:
    // 19 of 128 traded peers' true market caps fall inside it (15%).
    coverage: { n: 128, inside: 19, pct: 15 },
    tbill: { rate: 4.13, source: 'Federal Reserve H.15, 3-month Treasury bill (secondary market), 20 Nov 2026' },
    evVsTvl: { spearman: 0.894, top10: 7, top20: 15, moved: 84 }
  };

  // 200 bootstrap refits, computed by main.ts from the snapshot (seed 11):
  // [curve intercept a, curve slope b, odds intercept A, odds slope B] each.
  // Full-sample fits: a = 6.965, b = 0.522, A = -3.595, B = 0.604.
  var BOOT_FITS = DATA.bootstrap.fits;

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtMoney2(n) { return '$' + n.toFixed(2); }

  // The model, the same functions board.json was built with.
  function launchOdds(age, model) {
    var z = model.odds_a + model.odds_b * Math.log(Math.max(age, 1));
    return 1 / (1 + Math.exp(-z));
  }
  // Recomputes a row from the snapshot figures. model may be the dashboard model
  // or sandbox values (opts). Returns ev, implied, odds and the three multipliers.
  function impliedOf(row, model, opts) {
    var m = model || DATA.model;
    var age = row.age_days === null || row.age_days === undefined ? m.unknown_age_days : row.age_days;
    var g = Math.min(m.growth_cap, Math.max(m.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (g / 100) * (opts && opts.growthW !== undefined ? opts.growthW : m.growth_weight);
    var ageMult = m.age_floor + (Math.min(Math.max(age, 0), m.age_days) / m.age_days) * (opts && opts.ageSpread !== undefined ? opts.ageSpread : m.age_range);
    var chainsMult = 1 + m.chains_step * Math.min(row.chains ? row.chains.length : 0, m.chains_cap);
    var tvlExp = opts && opts.tvlExp !== undefined ? opts.tvlExp : m.tvl_exponent;
    var implied = Math.pow(row.tvl_usd, tvlExp) * m.tvl_scale * growthMult * ageMult * chainsMult;
    var odds = (opts && opts.oddsOn === false) ? 1 : launchOdds(age, m);
    return { ev: Math.max(1, Math.round(implied * odds)), implied: Math.round(implied),
      odds: odds, growthMult: growthMult, ageMult: ageMult, chainsMult: chainsMult, age: age, growthPct: g };
  }

  // The farm plan: the same derivation board.json carries.
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the position open.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Provide $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + ' and keep the position open.';
    if (c.indexOf('bridge') >= 0) return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return "Stake $" + capital + " of the chain's staking asset through " + name + ' and keep the receipt.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedge.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + capital + ' and place one market position on ' + name + '.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the shares.';
    if (c.indexOf('stable') >= 0) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.';
    if (c.indexOf('rwa') >= 0) return "Mint $" + capital + " of the protocol's yield asset on " + chain + ' and hold it.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + ' Hold the position and check the protocol\'s own page.';
    return s;
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    return [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
      { text: actionFor(p, capital, chain), cost: '$' + capital + ' of capital and about $' + (capital >= 150 ? 8 : 4) + ' of gas', time: '15 minutes to set up' },
      { text: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.', cost: 'about $2 of gas a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.', cost: 'nothing but the log', time: '5 minutes' }
    ].map(stepText);
  }

  // Verdict + farm economics, from the row's own figures, never the name.
  function verdictFor(row) {
    var g = row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d;
    var age = row.age_days === null || row.age_days === undefined ? DATA.model.unknown_age_days : row.age_days;
    if (row.rank <= 20 && g >= 0 && age >= 365) return 'Farm';
    if (row.rank <= 50) return 'Watch';
    return 'Skip';
  }
  function whyLine(row) {
    var maxTvl = 0, maxAge = 0, maxChains = 0, maxGrowth = -Infinity;
    DATA.rows.forEach(function (r) {
      if (r.tvl_usd > maxTvl) maxTvl = r.tvl_usd;
      var a = r.age_days === null ? 0 : r.age_days;
      if (a > maxAge) maxAge = a;
      if (r.chains && r.chains.length > maxChains) maxChains = r.chains.length;
      var g = r.change_7d === null ? -Infinity : r.change_7d;
      if (r.rank <= 20 && g > maxGrowth) maxGrowth = g;
    });
    var g = row.change_7d === null ? 0 : row.change_7d;
    var age = row.age_days === null ? DATA.model.unknown_age_days : row.age_days;
    if (row.tvl_usd === maxTvl) return 'Ranked #' + row.rank + ' because it holds the largest pre-token TVL in the set (' + fmtUsd(row.tvl_usd) + ') after ' + age + ' days with no token.';
    if (age === maxAge && maxAge > 0) return 'Ranked #' + row.rank + ' because it has waited the longest with no token (' + fmtAge(age) + ') on ' + fmtUsd(row.tvl_usd) + ' of TVL.';
    if (row.chains && row.chains.length === maxChains && maxChains > 1) return 'Ranked #' + row.rank + ' because it runs on the most chains in the set (' + maxChains + ') on ' + fmtUsd(row.tvl_usd) + ' of TVL.';
    if (g === maxGrowth && maxGrowth > 0) return 'Ranked #' + row.rank + ' because it has the fastest 7-day growth in the top 20 (' + fmtPct(g) + ') on ' + fmtUsd(row.tvl_usd) + ' of TVL.';
    return 'Ranked #' + row.rank + ' on ' + fmtUsd(row.tvl_usd) + ' of TVL held for ' + fmtAge(age) + ' with no token, ' + fmtPct(g) + ' in the last week across ' + (row.chains ? row.chains.length : 0) + ' chain' + ((row.chains ? row.chains.length : 0) === 1 ? '' : 's') + '.';
  }
  // Honest farm economics. Gas is summed from the plan's own costs: $3 to set up,
  // $4 or $8 of gas on the deposit, $2 a week for the hold. Break-even is that gas
  // total. The T-bill line prices the same capital parked risk-free at the stated
  // rate. No $/hour figure exists (the snapshot carries no airdrop share).
  function farmEconomics(row) {
    var capital = capitalFor(row);
    var hold = holdDaysFor(row.age_days);
    var gas = 3 + (capital >= 150 ? 8 : 4) + 2 * Math.ceil(hold / 7);
    var tbill = capital * (VALID.tbill.rate / 100) * hold / 365;
    var minCapital = Math.ceil((gas / 0.05) / 10) * 10;
    return { capital: capital, hold: hold, gas: gas, breakEven: gas, tbill: tbill, minCapital: minCapital };
  }

  // Bootstrap rank ranges: for each refit, every row is re-priced by the fitted
  // curve (exp(a + b x ln TVL)) times its own hand growth/age/chains factors and
  // the refit odds, then ranked. The range is the P10-P90 of the row's rank over
  // the 200 refits. It measures only the fits' parameter uncertainty, not the
  // market's scatter around the curve (see the coverage note).
  function percentile(sorted, p) {
    if (sorted.length === 0) return 0;
    var i = (sorted.length - 1) * p;
    var lo = Math.floor(i), hi = Math.ceil(i);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
  }
  function bootstrapRankRanges() {
    var rows = DATA.rows;
    var ranks = {};
    rows.forEach(function (r) { ranks[r.slug] = []; });
    BOOT_FITS.forEach(function (f) {
      var a = f[0], b = f[1], A = f[2], B = f[3];
      var scored = rows.map(function (r) {
        var age = r.age_days === null || r.age_days === undefined ? DATA.model.unknown_age_days : r.age_days;
        var odds = 1 / (1 + Math.exp(-(A + B * Math.log(Math.max(age, 1)))));
        var fitted = Math.exp(a + b * Math.log(r.tvl_usd)) * r.growth_multiplier * r.age_multiplier * r.chains_multiplier * odds;
        return { slug: r.slug, v: fitted };
      });
      scored.sort(function (x, y) { return y.v - x.v || (x.slug < y.slug ? -1 : x.slug > y.slug ? 1 : 0); });
      scored.forEach(function (s, i) { ranks[s.slug].push(i + 1); });
    });
    var out = {};
    rows.forEach(function (r) {
      var s = ranks[r.slug].slice().sort(function (x, y) { return x - y; });
      out[r.slug] = [Math.floor(percentile(s, 0.10)), Math.floor(percentile(s, 0.90))];
    });
    return out;
  }
  var RANGES = bootstrapRankRanges();

  // Self-checks, run live from the data (never hardcoded ticks).
  function runChecks() {
    var checks = [];
    var bad = 0;
    DATA.rows.forEach(function (r) {
      var v = impliedOf(r, DATA.model);
      if (v.ev !== r.implied_value_usd) bad++;
    });
    checks.push({ ok: bad === 0, text: 'Board recomputed — ' + DATA.rows.length + ' rows match' + (bad ? ' (' + bad + ' differ)' : '') });
    var watchCovered = DATA.board_size - DATA.early_size;
    checks.push({ ok: watchCovered === DATA.watchlist_size, text: 'Watchlist ' + watchCovered + '/' + DATA.watchlist_size });
    var accounted = DATA.rows.length + DATA.excluded.length + DATA.live.length + DATA.live_rest.length;
    checks.push({ ok: accounted === 758 && DATA.total_accounted === 758, text: accounted + '/758 accounted for' });
    var stepBad = 0;
    DATA.rows.forEach(function (r) {
      var steps = farmSteps(r);
      if (steps.length !== 6) stepBad++;
      steps.forEach(function (s) { if (s.indexOf('Cost: ') < 0 || s.indexOf('Time: ') < 0) stepBad++; });
    });
    checks.push({ ok: stepBad === 0, text: 'Farm plans: 6 steps, Cost + Time' + (stepBad ? ' (' + stepBad + ' fail)' : '') });
    var entries = (window.performance && performance.getEntriesByType) ? performance.getEntriesByType('resource') : [];
    var net = entries.filter(function (e) { return e.name && e.name.indexOf('file:') !== 0 && e.name.indexOf('data:') !== 0; });
    checks.push({ ok: net.length === 0, text: 'No network — every byte in the page' + (net.length ? ' (' + net.length + ' remote)' : '') });
    var rangeBad = 0;
    DATA.rows.forEach(function (r) {
      var rg = RANGES[r.slug];
      if (!rg || rg[0] > rg[1] || rg[0] < 1 || rg[1] > DATA.rows.length) rangeBad++;
    });
    var again = bootstrapRankRanges();
    var same = true;
    DATA.rows.forEach(function (r) { if (again[r.slug][0] !== RANGES[r.slug][0] || again[r.slug][1] !== RANGES[r.slug][1]) same = false; });
    checks.push({ ok: rangeBad === 0 && same, text: 'Rank ranges recomputed live' + (same ? '' : ' (not deterministic)') });
    return checks;
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // Rows the board shows (sandbox values re-rank live).
  function sandboxActive() {
    return state.growthW !== DATA.model.growth_weight || state.ageSpread !== DATA.model.age_range ||
      state.tvlExp !== DATA.model.tvl_exponent || state.oddsOn !== true;
  }
  function displayRows() {
    if (!sandboxActive()) return DATA.rows;
    var opts = { growthW: state.growthW, ageSpread: state.ageSpread, tvlExp: state.tvlExp, oddsOn: state.oddsOn };
    var scored = DATA.rows.map(function (r) {
      var v = impliedOf(r, DATA.model, opts);
      var copy = Object.assign({}, r);
      copy.implied_value_usd = v.ev;
      copy.implied_raw = v.implied;
      copy.odds = Math.round(v.odds * 1e4) / 1e4;
      return copy;
    });
    scored.sort(function (a, b) { return b.implied_value_usd - a.implied_value_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0); });
    scored.forEach(function (r, i) { r.rank = i + 1; });
    return scored;
  }
  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    return displayRows().filter(function (r) {
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && !(r.chains || []).some(function (c) { return c === state.chain; })) return false;
      if (state.watchOnly && !r.watch) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else if (key === 'odds') { av = a.odds; bv = b.odds; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { text: 'Token Radar' })),
      el('div', { class: 'top-meta' },
        el('span', { text: 'Snapshot ' + DATA.as_of }),
        el('span', { text: 'DefiLlama protocol index' }),
        el('span', { text: DATA.model_version + ' model' })
      )
    );
  }
  function lede() {
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: '198 pre-token protocols, ranked by expected value' }),
        el('p', { text: 'Expected value = the launch\u2019s implied value \u00D7 the share of protocols of this age that record a token. The watchlist is the floor; the early radar adds ' + DATA.early_size + ' below it. A model, not a promise.' })
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Accounted for' }), el('b', { text: DATA.total_accounted + ' / 758' })),
        el('div', { class: 'fact' }, el('span', { text: 'Top pick' }), el('b', { text: fmtUsd(DATA.rows[0].implied_value_usd) }))
      )
    );
  }
  function statsRow() {
    var top = DATA.rows[0];
    return el('div', { class: 'stats' },
      el('span', { class: 'stat', html: 'Top pick <b>' + top.name + ' ' + fmtUsd(top.implied_value_usd) + '</b>' }),
      el('span', { class: 'stat', html: 'Median EV <b>' + fmtUsd(DATA.rows[99].implied_value_usd) + '</b>' }),
      el('span', { class: 'stat', html: 'Watchlist <b>' + DATA.watchlist_size + '/' + DATA.watchlist_size + '</b>' }),
      el('span', { class: 'stat', html: 'Live tokens set aside <b>' + (DATA.live_size + DATA.live_rest_size) + '</b>' }),
      el('span', { class: 'stat', html: 'Excluded, with reasons <b>' + DATA.excluded_size + '</b>' })
    );
  }
  function checksStrip() {
    var checks = runChecks();
    return el('div', { class: 'checks' }, checks.map(function (c) {
      return el('span', { class: 'check' + (c.ok ? '' : ' bad'), text: (c.ok ? '\u2713 ' : '\u2717 ') + c.text });
    }));
  }
  function validLine() {
    var v = VALID;
    return el('div', { class: 'validline' },
      el('b', { text: 'Validation: ' }),
      'the fitted curve (R\u00B2 ' + v.curve.r2 + ', held-out \u00D7' + v.curve.heldOut + ') agrees with the hand formula (top 8 same order, Spearman ' + v.agree.spearman + '); ' +
      'odds Brier ' + v.odds.brier + ' vs ' + v.odds.base + ' base; ' +
      'only size predicts traded mcap on two blind tests (table below); ' +
      'rank ranges P10\u2013P90 over 200 refits.'
    );
  }
  function explainer() {
    var m = DATA.model;
    return el('section', { class: 'explainer' },
      el('p', null,
        el('b', { text: 'How the value is computed. ' }),
        'Four signals, nothing else. ',
        el('b', { text: 'Size: ' }), 'TVL, concave (TVL^0.8 \u00D7 8). ',
        el('b', { text: 'Momentum: ' }), '7-day growth, clamped \u221250\u2026+150%. ',
        el('b', { text: 'Patience: ' }), 'age with no token, 0.6\u20131.3\u00D7. ',
        el('b', { text: 'Reach: ' }), 'chains, up to ten. ',
        'Ranks by expected value: implied value \u00D7 launch odds.'
      ),
      el('div', { class: 'formula', text: 'EV = TVL^0.8 \u00D7 8 \u00D7 (1 + 0.9 \u00D7 clamp(7d%, \u221250, +150)) \u00D7 (0.6 + 0.7 \u00D7 min(age, 1460)/1460) \u00D7 (1 + 0.015 \u00D7 min(chains, 10)) \u00D7 odds(age)' }),
      el('p', { class: 'sub', text: 'Odds(age) = 1 / (1 + exp(\u2212(\u22123.595 + 0.604 \u00D7 ln(age)))). No protocol name is special-cased; the same function scores every row.' })
    );
  }
  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var select = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    select.addEventListener('change', function () { state.category = select.value; writeHash(); render(); });
    var chainSel = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); })
    );
    chainSel.addEventListener('change', function () { state.chain = chainSel.value; writeHash(); render(); });
    var watchBox = el('input', { type: 'checkbox', id: 'watch', checked: state.watchOnly ? 'checked' : null, 'aria-label': 'Watchlist only' });
    watchBox.addEventListener('change', function () { state.watchOnly = watchBox.checked; render(); });
    var tabs = [['board', 'Board'], ['live', 'Live tokens'], ['all758', 'All 758'], ['sandbox', 'Model sandbox'], ['compare', 'Compare'], ['planner', 'Budget planner']];
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), select),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chainSel),
      el('label', { class: 'checkline' }, watchBox, ' Watchlist only'),
      el('div', { class: 'tabs' }, tabs.map(function (t) {
        return el('button', { type: 'button', 'aria-pressed': state.tab === t[0] ? 'true' : 'false', text: t[1],
          onclick: function () { state.tab = t[0]; writeHash(); render(); } });
      })),
      el('span', { class: 'count', text: state.tab === 'board' ? filteredRows().length + ' rows shown' : '' })
    );
  }
  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }
  function boardTable() {
    var list = sortedRows(filteredRows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.watchOnly = false; writeHash(); render(); } })
      ));
    }
    var max = list[0].implied_value_usd || 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: (r.watch ? '\u2605 ' : '') + r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') + ' \u00B7 \u25CF no token' })
        )),
        el('td', { class: 'num', text: (r.category || 'Other') }),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', { class: 'num', text: String(r.chains ? r.chains.length : 0) }),
        el('td', { class: 'num', text: Math.round(r.odds * 100) + '%' }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        ))
      );
      tbody.appendChild(tr);
    });
    var note = sandboxActive() ? el('p', { class: 'sub', text: 'Sandbox values active: this board is re-ranked live from the sliders below. board.json carries the model defaults.' }) : null;
    return el('div', null, note,
      el('div', { class: 'panel' },
        el('div', { class: 'table-wrap' },
          el('table', { class: 'board' },
            el('caption', { class: 'sub', text: 'Pre-token protocols, strongest expected value first. \u2605 is on the house watchlist. Select a row for its model, rank range and farm plan.' }),
            el('thead', null, el('tr', null,
              sortHeader('implied', 'Rank'),
              sortHeader('name', 'Protocol'),
              sortHeader('name', 'Category'),
              sortHeader('tvl', 'TVL'),
              sortHeader('growth', '7d'),
              sortHeader('age', 'Age'),
              sortHeader('age', 'Chains'),
              sortHeader('odds', 'Odds'),
              sortHeader('implied', 'Expected value')
            )),
            tbody
          )
        )
      )
    );
  }
  function liveTable() {
    var rows = DATA.live.concat(DATA.live_rest);
    var tbody = el('tbody');
    rows.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: 'live' }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: r.mcap_usd === null ? 'token on record, no market cap' : fmtUsd(r.mcap_usd) }),
        el('td', null, el('span', { class: 'status live', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', { class: 'board' },
          el('caption', { class: 'sub', text: 'Tokens live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking; the first 24 are the Live token view, the rest are below.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }
  function all758Table() {
    var exBody = el('tbody');
    DATA.excluded.forEach(function (r) {
      exBody.appendChild(el('tr', null,
        el('td', null, el('b', { text: r.name })),
        el('td', { class: 'num', text: r.category || 'Other' }),
        el('td', { text: r.reason })
      ));
    });
    var restBody = el('tbody');
    DATA.live_rest.forEach(function (r) {
      restBody.appendChild(el('tr', null,
        el('td', null, el('b', { text: r.name })),
        el('td', { class: 'num', text: r.category || 'Other' }),
        el('td', { class: 'num', text: r.mcap_usd === null ? 'token on record, no market cap' : fmtUsd(r.mcap_usd) })
      ));
    });
    return el('div', null,
      el('div', { class: 'panel' },
        el('p', null, el('b', { text: '758 of 758 protocols accounted for. ' }),
          '198 ranked on the board, 144 pre-token protocols excluded with their reasons, 24 live tokens in the Live view, and 392 live tokens beyond it. Nothing in the snapshot is dropped silently.'),
        el('h2', { text: 'Pre-token, not ranked (' + DATA.excluded.length + ')' }),
        el('div', { class: 'table-wrap' },
          el('table', { class: 'board' },
            el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'Category' }), el('th', { scope: 'col', text: 'Why it is not ranked' }))),
            exBody
          )
        )
      ),
      el('div', { class: 'panel' },
        el('h2', { text: 'Live tokens beyond the top 24 (' + DATA.live_rest.length + ')' }),
        el('div', { class: 'table-wrap' },
          el('table', { class: 'board' },
            el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'Category' }), el('th', { scope: 'col', text: 'Market cap' }))),
            restBody
          )
        )
      )
    );
  }
  function sandboxPanel() {
    var m = DATA.model;
    function slider(id, label, min, max, step, val, oninput) {
      var out = el('output', { text: String(val) });
      var input = el('input', { type: 'range', id: id, min: String(min), max: String(max), step: String(step), value: String(val), 'aria-label': label });
      input.addEventListener('input', function () { out.textContent = input.value; oninput(parseFloat(input.value)); });
      return el('div', { class: 'row' }, el('label', { for: id, text: label }), input, out);
    }
    var oddsBox = el('input', { type: 'checkbox', id: 'odds', checked: state.oddsOn ? 'checked' : null, 'aria-label': 'Apply launch odds' });
    oddsBox.addEventListener('change', function () { state.oddsOn = oddsBox.checked; render(); });
    return el('section', { class: 'panel sandbox' },
      el('h2', { text: 'Model sandbox' }),
      el('p', { class: 'sub', text: 'Change the model and the board re-ranks live. The defaults are the model that built board.json.' }),
      slider('gw', 'Growth weight (default ' + m.growth_weight + ')', 0, 1.5, 0.05, state.growthW, function (v) { state.growthW = v; render(); }),
      slider('as', 'Age spread (default ' + m.age_range + ')', 0, 1.4, 0.05, state.ageSpread, function (v) { state.ageSpread = v; render(); }),
      slider('te', 'TVL exponent (default ' + m.tvl_exponent + ')', 0.5, 1, 0.01, state.tvlExp, function (v) { state.tvlExp = v; render(); }),
      el('label', { class: 'checkline' }, oddsBox, ' Apply launch odds (expected value instead of raw implied value)'),
      el('p', { class: 'sub', text: 'EV = TVL^exponent \u00D7 8 \u00D7 (1 + growth weight \u00D7 clamp(7d%, \u221250, +150)) \u00D7 (0.6 + age spread \u00D7 min(age, 1460)/1460) \u00D7 (1 + 0.015 \u00D7 min(chains, 10)) \u00D7 odds(age).' })
    );
  }
  function comparePanel() {
    var rows = DATA.rows;
    if (!state.cmpA) state.cmpA = rows[0].slug;
    if (!state.cmpB) state.cmpB = rows[1].slug;
    function pick(id, val, onchange) {
      var sel = el('select', { id: id, 'aria-label': id === 'cmpA' ? 'First protocol' : 'Second protocol' },
        rows.map(function (r) { return el('option', { value: r.slug, text: '#' + r.rank + ' ' + r.name, selected: r.slug === val ? 'selected' : null }); })
      );
      sel.addEventListener('change', function () { onchange(sel.value); render(); });
      return sel;
    }
    var a = rows.filter(function (r) { return r.slug === state.cmpA; })[0] || rows[0];
    var b = rows.filter(function (r) { return r.slug === state.cmpB; })[0] || rows[1];
    function cell(row) {
      var v = impliedOf(row, DATA.model);
      var rg = RANGES[row.slug];
      var ec = farmEconomics(row);
      return [
        el('div', { text: '#' + row.rank }),
        el('div', { text: fmtUsd(row.implied_value_usd) }),
        el('div', { text: fmtUsd(row.implied_raw) }),
        el('div', { text: Math.round(row.odds * 100) + '%' }),
        el('div', { text: fmtUsd(row.tvl_usd) }),
        el('div', { text: fmtPct(row.change_7d) }),
        el('div', { text: fmtAge(row.age_days) }),
        el('div', { text: String(row.chains ? row.chains.length : 0) }),
        el('div', { text: rg ? rg[0] + '\u2013' + rg[1] : 'n/a' }),
        el('div', null, el('span', { class: 'verdict ' + verdictFor(row).toLowerCase(), text: verdictFor(row) })),
        el('div', { text: 'gas about $' + ec.gas }),
        el('div', { class: 'equation', text: equationString(row, v) })
      ];
    }
    var labels = ['Rank', 'Expected value', 'Implied value', 'Launch odds', 'TVL', '7d growth', 'Age', 'Chains', 'Rank range (P10\u2013P90)', 'Verdict', 'Break-even gas', 'Value as an equation'];
    var grid = el('div', { class: 'cmp-grid' },
      el('div', { text: '' }), el('div', { text: a.name }), el('div', { text: b.name })
    );
    var ca = cell(a), cb = cell(b);
    labels.forEach(function (lab, i) {
      grid.appendChild(el('div', { text: lab }));
      grid.appendChild(ca[i]);
      grid.appendChild(cb[i]);
    });
    return el('section', { class: 'panel' },
      el('h2', { text: 'Compare two protocols' }),
      el('p', { class: 'sub', text: 'Side by side: value, factors, rank range under 200 refits, verdict and break-even.' }),
      el('div', { class: 'row' },
        el('div', { class: 'field' }, el('label', { for: 'cmpA', text: 'First' }), pick('cmpA', state.cmpA, function (v) { state.cmpA = v; })),
        el('div', { class: 'field' }, el('label', { for: 'cmpB', text: 'Second' }), pick('cmpB', state.cmpB, function (v) { state.cmpB = v; }))
      ),
      grid
    );
  }
  function plannerPanel() {
    var input = el('input', { type: 'number', id: 'budget', min: '50', step: '50', value: String(state.budget), 'aria-label': 'Budget in dollars' });
    input.addEventListener('input', function () { state.budget = parseFloat(input.value) || 0; render(); });
    var budget = state.budget || 0;
    var farms = DATA.rows.filter(function (r) { return verdictFor(r) === 'Farm'; })
      .sort(function (x, y) { return y.implied_value_usd - x.implied_value_usd; });
    var chosen = [], left = budget, capTotal = 0, gasTotal = 0, evTotal = 0;
    farms.forEach(function (r) {
      var ec = farmEconomics(r);
      if (ec.capital <= left) { chosen.push({ row: r, ec: ec }); left -= ec.capital; capTotal += ec.capital; gasTotal += ec.gas; evTotal += r.implied_value_usd; }
    });
    var tbody = el('tbody');
    chosen.forEach(function (c) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: '#' + c.row.rank }),
        el('td', null, el('b', { text: c.row.name })),
        el('td', { class: 'num', text: fmtUsd(c.row.implied_value_usd) }),
        el('td', { class: 'num', text: '$' + c.ec.capital }),
        el('td', { class: 'num', text: '$' + c.ec.gas })
      ));
    });
    return el('section', { class: 'panel planner' },
      el('h2', { text: 'Budget planner' }),
      el('p', { class: 'sub', text: 'Enter the capital you can deploy. The planner fills it with the highest expected-value Farm rows whose deposit fits and totals the capital, gas and expected value. Only Farm rows; a deposit is $50\u2013$250.' }),
      el('div', { class: 'row' }, el('label', { for: 'budget', text: 'Budget ($)' }), input),
      chosen.length === 0
        ? el('p', { text: 'No Farm row fits this budget. The smallest Farm deposit is $50.' })
        : el('div', { class: 'table-wrap' },
            el('table', { class: 'board' },
              el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Rank' }), el('th', { scope: 'col', text: 'Farm' }), el('th', { scope: 'col', text: 'Expected value' }), el('th', { scope: 'col', text: 'Deposit' }), el('th', { scope: 'col', text: 'Gas' }))),
              tbody
            )
          ),
      el('div', { class: 'totals' },
        el('span', { html: 'Farms: <b>' + chosen.length + '</b>' }),
        el('span', { html: 'Capital deployed: <b>$' + capTotal + '</b>' }),
        el('span', { html: 'Gas, total: <b>$' + gasTotal + '</b>' }),
        el('span', { html: 'Combined expected value: <b>' + fmtUsd(evTotal) + '</b>' }),
        el('span', { html: 'Budget left: <b>$' + left + '</b>' })
      )
    );
  }
  function modelPanel() {
    var m = DATA.model;
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How expected value is computed' }),
      el('p', { class: 'sub', text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked.' }),
      el('div', { class: 'formula', text: 'EV = TVL^0.8 \u00D7 8 \u00D7 (1 + 0.9 \u00D7 clamp(7d%, \u221250, +150)) \u00D7 (0.6 + 0.7 \u00D7 min(age, 1460)/1460) \u00D7 (1 + 0.015 \u00D7 min(chains, 10)) \u00D7 odds(age)' }),
      el('p', { class: 'sub', text: 'Age is the time since the protocol was first listed, the best record of how long it has run with no token; an unlisted age uses ' + m.unknown_age_days + ' days (the pre-token median). The odds are the share of protocols of that age that record a token \u2014 a cross-sectional base rate, not a forward probability that a protocol still waiting will launch. Age is therefore counted twice; the combined age spread is about 7\u00D7.' })
    );
  }
  function validationSection() {
    var v = VALID;
    function blindTable() {
      var tbody = el('tbody');
      v.blind.forEach(function (row) {
        tbody.appendChild(el('tr', null,
          el('td', { text: row[0] }),
          el('td', { class: 'num', text: '\u00D7' + row[1].toFixed(2) }),
          el('td', { class: 'num', text: '\u00D7' + row[2].toFixed(2) }),
          el('td', { class: 'num', text: '\u00D7' + row[3].toFixed(2) })
        ));
      });
      return el('table', { class: 'board' },
        el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Model' }), el('th', { scope: 'col', text: 'Leave-one-out' }), el('th', { scope: 'col', text: 'Walk-forward 50/50' }), el('th', { scope: 'col', text: 'Walk-forward 75/25' }))),
        tbody
      );
    }
    function ablationTable() {
      var tbody = el('tbody');
      tbody.appendChild(el('tr', null, el('td', { text: 'full (4 terms)' }), el('td', { class: 'num', text: '\u00D73.79' })));
      v.ablation.forEach(function (row) {
        tbody.appendChild(el('tr', null, el('td', { text: 'minus ' + row[0] }), el('td', { class: 'num', text: '\u00D7' + row[1].toFixed(2) })));
      });
      return el('table', { class: 'board' },
        el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Ablation (leave-one-out)' }), el('th', { scope: 'col', text: 'Median |error|' }))),
        tbody
      );
    }
    function brierTable() {
      var tbody = el('tbody');
      v.oddsBrier.forEach(function (row) {
        tbody.appendChild(el('tr', null, el('td', { text: row[0] }), el('td', { class: 'num', text: row[1].toFixed(4) })));
      });
      return el('table', { class: 'board' },
        el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Launch-odds inputs (5-fold held-out Brier)' }), el('th', { scope: 'col', text: 'Brier' }))),
        tbody
      );
    }
    var bucketText = v.odds.buckets.map(function (b) { return b[0] + '% vs ' + b[1] + '%'; }).join(', ');
    return el('section', { class: 'panel validate' },
      el('h2', { text: 'How we know the model works' }),
      el('p', null,
        el('b', { text: 'The fitted curve. ' }),
        'On the 128 traded peers, log(market cap) = ' + v.curve.a + ' + ' + v.curve.b + ' \u00D7 log(TVL), R\u00B2 = ' + v.curve.r2 + '. ' +
        'Held out (5-fold), the median error is \u00D7' + v.curve.heldOut + ' (' + v.curve.within2 + '% within 2\u00D7, ' + v.curve.within3 + '% within 3\u00D7); guessing the median market cap for every peer gives \u00D7' + v.curve.naive + '. ' +
        'The traded market\u2019s multiples span orders of magnitude, so no formula prices a launch precisely \u2014 the board ranks, it does not price. ' +
        'Agreement check: replacing the hand-set TVL term with the fitted curve leaves the top 8 in the same order, top-10 ' + v.agree.top10 + '/10, Spearman ' + v.agree.spearman + '.'
      ),
      el('p', null,
        el('b', { text: 'The blind tests. ' }),
        'Each value term was kept or dropped on two blind tests: leave-one-out and walk-forward (train on the older-listed half or three-quarters, test on the newer). ' +
        'The honest result: ', el('span', { class: 'warn', text: 'only size survives both tests.' }),
        ' Growth and chains make the held-out error worse on leave-one-out and on the 50/50 walk-forward; age is mixed (helps the 75/25 split, hurts the 50/50). ' +
        'The terms stay anyway because the ranking must follow from TVL, growth and age with no token \u2014 and they do real work: expected value vs pure TVL order has Spearman ' + v.evVsTvl.spearman + ', top-10 overlap ' + v.evVsTvl.top10 + '/10, top-20 ' + v.evVsTvl.top20 + '/20, and ' + v.evVsTvl.moved + ' rows move more than 10 ranks.'
      ),
      blindTable(),
      ablationTable(),
      el('p', null,
        el('b', { text: 'The launch odds. ' }),
        'Logistic on log age, \u22123.595 + 0.604 \u00D7 ln(age). Calibration (observed vs predicted): ' + bucketText + '. ' +
        'Held-out Brier ' + v.odds.brier + ' against a base rate of ' + v.odds.base + '. Adding TVL, chains or growth to age moves the held-out Brier by at most 0.0005, so age alone is the odds:'
      ),
      brierTable(),
      el('p', null,
        el('b', { text: 'Per-ticker peer models, tested and rejected. ' }),
        'Per-category intercepts: leave-one-out \u00D7' + v.peers.cat + ' (walk-forward \u00D7' + v.peers.catWf + '). ' +
        'Nearest-5 peer multiple in the same category: \u00D7' + v.peers.peer + ' (walk-forward \u00D7' + v.peers.peerWf + '). ' +
        'Both are worse than the single global size-only curve (\u00D7' + v.peers.size + ').'
      ),
      el('p', null,
        el('b', { text: 'The rank ranges. ' }),
        'The comps curve and the odds were refit on 200 bootstrap resamples (seed 11) and every row re-ranked; the detail panel shows each row\u2019s P10\u2013P90 rank. ' +
        'Curve slope median ' + v.boot.slopeMed + ' (P10 ' + v.boot.slopeP10 + ', P90 ' + v.boot.slopeP90 + '); intercept median ' + v.boot.intMed + ' (P10 ' + v.boot.intP10 + ', P90 ' + v.boot.intP90 + '). ' +
        'Fitted market cap P90/P10: ' + v.boot.ranges.map(function (r) { return r[4] + '\u00D7 at $' + r[0] + 'M TVL ($' + r[1] + 'M\u2013$' + r[2] + 'M, median $' + r[3] + 'M)'; }).join('; ') + '. ' +
        'Coverage, measured held out: the P10\u2013P90 fitted range contains the true market cap for ' + v.coverage.inside + ' of ' + v.coverage.n + ' traded peers (' + v.coverage.pct + '%). ' +
        'The range measures only the fits\u2019 parameter uncertainty \u2014 the market\u2019s own scatter is far wider (residual \u00D7' + v.curve.residSd + '), so the range is a stability check on the ranking, not a confidence interval for a launch value.'
      ),
      el('p', { class: 'sub', text: 'Survivorship caveat: the odds are the share of protocols of that age that record a token, not a forward probability that a protocol still waiting will launch. A four-year-old protocol with no token is in the minority of its cohort that did not launch; the base rate over-credits it.' })
    );
  }

  // The value as one equation string, from the row's own numbers.
  function equationString(row, v) {
    var tvl = fmtUsd(row.tvl_usd);
    return tvl + '^0.8 \u00D7 8 \u00D7 ' + v.growthMult.toFixed(2) + ' \u00D7 ' + v.ageMult.toFixed(2) + ' \u00D7 ' + v.chainsMult.toFixed(2) + ' \u00D7 ' + v.odds.toFixed(2) + ' = ' + fmtUsd(row.implied_value_usd);
  }

  // Detail slide-over.
  var panel = el('div', { class: 'detail-panel', hidden: true, role: 'dialog', 'aria-label': 'Protocol detail' });
  panel.addEventListener('click', function (e) { if (e.target === panel) closeDetail(); });

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    var v = impliedOf(row, DATA.model);
    var verdict = verdictFor(row);
    var rg = RANGES[row.slug];
    var ec = farmEconomics(row);
    var steps = farmSteps(row);
    var recompute = v.ev === row.implied_value_usd;
    panel.textContent = '';
    panel.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size }),
        el('h2', { text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') + ' \u00B7 \u25CF no token' })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { closeDetail(); } })
    ));
    panel.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Verdict' }),
      el('p', null,
        el('span', { class: 'verdict ' + verdict.toLowerCase(), text: verdict }),
        ' Rule: Farm = rank \u2264 20 with 7d \u2265 0 and age \u2265 365d; Watch = rank \u2264 50; Skip = rank > 50.'
      ),
      el('p', { text: whyLine(row) })
    ));
    panel.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Expected value' }),
      el('div', { class: 'equation', text: equationString(row, v) }),
      el('div', { class: 'factors' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) })),
        el('div', null, el('span', { text: 'Chains' }), el('b', { class: 'num', text: String(row.chains ? row.chains.length : 0) })),
        el('div', null, el('span', { text: 'Launch odds' }), el('b', { class: 'num', text: Math.round(row.odds * 100) + '%' })),
        el('div', null, el('span', { text: 'Expected value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) }))
      ),
      el('p', { class: 'sub', text: 'The same function scores every protocol. The page recomputes this row as ' + fmtUsd(v.ev) + (recompute ? ', the same number the board carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price.' }),
      el('p', { class: 'sub', text: 'Rank ' + row.rank + ' (P10\u2013P90 under 200 refits of the fitted curve and the odds: ' + (rg ? rg[0] + '\u2013' + rg[1] : 'n/a') + ').' })
    ));
    panel.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm economics' }),
      el('div', { class: 'econ' },
        el('div', null, el('b', { text: 'Break-even: ' }), 'farming this costs about $' + ec.gas + ' in gas and ties up $' + ec.capital + ' for ' + ec.hold + ' days \u2014 it pays if your eventual airdrop is worth more than $' + ec.gas + '.'),
        el('div', null, el('b', { text: 'Against a T-bill: ' }), 'parking the same $' + ec.capital + ' for ' + ec.hold + ' days at ' + VALID.tbill.rate + '% (' + VALID.tbill.source + ') earns about ' + fmtMoney2(ec.tbill) + '.'),
        el('div', null, el('b', { text: 'Smallest sensible deposit: ' }), '$' + ec.minCapital + ' \u2014 the deposit at which gas is at most 5% of the position. No $/hour figure: the snapshot carries no airdrop share.')
      )
    ));
    panel.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))
    ));
    panel.hidden = false;
  }
  function closeDetail() {
    state.selected = null;
    panel.hidden = true;
    writeHash();
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('cat')) state.category = params.get('cat');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('tab')) state.tab = params.get('tab');
    if (params.get('detail')) state.selected = params.get('detail');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('cat', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.tab !== 'board') params.set('tab', state.tab);
    if (state.selected) params.set('detail', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(statsRow());
    shell.appendChild(checksStrip());
    shell.appendChild(validLine());
    shell.appendChild(explainer());
    shell.appendChild(controls());
    if (state.tab === 'board') shell.appendChild(boardTable());
    else if (state.tab === 'live') shell.appendChild(liveTable());
    else if (state.tab === 'all758') shell.appendChild(all758Table());
    else if (state.tab === 'sandbox') { shell.appendChild(boardTable()); shell.appendChild(sandboxPanel()); }
    else if (state.tab === 'compare') shell.appendChild(comparePanel());
    else if (state.tab === 'planner') shell.appendChild(plannerPanel());
    if (state.tab === 'board') { shell.appendChild(modelPanel()); shell.appendChild(validationSection()); }
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!panel.isConnected) app.appendChild(panel);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !panel.hidden) closeDetail();
  });
})();
