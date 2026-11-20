// Token Radar's dashboard. It reads window.RADAR (written beside dashboard/ by main.ts)
// and renders the ranked board, a filterable table, a per-protocol detail view with the
// model's own arithmetic and the protocol's farm plan, and a model sandbox that re-ranks
// the board live from the snapshot's figures. No network: every byte it shows is in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  app.setAttribute('aria-busy', 'false');

  var PAGE_SIZE = 50;
  var state = {
    q: '',
    category: 'all',
    chain: 'all',
    tab: 'board',
    watchlistOnly: false,
    sort: 'implied',
    dir: -1,
    selected: null,
    page: 1,
    sandbox: null,
    view: null,
  };
  var didScroll = false;

  // Hash state, so a screenshot can open the page in one view: #detail=<slug>, #q=<text>,
  // #cat=<category>, #chain=<chain>, #tab=live. The board screenshot is the plain page.
  function readHash() {
    var h = (location.hash || '').replace(/^#/, '');
    if (!h) return;
    h.split('&').forEach(function (pair) {
      var kv = pair.split('=');
      var k = kv[0];
      var v = decodeURIComponent(kv[1] || '');
      if (k === 'detail') state.selected = v || null;
      else if (k === 'q') state.q = v;
      else if (k === 'cat') state.category = v;
      else if (k === 'chain') state.chain = v;
      else if (k === 'tab') state.tab = v === 'live' ? 'live' : 'board';
      else if (k === 'view') state.view = v;
    });
  }
  readHash();

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

  // The model in one function: the page recomputes a row from the snapshot figures and checks
  // the number board.json carries, so the page's code and the board's data are the same
  // arithmetic. Sandbox sliders replace the constants; the submitted board uses DATA.model.
  function impliedOf(row, model) {
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * model.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var maturity = model.maturity_floor + (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_span;
    var reach = 1 + model.reach_per_chain * Math.min((row.chains || []).length, model.reach_chains);
    var size = Math.pow(Math.max(row.tvl_usd, 0), model.tvl_exponent) * model.size_k;
    return {
      implied: Math.max(1, Math.round(size * growthMult * maturity * reach)),
      growth: growth,
      growthMult: growthMult,
      maturity: maturity,
      reach: reach,
      size: size,
      age: age,
    };
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

  // The farm plan is the same derivation main.ts writes to board.json: category, chains, TVL
  // and age decide the action, the capital, the hold and every cost and time. No name is
  // special-cased. The page regenerates it so the detail view never needs a second dataset.
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
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Lend $' + capital + ' of USDC through ' + name + ' on ' + chain + ' and leave the loan open.';
    if (c.indexOf('dex') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Add $' + capital + ' of liquidity to ' + name + "'s deepest pool on " + chain + ' and leave it in.';
    if (c.indexOf('yield') >= 0) return 'Put $' + capital + " into " + name + "'s yield vault on " + chain + ' and leave the shares alone.';
    if (c.indexOf('bridge') >= 0 || c.indexOf('canonical') >= 0) return 'Move $' + capital + ' of USDC across to ' + chain + ' with ' + name + ', then use it inside the app.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return 'Stake $' + capital + ' through ' + name + ' on ' + chain + ' and keep the staking receipt.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0 || c.indexOf('options') >= 0) return 'Post $' + capital + ' of USDC as margin on ' + name + ' and open a single small hedged trade.';
    if (c.indexOf('prediction') >= 0) return 'Back one market on ' + name + ' with $' + capital + ' and let the position run.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0 || c.indexOf('onchain capital') >= 0) return 'Allocate $' + capital + ' to a ' + name + ' vault on ' + chain + ' and hold the vault shares.';
    if (c.indexOf('stable') >= 0) return 'Mint $' + capital + ' of the stable asset with ' + name + ' on ' + chain + ' against collateral.';
    if (c.indexOf('rwa') >= 0) return 'Mint $' + capital + " of " + name + "'s yield-bearing asset on " + chain + ' and hold it.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy active.';
    if (c.indexOf('farm') >= 0) return 'Stake $' + capital + ' in ' + name + "'s farm on " + chain + ' and keep the receipt.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and leave the position open.';
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    var gas = capital >= 150 ? 8 : 4;
    return [
      { text: 'Open a fresh wallet for this farm alone, write its seed phrase on paper and keep it offline.', cost: 'nothing to set up', time: '5 minutes' },
      { text: actionFor(p, capital, chain), cost: '$' + capital + ' of capital and about $' + gas + ' of gas', time: '15 minutes to set up' },
      { text: 'Do one real action every week — a deposit, a borrow, a swap, a vote — so the wallet reads as a user, not a one-off.', cost: 'about $2 of gas a week', time: '10 minutes a week' },
      { text: 'Keep the position open for at least ' + hold + ' days, so it is counted in more than one snapshot window.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: "Check the protocol's own points page before you touch anything, and claim only from a link the protocol itself publishes.", cost: 'free to check; never pay to claim', time: '10 minutes' },
      { text: 'Log the wallet, the dates and every transaction hash, then unwind in steps when the season ends instead of all at once.', cost: 'nothing but the log', time: '5 minutes' },
    ];
  }

  var watchSlugs = {};
  (DATA.watchlist || []).forEach(function (s) { watchSlugs[s] = true; });
  var model = state.sandbox || DATA.model;

  function currentRows() {
    var rows = DATA.rows.map(function (r) {
      var v = impliedOf(r, model);
      return { row: r, implied: v.implied, calc: v };
    });
    if (state.sandbox) rows.sort(function (a, b) { return b.implied - a.implied; });
    return rows;
  }

  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    return currentRows().filter(function (item) {
      var r = item.row;
      if (state.watchlistOnly && !watchSlugs[r.slug]) return false;
      if (state.category !== 'all' && (r.category || 'Uncategorised') !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (q && (r.name + ' ' + r.slug + ' ' + (r.category || '')).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
  }

  function sortedRows(items) {
    var key = state.sort;
    var dir = state.dir;
    var val = function (item) {
      var r = item.row;
      if (key === 'implied') return item.implied;
      if (key === 'tvl') return r.tvl_usd;
      if (key === 'growth') return r.change_7d === null ? -9999 : r.change_7d;
      if (key === 'age') return r.age_days === null ? -1 : r.age_days;
      if (key === 'name') return r.name.toLowerCase();
      return r.rank;
    };
    return items.slice().sort(function (a, b) {
      var va = val(a), vb = val(b);
      if (va < vb) return -dir;
      if (va > vb) return dir;
      return a.row.rank - b.row.rank;
    });
  }

  function render() {
    model = state.sandbox || DATA.model;
    app.innerHTML = '';
    var wrap = el('div', { class: 'wrap' });
    app.appendChild(wrap);

    var totalImplied = DATA.rows.reduce(function (s, r) { return s + r.implied_value_usd; }, 0);
    var hero = el('header', { class: 'hero' },
      el('div', { class: 'kicker', text: 'Token Radar · ' + DATA.model_version }),
      el('h1', { text: 'Which pre-token protocol is worth farming next?' }),
      el('p', { class: 'lede' },
        el('strong', { text: 'A board of ' + DATA.board_size + ' protocols that record no token' }),
        document.createTextNode(', ranked by what a launch would be worth if each protocol kept its record. Every row states its implied value and the steps to farm it. ')
      ),
      el('div', { class: 'chips' },
        el('span', { class: 'chip' }, 'Watchlist ', el('strong', { text: String(DATA.watchlist_size) })),
        el('span', { class: 'chip' }, 'Board rows ', el('strong', { text: String(DATA.board_size) })),
        el('span', { class: 'chip' }, 'Early finds ', el('strong', { text: String(DATA.early_size) })),
        el('span', { class: 'chip' }, 'Total implied ', el('strong', { text: fmtUsd(totalImplied) })),
        el('span', { class: 'chip' }, 'Snapshot ', el('strong', { text: DATA.as_of }))
      )
    );
    wrap.appendChild(hero);

    var how = el('section', { class: 'panel' },
      el('h2', { text: 'How the radar works' }),
      el('p', { text: 'The implied value follows only from the snapshot\u2019s own figures: the protocol\u2019s TVL, its seven-day growth, how long it has run with no token, and how many chains it reaches. Size is concave, so a launch\u2019s value does not grow in proportion to TVL; growth is clamped so one hot week cannot carry a row; age pays for the time a protocol has waited. No name is ever special-cased — the same arithmetic scores every row, and the sandbox below recomputes it live.' }),
      el('p', { text: 'A protocol on this board records no token in DefiLlama\u2019s record. That is not proof it has none: a token may exist that the record does not carry. The implied value is this entry\u2019s own claim, never make.fun\u2019s, and it is not a prediction that a token will be issued, or when.' }),
      el('div', { class: 'model-line' },
        el('b', { text: 'implied = TVL^' + model.tvl_exponent + ' × ' + model.size_k }),
        document.createTextNode(' × (1 + clamp(7d, ' + model.growth_floor + '…+' + model.growth_cap + ') × ' + model.growth_weight + ')'),
        document.createTextNode('\n        × (' + model.maturity_floor + ' + min(age, ' + model.maturity_days + 'd) / ' + model.maturity_days + ' × ' + model.maturity_span + ')'),
        document.createTextNode('\n        × (1 + ' + model.reach_per_chain + ' × min(chains, ' + model.reach_chains + '))')
      ),
      sandboxPanel()
    );
    wrap.appendChild(how);

    var tabs = el('div', { class: 'tabs', role: 'tablist' },
      el('button', { class: 'tab', role: 'tab', 'aria-selected': state.tab === 'board' ? 'true' : 'false', onclick: function () { state.tab = 'board'; state.page = 1; render(); } }, 'Pre-token board (' + DATA.board_size + ')'),
      el('button', { class: 'tab', role: 'tab', 'aria-selected': state.tab === 'live' ? 'true' : 'false', onclick: function () { state.tab = 'live'; state.page = 1; render(); } }, 'Live tokens (' + DATA.live_size + ')')
    );
    wrap.appendChild(tabs);

    if (state.tab === 'live') {
      wrap.appendChild(livePanel());
    } else {
      wrap.appendChild(boardPanel());
    }

    var selected = null;
    if (state.selected) {
      for (var i = 0; i < DATA.rows.length; i++) {
        if (DATA.rows[i].slug === state.selected) { selected = DATA.rows[i]; break; }
      }
    }
    if (selected) wrap.appendChild(detailPanel(selected));

    var foot = el('footer', { class: 'foot' },
      el('p', { text: 'Data: DefiLlama protocols snapshot, ' + DATA.as_of + ' (' + DATA.source + '). The snapshot is sealed: every run of this radar reads the same bytes.' }),
      el('p', { text: 'Implied values are this entry\u2019s own claim, from the snapshot\u2019s figures alone. Nothing here is investment advice, and no token is promised.' })
    );
    wrap.appendChild(foot);

    // A screenshot opens the page in one view: scroll that view into place once, on the
    // first render, so the board, the detail and the filtered table each fill the frame.
    if (state.view && !didScroll) {
      didScroll = true;
      var target = state.view === 'detail' ? document.querySelector('.detail') : document.querySelector('.board-holder');
      if (target) target.scrollIntoView();
    }
  }

  function sandboxPanel() {
    var m = DATA.model;
    var sb = el('div', { class: 'sandbox' },
      el('h3', { text: 'Model sandbox — change the weights, re-rank the board' })
    );
    var grid = el('div', { class: 'sliders' });
    var defs = [
      { key: 'tvl_exponent', label: 'TVL exponent', min: 0.5, max: 1, step: 0.05, fmt: function (v) { return v.toFixed(2); } },
      { key: 'growth_weight', label: 'Growth weight', min: 0, max: 1, step: 0.05, fmt: function (v) { return v.toFixed(2); } },
      { key: 'maturity_span', label: 'Maturity span', min: 0, max: 0.8, step: 0.05, fmt: function (v) { return v.toFixed(2); } },
      { key: 'reach_per_chain', label: 'Reach per chain', min: 0, max: 0.03, step: 0.005, fmt: function (v) { return v.toFixed(3); } },
    ];
    defs.forEach(function (d) {
      var cur = state.sandbox ? state.sandbox[d.key] : m[d.key];
      var out = el('output', { text: d.fmt(cur) });
      var input = el('input', { type: 'range', min: String(d.min), max: String(d.max), step: String(d.step), value: String(cur), 'aria-label': d.label });
      input.addEventListener('input', function () {
        if (!state.sandbox) state.sandbox = Object.assign({}, m);
        state.sandbox[d.key] = parseFloat(input.value);
        out.textContent = d.fmt(state.sandbox[d.key]);
        note.textContent = 'Sandbox view: the board below is re-ranked with your weights. The submitted board uses the stated model.';
        note.className = 'sandbox-note on';
        renderTableOnly();
      });
      var cell = el('div', { class: 'slider' }, el('label', {}, d.label + ' ', out), input);
      grid.appendChild(cell);
    });
    sb.appendChild(grid);
    var note = el('p', { class: 'sandbox-note', text: 'The submitted board uses the stated model above. Move a slider to see how the ranking answers.' });
    sb.appendChild(note);
    var actions = el('div', { class: 'sandbox-actions' },
      el('button', {
        class: 'btn ghost', onclick: function () {
          state.sandbox = null;
          state.page = 1;
          render();
        }
      }, 'Reset to the submitted model')
    );
    sb.appendChild(actions);
    return sb;
  }

  // The table alone, for sandbox slides: the rest of the page stays put.
  function renderTableOnly() {
    var old = document.querySelector('.board-holder');
    if (!old) { render(); return; }
    var holder = boardPanel();
    old.parentNode.replaceChild(holder, old);
  }

  function boardPanel() {
    var holder = el('div', { class: 'board-holder' });
    var cats = {};
    DATA.rows.forEach(function (r) { cats[r.category || 'Uncategorised'] = true; });
    var chains = {};
    DATA.rows.forEach(function (r) { (r.chains || []).forEach(function (c) { chains[c] = true; }); });

    var qInput = el('input', { type: 'search', placeholder: 'Search name or slug…', value: state.q, 'aria-label': 'Search protocols' });
    qInput.addEventListener('input', function () { state.q = qInput.value; state.page = 1; renderTableOnly(); });
    var catSel = el('select', { 'aria-label': 'Filter by category' });
    catSel.appendChild(el('option', { value: 'all' }, 'All categories'));
    Object.keys(cats).sort().forEach(function (c) { catSel.appendChild(el('option', { value: c }, c)); });
    catSel.value = state.category;
    catSel.addEventListener('change', function () { state.category = catSel.value; state.page = 1; renderTableOnly(); });
    var chainSel = el('select', { 'aria-label': 'Filter by chain' });
    chainSel.appendChild(el('option', { value: 'all' }, 'All chains'));
    Object.keys(chains).sort().forEach(function (c) { chainSel.appendChild(el('option', { value: c }, c)); });
    chainSel.value = state.chain;
    chainSel.addEventListener('change', function () { state.chain = chainSel.value; state.page = 1; renderTableOnly(); });
    var wlLabel = el('label', { class: 'check' });
    var wlBox = el('input', { type: 'checkbox' });
    wlBox.checked = state.watchlistOnly;
    wlBox.addEventListener('change', function () { state.watchlistOnly = wlBox.checked; state.page = 1; renderTableOnly(); });
    wlLabel.appendChild(wlBox);
    wlLabel.appendChild(document.createTextNode('Watchlist only'));

    var items = sortedRows(filteredRows());
    var pages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
    if (state.page > pages) state.page = pages;
    var pageItems = items.slice((state.page - 1) * PAGE_SIZE, state.page * PAGE_SIZE);

    var controls = el('div', { class: 'controls' }, qInput, catSel, chainSel, wlLabel,
      el('span', { class: 'count', text: items.length + ' of ' + DATA.board_size + ' rows' }));
    holder.appendChild(controls);

    var table = el('table', { class: 'board' });
    var head = el('thead', {}, el('tr', {},
      thSort('Rank', 'rank'), thSort('Protocol', 'name'), thSort('Category', 'category'),
      el('th', { text: 'Chains' }),
      thSort('TVL', 'tvl', true), thSort('7d', 'growth', true), thSort('Age', 'age', true),
      thSort('Implied value', 'implied', true)
    ));
    table.appendChild(head);
    var body = el('tbody', {});
    if (pageItems.length === 0) {
      holder.appendChild(table);
      holder.appendChild(el('div', { class: 'empty', text: 'No protocol matches that filter. Clear the search or pick another category.' }));
    } else {
      pageItems.forEach(function (item) {
        var r = item.row;
        var change = el('span', { class: (r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) });
        var nameCell = el('td', { class: 'name' }, el('b', {}, r.name), el('span', { text: r.slug }));
        if (watchSlugs[r.slug]) nameCell.appendChild(el('span', { class: 'tag watch', text: 'Watchlist' }));
        else nameCell.appendChild(el('span', { class: 'tag', text: 'Early' }));
        var tr = el('tr', { class: state.selected === r.slug ? 'selected' : '', onclick: function () { state.selected = r.slug; render(); } },
          el('td', { class: 'num', text: String(r.rank) }),
          nameCell,
          el('td', { text: r.category || '—' }),
          el('td', { text: (r.chains || []).slice(0, 3).join(', ') + ((r.chains || []).length > 3 ? ' +' + ((r.chains || []).length - 3) : '') }),
          el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
          el('td', { class: 'num' }, change),
          el('td', { class: 'num', text: fmtAge(r.age_days) }),
          el('td', { class: 'num' }, el('strong', { text: fmtUsd(item.implied) }))
        );
        body.appendChild(tr);
      });
      table.appendChild(body);
      holder.appendChild(table);
    }

    var pager = el('div', { class: 'pager' });
    var prev = el('button', { disabled: state.page <= 1 ? true : null, onclick: function () { if (state.page > 1) { state.page--; renderTableOnly(); } } }, '← Previous');
    var next = el('button', { disabled: state.page >= pages ? true : null, onclick: function () { if (state.page < pages) { state.page++; renderTableOnly(); } } }, 'Next →');
    pager.appendChild(prev);
    pager.appendChild(el('span', { text: 'Page ' + state.page + ' of ' + pages }));
    pager.appendChild(next);
    holder.appendChild(pager);
    return holder;
  }

  function thSort(label, key, num) {
    var arrow = state.sort === key ? (state.dir === -1 ? ' ↓' : ' ↑') : '';
    var btn = el('button', {
      onclick: function () {
        if (state.sort === key) state.dir = -state.dir;
        else { state.sort = key; state.dir = key === 'name' ? 1 : -1; }
        renderTableOnly();
      }
    }, label + arrow);
    return el('th', { class: num ? 'num' : '' }, btn);
  }

  function livePanel() {
    var holder = el('div', { class: 'board-holder' });
    holder.appendChild(el('p', { class: 'sandbox-note', text: 'These protocols already trade: their market caps are the market\u2019s own values, shown for reference. They are not ranked, and they never enter the board.' }));
    var table = el('table', { class: 'board' });
    table.appendChild(el('thead', {}, el('tr', {},
      el('th', { text: 'Protocol' }), el('th', { text: 'Category' }), el('th', { text: 'Chains' }),
      el('th', { class: 'num', text: 'TVL' }), el('th', { class: 'num', text: 'Market cap' }), el('th', { class: 'num', text: '7d' })
    )));
    var body = el('tbody', {});
    DATA.live.forEach(function (p) {
      body.appendChild(el('tr', {},
        el('td', { class: 'name' }, el('b', {}, p.name), el('span', { text: p.slug })),
        el('td', { text: p.category || '—' }),
        el('td', { text: (p.chains || []).slice(0, 3).join(', ') }),
        el('td', { class: 'num', text: fmtUsd(p.tvl_usd) }),
        el('td', { class: 'num' }, el('strong', { text: fmtUsd(p.mcap_usd) })),
        el('td', { class: 'num' }, el('span', { class: (p.change_7d === null ? '' : p.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(p.change_7d) }))
      ));
    });
    table.appendChild(body);
    holder.appendChild(table);
    return holder;
  }

  function detailPanel(r) {
    var v = impliedOf(r, model);
    var steps = farmSteps(r);
    var isWatch = !!watchSlugs[r.slug];
    var why = 'Rank ' + r.rank + ' because ' + fmtUsd(r.tvl_usd) + ' of TVL at ' + fmtPct(r.change_7d) + ' over seven days, ' +
      (r.age_days === null ? 'listed at an unknown date' : fmtAge(r.age_days) + ' on record') + ', across ' +
      (r.chains || []).length + ' chain' + ((r.chains || []).length === 1 ? '' : 's') + ', scores ' +
      fmtUsd(v.implied) + ' under the model — ' + (isWatch ? 'a watchlist protocol' : 'an early find below the watchlist floor') + '.';
    var panel = el('section', { class: 'panel detail', 'aria-label': 'Protocol detail' },
      el('div', { class: 'head' },
        el('h2', {}, r.name, isWatch ? el('span', { class: 'tag watch', text: 'Watchlist' }) : el('span', { class: 'tag', text: 'Early' })),
        el('button', { class: 'close', onclick: function () { state.selected = null; render(); } }, 'Close ✕')
      ),
      el('p', { text: r.slug + ' · ' + (r.category || 'Uncategorised') + ' · listed ' + (r.listed_at || 'unknown') + ' · snapshot ' + DATA.as_of }),
      el('div', { class: 'figures' },
        el('div', { class: 'figure' }, el('span', { text: 'Implied value' }), el('strong', { text: fmtUsd(v.implied) })),
        el('div', { class: 'figure' }, el('span', { text: 'TVL' }), el('strong', { text: fmtUsd(r.tvl_usd) })),
        el('div', { class: 'figure' }, el('span', { text: '7-day change' }), el('strong', { text: fmtPct(r.change_7d) })),
        el('div', { class: 'figure' }, el('span', { text: 'Age' }), el('strong', { text: fmtAge(r.age_days) })),
        el('div', { class: 'figure' }, el('span', { text: 'Chains' }), el('strong', { text: String((r.chains || []).length) }))
      ),
      el('h3', { text: 'How the value is built' }),
      el('table', { class: 'breakdown' },
        el('tbody', {},
          el('tr', {}, el('td', { text: 'Size — TVL^' + model.tvl_exponent + ' × ' + model.size_k }), el('td', { class: 'num', text: fmtUsd(v.size) })),
          el('tr', {}, el('td', { text: 'Growth — 7d ' + fmtPct(r.change_7d) + ' clamped to ' + model.growth_floor + '…+' + model.growth_cap + '%' }), el('td', { class: 'num', text: '×' + v.growthMult.toFixed(3) })),
          el('tr', {}, el('td', { text: 'Maturity — ' + fmtAge(r.age_days) + ' on record' }), el('td', { class: 'num', text: '×' + v.maturity.toFixed(3) })),
          el('tr', {}, el('td', { text: 'Reach — ' + (r.chains || []).length + ' chain' + ((r.chains || []).length === 1 ? '' : 's') }), el('td', { class: 'num', text: '×' + v.reach.toFixed(3) })),
          el('tr', { class: 'total' }, el('td', { text: 'Implied value' }), el('td', { class: 'num', text: fmtUsd(v.implied) }))
        )
      ),
      el('h3', { text: 'How to farm it' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        return el('li', {}, s.text, el('span', { class: 'meta', text: 'Cost: ' + s.cost + ' · Time: ' + s.time }));
      })),
      el('p', { class: 'why' }, el('strong', { text: 'Why it ranks here: ' }), document.createTextNode(why))
    );
    return panel;
  }

  render();
})();
