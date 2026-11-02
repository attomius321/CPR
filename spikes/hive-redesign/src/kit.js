// Hive Control's mockup kit: lucide icons (ISC), the shared sidenav and status bar, the stage
// track. Each screen is static markup; this fills in the repeated parts so every screen shows
// the same shell and the same workspaces.
(function () {
  const ICONS = {
    overview:
      '<rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/>',
    git: '<circle cx="5" cy="6" r="3"/><path d="M5 9v6"/><circle cx="5" cy="18" r="3"/><path d="M12 3v18"/><circle cx="19" cy="6" r="3"/><path d="M16 15.7A9 9 0 0 0 19 9"/>',
    skills:
      '<path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>',
    monitor:
      '<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/>',
    history:
      '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>',
    settings:
      '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
    hexagon:
      '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>',
    plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
    more: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
    panel: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    'circle-check': '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
    'circle-x': '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>',
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    spin: '<circle cx="12" cy="12" r="9" opacity="0.28"/><path d="M21 12a9 9 0 0 0-9-9"/>',
    stopped:
      '<path d="M12 16h.01"/><path d="M12 8v4"/><path d="M15.312 2a2 2 0 0 1 1.414.586l4.688 4.688A2 2 0 0 1 22 8.688v6.624a2 2 0 0 1-.586 1.414l-4.688 4.688a2 2 0 0 1-1.414.586H8.688a2 2 0 0 1-1.414-.586l-4.688-4.688A2 2 0 0 1 2 15.312V8.688a2 2 0 0 1 .586-1.414l4.688-4.688A2 2 0 0 1 8.688 2z"/>',
    answered:
      '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/><path d="m9 12 2 2 4-4"/>',
    pause: '<rect x="14" y="4" width="4" height="16" rx="1"/><rect x="6" y="4" width="4" height="16" rx="1"/>',
    'circle-pause':
      '<circle cx="12" cy="12" r="10"/><line x1="10" x2="10" y1="15" y2="9"/><line x1="14" x2="14" y1="15" y2="9"/>',
    power: '<path d="M12 2v10"/><path d="M18.4 6.6a9 9 0 1 1-12.77.04"/>',
    clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
    coins:
      '<circle cx="8" cy="8" r="6"/><path d="M18.09 10.37A6 6 0 1 1 10.34 18"/><path d="M7 6h1v4"/><path d="m16.71 13.88.7.71-2.82 2.82"/>',
    gauge: '<path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>',
    merge: '<circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M6 21V9a9 9 0 0 0 9 9"/>',
    pr: '<circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M13 6h3a2 2 0 0 1 2 2v7"/><line x1="6" x2="6" y1="9" y2="21"/>',
    branch:
      '<line x1="6" x2="6" y1="3" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>',
    commit: '<circle cx="12" cy="12" r="3"/><path d="M3 12h6"/><path d="M15 12h6"/>',
    pencil:
      '<path d="M13 21h8"/><path d="m15 5 4 4"/><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/>',
    checks:
      '<path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/><path d="M13 6h8"/><path d="M13 12h8"/><path d="M13 18h8"/>',
    shield:
      '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
    flask:
      '<path d="M14 2v6a2 2 0 0 0 .245.96l5.51 10.08A2 2 0 0 1 18 22H6a2 2 0 0 1-1.755-2.96l5.51-10.08A2 2 0 0 0 10 8V2"/><path d="M6.453 15h11.094"/><path d="M8.5 2h7"/>',
    bug: '<path d="m8 2 1.88 1.88"/><path d="M14.12 3.88 16 2"/><path d="M9 7.13v-1a3.003 3.003 0 1 1 6 0v1"/><path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6"/><path d="M12 20v-9"/><path d="M6.53 9C4.6 8.8 3 7.1 3 5"/><path d="M6 13H2"/><path d="M3 21c0-2.1 1.7-3.9 3.8-4"/><path d="M20.97 5c0 2.1-1.6 3.8-3.5 4"/><path d="M22 13h-4"/><path d="M17.2 17c2.1.1 3.8 1.9 3.8 4"/>',
    eye: '<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/>',
    upload: '<path d="M12 13v8"/><path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"/><path d="m8 17 4-4 4 4"/>',
    terminal: '<polyline points="4 17 10 11 4 5"/><line x1="12" x2="20" y1="19" y2="19"/>',
    thread: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    activity:
      '<path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/>',
    file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
    log: '<path d="M15 12h-5"/><path d="M15 8h-5"/><path d="M19 17V5a2 2 0 0 0-2-2H4"/><path d="M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3"/>',
    external:
      '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
    'chevron-right': '<path d="m9 18 6-6-6-6"/>',
    'chevron-down': '<path d="m6 9 6 6 6-6"/>',
    'arrow-right': '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
    target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
    search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    filter: '<path d="M10 20a1 1 0 0 0 .553.895l2 1A1 1 0 0 0 14 21v-7a2 2 0 0 1 .517-1.341L21.74 4.67A1 1 0 0 0 21 3H3a1 1 0 0 0-.742 1.67l7.225 7.989A2 2 0 0 1 10 14z"/>',
    alert: '<circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>',
    danger: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4M12 17h.01"/>',
    feature:
      '<path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z"/>',
    fix: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
    spike: '<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>',
    refactor: '<path d="m18 16 4-4-4-4"/><path d="m6 8-4 4 4 4"/><path d="m14.5 4-5 16"/>',
    chore: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
    model: '<rect width="16" height="16" x="4" y="4" rx="2"/><rect width="6" height="6" x="9" y="9" rx="1"/><path d="M15 2v2"/><path d="M15 20v2"/><path d="M2 15h2"/><path d="M2 9h2"/><path d="M20 15h2"/><path d="M20 9h2"/><path d="M9 2v2"/><path d="M9 20v2"/>',
    sandbox: '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    attach: '<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
    copy: '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
    vscode: '<path d="m18 16 4-4-4-4"/><path d="m6 8-4 4 4 4"/>',
    image: '<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
    columns: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M12 3v18"/>',
    maximize: '<polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" x2="14" y1="3" y2="10"/><line x1="3" x2="10" y1="21" y2="14"/>',
    tty: '<path d="m7 11 2-2-2-2"/><path d="M11 13h4"/><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/>',
  };

  const svg = (name, cls = '') =>
    `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] ?? ''}</svg>`;

  // Alpha Ceph's mark: seven cells of the Hive Mind, drawn flat.
  const mind = () => {
    const cells = [
      [12, 12],
      [12, 5.2],
      [12, 18.8],
      [6.1, 8.6],
      [17.9, 8.6],
      [6.1, 15.4],
      [17.9, 15.4],
    ];
    const hex = (x, y, r) =>
      Array.from({ length: 6 }, (_, k) => {
        const a = (Math.PI / 3) * k + Math.PI / 6;
        return `${(x + r * Math.cos(a)).toFixed(2)},${(y + r * Math.sin(a)).toFixed(2)}`;
      }).join(' ');
    return `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${cells
      .map(
        ([x, y], k) =>
          `<polygon points="${hex(x, y, 3.3)}" style="fill:${k === 0 ? 'var(--hive)' : 'none'};stroke:${k === 0 ? 'var(--hive)' : 'currentColor'};stroke-width:1.4"/>`,
      )
      .join('')}</svg>`;
  };

  const hexPoints = '6,0.5 11.5,3.5 11.5,9.5 6,12.5 0.5,9.5 0.5,3.5';
  // A stage track: Write, Check, Review, Land; each `done`, `now`, `bad` or `todo`.
  const track = (states) =>
    states
      .split(',')
      .map((s, k, all) => {
        const hex = `<svg class="hex ${s}" viewBox="0 0 12 13"><polygon points="${hexPoints}"/></svg>`;
        const line =
          k < all.length - 1
            ? `<span class="link-line ${s === 'done' ? 'done' : ''}"></span>`
            : '';
        return hex + line;
      })
      .join('');

  const WS = {
    flight: [
      {
        icon: 'spin',
        cls: 'spin',
        title: 'Retry failed payment webhooks',
        meta: '<b>Checking 4/4</b> · round 2 · 7:23',
        branch: 'fix/payment-webhook-retry',
      },
      {
        icon: 'spin',
        cls: 'spin',
        title: 'Cache product search results',
        meta: '<b>Reviewing</b> · round 1 · 1:38',
        branch: 'feature/search-cache',
      },
      {
        icon: 'spin',
        cls: 'spin',
        title: 'Show stock levels on product pages',
        meta: '<b>Writing</b> · round 1 · 3:05',
        branch: 'feature/stock-levels',
      },
      {
        icon: 'spin',
        cls: 'spin',
        title: 'Export orders as CSV',
        meta: '<b>Landing</b> · checking the merge',
        branch: 'feature/orders-csv',
      },
    ],
    stopped: [
      {
        icon: 'stopped',
        cls: 'fail',
        title: 'Import products from a supplier feed',
        meta: '<b>Stopped</b> · 3 of 3 rounds',
        branch: 'feature/supplier-import',
      },
    ],
    landed: [
      { title: 'Add a discount code', when: '12:44', branch: 'feature/discount-code' },
      { title: 'Fix tax rounding on invoices', when: '11:58' },
      { title: 'Paginate the order history', when: '10:27' },
      { title: 'Rename the cart’s coupon field', when: '09:40' },
      { title: 'Can we drop lodash?', when: '09:12', answered: true },
    ],
  };

  function sidenav(nav) {
    const page = nav.dataset.page;
    const open = nav.dataset.open;
    const item = (key, label, icon, extra = '') =>
      `<div class="nav-item ${page === key ? 'on' : ''}">${icon}<span>${label}</span>${extra}</div>`;
    const wsRow = (w) =>
      `<div class="ws ${open && open === w.branch ? 'on' : ''}">${svg(w.icon, w.cls)}<div class="t">${w.title}</div><div class="m">${w.meta}</div></div>`;
    const landedRow = (w) =>
      `<div class="ws small ${open && open === w.branch ? 'on' : ''}">${svg(w.answered ? 'answered' : 'circle-check', w.answered ? 'faint s14' : 'ok s14')}<div class="t">${w.title}</div><span class="when">${w.when}</span></div>`;
    // `?fresh=1`: Hive just turned on: nothing in flight, today's normal-mode merges landed.
    const fresh = nav.dataset.fresh === '1';
    const flight = fresh ? [] : nav.dataset.flight ? WS.flight.slice(0, +nav.dataset.flight) : WS.flight;
    const landed = fresh
      ? [
          { title: 'Email a receipt after checkout', when: '11:20' },
          { title: 'Rename the cart’s coupon field', when: '10:02' },
          { title: 'Retry failed payment webhooks', when: '09:41' },
        ]
      : WS.landed;
    nav.innerHTML = `
      <div class="nav-top">
        <img class="mark" src="../../../packages/viewer/src/ui/mark-hive-96.png" alt="">
        <span class="repo">storefront</span>
        <span class="mode-pill"><svg viewBox="0 0 12 13"><polygon points="${hexPoints}"/></svg>Hive</span>
        <span class="icon-button">${svg('panel')}</span>
      </div>
      <div class="nav-list">
        ${item('overview', 'Overview', svg('overview'))}
        ${item('alpha', 'Alpha Ceph', mind())}
        ${item('git', 'Git', svg('git'))}
        ${item('skills', 'Skills', svg('skills'))}
        ${item('monitor', 'Monitor', svg('monitor'))}
        ${item('history', 'History', svg('history'))}
      </div>
      <div class="nav-sep"></div>
      <div class="nav-head">Workspaces<span class="icon-button">${svg('plus')}</span></div>
      <div class="nav-scroll">
        <div class="nav-group">In flight <span class="count">${flight.length}</span></div>
        ${fresh ? '<div class="ws small"><span></span><div class="t" style="color: var(--faint)">Nothing yet: start a goal</div></div>' : flight.map(wsRow).join('')}
        ${
          nav.dataset.stopped === 'no' || fresh
            ? ''
            : `<div class="nav-group">Stopped <span class="count">1</span></div>${WS.stopped.map(wsRow).join('')}`
        }
        <div class="nav-group">Landed today <span class="count">${landed.length}</span></div>
        ${landed.map(landedRow).join('')}
      </div>
      <div class="nav-foot">${item('settings', 'Settings', svg('settings'))}</div>`;
  }

  function statusbar(bar) {
    const paused = bar.dataset.paused === 'yes';
    bar.innerHTML = `
      <span class="seg"><span class="dot" style="${paused ? 'background:var(--run)' : ''}"></span>${paused ? 'Hive paused by usage' : 'Hive on'}</span>
      <span class="seg">${svg('spin', 's12 spin')}${bar.dataset.flight ?? 4} in flight</span>
      <span class="seg">${svg('merge', 's12')}${bar.dataset.landed ?? 5} landed today</span>
      <span class="seg">${svg('branch', 's12')}main</span>
      <span class="right">
        <span class="seg"><b style="font-weight:600;color:var(--text)">Claude</b> Pro</span>
        <span class="seg">5h <span class="meter"><i style="width:${paused ? 91 : 41}%;${paused ? 'background:var(--run)' : ''}"></i><b style="left:90%"></b></span> ${paused ? 91 : 41}%</span>
        <span class="seg">week <span class="meter"><i style="width:63%"></i><b style="left:90%"></b></span> 63%</span>
      </span>`;
  }

  function render() {
    const theme = new URLSearchParams(location.search).get('theme');
    if (theme) document.documentElement.dataset.theme = theme;
    if (new URLSearchParams(location.search).get('fresh')) {
      document.querySelectorAll('nav.nav').forEach((n) => (n.dataset.fresh = '1'));
      document.querySelectorAll('footer.status').forEach((b) => {
        b.dataset.flight = '0';
        b.dataset.landed = '3';
      });
    }
    document.querySelectorAll('nav.nav').forEach(sidenav);
    document.querySelectorAll('footer.status').forEach(statusbar);
    document.querySelectorAll('[data-i]').forEach((el) => {
      el.outerHTML = el.dataset.i === 'mind' ? mind() : svg(el.dataset.i, el.className);
    });
    document.querySelectorAll('[data-track]').forEach((el) => {
      el.classList.add('track');
      el.innerHTML = track(el.dataset.track);
    });
  }

  window.Kit = { render, svg, track, ICONS };
})();
