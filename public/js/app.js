// Cloud Asset Inventory - front-end (vanilla JS single page app, hash routing)
(() => {
  const $ = (s, e = document) => e.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const REGIONS = { 'us-east-1': 'US East (Virginia)', 'us-west-2': 'US West (Oregon)', 'eu-west-1': 'EU (Ireland)', 'ap-south-1': 'Asia Pacific (Mumbai)', 'ap-southeast-2': 'Asia Pacific (Sydney)' };
  const TYPES = ['EC2', 'S3', 'RDS', 'Lambda', 'VPC', 'EBS', 'IAM'];
  const NAV = [['dashboard', 'Dashboard', '📊'], ['assets', 'Asset Inventory', '🗄️'], ['accounts', 'Cloud Accounts', '☁️'],
    ['explorer', 'Resource Explorer', '🧭'], ['security', 'Security & Compliance', '🛡️'], ['alerts', 'Alerts', '🔔'],
    ['logs', 'Activity Logs', '📜'], ['reports', 'Reports', '📄'], ['settings', 'Settings', '⚙️']];
  const S = { token: localStorage.getItem('token') || '', user: null, account: 'all', region: 'all', q: '', accounts: [], f: { type: '', status: '' } };

  // ---------- utilities ----------
  function toast(msg, bad) {
    const t = document.createElement('div');
    t.className = 'toast' + (bad ? ' err' : '');
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2800);
  }
  async function raw(path, o = {}) {
    const res = await fetch('/api' + path, {
      method: o.method || 'GET',
      headers: { 'Content-Type': 'application/json', ...(S.token ? { Authorization: 'Bearer ' + S.token } : {}) },
      body: o.body ? JSON.stringify(o.body) : undefined,
    });
    if (res.status === 401 && S.token) { clearSession(); throw new Error('Session expired. Please sign in again.'); }
    return res;
  }
  async function api(path, o) {
    const res = await raw(path, o);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  }
  function clearSession() {
    S.token = ''; S.user = null; localStorage.removeItem('token');
    if (location.hash === '#/login') render(); else location.hash = '#/login';
  }
  const qs = () => `?account=${S.account}&region=${S.region}&q=${encodeURIComponent(S.q)}`;
  const date = (d) => new Date(d).toLocaleDateString();
  const when = (d) => new Date(d).toLocaleString();
  const tag = (text, color) => `<span class="tag ${color}">${esc(text)}</span>`;
  const statusTag = (s) => tag(s, { running: 'green', connected: 'green', resolved: 'green', stopped: 'amber', syncing: 'blue', unused: 'grey', open: 'red', disconnected: 'red' }[s] || 'grey');
  const sevTag = (s) => tag(s, { critical: 'red', high: 'amber', medium: 'blue', low: 'grey', warning: 'amber', info: 'blue' }[s] || 'grey');
  const money = (n) => '$' + Number(n).toFixed(2);
  const opt = (list, val) => list.map(([v, l]) => `<option value="${esc(v)}" ${v === val ? 'selected' : ''}>${esc(l)}</option>`).join('');
  const regionOpts = Object.entries(REGIONS);
  const accOpts = () => S.accounts.map((a) => [a.id, a.name]);

  function modal(title, body, onSave, onDelete) {
    const m = document.createElement('div');
    m.className = 'overlay';
    m.innerHTML = `<form class="modal"><h2>${esc(title)}</h2>${body}<div class="actions">
      ${onDelete ? '<button type="button" class="btn danger" data-del>Delete</button>' : ''}
      <button type="button" class="btn ghost" data-close>Cancel</button><button class="btn">Save changes</button></div></form>`;
    document.body.appendChild(m);
    $('[data-close]', m).onclick = () => m.remove();
    if (onDelete) $('[data-del]', m).onclick = async () => {
      if (!confirm('Delete this item? This cannot be undone.')) return;
      try { await onDelete(); m.remove(); } catch (e) { toast(e.message, 1); }
    };
    $('form', m).onsubmit = async (e) => {
      e.preventDefault();
      try { await onSave(Object.fromEntries(new FormData(e.target))); m.remove(); } catch (er) { toast(er.message, 1); }
    };
  }
  const field = (label, name, val = '', type = 'text', extra = '') => `<label>${label}<input name="${name}" type="${type}" value="${esc(val)}" ${extra}></label>`;
  const select = (label, name, opts, val) => `<label>${label}<select name="${name}">${opt(opts, val)}</select></label>`;

  function applyTheme(t) { document.body.classList.toggle('dark', t === 'dark'); }
  const bars = (items) => {
    const max = Math.max(1, ...items.map((i) => i.count));
    return items.length ? items.map((i) => `<div class="bar-row"><span>${esc(REGIONS[i.name] || i.name)}</span><div class="track"><div class="fill" style="width:${(i.count / max) * 100}%"></div></div><b>${i.count}</b></div>`).join('') : '<p class="muted">No data yet.</p>';
  };
  const table = (heads, rows) => rows.length
    ? `<table><thead><tr>${heads.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>`
    : '<div class="empty">Nothing to show here yet.</div>';

  // ---------- public pages ----------
  function landing() {
    $('#app').innerHTML = `
      <div class="land-nav"><div class="brand">☁️ Cloud Asset Inventory</div>
        <div class="links"><a href="#/login">Sign in</a><a class="btn" href="#/register">Get Started</a></div></div>
      <section class="hero"><span class="pill">⚡ Enterprise Cloud Management</span>
        <h1>One dashboard for all your <em>cloud assets</em></h1>
        <p>Discover, track, monitor, and manage cloud resources across AWS, Azure, and GCP. Built for teams that need visibility and control.</p>
        <div class="cta"><a class="btn lg" href="#/register">Start Free Trial</a><a class="btn ghost lg" href="#/login">Sign in to Dashboard</a></div></section>`;
  }
  function authPage(mode) {
    const reg = mode === 'register';
    $('#app').innerHTML = `<div class="auth">
      <div class="auth-art"><div class="big">☁️</div><h2>Cloud Asset Inventory</h2>
        <p>Centralized cloud resource management and monitoring for enterprise teams</p>
        <div class="stats"><div><b>528</b><span>Assets</span></div><div><b>4</b><span>Accounts</span></div><div><b>87%</b><span>Compliance</span></div></div></div>
      <div class="auth-form"><form id="af"><h1>${reg ? 'Create your account' : 'Welcome back'}</h1>
        <p class="muted" style="margin-bottom:24px">${reg ? 'Start tracking your cloud assets' : 'Sign in to your account'}</p>
        ${reg ? field('Full name', 'name', '', 'text', 'required') : ''}
        ${field('Email', 'email', reg ? '' : 'admin@cloudinventory.com', 'email', 'required')}
        ${field('Password', 'password', '', 'password', 'required minlength="6"')}
        ${reg ? '' : '<p class="hint">Demo login: admin@cloudinventory.com / Admin@123</p>'}
        <p class="err" id="ae"></p>
        <button class="btn">${reg ? 'Create account' : 'Sign in'}</button>
        <p class="muted" style="text-align:center">${reg ? 'Already have an account? <a href="#/login">Sign in</a>' : 'Don\'t have an account? <a href="#/register">Create account</a>'}</p>
      </form></div></div>`;
    $('#af').onsubmit = async (e) => {
      e.preventDefault();
      try {
        const out = await api(reg ? '/auth/register' : '/auth/login', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
        S.token = out.token; S.user = out.user; localStorage.setItem('token', out.token);
        S.region = out.user.settings.defaultRegion || 'all';
        location.hash = '#/dashboard';
        toast('Welcome back!');
      } catch (er) { $('#ae').textContent = er.message; }
    };
  }

  // ---------- app shell ----------
  async function buildShell() {
    S.accounts = (await api('/accounts')).items;
    applyTheme(S.user.settings.theme);
    $('#app').innerHTML = `<div class="layout">
      <aside class="sidebar"><div class="brand">☁️ <span>Cloud Asset<br>Inventory</span></div>
        <nav>${NAV.map(([id, name, ic]) => `<a href="#/${id}" data-nav="${id}"><span>${ic}</span><span class="lbl">${name}</span></a>`).join('')}</nav>
        <button id="lo"><span>🚪</span><span class="lbl">Logout</span></button></aside>
      <div class="main"><header class="topbar">
        <input id="q" type="search" placeholder="Search assets, resources..." value="${esc(S.q)}">
        <select id="sa"></select><select id="sr"></select>
        <button class="icon-btn" id="bell" title="Alerts">🔔<span class="badge" id="bd" hidden></span></button>
        <button class="icon-btn" id="th" title="Toggle theme">🌙</button>
        <div class="user"><div class="avatar">${esc(S.user.name[0].toUpperCase())}</div><span>${esc(S.user.name)}</span></div>
      </header><main id="content"></main></div></div>`;
    fillSelects();
    $('#q').onkeydown = (e) => { if (e.key === 'Enter') { S.q = e.target.value.trim(); location.hash === '#/assets' ? render() : (location.hash = '#/assets'); } };
    $('#sa').onchange = (e) => { S.account = e.target.value; render(); };
    $('#sr').onchange = (e) => { S.region = e.target.value; render(); };
    $('#bell').onclick = () => (location.hash = '#/alerts');
    $('#th').onclick = async () => {
      const t = document.body.classList.contains('dark') ? 'light' : 'dark';
      applyTheme(t); S.user.settings.theme = t;
      api('/settings', { method: 'PUT', body: { theme: t } }).catch(() => {});
    };
    $('#lo').onclick = async () => { await api('/auth/logout', { method: 'POST' }).catch(() => {}); clearSession(); };
  }
  function fillSelects() {
    $('#sa').innerHTML = opt([['all', 'All accounts'], ...accOpts()], S.account);
    $('#sr').innerHTML = opt([['all', 'All regions'], ...regionOpts], S.region);
  }
  async function refreshBadge() {
    const { unread } = await api('/alerts');
    const b = $('#bd');
    if (b) { b.textContent = unread; b.hidden = !unread; }
  }
  async function reloadAccounts() { S.accounts = (await api('/accounts')).items; if ($('#sa')) fillSelects(); }

  // ---------- pages ----------
  const PAGES = {};

  PAGES.dashboard = async (el) => {
    const d = await api('/dashboard' + qs());
    const stat = (ic, bg, n, label) => `<div class="card stat"><div class="ico" style="background:${bg}">${ic}</div><b>${n}</b><span>${label}</span></div>`;
    el.innerHTML = `<div class="page-head"><div><h1>Dashboard</h1><p class="muted">Live overview of your cloud infrastructure</p></div>
        <button class="btn" id="scan">🔄 Scan Assets</button></div>
      <div class="grid g5">${stat('☁️', '#dbeafe', d.total, 'Total Cloud Assets')}${stat('🖥️', '#dcfce7', d.active, 'Active Resources')}
        ${stat('⚠️', '#fee2e2', d.critical, 'Critical Findings')}${stat('🗑️', '#fef3c7', d.unused, 'Unused Resources')}${stat('💲', '#ede9fe', money(d.monthlyCost), 'Monthly Cost')}</div>
      <div class="grid g2"><div class="card"><h3>Assets by Cloud Service</h3>${bars(d.byService)}</div>
        <div class="card"><h3>Assets by Region</h3>${bars(d.byRegion)}</div></div>
      <div class="grid g2"><div class="card"><h3>Assets by Account</h3>${bars(d.byAccount)}</div>
        <div class="card"><h3>Recent Activity</h3>${d.recent.map((l) => `<div class="list-item"><div class="grow"><b>${esc(l.action)}</b> · ${esc(l.target)}<br><small class="muted">${esc(l.user)} · ${when(l.time)}</small></div></div>`).join('')}</div></div>`;
    $('#scan').onclick = async () => {
      const r = await api('/scan' + qs(), { method: 'POST' });
      toast(`Scan complete: ${r.scanned} assets checked`); refreshBadge(); render();
    };
  };

  function assetForm(a = {}) {
    return field('Name', 'name', a.name, 'text', 'required') + select('Type', 'type', TYPES.map((t) => [t, t]), a.type) +
      select('Account', 'accountId', accOpts(), a.accountId) + select('Region', 'region', regionOpts, a.region) +
      select('Status', 'status', ['running', 'stopped', 'unused'].map((s) => [s, s]), a.status) +
      select('Environment', 'env', ['prod', 'staging', 'dev'].map((s) => [s, s]), a.env) +
      field('Monthly cost (USD)', 'cost', a.cost ?? 0, 'number', 'min="0" step="0.01"');
  }
  PAGES.assets = async (el) => {
    const { items } = await api('/assets' + qs() + `&type=${S.f.type}&status=${S.f.status}`);
    el.innerHTML = `<div class="page-head"><div><h1>Asset Inventory</h1><p class="muted">${items.length} assets found</p></div>
        <button class="btn" id="add">+ Add Asset</button></div>
      <div class="filters"><select id="ft">${opt([['', 'All types'], ...TYPES.map((t) => [t, t])], S.f.type)}</select>
        <select id="fs">${opt([['', 'All statuses'], ...['running', 'stopped', 'unused'].map((s) => [s, s])], S.f.status)}</select>
        ${S.q ? `<span class="chip">Search: ${esc(S.q)} <a href="#" id="clr">✕</a></span>` : ''}</div>
      <div class="card table-wrap">${table(['Name', 'Type', 'Account', 'Region', 'Status', 'Env', 'Cost/mo', 'Actions'],
        items.map((a) => `<tr><td><b>${esc(a.name)}</b></td><td>${a.type}</td><td>${esc(a.accountName)}</td><td>${esc(REGIONS[a.region] || a.region)}</td>
          <td>${statusTag(a.status)}</td><td>${a.env}</td><td>${money(a.cost)}</td>
          <td><button class="btn ghost sm" data-edit="${a.id}">Edit</button><button class="btn ghost sm" data-del="${a.id}">Delete</button></td></tr>`))}</div>`;
    $('#ft').onchange = (e) => { S.f.type = e.target.value; render(); };
    $('#fs').onchange = (e) => { S.f.status = e.target.value; render(); };
    if ($('#clr')) $('#clr').onclick = (e) => { e.preventDefault(); S.q = ''; $('#q').value = ''; render(); };
    $('#add').onclick = () => modal('Add asset', assetForm(), async (d) => { await api('/assets', { method: 'POST', body: d }); toast('Asset added'); render(); });
    el.querySelectorAll('[data-edit]').forEach((b) => (b.onclick = () => {
      const a = items.find((x) => x.id === b.dataset.edit);
      modal('Edit asset', assetForm(a), async (d) => { await api('/assets/' + a.id, { method: 'PUT', body: d }); toast('Asset updated'); render(); });
    }));
    el.querySelectorAll('[data-del]').forEach((b) => (b.onclick = async () => {
      if (!confirm('Delete this asset?')) return;
      await api('/assets/' + b.dataset.del, { method: 'DELETE' }); toast('Asset deleted'); render();
    }));
  };

  const accountForm = (a = {}) => field('Account name', 'name', a.name, 'text', 'required') +
    select('Provider', 'provider', ['AWS', 'Azure', 'GCP'].map((p) => [p, p]), a.provider) +
    field('Account ID', 'accountId', a.accountId, 'text', 'required') +
    (a.id ? select('Status', 'status', ['connected', 'disconnected'].map((s) => [s, s]), a.status) : '');
  PAGES.accounts = async (el) => {
    await reloadAccounts();
    const list = S.accounts;
    el.innerHTML = `<div class="page-head"><div><h1>Cloud Accounts</h1><p class="muted">${list.length} accounts connected</p></div>
        <button class="btn" id="conn">+ Connect Account</button></div>
      <div class="grid g3">${list.map((a) => `<div class="card"><div class="acc-head"><div><b>${esc(a.name)}</b><small>${esc(a.accountId)}</small></div>${statusTag(a.status)}</div>
        <div class="acc-nums"><div><b>${a.assets}</b><span>Assets</span></div><div><b>${a.regions}</b><span>Regions</span></div><div><b>${date(a.lastSync)}</b><span>Last Sync</span></div></div>
        <div class="acc-actions"><button class="btn ghost sm" data-sync="${a.id}">🔄 Sync</button><button class="btn ghost sm" data-assets="${a.id}">👁 Assets</button><button class="btn ghost sm" data-edit="${a.id}">✏️ Edit</button></div></div>`).join('')}</div>`;
    $('#conn').onclick = () => modal('Connect account', accountForm(), async (d) => { await api('/accounts', { method: 'POST', body: d }); toast('Account connected'); render(); });
    el.querySelectorAll('[data-sync]').forEach((b) => (b.onclick = async () => { await api(`/accounts/${b.dataset.sync}/sync`, { method: 'POST' }); toast('Account synced'); render(); }));
    el.querySelectorAll('[data-assets]').forEach((b) => (b.onclick = () => { S.account = b.dataset.assets; fillSelects(); location.hash = '#/assets'; }));
    el.querySelectorAll('[data-edit]').forEach((b) => (b.onclick = () => {
      const a = list.find((x) => x.id === b.dataset.edit);
      modal('Edit account', accountForm(a),
        async (d) => { await api('/accounts/' + a.id, { method: 'PUT', body: d }); toast('Account updated'); render(); },
        async () => { await api('/accounts/' + a.id, { method: 'DELETE' }); if (S.account === a.id) S.account = 'all'; await reloadAccounts(); toast('Account removed'); render(); });
    }));
  };

  PAGES.explorer = async (el) => {
    const { items } = await api('/assets' + qs());
    const type = S.f.explorer || '';
    const shown = type ? items.filter((a) => a.type === type) : items;
    el.innerHTML = `<div class="page-head"><div><h1>Resource Explorer</h1><p class="muted">Browse resources by service</p></div></div>
      <div class="tiles">${TYPES.map((t) => `<div class="card tile ${t === type ? 'sel' : ''}" data-t="${t}"><b>${items.filter((a) => a.type === t).length}</b><span class="muted">${t}</span></div>`).join('')}</div>
      <div class="card table-wrap">${table(['Name', 'Type', 'Region', 'Status', 'Env'],
        shown.map((a) => `<tr><td><b>${esc(a.name)}</b></td><td>${a.type}</td><td>${esc(REGIONS[a.region])}</td><td>${statusTag(a.status)}</td><td>${a.env}</td></tr>`))}</div>`;
    el.querySelectorAll('[data-t]').forEach((t) => (t.onclick = () => { S.f.explorer = S.f.explorer === t.dataset.t ? '' : t.dataset.t; render(); }));
  };

  PAGES.security = async (el) => {
    const { score, items } = await api('/findings' + qs());
    const color = score >= 80 ? '#16a34a' : score >= 50 ? '#d97706' : '#dc2626';
    el.innerHTML = `<div class="page-head"><div><h1>Security & Compliance</h1><p class="muted">Findings and remediation status</p></div></div>
      <div class="grid g2"><div class="card" style="text-align:center"><h3>Compliance score</h3>
        <div class="ring" style="background:conic-gradient(${color} ${score * 3.6}deg, var(--bg) 0)"><div>${score}%</div></div>
        <p class="muted">${items.filter((f) => f.status === 'open').length} open findings</p></div>
        <div class="card"><h3>Open by severity</h3>${bars(['critical', 'high', 'medium', 'low'].map((s) => ({ name: s, count: items.filter((f) => f.severity === s && f.status === 'open').length })))}</div></div>
      <div class="card table-wrap">${table(['Finding', 'Severity', 'Asset', 'Account', 'Status', 'Action'],
        items.map((f) => `<tr><td><b>${esc(f.title)}</b></td><td>${sevTag(f.severity)}</td><td>${esc(f.assetName)}</td><td>${esc(f.accountName)}</td><td>${statusTag(f.status)}</td>
          <td><button class="btn ghost sm" data-f="${f.id}" data-s="${f.status === 'open' ? 'resolved' : 'open'}">${f.status === 'open' ? 'Mark resolved' : 'Reopen'}</button></td></tr>`))}</div>`;
    el.querySelectorAll('[data-f]').forEach((b) => (b.onclick = async () => { await api('/findings/' + b.dataset.f, { method: 'PUT', body: { status: b.dataset.s } }); render(); }));
  };

  PAGES.alerts = async (el) => {
    const { items } = await api('/alerts');
    el.innerHTML = `<div class="page-head"><div><h1>Alerts</h1><p class="muted">${items.filter((a) => !a.read).length} unread</p></div><button class="btn ghost" id="all">Mark all as read</button></div>
      <div class="card">${items.length ? items.map((a) => `<div class="list-item ${a.read ? '' : 'unread'}">${sevTag(a.level)}<div class="grow">${esc(a.message)}<br><small class="muted">${when(a.created)}</small></div>
        ${a.read ? '' : `<button class="btn ghost sm" data-r="${a.id}">Mark read</button>`}</div>`).join('') : '<div class="empty">You are all caught up.</div>'}</div>`;
    $('#all').onclick = async () => { await api('/alerts/read-all', { method: 'PUT' }); render(); };
    el.querySelectorAll('[data-r]').forEach((b) => (b.onclick = async () => { await api(`/alerts/${b.dataset.r}/read`, { method: 'PUT' }); render(); }));
  };

  PAGES.logs = async (el) => {
    const { items } = await api('/logs');
    el.innerHTML = `<div class="page-head"><div><h1>Activity Logs</h1><p class="muted">Latest ${items.length} events</p></div></div>
      <div class="card table-wrap">${table(['Time', 'User', 'Action', 'Target'], items.map((l) => `<tr><td>${when(l.time)}</td><td>${esc(l.user)}</td><td>${esc(l.action)}</td><td>${esc(l.target)}</td></tr>`))}</div>`;
  };

  PAGES.reports = async (el) => {
    const { generated } = await api('/reports');
    const R = [['inventory', 'Complete Asset Inventory Report', 'Full inventory of all cloud assets across accounts and regions.'],
      ['security', 'Security Compliance Report', 'Security findings, compliance scores, and remediation status.'],
      ['unused', 'Unused Resource Report', 'Identifies idle, stopped, or unattached resources for cost optimization.'],
      ['cost', 'Cloud Asset Cost Report', 'Cost breakdown by service, account, region, and environment.'],
      ['changes', 'Asset Change Report', 'Tracks all changes and modifications to cloud resources.']];
    el.innerHTML = `<div class="page-head"><div><h1>Reports</h1><p class="muted">Generate and download reports</p></div></div>
      <div class="grid g3">${R.map(([id, name, desc]) => `<div class="card"><h3>📄 ${name}</h3><p class="muted" style="margin-bottom:14px">${desc}</p>
        <p class="muted" style="font-size:13px;margin-bottom:14px">Last generated: ${generated[id] ? date(generated[id]) : 'never'}</p>
        <div class="acc-actions"><button class="btn sm" data-g="${id}">Generate</button><button class="btn ghost sm" data-d="${id}">⬇ Download</button></div></div>`).join('')}</div>`;
    el.querySelectorAll('[data-g]').forEach((b) => (b.onclick = async () => { await api(`/reports/${b.dataset.g}/generate`, { method: 'POST' }); toast('Report generated'); render(); }));
    el.querySelectorAll('[data-d]').forEach((b) => (b.onclick = async () => {
      const res = await raw(`/reports/${b.dataset.d}/download`);
      if (!res.ok) return toast('Download failed', 1);
      const url = URL.createObjectURL(await res.blob());
      const a = Object.assign(document.createElement('a'), { href: url, download: `${b.dataset.d}-report.csv` });
      a.click(); URL.revokeObjectURL(url);
    }));
  };

  PAGES.settings = async (el) => {
    const u = S.user;
    el.innerHTML = `<div class="page-head"><div><h1>Settings</h1><p class="muted">Manage your profile and preferences</p></div></div>
      <div class="card" style="max-width:520px"><form id="sf">${field('Name', 'name', u.name, 'text', 'required')}
        <label>Email<input value="${esc(u.email)}" disabled></label>
        ${select('Default region', 'defaultRegion', [['all', 'All regions'], ...regionOpts], u.settings.defaultRegion)}
        ${select('Theme', 'theme', [['light', 'Light'], ['dark', 'Dark']], u.settings.theme)}
        ${field('New password (optional)', 'password', '', 'password', 'minlength="6" autocomplete="new-password"')}
        <label style="display:flex;gap:10px;align-items:center"><input type="checkbox" name="emailAlerts" style="width:auto;margin:0" ${u.settings.emailAlerts ? 'checked' : ''}> Email me about critical alerts</label>
        <button class="btn">Save changes</button></form></div>`;
    $('#sf').onsubmit = async (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target));
      f.emailAlerts = e.target.emailAlerts.checked;
      if (!f.password) delete f.password;
      try { S.user = (await api('/settings', { method: 'PUT', body: f })).user; applyTheme(S.user.settings.theme); toast('Settings saved'); } catch (er) { toast(er.message, 1); }
    };
  };

  // ---------- router ----------
  async function render() {
    const route = location.hash.replace(/^#\/?/, '').split('?')[0];
    if (!S.token) {
      if (route === 'login') return authPage('login');
      if (route === 'register') return authPage('register');
      if (route === '') return landing();
      location.hash = '#/login'; return;
    }
    if (['', 'login', 'register'].includes(route)) { location.hash = '#/dashboard'; return; }
    try {
      if (!S.user) { S.user = (await api('/auth/me')).user; S.region = S.user.settings.defaultRegion || 'all'; }
      if (!$('#content')) await buildShell();
      document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === route));
      const page = PAGES[route] || PAGES.dashboard;
      $('#content').innerHTML = '<p class="muted">Loading…</p>';
      await page($('#content'));
      refreshBadge().catch(() => {});
    } catch (e) {
      if ($('#content')) $('#content').innerHTML = `<p class="err">${esc(e.message)}</p>`;
    }
  }
  window.addEventListener('hashchange', render);
  render();
})();
