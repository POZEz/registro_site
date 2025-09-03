import fs from 'fs/promises';
import path from 'path';

const defaultFile = process.env.DB_FILE || './db.jsonv';

class Mutex {
  constructor(){ this.queue = []; this.locked = false; }
  async lock(){
    if(!this.locked){ this.locked = true; return; }
    return new Promise(resolve => this.queue.push(resolve));
  }
  unlock(){
    const next = this.queue.shift();
    if(next) next(); else this.locked = false;
  }
}

const mutex = new Mutex();

async function readJSON(file = defaultFile){
  const data = await fs.readFile(file, 'utf8').catch(async err => {
    if(err.code === 'ENOENT'){
      const initial = { users: [], cards: [] };
      await fs.writeFile(file, JSON.stringify(initial, null, 2));
      return JSON.stringify(initial);
    }
    throw err;
  });
  return JSON.parse(data);
}

async function writeJSON(data, file = defaultFile){
  const tmp = file + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(data, null, 2));
  await fs.rename(tmp, file); // atômico na maioria dos FS
}

export async function getDB(){
  await mutex.lock();
  try {
    return await readJSON();
  } finally {
    mutex.unlock();
  }
}

export async function updateDB(mutator){
  await mutex.lock();
  try {
    const db = await readJSON();
    const result = await mutator(db) || db;
    await writeJSON(result);
    return result;
  } finally {
    mutex.unlock();
  }
}

export async function findUserByEmail(email){
  await mutex.lock();
  try {
    const db = await readJSON();
    return db.users.find(u => u.email === email) || null;
  } finally { mutex.unlock(); }
}

export async function upsertUser(user){
  return updateDB(db => {
    const i = db.users.findIndex(u => u.email === user.email);
    if(i >= 0) db.users[i] = user; else db.users.push(user);
    return db;
  });
}

export async function listCards(){
  await mutex.lock();
  try {
    const db = await readJSON();
    return db.cards;
  } finally { mutex.unlock(); }
}

export async function createCard(card){
  return updateDB(db => {
    db.cards.push(card);
    return db;
  });
}

export async function updateCard(id, patch){
  return updateDB(db => {
    const i = db.cards.findIndex(c => c.id === id);
    if(i === -1) throw new Error('Card não encontrado');
    db.cards[i] = { ...db.cards[i], ...patch, updatedAt: new Date().toISOString() };
    return db;
  });
}

export async function deleteCard(id){
  return updateDB(db => {
    const i = db.cards.findIndex(c => c.id === id);
    if(i === -1) throw new Error('Card não encontrado');
    db.cards.splice(i,1);
    return db;
  });
}