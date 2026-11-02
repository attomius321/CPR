// Normal mode's shell for the mockups, on Hive Control's kit (../../hive-redesign/src/kit.js,
// loaded first, gives the icons and the stage track): the sidenav with today's groups, the icon
// rail a review opens in, and the status bar.
(function () {
  const { svg, track, ICONS } = window.Kit;
  Object.assign(ICONS, {
    bell: '<path d="M10.268 21a2 2 0 0 0 3.464 0"/><path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326"/>',
    nucleus: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.5"/>',
    question:
      '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
    send: '<path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"/><path d="m21.854 2.147-10.94 10.939"/>',
    focus: '<circle cx="12" cy="12" r="3"/><path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/>',
    minus: '<path d="M5 12h14"/>',
    fit: '<path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/>',
    back: '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
    'arrow-down': '<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>',
    'arrow-up': '<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>',
    keyboard: '<path d="M10 8h.01"/><path d="M12 12h.01"/><path d="M14 8h.01"/><path d="M16 12h.01"/><path d="M18 8h.01"/><path d="M6 8h.01"/><path d="M7 16h10"/><path d="M8 12h.01"/><rect width="20" height="16" x="2" y="4" rx="2"/>',
  });

  const MARK = '../../../packages/viewer/src/ui/mark-96.png';

  const WS = {
    merging: [
      {
        icon: 'merge',
        cls: 'run',
        title: 'Fix order total rounding',
        meta: '<b>Checking</b> · npm test · 0:12',
        branch: 'fix/order-total-rounding',
      },
    ],
    waiting: [
      { icon: 'bell', cls: 'you', title: 'Save a cart for later', meta: '<b>Plan ready</b> · 4m', branch: 'feature/saved-carts' },
      { icon: 'question', cls: 'you', title: 'Charge tax on shipping', meta: '<b>Asked a question</b> · 1m', branch: 'fix/shipping-tax' },
    ],
    review: [
      { icon: 'eye', cls: 'you', title: 'Add a discount code', meta: '<b>3 commits</b> · 1 error · 2 warnings', branch: 'feature/discount-code' },
      { icon: 'eye', cls: 'you', title: 'Which search library fits the catalog?', meta: '<b>Answered</b> · spike · 2m', branch: 'spike/catalog-search' },
    ],
    working: [
      { icon: 'spin', cls: 'spin', title: 'Show stock levels on product pages', meta: '<b>Running tests</b> · 3:05', branch: 'feature/stock-levels' },
      { icon: 'spin', cls: 'spin', title: 'Paginate the order history', meta: '<b>Editing</b> list.ts · 7:40', branch: 'feature/order-pages' },
    ],
    done: [
      { title: 'Email a receipt after checkout', when: '11:20' },
      { title: 'Rename the cart’s coupon field', when: '10:02' },
      { title: 'Retry failed payment webhooks', when: '09:41' },
    ],
  };

  function sidenav(nav) {
    const page = nav.dataset.page;
    const open = nav.dataset.open;
    // A screen's own state of a row: `data-meta='{"<branch>": ["<icon>", "<class>", "<meta>"]}'`.
    const over = JSON.parse(nav.dataset.meta ?? '{}');
    // A fourth item moves the row to another group (`working`, `waiting`, …).
    for (const [key, list] of Object.entries(WS))
      for (const w of [...list]) {
        const o = w.branch && over[w.branch];
        if (!o) continue;
        [w.icon, w.cls, w.meta] = o;
        if (o[3] && o[3] !== key) {
          list.splice(list.indexOf(w), 1);
          WS[o[3]].unshift(w);
        }
      }
    const item = (key, label, icon) =>
      `<div class="nav-item ${page === key ? 'on' : ''}">${icon}<span>${label}</span></div>`;
    const row = (w) =>
      `<div class="ws ${open && open === w.branch ? 'on' : ''}">${svg(w.icon, w.cls)}<div class="t">${w.title}</div><div class="m">${w.meta}</div></div>`;
    const small = (w) =>
      `<div class="ws small">${svg('circle-check', 'ok s14')}<div class="t">${w.title}</div><span class="when">${w.when}</span></div>`;
    const group = (label, rows, render = row) =>
      `<div class="nav-group">${label} <span class="count">${rows.length}</span></div>${rows.map(render).join('')}`;
    nav.innerHTML = `
      <div class="nav-top">
        <img class="mark" src="${MARK}" alt="">
        <span class="repo">storefront</span>
        <span class="icon-button">${svg('panel')}</span>
      </div>
      <div class="nav-list">
        ${item('overview', 'Overview', svg('overview'))}
        ${item('nucleus', 'Nucleus', svg('nucleus'))}
        ${item('git', 'Git', svg('git'))}
        ${item('skills', 'Skills', svg('skills'))}
        ${item('monitor', 'Monitor', svg('monitor'))}
        ${item('history', 'History', svg('history'))}
      </div>
      <div class="nav-sep"></div>
      <div class="nav-head">Workspaces<span class="icon-button">${svg('plus')}</span></div>
      <div class="nav-scroll">
        ${
          // `data-only="done"`: nothing open, only what was done today.
          nav.dataset.only === 'done'
            ? `${group('Done today', WS.done, small)}`
            : `${group('Merging', WS.merging)}
        ${group('Waiting for you', WS.waiting)}
        ${group('To review', WS.review)}
        ${group('Working', WS.working)}
        <div class="nav-group">${svg('chevron-right', 's14')}Done today <span class="count">${WS.done.length}</span></div>`
        }
      </div>
      <div class="nav-foot">${item('settings', 'Settings', svg('settings'))}</div>`;
  }

  function rail(el) {
    const r = (icon, cls = '', badge = '') =>
      `<span class="r ${cls}">${svg(icon)}${badge ? `<span class="badge">${badge}</span>` : ''}</span>`;
    el.innerHTML = `
      <img src="${MARK}" alt="">
      ${r('panel')}${r('overview')}${r('nucleus')}${r('git')}${r('skills')}${r('monitor')}${r('history')}
      <span class="sep"></span>
      ${r('plus')}${r('bell', '', '2')}${r('eye', 'on', '2')}${r('spin')}
      <span class="end">${r('settings')}</span>`;
  }

  function statusbar(bar) {
    if (document.querySelector('nav.nav[data-only="done"]')) {
      WS.waiting.length = WS.review.length = WS.working.length = 0;
    }
    bar.innerHTML = `
      <span class="seg">${svg('branch', 's12')}main <span class="mono" style="font-size:12px">7aeb0ad</span></span>
      <span class="seg you">${svg('bell', 's12')}${WS.waiting.length + WS.review.length} wait for you</span>
      <span class="seg">${svg('spin', 's12 spin')}${WS.working.length} agents working</span>
      <span class="right">
        <span class="seg"><b style="font-weight:600;color:var(--text)">Claude</b> Pro</span>
        <span class="seg">5h <span class="meter"><i style="width:34%"></i></span> 34%</span>
        <span class="seg">week <span class="meter"><i style="width:58%"></i></span> 58%</span>
      </span>`;
  }

  function render() {
    const theme = new URLSearchParams(location.search).get('theme');
    if (theme) document.documentElement.dataset.theme = theme;
    // `?ws=all`: every group, whatever the screen's `data-only`.
    if (new URLSearchParams(location.search).get('ws') === 'all')
      document.querySelectorAll('nav.nav').forEach((n) => delete n.dataset.only);
    document.querySelectorAll('nav.nav').forEach(sidenav);
    document.querySelectorAll('nav.rail').forEach(rail);
    document.querySelectorAll('footer.status').forEach(statusbar);
    document.querySelectorAll('[data-i]').forEach((el) => {
      el.outerHTML = svg(el.dataset.i, el.className);
    });
    document.querySelectorAll('[data-track]').forEach((el) => {
      el.classList.add('track');
      el.innerHTML = track(el.dataset.track);
    });
    document.querySelectorAll('[data-edges]').forEach(drawEdges);
  }

  // Edges between nodes of a canvas, from their boxes: out of the right side, into the left.
  function drawEdges(canvas) {
    const box = canvas.getBoundingClientRect();
    const edges = JSON.parse(canvas.dataset.edges);
    const path = ([from, to, kind]) => {
      const a = document.getElementById(from).getBoundingClientRect();
      const b = document.getElementById(to).getBoundingClientRect();
      const leftToRight = a.left < b.left;
      const x1 = (leftToRight ? a.right : a.left) - box.left;
      const y1 = a.top + a.height / 2 - box.top;
      const x2 = (leftToRight ? b.left : b.right) - box.left;
      const y2 = b.top + b.height / 2 - box.top;
      const bend = Math.max(30, Math.abs(x2 - x1) / 2) * (leftToRight ? 1 : -1);
      return `<path class="${kind}" d="M${x1},${y1} C${x1 + bend},${y1} ${x2 - bend},${y2} ${x2},${y2}"/>`;
    };
    // The picked symbol's edges are drawn over the nodes, as React Flow elevates a selection's.
    for (const top of [false, true]) {
      const layer = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      layer.setAttribute('class', top ? 'edges top' : 'edges');
      layer.innerHTML = edges.filter((e) => e[2].includes('hot') === top).map(path).join('');
      canvas.prepend(layer);
    }
  }

  window.NKit = { render };
})();
