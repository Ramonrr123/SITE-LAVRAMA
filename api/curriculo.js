const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const MAX_BYTES = 2 * 1024 * 1024;
const OK_EXT = /\.(docx?|rtf|odt|pdf)$/i;

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  Object.entries(cors).forEach(([k, v]) => res.setHeader(k, v));
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BYTES + 200000) {
        reject(Object.assign(new Error('too_large'), { code: 'too_large' }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
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
  } catch (e) {
    if (e && e.code === 'too_large') return json(res, 413, { ok: false, error: 'file_too_large' });
    return json(res, 400, { ok: false, error: 'invalid_json' });
  }

  const nome = clean(data.nome, 120);
  const email = clean(data.email, 160).toLowerCase();
  const tel = clean(data.tel, 60);
  const area = clean(data.area, 80);
  const msg = clean(data.msg, 4000);
  const aceite = !!data.aceite;
  const file = data.file || {};
  const filename = clean(file.filename || file.name, 180);
  const content = String(file.content || '').replace(/\s+/g, '');

  if (!nome || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !aceite) {
    return json(res, 400, { ok: false, error: 'validation' });
  }
  if (!filename || !OK_EXT.test(filename) || !content) {
    return json(res, 400, { ok: false, error: 'file_required' });
  }

  let bytes;
  try {
    bytes = Buffer.from(content, 'base64');
  } catch {
    return json(res, 400, { ok: false, error: 'file_invalid' });
  }
  if (!bytes.length || bytes.length > MAX_BYTES) {
    return json(res, 413, { ok: false, error: 'file_too_large' });
  }

  const to = process.env.CONTACT_TO_RH || 'ramon@lavrasul.com.br';
  const from = process.env.RESEND_FROM || 'Lavrama <noreply@lavrasul.com.br>';
  const text = [
    `Nome: ${nome}`,
    `E-mail: ${email}`,
    `Telefone: ${tel || '—'}`,
    `Área de interesse: ${area || '—'}`,
    `Arquivo: ${filename}`,
    '',
    msg || '(sem mensagem)',
    '',
    'Aceito os termos de LGPD da Lavrama.',
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
      subject: `Currículo: ${nome} · ${area || 'Lavrama'}`,
      text,
      attachments: [
        {
          filename,
          content: bytes.toString('base64'),
        },
      ],
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
