// Token Radar dashboard: renders the ranked board, the detail view and the
// filter from the data main.ts writes beside this page (data.js). The farm
// steps are regenerated here from each row's own figures — rank tier, main
// chain and category — so what the page shows is the board's plan.

(function () {
  var DATA = window.RADAR_DATA || { rows: [], watchlist: [] };
  var rows = DATA.rows || [];
  var watchSet = new Set(DATA.watchlist || []);

  var GAS_USD = {
    Ethereum: 5.0,
    Solana: 0.02,
    Polygon: 0.05,
    Mantle: 0.1,
    Base: 0.15,
    Avalanche: 0.3,
    Arbitrum: 0.3,
  };

  var CATEGORY_ACTION = {
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

  var GENERIC_ACTION =
    "Use ${NAME} with $${TIER}: open the position the protocol's own app guides you to, keep it open for at least 30 days, and do the protocol's core action once a week.";

  function tierUsd(rank) {
    return rank <= 20 ? 500 : rank <= 60 ? 250 : 100;
  }

  function farmSteps(row) {
    var tier = tierUsd(row.r);
    var chain = row.x || 'Ethereum';
    var gas = (GAS_USD[chain] !== undefined ? GAS_USD[chain] : 0.5).toFixed(2);
    var action = (CATEGORY_ACTION[row.c || ''] || GENERIC_ACTION)
      .split('${TIER}').join(String(tier))
      .split('${NAME}').join(row.n);
    return [
      'Set up a fresh wallet for ' + row.n + ' only, fund it with $' + tier + ' plus about $' + gas + ' of ' + chain + ' gas, and never reuse the wallet on another protocol (about 20 minutes).',
      action,
      "Repeat the protocol's core action once a week for four weeks, about 15 minutes each time, so the account shows a month of steady activity rather than one burst.",
      'Hold the position for 30 to 60 days without withdrawing: early exits usually reset the activity the protocol counts, and the hold costs nothing but time.',
      'Claim anything only from a link the protocol itself publishes on its own site or verified account, never from a link in a chat or email; a fake claim page drains the wallet.',
      'Keep a farm log with the dates, the amounts and the transaction hashes for ' + row.n + ', so you can prove the activity if the launch asks for it (5 minutes a week).',
    ];
  }

  function money(v) {
    if (v >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
    if (v >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M';
    if (v >= 1e3) return '$' + (v / 1e3).toFixed(1) + 'K';
    return '$' + v;
  }

  function moneyFull(v) {
    return '$' + v.toLocaleString('en-US');
  }

  function pct(v) {
    if (v === null || v === undefined) return '—';
    return (v > 0 ? '+' : '') + v.toFixed(2) + '%';
  }

  var state = { q: '', cat: '', watchOnly: false, sort: 'value', dir: -1 };

  var tbody = document.getElementById('rows');
  var countEl = document.getElementById('count');
  var detailEl = document.getElementById('detail');
  var selectedSlug = null;

  function visibleRows() {
    var q = state.q.trim().toLowerCase();
    var list = rows.filter(function (row) {
      if (state.cat && row.c !== state.cat) return false;
      if (state.watchOnly && !watchSet.has(row.s)) return false;
      if (q && row.n.toLowerCase().indexOf(q) < 0 && row.s.toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    var key = state.sort;
    var dir = state.dir;
    list.sort(function (a, b) {
      var av, bv;
      if (key === 'value') { av = a.v; bv = b.v; }
      else if (key === 'tvl') { av = a.t; bv = b.t; }
      else if (key === 'growth') { av = a.g === null ? -Infinity : a.g; bv = b.g === null ? -Infinity : b.g; }
      else if (key === 'age') { av = a.a; bv = b.a; }
      else if (key === 'multiple') { av = a.m; bv = b.m; }
      else if (key === 'name') { av = a.n.toLowerCase(); bv = b.n.toLowerCase(); }
      else if (key === 'category') { av = a.c || ''; bv = b.c || ''; }
      else if (key === 'chains') { av = a.k; bv = b.k; }
      else { av = a.r; bv = b.r; }
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return a.r - b.r;
    });
    return list;
  }

  function render() {
    var list = visibleRows();
    countEl.textContent = list.length + ' of ' + rows.length + ' protocols';
    var html = '';
    list.forEach(function (row) {
      var g = row.g === null ? '—' : pct(row.g);
      var gClass = row.g === null ? '' : row.g < 0 ? 'neg' : 'pos';
      var watch = watchSet.has(row.s) ? '<span class="badge">WATCH</span>' : '';
      html += '<tr data-slug="' + row.s + '"' + (row.s === selectedSlug ? ' class="selected"' : '') + '>'
        + '<td>' + row.r + '</td>'
        + '<td>' + escapeHtml(row.n) + watch + '</td>'
        + '<td>' + escapeHtml(row.c || '—') + '</td>'
        + '<td class="num">' + money(row.t) + '</td>'
        + '<td class="num ' + gClass + '">' + g + '</td>'
        + '<td class="num">' + row.a + 'd</td>'
        + '<td class="num">' + row.k + '</td>'
        + '<td class="num">' + row.m.toFixed(2) + '</td>'
        + '<td class="num value">' + money(row.v) + '</td>'
        + '</tr>';
    });
    tbody.innerHTML = html;
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function showDetail(slug) {
    var row = null;
    for (var i = 0; i < rows.length; i++) if (rows[i].s === slug) { row = rows[i]; break; }
    if (!row) { detailEl.hidden = true; selectedSlug = null; render(); return; }
    selectedSlug = slug;
    document.getElementById('detail-name').textContent = row.n + ' — rank ' + row.r;
    document.getElementById('detail-sub').textContent =
      (row.c || 'No category') + ' · ' + row.k + (row.k === 1 ? ' chain' : ' chains') + ' (' + row.x + ') · TVL ' + money(row.t) +
      (watchSet.has(row.s) ? ' · on the watchlist' : '');
    document.getElementById('detail-value').textContent = moneyFull(row.v);
    var model = document.getElementById('detail-model');
    model.innerHTML =
      '<tr><td>TVL</td><td>' + moneyFull(row.t) + '</td></tr>'
      + '<tr><td>Category multiple</td><td>' + row.m.toFixed(4) + ' (' + escapeHtml(row.c || 'global fallback') + ')</td></tr>'
      + '<tr><td>7-day growth</td><td>' + pct(row.g) + ' → factor ' + row.f.toFixed(3) + '</td></tr>'
      + '<tr><td>Age</td><td>' + row.a + ' days → factor ' + row.e.toFixed(3) + '</td></tr>'
      + '<tr><td>Chains</td><td>' + row.k + ' → factor ' + row.h.toFixed(3) + '</td></tr>';
    var steps = farmSteps(row);
    var ol = document.getElementById('detail-steps');
    ol.innerHTML = steps.map(function (s) { return '<li>' + escapeHtml(s) + '</li>'; }).join('');
    detailEl.hidden = false;
    render();
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    var params = {};
    hash.split('&').forEach(function (part) {
      var kv = part.split('=');
      if (kv.length === 2) params[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1]);
    });
    return params;
  }

  function initControls() {
    var cats = [];
    rows.forEach(function (row) { if (row.c && cats.indexOf(row.c) < 0) cats.push(row.c); });
    cats.sort();
    var sel = document.getElementById('cat');
    cats.forEach(function (c) {
      var o = document.createElement('option');
      o.value = c;
      o.textContent = c;
      sel.appendChild(o);
    });
    document.getElementById('q').addEventListener('input', function (e) { state.q = e.target.value; render(); });
    sel.addEventListener('change', function (e) { state.cat = e.target.value; render(); });
    document.getElementById('watch-only').addEventListener('change', function (e) { state.watchOnly = e.target.checked; render(); });
    document.getElementById('sort').addEventListener('change', function (e) { state.sort = e.target.value; render(); });
    document.querySelectorAll('table.board thead th').forEach(function (th) {
      th.addEventListener('click', function () {
        var key = th.getAttribute('data-sort');
        if (!key) return;
        if (state.sort === key) { state.dir = -state.dir; }
        else { state.sort = key; state.dir = key === 'name' || key === 'category' ? 1 : -1; }
        var sortSel = document.getElementById('sort');
        if (sortSel.querySelector('option[value="' + key + '"]')) sortSel.value = key;
        render();
      });
    });
    tbody.addEventListener('click', function (e) {
      var tr = e.target.closest('tr[data-slug]');
      if (!tr) return;
      var slug = tr.getAttribute('data-slug');
      window.location.hash = 'detail=' + encodeURIComponent(slug) + '&view=detail';
      showDetail(slug);
      detailEl.scrollIntoView();
    });
    window.addEventListener('hashchange', function () {
      var p = readHash();
      if (p.detail) showDetail(p.detail);
      if (p.cat) { state.cat = p.cat; sel.value = p.cat; render(); }
    });
  }

  function init() {
    var meta = document.getElementById('meta-line');
    meta.textContent = 'Snapshot as of ' + (DATA.asOf || '—') + ' · ' + rows.length + ' protocols ranked · '
      + (DATA.watchlist ? DATA.watchlist.length : 0) + ' on the watchlist · floor $' + ((DATA.floorUsd || 0) / 1e6).toFixed(0) + 'M';
    initControls();
    var p = readHash();
    if (p.cat) { state.cat = p.cat; document.getElementById('cat').value = p.cat; }
    render();
    if (p.detail) showDetail(p.detail);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
