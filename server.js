import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  getDB, updateDB, findUserByEmail, upsertUser,
  listCards, createCard, updateCard, deleteCard
} from './db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

app.use(helmet({
  crossOriginResourcePolicy: { policy: 'same-site' }
}));
app.use(express.json({ limit: '200kb' }));
app.use(cookieParser());

// Rate limit básico
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false
});

// Seed de usuário admin (se não existir)
async function ensureAdmin(){
  const email = process.env.ADMIN_EMAIL || 'admin@local';
  const password = process.env.ADMIN_PASSWORD || 'admin123';
  const existing = await findUserByEmail(email);
  if(!existing){
    const passwordHash = await bcrypt.hash(password, 12);
    await upsertUser({ id: 'u1', email, passwordHash, role: 'admin', createdAt: new Date().toISOString() });
    console.log(`Usuário admin criado => ${email}`);
  }
}
ensureAdmin();

// CSRF simples: emitir token por sessão e validar em métodos state-changing
function generateCsrf(){
  return Buffer.from(cryptoRandom(24)).toString('base64url');
}
function cryptoRandom(len){
  const arr = new Uint8Array(len);
  for (let i=0;i<len;i++) arr[i] = Math.floor(Math.random()*256);
  return arr;
}

function authMiddleware(req, res, next){
  const token = req.cookies['token'];
  if(!token) return res.status(401).json({ error: 'Não autenticado' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    return next();
  } catch(e){
    return res.status(401).json({ error: 'Token inválido' });
  }
}

function requireCsrf(req, res, next){
  const method = req.method;
  const needs = ['POST','PUT','PATCH','DELETE'].includes(method);
  if(!needs) return next();
  const header = req.get('X-CSRF-Token');
  const cookie = req.cookies['csrf'];
  if(!header || !cookie || header !== cookie){
    return res.status(403).json({ error: 'Falha CSRF' });
  }
  next();
}

// Login
app.post('/api/login', authLimiter, async (req, res) => {
  const { email, password } = req.body || {};
  if(!email || !password) return res.status(400).json({ error: 'Credenciais obrigatórias' });
  const user = await findUserByEmail(email);
  if(!user) return res.status(401).json({ error: 'Credenciais inválidas' });
  const ok = await bcrypt.compare(password, user.passwordHash);
  if(!ok) return res.status(401).json({ error: 'Credenciais inválidas' });

  const csrf = generateCsrf();
  const token = jwt.sign({ sub: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '2h' });

  const cookieOpts = {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 2 * 60 * 60 * 1000
  };
  res.cookie('token', token, cookieOpts);
  res.cookie('csrf', csrf, { sameSite: 'strict', secure: cookieOpts.secure, maxAge: cookieOpts.maxAge });
  res.json({ ok: true });
});

app.post('/api/logout', authMiddleware, (req, res) => {
  res.clearCookie('token');
  res.clearCookie('csrf');
  res.json({ ok: true });
});

app.get('/api/me', authMiddleware, (req, res) => {
  res.json({ user: { email: req.user.email, role: req.user.role } });
});

// CRUD de Cards
app.get('/api/cards', authMiddleware, async (req, res) => {
  const cards = await listCards();
  res.json({ cards });
});

app.post('/api/cards', authMiddleware, requireCsrf, async (req, res) => {
  const body = req.body || {};
  const now = new Date().toISOString();
  const id = 'c_' + Math.random().toString(36).slice(2);
  const card = {
    id,
    createdAt: now,
    updatedAt: now,
    // Campos do requisito
    isGestante: !!body.isGestante,
    childrenNames: Array.isArray(body.childrenNames) ? body.childrenNames.filter(Boolean) : [],
    responsibleNames: Array.isArray(body.responsibleNames) ? body.responsibleNames.filter(Boolean) : [],
    ageYears: Number(body.ageYears || 0),
    ageMonths: Number(body.ageMonths || 0),
    address: String(body.address || ''),
    contactInfo: String(body.contactInfo || ''),
    cpf: String(body.cpf || '')
  };
  await createCard(card);
  res.status(201).json({ card });
});

app.put('/api/cards/:id', authMiddleware, requireCsrf, async (req, res) => {
  const id = req.params.id;
  const patch = req.body || {};
  if(patch.childrenNames && !Array.isArray(patch.childrenNames)) return res.status(400).json({ error: 'childrenNames deve ser array' });
  if(patch.responsibleNames && !Array.isArray(patch.responsibleNames)) return res.status(400).json({ error: 'responsibleNames deve ser array' });
  try {
    const db = await updateCard(id, patch);
    const card = db.cards.find(c => c.id === id);
    res.json({ card });
  } catch(e){
    res.status(404).json({ error: e.message });
  }
});

app.delete('/api/cards/:id', authMiddleware, requireCsrf, async (req, res) => {
  const id = req.params.id;
  try {
    await deleteCard(id);
    res.json({ ok: true });
  } catch(e){
    res.status(404).json({ error: e.message });
  }
});

// Servir front-end
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => console.log(`Servidor em http://localhost:${PORT}`));