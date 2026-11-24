// Token Launch Radar — radar-4 dashboard.
//
// The model lives here, in plain arithmetic, so the page and the board agree. Every row is
// scored by the same function, from the snapshot's own figures only:
//
//   implied = TVL^0.8 x 8 x (1 + 0.9 x clamp(7d%, -50..+150))
//                   x (0.6 + 0.7 x min(age, 1460) / 1460)
//                   x (1 + 0.015 x min(chains, 10))
//
// Size (TVL), momentum (the last seven days) and patience (days run with no token). A protocol
// with no listing date takes the median age of the pre-token set; a missing seven-day change
// counts as zero. No protocol name is special-cased anywhere in this file.

const RADAR = window.RADAR;
const MODEL = RADAR.model;
const MEDIAN_AGE = RADAR.median_age_days;
const ROWS = RADAR.rows;
const LIVE = RADAR.live;

// ---------------------------------------------------------------- the model

function clamp(x, lo, hi) { return Math.min(hi, Math.max(lo, x)); }

/** A row's age in days: its own listing date, or the pre-token set's median when it has none. */
function ageOf(row) { return row.age_days === null || row.age_days === undefined ? MEDIAN_AGE : row.age_days; }

/**
 * The implied value of one row under a model, with every factor shown. The board, the detail
 * panel and the sandbox all call this one function, so the page can never disagree with itself.
 */
function impliedValue(row, m) {
  const age = ageOf(row);
  const growthPct = clamp(row.change_7d === null ? 0 : row.change_7d, m.growth_floor, m.growth_cap);
  const growthMult = 1 + (growthPct / 100) * m.growth_weight;
  const ageMult = m.age_floor + (Math.min(Math.max(age, 0), m.age_days) / m.age_days) * m.age_range;
  const chainMult = 1 + m.chain_step * Math.min(row.chains.length, m.chain_cap);
  const base = Math.pow(row.tvl_usd, m.tvl_exponent) * m.scale;
  const implied = Math.max(1, Math.round(base * growthMult * ageMult * chainMult));
  return { implied, base: Math.round(base), growthPct, growthMult, ageMult, chainMult, age };
}

// ---------------------------------------------------------------- farm plans

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(row) {
  if (row.tvl_usd >= 1000000000) return 250;
  if (row.tvl_usd >= 100000000) return 100;
  return 50;
}

/** The gas budget for the main position, from its capital tier. */
function gasFor(capital) {
  if (capital >= 250) return 5;
  if (capital >= 100) return 3;
  return 1;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age) {
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(row) { return row.chains.length > 0 ? row.chains[0] : 'its main chain'; }

/** The category's one action, in the words a farmer can follow. */
function actionFor(row, capital, chain) {
  const c = (row.category || '').toLowerCase();
  const name = row.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Lend $${capital} of USDC into ${name} on ${chain} and leave the position open.`;
  if (c.includes('dex')) return `Add $${capital} of liquidity to ${name}'s main pool on ${chain} and leave it in place.`;
  if (c.includes('yield') || c.includes('leveraged') || c.includes('farm')) return `Deposit $${capital} into ${name}'s main yield position on ${chain} and leave it earning.`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('liquidity manager')) return `Deposit $${capital} into a ${name} vault on ${chain} and hold the shares.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of ${name}'s yield asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('basis')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds inside its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`;
  if (c.includes('btc')) return `Deposit $${capital} of the BTC-backed asset into ${name} on ${chain} and hold it.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and leave the position open.`;
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time, from the
 * protocol's own record (category, chains, TVL, age). The same templates build the board's
 * farm steps, so the detail panel shows exactly what the board carries.
 */
function farmSteps(row) {
  const chain = chainOf(row);
  const capital = capitalFor(row);
  const hold = holdDaysFor(ageOf(row));
  const action = actionFor(row, capital, chain);
  return [
    { text: `Set up a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`, cost: `$3 of gas at most for the first transaction`, time: `5 minutes` },
    { text: action, cost: `$${capital} of capital and about $${gasFor(capital)} of gas`, time: `15 minutes to set up` },
    { text: `Do one qualifying action every week \u2014 a deposit, a borrow, a swap or a vote \u2014 so the wallet stays active.`, cost: `about $2 of gas a week`, time: `10 minutes a week` },
    { text: `Hold the position for at least ${hold} days so the activity spans more than one snapshot.`, cost: `the $${capital} stays in the position`, time: `${hold} days` },
    { text: `Before withdrawing, open ${row.name}'s own points or rewards page and claim only through the link it publishes.`, cost: `$0 to check, and never pay to claim`, time: `10 minutes` },
    { text: `Record the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it cleanly.`, cost: `$0 in fees, only the log to keep`, time: `5 minutes` },
  ];
}

/** A step as one string: its action, then its cost and time. */
function stepText(step) { return `${step.text} Cost: ${step.cost} \u00b7 Time: ${step.time}.`; }

// ---------------------------------------------------------------- formatting

function fmtMoney(v) {
  if (v >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
  if (v >= 1e6) return '$' + Math.round(v / 1e6) + 'M';
  if (v >= 1e3) return '$' + Math.round(v / 1e3) + 'K';
  return '$' + Math.round(v);
}
function fmtPct(v) { return v === null || v === undefined ? '\u2014' : (v > 0 ? '+' : '') + v.toFixed(1) + '%'; }
function fmtAge(row) { const a = row.age_days; return a === null || a === undefined ? '\u2014' : a + 'd'; }
function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

// ---------------------------------------------------------------- board

const tbody = document.getElementById('rows');
const state = { q: '', cat: '', chain: '', watch: false, sort: 'rank', dir: 1, view: 'board' };

function sortValue(row, key) {
  if (key === 'chains') return row.chains.length;
  if (key === 'age_days') return ageOf(row);
  return row[key];
}

function filteredRows() {
  const q = state.q.trim().toLowerCase();
  let list = ROWS.filter((r) => {
    if (state.watch && !r.watch) return false;
    if (state.cat && r.category !== state.cat) return false;
    if (state.chain && !r.chains.includes(state.chain)) return false;
    if (q && !(r.name.toLowerCase().includes(q) || r.slug.toLowerCase().includes(q))) return false;
    return true;
  });
  const key = state.sort;
  list = [...list].sort((a, b) => {
    const av = sortValue(a, key), bv = sortValue(b, key);
    if (typeof av === 'string') return av.localeCompare(bv) * state.dir;
    return (av - bv) * state.dir;
  });
  return list;
}

function renderBoard() {
  const list = filteredRows();
  const max = list.length ? Math.max(...list.map((r) => r.implied_value_usd)) : 1;
  tbody.innerHTML = list.map((r) => {
    const pct = r.change_7d === null ? null : r.change_7d;
    const cls = pct === null ? '' : pct >= 0 ? 'up' : 'down';
    const w = Math.max(2, Math.round((r.implied_value_usd / max) * 100));
    return `<tr data-slug="${esc(r.slug)}"><td>${r.rank}</td>` +
      `<td>${esc(r.name)}${r.watch ? ' <span class="star" title="On the watchlist">\u2605</span>' : ''}</td>` +
      `<td>${esc(r.category || '\u2014')}</td>` +
      `<td class="num">${fmtMoney(r.tvl_usd)}</td>` +
      `<td class="num ${cls}">${fmtPct(pct)}</td>` +
      `<td class="num">${fmtAge(r)}</td>` +
      `<td class="num">${r.chains.length}</td>` +
      `<td class="num"><span class="bar-wrap"><span class="bar" style="width:${w}%"></span></span>${fmtMoney(r.implied_value_usd)}</td></tr>`;
  }).join('');
  document.getElementById('count').textContent = `${list.length} of ${ROWS.length} rows shown \u00b7 \u2605 on the watchlist`;
  document.querySelectorAll('.board thead th[data-sort]').forEach((th) => {
    th.classList.toggle('sorted', th.dataset.sort === state.sort);
  });
}

tbody.addEventListener('click', (e) => {
  const tr = e.target.closest('tr[data-slug]');
  if (tr) openDetail(tr.dataset.slug);
});

document.querySelectorAll('.board thead th[data-sort]').forEach((th) => {
  th.addEventListener('click', () => {
    const key = th.dataset.sort;
    if (state.sort === key) state.dir = -state.dir;
    else { state.sort = key; state.dir = key === 'name' || key === 'category' ? 1 : -1; }
    renderBoard();
  });
});

// ---------------------------------------------------------------- filters + tabs + hash state

const qEl = document.getElementById('q');
const catEl = document.getElementById('cat');
const chainEl = document.getElementById('chain');
const watchEl = document.getElementById('watch');

[...new Set(ROWS.map((r) => r.category).filter(Boolean))].sort().forEach((c) => {
  catEl.insertAdjacentHTML('beforeend', `<option>${esc(c)}</option>`);
});
[...new Set(ROWS.flatMap((r) => r.chains))].sort().forEach((c) => {
  chainEl.insertAdjacentHTML('beforeend', `<option>${esc(c)}</option>`);
});

function syncHash() {
  const h = new URLSearchParams();
  if (state.q) h.set('q', state.q);
  if (state.cat) h.set('cat', state.cat);
  if (state.chain) h.set('chain', state.chain);
  if (state.watch) h.set('watch', '1');
  if (state.view !== 'board') h.set('view', state.view);
  const d = document.getElementById('detail');
  if (!d.hidden) h.set('detail', d.dataset.slug || '');
  history.replaceState(null, '', '#' + h.toString());
}

function applyHash() {
  const h = new URLSearchParams(location.hash.slice(1));
  state.q = h.get('q') || '';
  state.cat = h.get('cat') || '';
  state.chain = h.get('chain') || '';
  state.watch = h.get('watch') === '1';
  state.view = h.get('view') || 'board';
  qEl.value = state.q; catEl.value = state.cat; chainEl.value = state.chain; watchEl.checked = state.watch;
  showView(state.view);
  renderBoard();
  const slug = h.get('detail');
  if (slug && ROWS.some((r) => r.slug === slug)) openDetail(slug, true);
}

qEl.addEventListener('input', () => { state.q = qEl.value; renderBoard(); syncHash(); });
catEl.addEventListener('change', () => { state.cat = catEl.value; renderBoard(); syncHash(); });
chainEl.addEventListener('change', () => { state.chain = chainEl.value; renderBoard(); syncHash(); });
watchEl.addEventListener('change', () => { state.watch = watchEl.checked; renderBoard(); syncHash(); });

function showView(view) {
  state.view = view;
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.view === view));
  document.getElementById('view-board').hidden = view !== 'board';
  document.getElementById('view-live').hidden = view !== 'live';
  document.getElementById('view-sandbox').hidden = view !== 'sandbox';
  if (view === 'sandbox') renderSandbox();
}
document.querySelectorAll('.tabs button').forEach((b) => {
  b.addEventListener('click', () => { showView(b.dataset.view); syncHash(); });
});

// ---------------------------------------------------------------- live tokens

document.getElementById('live-rows').innerHTML = LIVE.map((p) => {
  const pct = p.change_7d === null ? null : p.change_7d;
  const cls = pct === null ? '' : pct >= 0 ? 'up' : 'down';
  return `<tr><td>${esc(p.name)}</td><td>${esc(p.category || '\u2014')}</td>` +
    `<td class="num">${fmtMoney(p.tvl_usd)}</td><td class="num">${p.mcap_usd ? fmtMoney(p.mcap_usd) : '\u2014'}</td>` +
    `<td class="num ${cls}">${fmtPct(pct)}</td></tr>`;
}).join('');

// ---------------------------------------------------------------- detail slide-over

const panel = document.getElementById('detail');
const panelBody = document.getElementById('detail-body');

function openDetail(slug, quiet) {
  const row = ROWS.find((r) => r.slug === slug);
  if (!row) return;
  const f = impliedValue(row, MODEL);
  const steps = farmSteps(row);
  panelBody.innerHTML =
    `<h2>${esc(row.name)}</h2>` +
    `<p class="rank-line">#${row.rank} &middot; ${esc(row.category || 'no category')} &middot; ${row.chains.length} chain${row.chains.length === 1 ? '' : 's'}${row.watch ? ' &middot; <span class="star">\u2605 on the watchlist</span>' : ''}</p>` +
    `<p class="implied-big">${fmtMoney(row.implied_value_usd)} implied</p>` +
    `<h3>How the value is built</h3>` +
    `<table class="factors"><tbody>` +
    `<tr><td>TVL ${fmtMoney(row.tvl_usd)}</td><td>TVL<sup>0.8</sup> &times; 8 = ${fmtMoney(f.base)}</td></tr>` +
    `<tr><td>7-day change ${fmtPct(row.change_7d)}</td><td>&times; ${f.growthMult.toFixed(3)} growth</td></tr>` +
    `<tr><td>Age ${f.age} days</td><td>&times; ${f.ageMult.toFixed(3)} patience</td></tr>` +
    `<tr><td>${row.chains.length} chain${row.chains.length === 1 ? '' : 's'} (${esc(row.chains.slice(0, 3).join(', '))}${row.chains.length > 3 ? ', \u2026' : ''})</td><td>&times; ${f.chainMult.toFixed(3)} reach</td></tr>` +
    `<tr class="total"><td>Implied value</td><td>${fmtMoney(row.implied_value_usd)}</td></tr>` +
    `</tbody></table>` +
    `<p class="nonames">implied = TVL<sup>0.8</sup> &times; 8 &times; (1 + 0.9 &times; growth) &times; (0.6 + 0.7 &times; age) &times; (1 + 0.015 &times; chains)</p>` +
    `<h3>Farm plan &mdash; six steps</h3>` +
    `<ol class="farm">` + steps.map((s) => `<li>${esc(s.text)}<span class="cost">Cost: ${esc(s.cost)} \u00b7 Time: ${esc(s.time)}.</span></li>`).join('') + `</ol>`;
  panel.dataset.slug = slug;
  panel.hidden = false;
  if (!quiet) syncHash();
}

document.getElementById('detail-close').addEventListener('click', () => {
  panel.hidden = true;
  delete panel.dataset.slug;
  syncHash();
});

// ---------------------------------------------------------------- model sandbox

function renderSandbox() {
  const gw = parseFloat(document.getElementById('gw').value);
  const a1 = parseFloat(document.getElementById('a1').value);
  const exp = parseFloat(document.getElementById('exp').value);
  document.getElementById('gw-val').textContent = gw.toFixed(2);
  document.getElementById('a1-val').textContent = a1.toFixed(2);
  document.getElementById('exp-val').textContent = exp.toFixed(2);
  const m = { ...MODEL, growth_weight: gw, age_range: a1, tvl_exponent: exp };
  const ranked = ROWS.map((r) => ({ row: r, v: impliedValue(r, m).implied }))
    .sort((a, b) => b.v - a.v || a.row.rank - b.row.rank)
    .slice(0, 10);
  document.getElementById('sandbox-rows').innerHTML = ranked.map((x, i) =>
    `<tr><td>${i + 1}</td><td>${esc(x.row.name)}</td><td class="num">${fmtMoney(x.v)}</td><td class="num">was #${x.row.rank}</td></tr>`
  ).join('');
}
['gw', 'a1', 'exp'].forEach((id) => document.getElementById(id).addEventListener('input', renderSandbox));

// ---------------------------------------------------------------- stats + start

document.getElementById('stat-watch').textContent = `${RADAR.watchlist_size}/${RADAR.watchlist_size}`;
document.getElementById('stat-rows').textContent = String(RADAR.board_size);
document.getElementById('stat-date').textContent = RADAR.as_of;
document.getElementById('stat-model').textContent = RADAR.model_version;

renderBoard();
applyHash();
