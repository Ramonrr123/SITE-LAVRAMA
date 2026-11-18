const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  Object.entries(cors).forEach(([k, v]) => res.setHeader(k, v));
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function clean(s, max) {
  return String(s || '')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .trim()
    .slice(0, max);
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    Object.entries(cors).forEach(([k, v]) => res.setHeader(k, v));
    res.statusCode = 204;
    return res.end();
  }
  if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method_not_allowed' });

  const key = process.env.RESEND_API_KEY;
  if (!key) return json(res, 500, { ok: false, error: 'missing_api_key' });

  let data;
  try {
    data = await readBody(req);
  } catch {
    return json(res, 400, { ok: false, error: 'invalid_json' });
  }

  const nome = clean(data.nome, 120);
  const empresa = clean(data.empresa, 120);
  const email = clean(data.email, 160).toLowerCase();
  const tel = clean(data.tel, 60);
  const produto = clean(data.produto, 120);
  const msg = clean(data.msg, 4000);

  if (!nome || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json(res, 400, { ok: false, error: 'validation' });
  }

  const to = process.env.CONTACT_TO_SALES || 'ramon@lavrasul.com.br';
  const from = process.env.RESEND_FROM || 'Lavrama <noreply@lavrama.com.br>';
  const text = [
    `Nome: ${nome}`,
    `Empresa: ${empresa || '—'}`,
    `E-mail: ${email}`,
    `Telefone: ${tel || '—'}`,
    `Produto: ${produto || '—'}`,
    '',
    msg || '(sem mensagem)',
  ].join('\n');

  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [to],
      reply_to: email,
      subject: `Pedido de orçamento: ${produto || 'Lavrama'} — ${nome}`,
      text,
    }),
  });

  const payload = await r.json().catch(() => ({}));
  if (!r.ok) {
    return json(res, 502, {
      ok: false,
      error: 'resend_failed',
      detail: payload.message || payload.name || 'send_error',
    });
  }
  return json(res, 200, { ok: true, id: payload.id || null });
};
