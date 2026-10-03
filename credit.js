const db = require('./database');
const config = require('./config.json');

const HOUR = 3600 * 1000;

// Cek user bisa pakai fitur atau ngga. Return {ok, reason}
function canUse(userId) {
  const u = db.getUser(userId);
  if (u.prem) return { ok: true, prem: true };
  if (u.credit > 0) return { ok: true, credit: u.credit };

  // Cek daily refresh
  const now = Date.now();
  const since = now - (u.lastDaily || 0);
  if (since >= config.DAILY_REFRESH_HOURS * HOUR) {
    const refreshAmount = config.INITIAL_CREDIT;
    db.updateUser(userId, { credit: refreshAmount, lastDaily: now });
    return { ok: true, credit: refreshAmount, refreshed: true };
  }

  const waitMs = config.DAILY_REFRESH_HOURS * HOUR - since;
  const waitH = Math.floor(waitMs / HOUR);
  const waitM = Math.floor((waitMs % HOUR) / 60000);
  return {
    ok: false,
    reason: `Credit habis. Refresh dalam *${waitH}j ${waitM}m* atau beli paket.`
  };
}

// Potong credit setelah operasi sukses
function deduct(userId) {
  const u = db.getUser(userId);
  if (u.prem) return { ok: true, prem: true };
  if (u.credit <= 0) return { ok: false, reason: 'Credit habis.' };
  const newCredit = u.credit - config.CREDIT_PER_OP;
  db.updateUser(userId, {
    credit: newCredit,
    totalOps: (u.totalOps || 0) + 1
  });
  return { ok: true, credit: newCredit };
}

// Tambah credit / set prem
function addCredit(userId, amount) {
  const u = db.getUser(userId);
  return db.updateUser(userId, { credit: u.credit + amount });
}
function setPrem(userId, val) {
  return db.updateUser(userId, { prem: !!val });
}

// Deteksi paket dari label
function parsePackage(key) {
  const P = config.PRICE;
  const map = {
    credit_50: { type: 'credit', amount: 50, price: P.credit_50, label: '50 Credit' },
    credit_100: { type: 'credit', amount: 100, price: P.credit_100, label: '100 Credit' },
    credit_500: { type: 'credit', amount: 500, price: P.credit_500, label: '500 Credit' },
    credit_1000: { type: 'credit', amount: 1000, price: P.credit_1000, label: '1000 Credit' },
    prem: { type: 'prem', amount: 0, price: P.prem, label: 'Permanent (Unlimited)' }
  };
  return map[key] || null;
}

function formatRp(n) { return 'Rp ' + n.toLocaleString('id-ID'); }

module.exports = { canUse, deduct, addCredit, setPrem, parsePackage, formatRp };