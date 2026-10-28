// Данные компании по ИНН с orginfo.uz: страницы организаций открыты для ботов (robots.txt),
// но браузер не даст странице приложения прочитать их напрямую (нет CORS) — поэтому через эту функцию.
// GET /api/inn?tin=313431801 → {found, tin, name, fullName}

const BASE = 'https://orginfo.uz';
const HEADERS = { 'User-Agent': 'restoran-eda-app/1.0 (+https://restoran-eda-app.vercel.app)', 'Accept-Language': 'ru' };

const clean = s => String(s || '').replace(/<[^>]+>/g, ' ').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

// значение строки таблицы «подпись → значение» на странице организации
function row(html, label) {
  const i = html.indexOf('<span>' + label + '</span>');
  if (i < 0) return '';
  const m = html.slice(i, i + 1500).match(/<div class="col-6">([\s\S]*?)<\/div>/);
  return m ? clean(m[1]) : '';
}

function parseOrg(html, tin) {
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  for (const b of blocks) {
    let data; try { data = JSON.parse(b[1]); } catch (e) { continue; }
    for (const x of [].concat(data)) {
      const o = x && (x.mainEntity || (x['@type'] === 'Organization' ? x : null));
      if (!o || String(o.taxID) !== tin) continue;
      const a = o.address || {}, id = (o.identifier || []).find(v => /Registration/i.test(v.propertyID || ''));
      return {
        found: true, tin,
        name: o.alternateName || o.name || '', fullName: o.name || '',
        regNumber: id ? String(id.value) : '',
        status: row(html, 'Статус'), oked: row(html, 'ОКЭД'),
        address: [a.addressLocality, a.streetAddress].filter(Boolean).join(', '),
        director: o.employee && o.employee.name ? o.employee.name : '',
        founders: [].concat(o.founder || []).map(f => f && f.name).filter(Boolean),
        phone: o.telephone || '', email: o.email || '', url: o.url || ''
      };
    }
  }
  return null;
}

function orgLinks(html) {
  return [...new Set([...html.matchAll(/href="(\/ru\/organization\/[0-9a-f]+\/)"/g)].map(m => m[1]))];
}

async function lookup(tin) {
  const s = await fetch(`${BASE}/ru/search/all/?q=${tin}`, { headers: HEADERS });
  if (!s.ok) throw new Error('orginfo search ' + s.status);
  for (const link of orgLinks(await s.text()).slice(0, 5)) {
    const r = await fetch(BASE + link, { headers: HEADERS });
    if (!r.ok) continue;
    const org = parseOrg(await r.text(), tin);
    if (org) return { found: true, tin, name: org.name, fullName: org.fullName }; // форме нужно только юридическое название
  }
  return { found: false, tin };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*'); // форма может быть открыта и файлом с компьютера
  const tin = String((req.query && req.query.tin) || '').replace(/\D/g, '');
  if (!/^(\d{9}|\d{14})$/.test(tin)) { res.status(400).json({ error: 'ИНН — 9 цифр, ПИНФЛ — 14 цифр' }); return; }
  try {
    const out = await lookup(tin);
    res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800');
    res.status(200).json(out);
  } catch (e) {
    res.status(502).json({ error: 'Сервис orginfo.uz не ответил', detail: String(e.message || e) });
  }
};
module.exports.parseOrg = parseOrg;
module.exports.orgLinks = orgLinks;
