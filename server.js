const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const db = new Database(process.env.DB_PATH || path.join(__dirname, 'appointments.db'));

db.pragma('journal_mode = WAL');
db.exec(`CREATE TABLE IF NOT EXISTS appointments (
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

app.use(express.json({limit:'1mb'}));
app.use(express.static(path.join(__dirname,'public')));

const norm = v => String(v ?? '').trim().replace(/\s+/g,' ');
const passportOk = v => /^A\d{8}$/i.test(norm(v));
const phoneOk = v => /^01\d{9}$/.test(norm(v));
const ticketOk = v => /^mc\d{11}$/i.test(norm(v));
function ticket(){
  let t;
  do { t='mc'+crypto.randomInt(10000000000,100000000000); }
  while(db.prepare('SELECT 1 FROM appointments WHERE ticket=?').get(t));
  return t;
}
function row(q){return db.prepare(`SELECT * FROM appointments WHERE passport=@q OR phone=@q OR ticket=@t`).get({q:q.toUpperCase(),t:q.toLowerCase()});}

app.post('/api/appointments', (req,res)=>{
  const x=req.body||{};
  const name=norm(x.name), passport=norm(x.passport).toUpperCase(), phone=norm(x.phone);
  if(name.length<3) return res.status(400).json({error:'يرجى كتابة الاسم بشكل صحيح.'});
  if(!passportOk(passport)) return res.status(400).json({error:'رقم الجواز غير صحيح. يجب أن يبدأ بحرف A ويتبعه 8 أرقام.'});
  if(!phoneOk(phone)) return res.status(400).json({error:'رقم الهاتف غير صحيح. يجب أن يتكون من 11 رقمًا ويبدأ بـ 01.'});
  if(x.booking_date && x.exam_date && x.exam_date < x.booking_date) return res.status(400).json({error:'تاريخ الكشف لا يمكن أن يكون قبل تاريخ الحجز.'});
  const dup=db.prepare('SELECT 1 FROM appointments WHERE passport=? OR phone=?').get(passport,phone);
  if(dup) return res.status(409).json({error:'لا يمكن التسجيل مرة أخرى بنفس رقم الجواز أو رقم الهاتف.'});
  const data={id:crypto.randomUUID(),ticket:ticket(),name,passport,phone,booking_date:norm(x.booking_date),exam_date:norm(x.exam_date),payment:2500,exam_place:'حميات العباسية',governorate:'القاهرة',destination:'الأردن',status:'محجوز',created_at:new Date().toISOString()};
  db.prepare(`INSERT INTO appointments (id,ticket,name,passport,phone,booking_date,exam_date,payment,exam_place,governorate,destination,status,created_at)
    VALUES (@id,@ticket,@name,@passport,@phone,@booking_date,@exam_date,@payment,@exam_place,@governorate,@destination,@status,@created_at)`).run(data);
  res.status(201).json(data);
});

app.get('/api/appointments/search',(req,res)=>{
  const q=norm(req.query.q);
  if(!q) return res.status(400).json({error:'أدخل رقم الجواز أو الهاتف أو رقم التذكرة.'});
  if(/^[a-zA-Z]/.test(q) && !passportOk(q) && !ticketOk(q)) return res.status(400).json({error:'البيانات المدخلة غير صحيحة.'});
  if(/^A/i.test(q) && !passportOk(q)) return res.status(400).json({error:'رقم الجواز غير صحيح. يجب أن يبدأ بحرف A ويتبعه 8 أرقام.'});
  if(/^MC/i.test(q) && !ticketOk(q)) return res.status(400).json({error:'رقم التذكرة غير صحيح. يجب أن يبدأ بـ mc ويتبعه 11 رقمًا.'});
  if(/^\d+$/.test(q) && !phoneOk(q)) return res.status(400).json({error:'رقم الهاتف غير صحيح. يجب أن يتكون من 11 رقمًا ويبدأ بـ 01.'});
  const x=row(q);
  if(!x) return res.status(404).json({error:'البيانات غير صحيحة أو لا يوجد حجز مطابق.'});
  res.json(x);
});

app.get('/api/health',(req,res)=>res.json({ok:true,service:'appointment-portal'}));
app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
app.listen(PORT,()=>console.log(`Appointment portal running on port ${PORT}`));
