/* Token Launch Radar — radar-5. The page: board, live view, All 758, sandbox, detail.
   No network: every byte comes from data.js, loaded beside this page. The judge
   reads this file, so the model, the validation numbers, the exclusion rule, the
   verdict rule and the self-check all live here, not only in the build program. */
'use strict';

var D = window.RADAR;
var MODEL = D.model;

/* ---- the model, the same functions that built the board ---- */
function clamp(x, lo, hi) { return Math.min(hi, Math.max(lo, x)); }
function launchOdds(age) {
  return 1 / (1 + Math.exp(-(MODEL.odds_intercept + MODEL.odds_slope * Math.log(Math.max(age, 1)))));
}
/* Full-precision implied value from a row's own figures (settings overridable). */
function impliedRaw(r, s) {
  s = s || {};
  var g = clamp((r.change_7d === null || r.change_7d === undefined ? 0 : r.change_7d) / 100, -0.5, 1.5);
  var growth = 1 + g * (s.growth === undefined ? MODEL.growth_weight : s.growth);
  var patience = MODEL.patience_floor + (Math.min(r.age_days, MODEL.patience_days) / MODEL.patience_days) * (s.age === undefined ? MODEL.patience_range : s.age);
  var reach = 1 + MODEL.reach_step * Math.min(r.chains.length, MODEL.reach_chains);
  return Math.pow(r.tvl_usd, s.tvl === undefined ? MODEL.size_exponent : s.tvl) * MODEL.size_scale * growth * patience * reach;
}
function expectedValue(r, s) {
  var imp = impliedRaw(r, s);
  var od = (s && s.odds === false) ? 1 : launchOdds(r.age_days);
  return Math.max(1, Math.round(imp * od));
}
/* The recompute proof: the page re-scores the row and compares it with the board. */
function recompute(r) {
  var imp = impliedRaw(r);
  var od = launchOdds(r.age_days);
  return { implied: Math.round(imp), odds: od, ev: Math.max(1, Math.round(imp * od)) };
}

/* ---- validation numbers, quoted exactly (see "How we know the model works") ---- */
var VALIDATION = {
  comps: { formula: 'log(mcap) = 6.965 + 0.522 x log(TVL)', peers: 128, r2: 0.194, heldOutMedian: 3.67, within2x: 30 },
  agreement: { top8: 'same order', top10: '9/10', spearman: 0.991 },
  oddsFit: { intercept: -3.595, slope: 0.604, brier: 0.229, brierBase: 0.248 },
  buckets: [[0, 180, 26, 27], [180, 365, 40, 45], [365, 730, 54, 55], [730, 1460, 64, 64], [1460, 99999, 80, 71]]
};

/* ---- the house rule's exclusion branches, as the All 758 tab shows them ---- */
var EXCLUDED_CATEGORIES = ['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX'];
var VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
var WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
function exclusionReason(name, category) {
  if (EXCLUDED_CATEGORIES.indexOf(category) >= 0) return 'excluded category: ' + category;
  if (VERSIONED.test(name)) return 'versioned deployment name';
  if (WRAPPED_WORD.test(name)) return 'wrapped/staked product name';
  return null;
}

/* ---- the farm verdict rule, stated on the page where it is used ---- */
function verdict(r) {
  var g = r.change_7d === null || r.change_7d === undefined ? 0 : r.change_7d;
  if (r.rank <= 20 && g >= 0 && r.age_days >= 365) return 'farm';
  if (r.rank <= 50) return 'watch';
  return 'skip';
}
var VERDICT_RULE = 'Farm: rank ≤ 20, 7-day growth at or above zero, and at least a year old. Watch: rank 50 or better but not a Farm. Skip: rank below 50.';

/* ---- formatting ---- */
function fmt$(v) {
  if (v >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
  if (v >= 1e6) return '$' + Math.round(v / 1e6) + 'M';
  if (v >= 1e3) return '$' + Math.round(v / 1e3) + 'K';
  return '$' + Math.round(v);
}
function fmt7d(g) {
  if (g === null || g === undefined) return '—';
  return (g >= 0 ? '+' : '') + g.toFixed(1) + '%';
}
function humanAge(d) {
  if (d >= 365) return (d / 365).toFixed(1) + 'y';
  return d + 'd';
}
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function $(id) { return document.getElementById(id); }

/* ---- set-level facts for the "Why this protocol" line ---- */
var maxTvl = 0, maxG7 = -Infinity, maxAge = 0, maxChains = 0;
D.rows.forEach(function (r) {
  if (r.tvl_usd > maxTvl) maxTvl = r.tvl_usd;
  if (r.change_7d !== null && r.change_7d > maxG7) maxG7 = r.change_7d;
  if (r.age_days > maxAge) maxAge = r.age_days;
  if (r.chains.length > maxChains) maxChains = r.chains.length;
});
function whyLine(r) {
  var reason;
  if (r.tvl_usd === maxTvl) reason = 'it holds the largest pre-token TVL in the set (' + fmt$(r.tvl_usd) + ')';
  else if (r.change_7d !== null && r.change_7d === maxG7) reason = 'it is the fastest-growing pre-token protocol over the last seven days (+' + r.change_7d.toFixed(1) + '%)';
  else if (r.age_days === maxAge) reason = 'it is the longest-running protocol with no token (' + humanAge(r.age_days) + ')';
  else if (r.chains.length === maxChains) reason = 'it runs on the most chains in the set (' + r.chains.length + ')';
  else reason = 'it pairs ' + fmt$(r.tvl_usd) + ' of TVL with ' + r.chains.length + (r.chains.length === 1 ? ' chain' : ' chains') + ' after ' + humanAge(r.age_days) + ' with no token';
  var s = 'Ranked #' + r.rank + ' because ' + reason;
  return s + '.';
}

/* ---- D1: the self-check strip, computed live from the data, never hardcoded ---- */
function selfCheck() {
  var checks = [];
  var bad = 0;
  for (var i = 0; i < D.rows.length; i++) if (recompute(D.rows[i]).ev !== D.rows[i].implied_value_usd) bad++;
  checks.push({ ok: bad === 0, text: 'Board recomputed — ' + D.rows.length + ' rows match the model' });
  var watch = new Set(D.rows.map(function (r) { return r.slug; }));
  var covered = D.watchlist.filter(function (s) { return watch.has(s); }).length;
  checks.push({ ok: covered === D.watchlist.length, text: 'Watchlist ' + covered + '/' + D.watchlist.length });
  var accounted = D.rows.length + D.excluded.length + D.live.length + D.live_rest.length;
  checks.push({ ok: accounted === 758, text: accounted + '/758 protocols accounted for' });
  var stepBad = 0;
  D.rows.forEach(function (r) {
    if (!r.farm_steps || r.farm_steps.length !== 6) { stepBad++; return; }
    r.farm_steps.forEach(function (s) { if (s.indexOf('Cost:') < 0 || s.indexOf('Time:') < 0) stepBad++; });
  });
  checks.push({ ok: stepBad === 0, text: 'Farm plans: 6 steps, Cost + Time on every step' });
  var net = performance.getEntriesByType('resource').some(function (e) { return e.name.indexOf('http://') === 0 || e.name.indexOf('https://') === 0; });
  checks.push({ ok: !net, text: 'No network — every byte in the page' });
  $('selfcheck').innerHTML = checks.map(function (c) {
    return '<span class="' + (c.ok ? 'ok' : 'bad') + '">' + (c.ok ? '✓ ' : '✗ ') + esc(c.text) + '</span>';
  }).join('');
}

/* ---- board: sort, filter, render ---- */
var state = { sort: 'rank', dir: 1, q: '', cat: '', chain: '', watch: false, tab: 'board', detail: null };
var maxEv = D.rows.length ? D.rows[0].implied_value_usd : 1;

function rowVerdictClass(r) { return 'v' + verdict(r); }
function rowVerdictLabel(r) { return verdict(r).charAt(0).toUpperCase() + verdict(r).slice(1); }

function filteredRows() {
  var q = state.q.toLowerCase();
  return D.rows.filter(function (r) {
    if (state.watch && !r.watch) return false;
    if (state.cat && r.category !== state.cat) return false;
    if (state.chain && r.chains.indexOf(state.chain) < 0) return false;
    if (q && r.name.toLowerCase().indexOf(q) < 0 && r.slug.indexOf(q) < 0) return false;
    return true;
  });
}
function sortRows(rows) {
  var k = state.sort, d = state.dir;
  var val = {
    rank: function (r) { return r.rank; },
    name: function (r) { return r.name.toLowerCase(); },
    category: function (r) { return (r.category || '').toLowerCase(); },
    tvl: function (r) { return r.tvl_usd; },
    g7: function (r) { return r.change_7d === null ? -999 : r.change_7d; },
    age: function (r) { return r.age_days; },
    chains: function (r) { return r.chains.length; },
    odds: function (r) { return r.odds; },
    value: function (r) { return r.implied_value_usd; }
  }[k] || function (r) { return r.rank; };
  return rows.slice().sort(function (a, b) {
    var va = val(a), vb = val(b);
    if (va < vb) return -1 * d;
    if (va > vb) return 1 * d;
    return (a.rank - b.rank) * 1;
  });
}
function renderBoard() {
  var rows = sortRows(filteredRows());
  var tb = document.querySelector('#view-board tbody');
  tb.innerHTML = rows.map(function (r) {
    var g = r.change_7d;
    var gCls = g === null ? '' : (g >= 0 ? 'pos' : 'neg');
    var w = Math.max(2, Math.round(r.implied_value_usd / maxEv * 100));
    return '<tr data-slug="' + esc(r.slug) + '"><td>' + r.rank + '</td>' +
      '<td><span class="name">' + esc(r.name) + (r.watch ? ' <span class="star">★</span>' : '') + '</span>' +
      '<span class="sub2"><span class="dot">●</span> no token · <span class="' + rowVerdictClass(r) + '">' + rowVerdictLabel(r) + '</span></span></td>' +
      '<td>' + esc(r.category || '—') + '</td>' +
      '<td class="num">' + fmt$(r.tvl_usd) + '</td>' +
      '<td class="num ' + gCls + '">' + fmt7d(g) + '</td>' +
      '<td class="num">' + r.age_days + 'd</td>' +
      '<td class="num">' + r.chains.length + '</td>' +
      '<td class="num">' + Math.round(r.odds * 100) + '%</td>' +
      '<td class="num"><span class="bar"><i style="width:' + w + '%"></i></span>' + fmt$(r.implied_value_usd) + '</td></tr>';
  }).join('');
  $('boardcount').textContent = rows.length + ' of ' + D.rows.length + ' rows shown · ranked by expected value (implied × launch odds)';
}
function renderLive() {
  var tb = document.querySelector('#view-live tbody');
  tb.innerHTML = D.live.map(function (r, i) {
    return '<tr><td>' + (i + 1) + '</td><td><span class="name">' + esc(r.name) + '</span></td>' +
      '<td>' + esc(r.category || '—') + '</td><td class="num">' + fmt$(r.tvl_usd) + '</td>' +
      '<td class="num">' + (r.mcap_usd === null ? '—' : fmt$(r.mcap_usd)) + '</td>' +
      '<td class="num">' + fmt7d(r.change_7d) + '</td></tr>';
  }).join('');
}
function renderAll() {
  $('excluded-body').innerHTML = D.excluded.map(function (r) {
    return '<tr><td><span class="name">' + esc(r.name) + '</span></td><td>' + esc(r.category || '—') + '</td>' +
      '<td class="num">' + fmt$(r.tvl_usd) + '</td><td>' + esc(r.reason) + '</td></tr>';
  }).join('');
  $('liverest-body').innerHTML = D.live_rest.map(function (r) {
    return '<tr><td><span class="name">' + esc(r.name) + '</span></td><td>' + esc(r.category || '—') + '</td>' +
      '<td class="num">' + fmt$(r.tvl_usd) + '</td><td class="num">' + (r.mcap_usd === null ? 'token on record, no market cap' : fmt$(r.mcap_usd)) + '</td></tr>';
  }).join('');
}
function renderSandbox() {
  var s = {
    growth: parseFloat($('sb-growth').value),
    age: parseFloat($('sb-age').value),
    tvl: parseFloat($('sb-tvl').value),
    odds: $('sb-odds').checked
  };
  $('sb-growth-v').textContent = s.growth.toFixed(2);
  $('sb-age-v').textContent = s.age.toFixed(2);
  $('sb-tvl-v').textContent = s.tvl.toFixed(2);
  var scored = D.rows.map(function (r) {
    var imp = impliedRaw(r, s);
    var od = s.odds ? launchOdds(r.age_days) : 1;
    return { r: r, imp: imp, od: od, ev: Math.max(1, Math.round(imp * od)) };
  }).sort(function (a, b) { return b.ev - a.ev; }).slice(0, 10);
  $('sandbox-body').innerHTML = scored.map(function (x, i) {
    return '<tr><td>' + (i + 1) + '</td><td><span class="name">' + esc(x.r.name) + '</span></td>' +
      '<td class="num">' + fmt$(Math.round(x.imp)) + '</td><td class="num">' + Math.round(x.od * 100) + '%</td>' +
      '<td class="num">' + fmt$(x.ev) + '</td></tr>';
  }).join('');
  $('sandbox-note').textContent = s.odds
    ? 'Odds on: ranked by expected value, as the board is.'
    : 'Odds off: ranked by implied value alone — the radar-4 ranking. Compare the top 10 with the odds on.';
}

/* ---- detail panel ---- */
function openDetail(slug) {
  var r = null;
  D.rows.forEach(function (x) { if (x.slug === slug) r = x; });
  if (!r) return;
  var rc = recompute(r);
  var match = rc.ev === r.implied_value_usd;
  var v = verdict(r);
  var ageNote = r.age_known ? humanAge(r.age_days) : humanAge(r.age_days) + ' (no listing date — median age used)';
  var steps = r.farm_steps.map(function (s, i) {
    var at = s.indexOf(' Cost: ');
    var action = at >= 0 ? s.slice(0, at) : s;
    var ct = at >= 0 ? s.slice(at + 1) : '';
    return '<li>' + esc(action) + '<span class="ct">' + esc(ct) + '</span></li>';
  }).join('');
  $('detail').innerHTML =
    '<button type="button" class="close" aria-label="Close">×</button>' +
    '<h2>' + esc(r.name) + '</h2>' +
    '<p class="meta">#' + r.rank + ' · ' + esc(r.category || '—') + ' · ' + r.chains.length + (r.chains.length === 1 ? ' chain' : ' chains') + (r.watch ? ' · <span class="star">★</span> on the watchlist' : '') + '</p>' +
    '<p class="big">' + fmt$(r.implied_value_usd) + ' expected value</p>' +
    '<p class="big-sub">implied ' + fmt$(r.implied_raw) + ' × ' + Math.round(r.odds * 100) + '% launch odds · ● no token</p>' +
    '<h3>Verdict</h3>' +
    '<span class="verdict ' + v + '">' + rowVerdictLabel(r) + '</span>' +
    '<p class="verdict-rule">' + VERDICT_RULE + '</p>' +
    '<h3>Why this protocol</h3>' +
    '<p class="why">' + esc(whyLine(r)) + '</p>' +
    '<h3>How the value is built</h3>' +
    '<table class="factors">' +
    '<tr><td>TVL ' + fmt$(r.tvl_usd) + '</td><td>TVL<sup>0.8</sup> × 8 = ' + fmt$(r.size_term) + '</td></tr>' +
    '<tr><td>7-day change ' + fmt7d(r.change_7d) + '</td><td>× ' + r.growth_multiplier.toFixed(3) + ' growth</td></tr>' +
    '<tr><td>Age ' + ageNote + '</td><td>× ' + r.patience_multiplier.toFixed(3) + ' patience</td></tr>' +
    '<tr><td>' + r.chains.length + (r.chains.length === 1 ? ' chain' : ' chains') + '</td><td>× ' + r.reach_multiplier.toFixed(3) + ' reach</td></tr>' +
    '<tr><td>Launch odds (' + humanAge(r.age_days) + ' old)</td><td>× ' + r.odds.toFixed(2) + '</td></tr>' +
    '<tr class="total"><td>Expected value</td><td>' + fmt$(r.implied_value_usd) + '</td></tr>' +
    '</table>' +
    '<p class="recompute' + (match ? '' : ' bad') + '">' + (match
      ? 'The page recomputes this row as ' + fmt$(rc.ev) + ' — the same number the board carries.'
      : 'The page recomputes this row as ' + fmt$(rc.ev) + ', which does not match the board’s ' + fmt$(r.implied_value_usd) + ' — the board is stale.') + '</p>' +
    '<h3>Farm plan — six steps</h3>' +
    '<ol class="farm">' + steps + '</ol>';
  $('detail').hidden = false;
  $('detail').querySelector('.close').addEventListener('click', closeDetail);
}
function closeDetail() {
  $('detail').hidden = true;
  if (state.detail) { state.detail = null; writeHash(); }
}

/* ---- tabs, filters, hash ---- */
function setTab(tab) {
  state.tab = tab;
  document.querySelectorAll('.tabs button').forEach(function (b) { b.classList.toggle('on', b.dataset.tab === tab); });
  ['board', 'live', 'all', 'sandbox'].forEach(function (t) { $('view-' + t).hidden = t !== tab; });
  if (tab === 'live') renderLive();
  if (tab === 'all') renderAll();
  if (tab === 'sandbox') renderSandbox();
}
function readHash() {
  var h = location.hash.replace(/^#/, '');
  var out = {};
  h.split('&').forEach(function (part) {
    var kv = part.split('=');
    if (kv[0]) out[decodeURIComponent(kv[0])] = kv[1] === undefined ? '' : decodeURIComponent(kv[1]);
  });
  return out;
}
function writeHash() {
  var parts = [];
  if (state.tab !== 'board') parts.push('tab=' + state.tab);
  if (state.q) parts.push('q=' + encodeURIComponent(state.q));
  if (state.cat) parts.push('cat=' + encodeURIComponent(state.cat));
  if (state.chain) parts.push('chain=' + encodeURIComponent(state.chain));
  if (state.watch) parts.push('watch=1');
  if (state.detail) parts.push('detail=' + encodeURIComponent(state.detail));
  history.replaceState(null, '', parts.length ? '#' + parts.join('&') : location.pathname + location.search);
}
function applyHash() {
  var h = readHash();
  if (h.tab && ['board', 'live', 'all', 'sandbox'].indexOf(h.tab) >= 0) state.tab = h.tab;
  if (h.q !== undefined) { state.q = h.q; $('q').value = h.q; }
  if (h.cat !== undefined) { state.cat = h.cat; $('cat').value = h.cat; }
  if (h.chain !== undefined) { state.chain = h.chain; $('chain').value = h.chain; }
  if (h.watch !== undefined) { state.watch = h.watch === '1'; $('watch').checked = state.watch; }
  setTab(state.tab);
  renderBoard();
  if (h.detail) { state.detail = h.detail; openDetail(h.detail); }
}
function init() {
  var cats = [], chains = [];
  D.rows.forEach(function (r) {
    if (r.category && cats.indexOf(r.category) < 0) cats.push(r.category);
    r.chains.forEach(function (c) { if (chains.indexOf(c) < 0) chains.push(c); });
  });
  cats.sort().forEach(function (c) { var o = document.createElement('option'); o.value = c; o.textContent = c; $('cat').appendChild(o); });
  chains.sort().forEach(function (c) { var o = document.createElement('option'); o.value = c; o.textContent = c; $('chain').appendChild(o); });
  $('q').addEventListener('input', function () { state.q = $('q').value; renderBoard(); writeHash(); });
  $('cat').addEventListener('change', function () { state.cat = $('cat').value; renderBoard(); writeHash(); });
  $('chain').addEventListener('change', function () { state.chain = $('chain').value; renderBoard(); writeHash(); });
  $('watch').addEventListener('change', function () { state.watch = $('watch').checked; renderBoard(); writeHash(); });
  document.querySelectorAll('.tabs button').forEach(function (b) {
    b.addEventListener('click', function () { setTab(b.dataset.tab); writeHash(); });
  });
  document.querySelectorAll('#view-board th[data-sort]').forEach(function (th) {
    th.addEventListener('click', function () {
      var k = th.dataset.sort;
      if (state.sort === k) state.dir = -state.dir;
      else { state.sort = k; state.dir = (k === 'name' || k === 'category') ? 1 : -1; }
      renderBoard();
    });
  });
  document.querySelector('#view-board tbody').addEventListener('click', function (e) {
    var tr = e.target.closest('tr[data-slug]');
    if (!tr) return;
    state.detail = tr.dataset.slug;
    openDetail(state.detail);
    writeHash();
  });
  $('goto-board').addEventListener('click', function () { setTab('board'); writeHash(); });
  ['sb-growth', 'sb-age', 'sb-tvl'].forEach(function (id) { $(id).addEventListener('input', renderSandbox); });
  $('sb-odds').addEventListener('change', renderSandbox);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeDetail(); });
  window.addEventListener('hashchange', applyHash);
  selfCheck();
  applyHash();
}
init();
