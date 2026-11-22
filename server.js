// Cloud Asset Inventory - backend (Node.js built-ins only, no npm install needed)
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 5173;
const DB_FILE = path.join(__dirname, 'data', 'db.json');
const PUB = path.join(__dirname, 'public');
const REGIONS = ['us-east-1', 'us-west-2', 'eu-west-1', 'ap-south-1', 'ap-southeast-2'];
const TYPES = ['EC2', 'S3', 'RDS', 'Lambda', 'VPC', 'EBS', 'IAM'];

// ---------- helpers ----------
const uid = (p) => p + crypto.randomBytes(5).toString('hex');
const hash = (pw, salt = crypto.randomBytes(8).toString('hex')) =>
  salt + ':' + crypto.scryptSync(pw, salt, 32).toString('hex');
const verify = (pw, stored) => {
  const [salt] = stored.split(':');
  return crypto.timingSafeEqual(Buffer.from(hash(pw, salt)), Buffer.from(stored));
};
const daysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString();
const fail = (status, msg) => { throw { status, msg }; };

// ---------- database (simple JSON file) ----------
function seed() {
  const accounts = [
    { id: 'acc_prod', name: 'Production AWS', provider: 'AWS', accountId: '123456789012', status: 'connected', lastSync: daysAgo(0) },
    { id: 'acc_stg', name: 'Staging AWS', provider: 'AWS', accountId: '987654321098', status: 'connected', lastSync: daysAgo(0) },
    { id: 'acc_dev', name: 'Development AWS', provider: 'AWS', accountId: '555123456789', status: 'connected', lastSync: daysAgo(1) },
    { id: 'acc_az', name: 'Analytics Azure', provider: 'Azure', accountId: 'aaaa-bbbb-cccc-dddd', status: 'disconnected', lastSync: daysAgo(4) },
  ];
  const assets = [];
  for (let i = 0; i < 48; i++) {
    const type = TYPES[i % 7], env = ['prod', 'staging', 'dev'][i % 3];
    assets.push({
      id: uid('ast_'), name: `${type.toLowerCase()}-${env}-${String(i + 1).padStart(2, '0')}`, type,
      accountId: accounts[i % 4].id, region: REGIONS[(i * 3 + 1) % 5],
      status: i % 9 === 0 ? 'unused' : i % 5 === 0 ? 'stopped' : 'running',
      env, cost: +(((i * 37) % 90) + 5).toFixed(2), createdAt: daysAgo(i * 3),
    });
  }
  const titles = ['Public S3 bucket detected', 'Security group open to 0.0.0.0/0 on port 22', 'Root account has no MFA',
    'Unencrypted EBS volume', 'RDS instance is publicly accessible', 'IAM access key unused for 90 days', 'CloudTrail logging disabled'];
  const sev = ['critical', 'high', 'medium', 'low'];
  const findings = assets.filter((_, i) => i % 3 === 0).map((a, i) => ({
    id: uid('fnd_'), title: titles[i % 7], severity: sev[i % 4], assetId: a.id, assetName: a.name,
    accountId: a.accountId, region: a.region, status: i % 4 === 3 ? 'resolved' : 'open', created: daysAgo(i),
  }));
  const alerts = [
    { id: uid('alt_'), level: 'critical', message: 'Public S3 bucket detected in Production AWS', read: false, created: daysAgo(0) },
    { id: uid('alt_'), level: 'warning', message: 'Analytics Azure account is disconnected', read: false, created: daysAgo(1) },
    { id: uid('alt_'), level: 'info', message: 'Weekly sync completed for Staging AWS', read: true, created: daysAgo(2) },
  ];
  return {
    users: [{ id: 'usr_admin', name: 'Admin', email: 'admin@cloudinventory.com', password: hash('Admin@123'),
      settings: { theme: 'light', defaultRegion: 'all', emailAlerts: true } }],
    sessions: {}, accounts, assets, findings, alerts,
    logs: [{ id: uid('log_'), user: 'System', action: 'Database created', target: 'Cloud Asset Inventory', time: daysAgo(0) }],
    reports: {},
  };
}
let db;
function load() {
  if (!fs.existsSync(DB_FILE)) { fs.mkdirSync(path.dirname(DB_FILE), { recursive: true }); db = seed(); save(); }
  else db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}
function save() { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2)); }
function log(user, action, target) {
  db.logs.unshift({ id: uid('log_'), user: user.name, action, target, time: new Date().toISOString() });
  db.logs = db.logs.slice(0, 500);
}
function addAlert(level, message) {
  db.alerts.unshift({ id: uid('alt_'), level, message, read: false, created: new Date().toISOString() });
}

// ---------- filtering ----------
const scope = (list, q) => list.filter((x) =>
  (!q.account || q.account === 'all' || x.accountId === q.account) &&
  (!q.region || q.region === 'all' || x.region === q.region));
const accName = (id) => (db.accounts.find((a) => a.id === id) || {}).name || 'Unknown';
const count = (list, key) => {
  const m = {};
  list.forEach((x) => { m[x[key]] = (m[x[key]] || 0) + 1; });
  return Object.entries(m).map(([name, c]) => ({ name, count: c })).sort((a, b) => b.count - a.count);
};
const csv = (rows) => rows.map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
const complianceScore = (f) => (f.length ? Math.round((f.filter((x) => x.status === 'resolved').length / f.length) * 100) : 100);

// ---------- routes ----------
const routes = [];
const route = (method, p, fn, auth = true) =>
  routes.push({ method, re: new RegExp('^' + p.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), fn, auth });

const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, settings: u.settings });
const startSession = (u) => {
  const token = crypto.randomBytes(24).toString('hex');
  db.sessions[token] = u.id; save();
  return { token, user: publicUser(u) };
};

route('POST', '/api/auth/register', ({ body }) => {
  const { name, email, password } = body;
  if (!name || !email || !password) fail(400, 'Name, email and password are required');
  if (password.length < 6) fail(400, 'Password must be at least 6 characters');
  if (db.users.some((u) => u.email === email.toLowerCase())) fail(409, 'An account with this email already exists');
  const u = { id: uid('usr_'), name, email: email.toLowerCase(), password: hash(password),
    settings: { theme: 'light', defaultRegion: 'all', emailAlerts: true } };
  db.users.push(u); log(u, 'Registered account', u.email);
  return startSession(u);
}, false);

route('POST', '/api/auth/login', ({ body }) => {
  const u = db.users.find((x) => x.email === String(body.email || '').toLowerCase());
  if (!u || !verify(String(body.password || ''), u.password)) fail(401, 'Incorrect email or password');
  log(u, 'Signed in', u.email);
  return startSession(u);
}, false);

route('GET', '/api/auth/me', ({ user }) => ({ user: publicUser(user) }));
route('POST', '/api/auth/logout', ({ user, token }) => { delete db.sessions[token]; log(user, 'Signed out', user.email); save(); return { ok: true }; });

route('GET', '/api/dashboard', ({ query }) => {
  const assets = scope(db.assets, query), findings = scope(db.findings, query);
  return {
    total: assets.length,
    active: assets.filter((a) => a.status === 'running').length,
    critical: findings.filter((f) => f.severity === 'critical' && f.status === 'open').length,
    unused: assets.filter((a) => a.status === 'unused').length,
    monthlyCost: +assets.reduce((s, a) => s + a.cost, 0).toFixed(2),
    compliance: complianceScore(findings),
    byService: count(assets, 'type'), byRegion: count(assets, 'region'),
    byAccount: count(assets.map((a) => ({ n: accName(a.accountId) })), 'n'),
    recent: db.logs.slice(0, 6),
  };
});

// accounts
const withStats = (a) => {
  const list = db.assets.filter((x) => x.accountId === a.id);
  return { ...a, assets: list.length, regions: new Set(list.map((x) => x.region)).size };
};
route('GET', '/api/accounts', () => ({ items: db.accounts.map(withStats) }));
route('POST', '/api/accounts', ({ user, body }) => {
  if (!body.name || !body.accountId) fail(400, 'Name and account ID are required');
  const a = { id: uid('acc_'), name: body.name, provider: body.provider || 'AWS', accountId: body.accountId,
    status: 'connected', lastSync: new Date().toISOString() };
  db.accounts.push(a); log(user, 'Connected account', a.name); save();
  return withStats(a);
});
route('PUT', '/api/accounts/:id', ({ user, params, body }) => {
  const a = db.accounts.find((x) => x.id === params.id) || fail(404, 'Account not found');
  ['name', 'provider', 'accountId', 'status'].forEach((k) => { if (body[k]) a[k] = body[k]; });
  log(user, 'Updated account', a.name); save();
  return withStats(a);
});
route('DELETE', '/api/accounts/:id', ({ user, params }) => {
  const a = db.accounts.find((x) => x.id === params.id) || fail(404, 'Account not found');
  db.accounts = db.accounts.filter((x) => x !== a);
  db.assets = db.assets.filter((x) => x.accountId !== a.id);
  db.findings = db.findings.filter((x) => x.accountId !== a.id);
  log(user, 'Removed account', a.name); save();
  return { ok: true };
});
route('POST', '/api/accounts/:id/sync', ({ user, params }) => {
  const a = db.accounts.find((x) => x.id === params.id) || fail(404, 'Account not found');
  a.status = 'connected'; a.lastSync = new Date().toISOString();
  log(user, 'Synced account', a.name); save();
  return withStats(a);
});
route('POST', '/api/scan', ({ user, query }) => {
  const n = scope(db.assets, query).length;
  addAlert('info', `Scan finished: ${n} assets checked`);
  log(user, 'Scanned assets', `${n} assets`); save();
  return { scanned: n };
});

// assets
route('GET', '/api/assets', ({ query }) => {
  const q = (query.q || '').toLowerCase();
  const items = scope(db.assets, query)
    .filter((a) => (!query.type || a.type === query.type) && (!query.status || a.status === query.status))
    .filter((a) => !q || [a.name, a.type, a.env, a.region, a.status].some((v) => v.toLowerCase().includes(q)))
    .map((a) => ({ ...a, accountName: accName(a.accountId) }));
  return { items };
});
const cleanAsset = (b) => {
  if (!b.name) fail(400, 'Asset name is required');
  if (!TYPES.includes(b.type)) fail(400, 'Invalid asset type');
  if (!db.accounts.some((a) => a.id === b.accountId)) fail(400, 'Choose a valid account');
  return { name: b.name, type: b.type, accountId: b.accountId, region: b.region || REGIONS[0],
    status: b.status || 'running', env: b.env || 'prod', cost: Math.max(0, Number(b.cost) || 0) };
};
route('POST', '/api/assets', ({ user, body }) => {
  const a = { id: uid('ast_'), ...cleanAsset(body), createdAt: new Date().toISOString() };
  db.assets.unshift(a); log(user, 'Added asset', a.name); save();
  return a;
});
route('PUT', '/api/assets/:id', ({ user, params, body }) => {
  const a = db.assets.find((x) => x.id === params.id) || fail(404, 'Asset not found');
  Object.assign(a, cleanAsset({ ...a, ...body })); log(user, 'Updated asset', a.name); save();
  return a;
});
route('DELETE', '/api/assets/:id', ({ user, params }) => {
  const a = db.assets.find((x) => x.id === params.id) || fail(404, 'Asset not found');
  db.assets = db.assets.filter((x) => x !== a);
  db.findings = db.findings.filter((f) => f.assetId !== a.id);
  log(user, 'Deleted asset', a.name); save();
  return { ok: true };
});

// security, alerts, logs
route('GET', '/api/findings', ({ query }) => {
  const items = scope(db.findings, query).map((f) => ({ ...f, accountName: accName(f.accountId) }));
  return { score: complianceScore(items), items };
});
route('PUT', '/api/findings/:id', ({ user, params, body }) => {
  const f = db.findings.find((x) => x.id === params.id) || fail(404, 'Finding not found');
  f.status = body.status === 'open' ? 'open' : 'resolved';
  log(user, f.status === 'resolved' ? 'Resolved finding' : 'Reopened finding', f.title); save();
  return f;
});
route('GET', '/api/alerts', () => ({ items: db.alerts, unread: db.alerts.filter((a) => !a.read).length }));
route('PUT', '/api/alerts/read-all', () => { db.alerts.forEach((a) => (a.read = true)); save(); return { ok: true }; });
route('PUT', '/api/alerts/:id/read', ({ params }) => {
  const a = db.alerts.find((x) => x.id === params.id) || fail(404, 'Alert not found');
  a.read = true; save(); return a;
});
route('GET', '/api/logs', () => ({ items: db.logs.slice(0, 200) }));

// reports
const REPORTS = {
  inventory: () => [['Name', 'Type', 'Account', 'Region', 'Status', 'Environment', 'Monthly cost (USD)'],
    ...db.assets.map((a) => [a.name, a.type, accName(a.accountId), a.region, a.status, a.env, a.cost])],
  security: () => [['Finding', 'Severity', 'Asset', 'Account', 'Region', 'Status'],
    ...db.findings.map((f) => [f.title, f.severity, f.assetName, accName(f.accountId), f.region, f.status])],
  unused: () => [['Name', 'Type', 'Account', 'Region', 'Status', 'Monthly cost (USD)'],
    ...db.assets.filter((a) => a.status !== 'running').map((a) => [a.name, a.type, accName(a.accountId), a.region, a.status, a.cost])],
  cost: () => [['Account', 'Service', 'Assets', 'Monthly cost (USD)'],
    ...db.accounts.flatMap((acc) => TYPES.map((t) => {
      const l = db.assets.filter((a) => a.accountId === acc.id && a.type === t);
      return [acc.name, t, l.length, l.reduce((s, a) => s + a.cost, 0).toFixed(2)];
    }).filter((r) => r[2] > 0))],
  changes: () => [['Time', 'User', 'Action', 'Target'], ...db.logs.map((l) => [l.time, l.user, l.action, l.target])],
};
route('GET', '/api/reports', () => ({ generated: db.reports }));
route('POST', '/api/reports/:type/generate', ({ user, params }) => {
  if (!REPORTS[params.type]) fail(404, 'Unknown report');
  db.reports[params.type] = new Date().toISOString(); log(user, 'Generated report', params.type); save();
  return { generated: db.reports[params.type] };
});
route('GET', '/api/reports/:type/download', ({ params }) => {
  if (!REPORTS[params.type]) fail(404, 'Unknown report');
  return { csv: csv(REPORTS[params.type]()), filename: `${params.type}-report.csv` };
});

// settings
route('PUT', '/api/settings', ({ user, body }) => {
  if (body.name) user.name = body.name;
  if (body.password) {
    if (body.password.length < 6) fail(400, 'Password must be at least 6 characters');
    user.password = hash(body.password);
  }
  if (['light', 'dark'].includes(body.theme)) user.settings.theme = body.theme;
  if (body.defaultRegion) user.settings.defaultRegion = body.defaultRegion;
  if (typeof body.emailAlerts === 'boolean') user.settings.emailAlerts = body.emailAlerts;
  log(user, 'Updated settings', user.email); save();
  return { user: publicUser(user) };
});

// ---------- http server ----------
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
const send = (res, status, data) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
};
function serveStatic(res, pathname) {
  let file = path.normalize(path.join(PUB, pathname === '/' ? 'index.html' : pathname));
  if (!file.startsWith(PUB) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(PUB, 'index.html');
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}

load();
http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (!url.pathname.startsWith('/api/')) return serveStatic(res, decodeURIComponent(url.pathname));
  let raw = '';
  req.on('data', (c) => { raw += c; if (raw.length > 1e6) req.destroy(); });
  req.on('end', () => {
    try {
      let match, r;
      for (const x of routes) {
        if (x.method !== req.method) continue;
        const m = x.re.exec(url.pathname);
        if (m) { r = x; match = m; break; }
      }
      if (!r) fail(404, 'Not found');
      const token = (req.headers.authorization || '').replace('Bearer ', '');
      const user = db.users.find((u) => u.id === db.sessions[token]);
      if (r.auth && !user) fail(401, 'Please sign in');
      let body = {};
      if (raw) { try { body = JSON.parse(raw); } catch { fail(400, 'Invalid JSON'); } }
      const out = r.fn({ user, token, params: { ...match.groups }, query: Object.fromEntries(url.searchParams), body });
      if (out && out.csv !== undefined) {
        res.writeHead(200, { 'Content-Type': 'text/csv', 'Content-Disposition': `attachment; filename="${out.filename}"` });
        return res.end(out.csv);
      }
      send(res, 200, out);
    } catch (e) {
      if (!e.status) console.error(e);
      send(res, e.status || 500, { error: e.msg || 'Server error' });
    }
  });
}).listen(PORT, () => console.log(`Cloud Asset Inventory running at http://localhost:${PORT}`));
