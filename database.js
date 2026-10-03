const fs = require('fs');
const path = require('path');
const config = require('./config.json');

const DIR = config.DATA_DIR;
if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });

const FILES = {
  users: path.join(DIR, 'users.json'),
  pending: path.join(DIR, 'pending.json'),
  settings: path.join(DIR, 'settings.json')
};

function load(file) {
  if (!fs.existsSync(file)) return {};
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return {}; }
}
function save(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

// USERS
function getUser(id) {
  const users = load(FILES.users);
  if (!users[id]) {
    users[id] = {
      id,
      credit: config.INITIAL_CREDIT,
      prem: false,
      joined: Date.now(),
      lastDaily: 0,
      totalOps: 0
    };
    save(FILES.users, users);
  }
  return users[id];
}
function updateUser(id, patch) {
  const users = load(FILES.users);
  if (!users[id]) users[id] = getUser(id);
  users[id] = { ...users[id], ...patch };
  save(FILES.users, users);
  return users[id];
}
function allUsers() { return load(FILES.users); }

// PENDING ORDERS
function newPending(userId, type, amount) {
  const p = load(FILES.pending);
  const orderId = `ORD${Date.now().toString(36).toUpperCase()}`;
  p[orderId] = {
    id: orderId, userId, type, amount,
    status: 'pending', createdAt: Date.now()
  };
  save(FILES.pending, p);
  return p[orderId];
}
function getPending(orderId) {
  const p = load(FILES.pending);
  return p[orderId] || null;
}
function updatePending(orderId, patch) {
  const p = load(FILES.pending);
  if (!p[orderId]) return null;
  p[orderId] = { ...p[orderId], ...patch };
  save(FILES.pending, p);
  return p[orderId];
}
function allPending() { return load(FILES.pending); }

// SETTINGS
function getSetting(key) {
  return load(FILES.settings)[key];
}
function setSetting(key, val) {
  const s = load(FILES.settings);
  s[key] = val;
  save(FILES.settings, s);
}

module.exports = {
  getUser, updateUser, allUsers,
  newPending, getPending, updatePending, allPending,
  getSetting, setSetting
};