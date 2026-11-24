// app.js — the token-radar dashboard. Static page, no framework, no network.
// Reads window.RADAR (written by main.ts from the same board), renders the
// sortable/filterable board, a detail view per protocol with the model's full
// breakdown and its farm plan, a live-token reference, and a model sandbox
// that re-ranks the board live from the snapshot figures.

const R = window.RADAR;
const rows = R.rows;
const bySlug = new Map(rows.map((r) => [r.s, r]));

/** Money: $2.75B, $287M, $44M. */
function fmtMoney(v) {
  if (v >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
  if (v >= 1e6) return '$' + Math.round(v / 1e6) + 'M';
  return '$' + Math.round(v / 1e3) + 'K';
}
function fmtAge(days) {
  if (days >= 365) return (days / 365).toFixed(1) + 'y';
  return days + 'd';
}
function fmtChange(g) {
  if (g === null || g === undefined) return '—';
  return (g > 0 ? '+' : '') + g.toFixed(1) + '%';
}
function el(tag, text, cls) {
  const n = document.createElement(tag);
  if (text !== undefined && text !== null) n.textContent = text;
  if (cls) n.className = cls;
  return n;
}
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

// ------------------------------------------------------------- farm plans
// The same templates the model uses for board.json, so the detail view
// shows the exact plan the board carries for each protocol.

const CATEGORY_ACTIONS = {
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
const CHAIN_GAS_USD = {
  Ethereum: 15, Solana: 1, Base: 1, Arbitrum: 2, BSC: 1, Polygon: 1, Avalanche: 2,
  Optimism: 1, Linea: 1, Blast: 1, Scroll: 1, Mantle: 1, Berachain: 1, Sui: 1,
  Aptos: 1, Tron: 2, Fantom: 1, Gnosis: 1,
};
function capitalFor(tvl) {
  if (tvl < 100_000_000) return 50;
  if (tvl < 1_000_000_000) return 100;
  return 250;
}
function holdDaysFor(age) {
  if (age < 180) return 30;
  if (age < 730) return 45;
  return 60;
}
function farmSteps(row) {
  const chains = row.ch ? row.ch.split(',') : [];
  const mainChain = chains.length > 0 ? chains[0] : 'its main chain';
  const action = row.c !== null ? (CATEGORY_ACTIONS[row.c] || DEFAULT_ACTION) : DEFAULT_ACTION;
  const capital = capitalFor(row.t);
  const gas = CHAIN_GAS_USD[mainChain] || 3;
  const hold = holdDaysFor(row.a);
  const venue = row.c === null ? 'venue' : row.c + ' venue';
  return [
    'Use ' + row.n + ' on ' + mainChain + ' as a ' + venue + ': ' + action + '. Start with the smallest position the venue accepts and confirm the transaction settles before adding more.',
    'Fund the position with $' + capital + '. That size matches the protocol\'s TVL tier (under $100M gets $50, $100M to $1B gets $100, over $1B gets $250). Keep the rest of your farming budget in stables until the first week settles.',
    'Do the work on ' + mainChain + ' first — it is the protocol\'s main chain. Budget about $' + gas + ' for gas across the week\'s transactions; if gas spikes, wait for a quiet hour instead of paying a premium.',
    'Check the position once a week: confirm the TVL is still growing, the 7-day change has not collapsed, and no token has been announced. Rebalance only if one leg of the plan stops working.',
    'Hold the position for ' + hold + ' days — the hold scales with how long the protocol has been listed (under 6 months gets 30 days, 6 to 24 months gets 45, over 24 months gets 60). Do not chase a token announcement; the farm is the position and any token is a bonus.',
    'Claim anything only from the protocol\'s official site and its official social accounts — never from a link in a direct message or a reply. Keep a farm log: the date, the chain, the amount in, the amount out, and the transaction hash of every step.',
  ];
}

// ------------------------------------------------------------------ state

const state = { q: '', cat: '', chain: '', watch: false, sortKey: 'rank', sortDir: 1, tab: 'board', detail: null };
const sandbox = { exp: 0.8, scale: 8, growth: 0.6, ageSpan: 0.5, chainW: 0.015, active: false };

const tbody = document.querySelector('table.board tbody');
const countEl = document.getElementById('count');
const detailEl = document.getElementById('detail');

function sandboxValue(row) {
  const nChains = row.ch ? row.ch.split(',').length : 0;
  const g = clamp((row.g === null ? 0 : row.g) / 100, -0.5, 1.5);
  return Math.pow(row.t, sandbox.exp) * sandbox.scale
    * (1 + g * sandbox.growth)
    * (0.7 + Math.min(row.a, 1460) / 1460 * sandbox.ageSpan)
    * (1 + sandbox.chainW * Math.min(nChains, 10));
}
function displayValue(row) {
  return sandbox.active ? sandboxValue(row) : row.v;
}

function filteredRows() {
  const q = state.q.trim().toLowerCase();
  let list = rows.filter((r) => {
    if (state.watch && !r.w) return false;
    if (state.cat && r.c !== state.cat) return false;
    if (state.chain) {
      const chains = r.ch ? r.ch.split(',') : [];
      if (!chains.includes(state.chain)) return false;
    }
    if (q && r.n.toLowerCase().indexOf(q) < 0 && r.s.toLowerCase().indexOf(q) < 0) return false;
    return true;
  });
  const key = state.sortKey;
  const dir = state.sortDir;
  const val = (r) => {
    if (key === 'rank') return displayValue(r);
    if (key === 'name') return r.n;
    if (key === 'category') return r.c || '';
    if (key === 'tvl') return r.t;
    if (key === 'change') return r.g === null ? 0 : r.g;
    if (key === 'age') return r.a;
    if (key === 'chains') return r.ch ? r.ch.split(',').length : 0;
    if (key === 'value') return displayValue(r);
    return r.r;
  };
  list = list.slice().sort((a, b) => {
    const va = val(a), vb = val(b);
    if (typeof va === 'string') return va.localeCompare(vb) * dir;
    return (va - vb) * dir;
  });
  // Rank and value always sort highest first, whatever the toggle says.
  if (key === 'rank' || key === 'value') list.sort((a, b) => displayValue(b) - displayValue(a));
  return list;
}

function renderBoard() {
  const list = filteredRows();
  tbody.textContent = '';
  const frag = document.createDocumentFragment();
  list.forEach((r, i) => {
    const tr = document.createElement('tr');
    if (state.detail === r.s) tr.className = 'selected';
    tr.addEventListener('click', () => openDetail(r.s));
    const cells = [
      [String(sandbox.active ? i + 1 : r.r), 'num'],
      [r.n, ''],
      [r.c || '—', ''],
      [fmtMoney(r.t), 'num'],
      [fmtChange(r.g), 'num ' + (r.g === null ? '' : r.g >= 0 ? 'up' : 'down')],
      [fmtAge(r.a), 'num'],
      [String(r.ch ? r.ch.split(',').length : 0) + (r.ch ? ' · ' + r.ch.split(',')[0] : ''), 'num'],
      [fmtMoney(displayValue(r)), 'num'],
      [r.w ? '★' : '', 'watch-star'],
    ];
    for (const [text, cls] of cells) {
      const td = document.createElement('td');
      td.textContent = text;
      if (cls) td.className = cls;
      tr.appendChild(td);
    }
    frag.appendChild(tr);
  });
  tbody.appendChild(frag);
  countEl.textContent = list.length + ' of ' + rows.length + ' protocols shown'
    + (sandbox.active ? ' — sandbox model active (re-ranked live)' : '')
    + ' · snapshot ' + R.as_of;
}

function renderDetail() {
  const r = state.detail ? bySlug.get(state.detail) : null;
  if (!r) { detailEl.hidden = true; detailEl.textContent = ''; return; }
  detailEl.hidden = false;
  detailEl.textContent = '';
  detailEl.appendChild(el('h2', '#' + r.r + ' — ' + r.n));
  detailEl.appendChild(el('p', (r.c || 'Uncategorized') + ' · records no token' + (r.w ? ' · on the watchlist' : ''), 'meta'));
  detailEl.appendChild(el('h3', 'Implied value: ' + fmtMoney(displayValue(r))));
  const dl = document.createElement('dl');
  const pairs = [
    ['TVL', fmtMoney(r.t)],
    ['7-day change', fmtChange(r.g) + '  →  growth factor ' + r.f[0].toFixed(3)],
    ['Age listed', fmtAge(r.a) + '  →  age factor ' + r.f[1].toFixed(3)],
    ['Chains', (r.ch ? r.ch.split(',').length : 0) + ' (' + (r.ch || '—') + ')  →  chain factor ' + r.f[2].toFixed(3)],
    ['Model', R.model],
  ];
  for (const [k, v] of pairs) {
    dl.appendChild(el('dt', k));
    dl.appendChild(el('dd', v));
  }
  detailEl.appendChild(dl);
  detailEl.appendChild(el('h3', 'Farm plan — six steps'));
  const ol = document.createElement('ol');
  for (const step of farmSteps(r)) ol.appendChild(el('li', step));
  detailEl.appendChild(ol);
}

function openDetail(slug) {
  state.detail = slug;
  renderBoard();
  renderDetail();
  writeHash();
  detailEl.scrollIntoView({ block: 'nearest' });
}

function renderLive() {
  const liveBody = document.querySelector('#live-table tbody');
  liveBody.textContent = '';
  R.live.forEach((p, i) => {
    const tr = document.createElement('tr');
    const ratio = p.t > 0 ? (p.m / p.t).toFixed(2) + 'x' : '—';
    for (const [text, cls] of [
      [String(i + 1), 'num'], [p.n, ''], [p.c || '—', ''],
      [fmtMoney(p.t), 'num'], [fmtMoney(p.m), 'num'], [ratio, 'num'],
    ]) {
      const td = document.createElement('td');
      td.textContent = text;
      if (cls) td.className = cls;
      tr.appendChild(td);
    }
    liveBody.appendChild(tr);
  });
}

function renderSandboxNote() {
  const top = rows.slice().sort((a, b) => sandboxValue(b) - sandboxValue(a))[0];
  document.getElementById('sandbox-note').textContent =
    'Top pick under the current sliders: ' + top.n + ' at ' + fmtMoney(sandboxValue(top))
    + ' (published model: ' + rows[0].n + ' at ' + fmtMoney(rows[0].v) + ').';
}

// ------------------------------------------------------------------- tabs

function showTab(tab) {
  state.tab = tab;
  document.querySelectorAll('.tabs button').forEach((b) => {
    b.classList.toggle('active', b.dataset.tab === tab);
  });
  document.getElementById('tab-board').hidden = tab !== 'board';
  document.getElementById('tab-live').hidden = tab !== 'live';
  document.getElementById('tab-model').hidden = tab !== 'model';
  if (tab === 'live') renderLive();
  if (tab === 'model') renderSandboxNote();
  writeHash();
}
document.querySelectorAll('.tabs button').forEach((b) => {
  b.addEventListener('click', () => showTab(b.dataset.tab));
});

// ---------------------------------------------------------------- filters

const qInput = document.getElementById('q');
const catSelect = document.getElementById('cat');
const chainSelect = document.getElementById('chain');
const watchBox = document.getElementById('watch');

for (const c of [...new Set(rows.map((r) => r.c).filter(Boolean))].sort()) {
  catSelect.appendChild(el('option', c));
}
for (const c of [...new Set(rows.flatMap((r) => (r.ch ? r.ch.split(',') : [])))].sort()) {
  chainSelect.appendChild(el('option', c));
}
qInput.addEventListener('input', () => { state.q = qInput.value; renderBoard(); writeHash(); });
catSelect.addEventListener('change', () => { state.cat = catSelect.value; renderBoard(); writeHash(); });
chainSelect.addEventListener('change', () => { state.chain = chainSelect.value; renderBoard(); writeHash(); });
watchBox.addEventListener('change', () => { state.watch = watchBox.checked; renderBoard(); writeHash(); });

document.querySelectorAll('table.board th[data-sort]').forEach((th) => {
  th.addEventListener('click', () => {
    const key = th.dataset.sort;
    if (state.sortKey === key) state.sortDir = -state.sortDir;
    else { state.sortKey = key; state.sortDir = 1; }
    renderBoard();
  });
});

// -------------------------------------------------------------- sandbox

function bindSlider(id, valId, fmt, apply) {
  const input = document.getElementById(id);
  const val = document.getElementById(valId);
  input.addEventListener('input', () => {
    apply(parseFloat(input.value));
    val.textContent = fmt(parseFloat(input.value));
    sandbox.active = true;
    renderBoard();
    renderSandboxNote();
    if (state.detail) renderDetail();
  });
}
bindSlider('sb-exp', 'exp-val', (v) => v.toFixed(2), (v) => { sandbox.exp = v; });
bindSlider('sb-scale', 'scale-val', (v) => String(v), (v) => { sandbox.scale = v; });
bindSlider('sb-growth', 'growth-val', (v) => v.toFixed(2), (v) => { sandbox.growth = v; });
bindSlider('sb-age', 'age-val', (v) => v.toFixed(2), (v) => { sandbox.ageSpan = v; });
bindSlider('sb-chain', 'chain-val', (v) => v.toFixed(3), (v) => { sandbox.chainW = v; });
document.getElementById('sb-reset').addEventListener('click', () => {
  sandbox.exp = 0.8; sandbox.scale = 8; sandbox.growth = 0.6; sandbox.ageSpan = 0.5; sandbox.chainW = 0.015;
  sandbox.active = false;
  document.getElementById('sb-exp').value = '0.8';
  document.getElementById('sb-scale').value = '8';
  document.getElementById('sb-growth').value = '0.6';
  document.getElementById('sb-age').value = '0.5';
  document.getElementById('sb-chain').value = '0.015';
  document.getElementById('exp-val').textContent = '0.80';
  document.getElementById('scale-val').textContent = '8';
  document.getElementById('growth-val').textContent = '0.60';
  document.getElementById('age-val').textContent = '0.50';
  document.getElementById('chain-val').textContent = '0.015';
  renderBoard();
  renderSandboxNote();
  if (state.detail) renderDetail();
});

// ------------------------------------------------------------------- hash

function writeHash() {
  const parts = [];
  if (state.tab !== 'board') parts.push('view=' + state.tab);
  if (state.q) parts.push('q=' + encodeURIComponent(state.q));
  if (state.cat) parts.push('cat=' + encodeURIComponent(state.cat));
  if (state.chain) parts.push('chain=' + encodeURIComponent(state.chain));
  if (state.watch) parts.push('watch=1');
  if (state.detail) parts.push('detail=' + encodeURIComponent(state.detail));
  history.replaceState(null, '', parts.length ? '#' + parts.join('&') : location.pathname + location.search);
}
function readHash() {
  const hash = location.hash.replace(/^#/, '');
  if (!hash) return;
  for (const part of hash.split('&')) {
    const [k, v] = part.split('=');
    const val = v === undefined ? '' : decodeURIComponent(v);
    if (k === 'view' && (val === 'board' || val === 'live' || val === 'model' || val === 'detail' || val === 'filtered')) {
      state.tab = val === 'detail' || val === 'filtered' ? 'board' : val;
    }
    if (k === 'q') { state.q = val; qInput.value = val; }
    if (k === 'cat') { state.cat = val; catSelect.value = val; }
    if (k === 'chain') { state.chain = val; chainSelect.value = val; }
    if (k === 'watch') state.watch = val === '1';
    if (k === 'detail' && bySlug.has(val)) state.detail = val;
  }
  watchBox.checked = state.watch;
}

// ------------------------------------------------------------------- init

document.getElementById('model-line').textContent = R.model;
readHash();
showTab(state.tab);
renderBoard();
renderDetail();
