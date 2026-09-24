const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set. Add it to Render Environment Variables.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 3
});

const norm = v => String(v ?? '').trim().replace(/\s+/g, ' ');
const passportOk = v => /^A\d{8}$/i.test(norm(v));
const phoneOk = v => /^01\d{9}$/.test(norm(v));
const ticketOk = v => /^mc\d{11}$/i.test(norm(v));

async function initDb() {
  await pool.query(`CREATE TABLE IF NOT EXISTS appointments (
    id TEXT PRIMARY KEY,
    ticket TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    passport TEXT NOT NULL UNIQUE,
    phone TEXT NOT NULL UNIQUE,
    booking_date TEXT NOT NULL,
    exam_date TEXT NOT NULL,
    payment INTEGER NOT NULL DEFAULT 2500,
    exam_place TEXT NOT NULL DEFAULT 'حميات العباسية',
    governorate TEXT NOT NULL DEFAULT 'القاهرة',
    destination TEXT NOT NULL DEFAULT 'الأردن',
    status TEXT NOT NULL DEFAULT 'محجوز',
    created_at TEXT NOT NULL
  )`);
}

async function ticket() {
  while (true) {
    const t = 'mc' + crypto.randomInt(10000000000, 100000000000);
    const result = await pool.query('SELECT 1 FROM appointments WHERE ticket = $1 LIMIT 1', [t]);
    if (result.rowCount === 0) return t;
  }
}

async function row(q) {
  const result = await pool.query(
    'SELECT * FROM appointments WHERE passport = $1 OR phone = $1 OR ticket = $2 LIMIT 1',
    [q.toUpperCase(), q.toLowerCase()]
  );
  return result.rows[0] || null;
}

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/appointments', async (req, res) => {
  try {
    const x = req.body || {};
    const name = norm(x.name);
    const passport = norm(x.passport).toUpperCase();
    const phone = norm(x.phone);

    if (name.length < 3) return res.status(400).json({ error: 'يرجى كتابة الاسم بشكل صحيح.' });
    if (!passportOk(passport)) return res.status(400).json({ error: 'رقم الجواز غير صحيح. يجب أن يبدأ بحرف A ويتبعه 8 أرقام.' });
    if (!phoneOk(phone)) return res.status(400).json({ error: 'رقم الهاتف غير صحيح. يجب أن يتكون من 11 رقمًا ويبدأ بـ 01.' });
    if (x.booking_date && x.exam_date && x.exam_date < x.booking_date) return res.status(400).json({ error: 'تاريخ الكشف لا يمكن أن يكون قبل تاريخ الحجز.' });

    const dup = await pool.query('SELECT 1 FROM appointments WHERE passport = $1 OR phone = $2 LIMIT 1', [passport, phone]);
    if (dup.rowCount) return res.status(409).json({ error: 'لا يمكن التسجيل مرة أخرى بنفس رقم الجواز أو رقم الهاتف.' });

    const data = {
      id: crypto.randomUUID(),
      ticket: await ticket(),
      name,
      passport,
      phone,
      booking_date: norm(x.booking_date),
      exam_date: norm(x.exam_date),
      payment: 2500,
      exam_place: 'حميات العباسية',
      governorate: 'القاهرة',
      destination: 'الأردن',
      status: 'محجوز',
      created_at: new Date().toISOString()
    };

    await pool.query(
      `INSERT INTO appointments
       (id,ticket,name,passport,phone,booking_date,exam_date,payment,exam_place,governorate,destination,status,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [data.id, data.ticket, data.name, data.passport, data.phone, data.booking_date, data.exam_date,
       data.payment, data.exam_place, data.governorate, data.destination, data.status, data.created_at]
    );

    res.status(201).json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'حدث خطأ في الخادم.' });
  }
});

app.get('/api/appointments/search', async (req, res) => {
  try {
    const q = norm(req.query.q);
    if (!q) return res.status(400).json({ error: 'أدخل رقم الجواز أو الهاتف أو رقم التذكرة.' });
    if (/^[a-zA-Z]/.test(q) && !passportOk(q) && !ticketOk(q)) return res.status(400).json({ error: 'البيانات المدخلة غير صحيحة.' });
    if (/^A/i.test(q) && !passportOk(q)) return res.status(400).json({ error: 'رقم الجواز غير صحيح. يجب أن يبدأ بحرف A ويتبعه 8 أرقام.' });
    if (/^MC/i.test(q) && !ticketOk(q)) return res.status(400).json({ error: 'رقم التذكرة غير صحيح. يجب أن يبدأ بـ mc ويتبعه 11 رقمًا.' });
    if (/^\d+$/.test(q) && !phoneOk(q)) return res.status(400).json({ error: 'رقم الهاتف غير صحيح. يجب أن يتكون من 11 رقمًا ويبدأ بـ 01.' });

    const x = await row(q);
    if (!x) return res.status(404).json({ error: 'البيانات غير صحيحة أو لا يوجد حجز مطابق.' });
    res.json(x);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'حدث خطأ في الخادم.' });
  }
});

app.get('/api/health', (req, res) => res.json({ ok: true, service: 'appointment-portal' }));
app.get('*splat', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

initDb()
  .then(() => {
    app.listen(PORT, '0.0.0.0', () => console.log(`Appointment portal running on port ${PORT}`));
  })
  .catch(err => {
    console.error('Database initialization failed:', err);
    process.exit(1);
  });
