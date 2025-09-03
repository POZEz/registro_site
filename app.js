const qs = s => document.querySelector(s);
const qsa = s => Array.from(document.querySelectorAll(s));

async function api(path, opts={}){
  const r = await fetch(path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(opts.headers||{}) },
    ...opts
  });
  if(!r.ok){
    const data = await r.json().catch(()=>({error:'Erro'}));
    throw new Error(data.error || r.statusText);
  }
  return r.json();
}

function toggleLogin(showLogin){
  qs('#view-login').classList.toggle('hidden', !showLogin);
  qs('#view-dashboard').classList.toggle('hidden', showLogin);
}

async function checkAuth(){
  try {
    const { user } = await api('/api/me');
    qs('#user-email').textContent = user.email;
    toggleLogin(false);
    await refreshCards();
  } catch { toggleLogin(true); }
}

function collectArrayInputs(baseSelector){
  return qsa(baseSelector).map(i => i.value.trim()).filter(Boolean);
}

function buildCardElement(card){
  const el = document.createElement('div');
  el.className = 'card card-item';
  el.innerHTML = `
    <div class="card-header" data-id="${card.id}">
      <div>
        <span class="card-title">${card.isGestante ? 'Gestante' : (card.childrenNames[0] || 'Sem nome')}</span>
        <span class="badge">${card.ageYears||0}a ${card.ageMonths||0}m</span>
      </div>
      <div class="card-actions">
        <button class="secondary btn-edit">Editar</button>
        <button class="danger btn-del">Excluir</button>
      </div>
    </div>
    <div class="card-body" id="body-${card.id}">
      <p><strong>Crianças:</strong> ${card.childrenNames.join(', ') || '—'}</p>
      <p><strong>Responsáveis:</strong> ${card.responsibleNames.join(', ') || '—'}</p>
      <p><strong>Endereço:</strong> ${card.address || '—'}</p>
      <p><strong>Contato:</strong> ${card.contactInfo || '—'}</p>
      <p><strong>CPF:</strong> ${card.cpf || '—'}</p>
      <p class="hint">Atualizado: ${new Date(card.updatedAt).toLocaleString()}</p>
    </div>
  `;
  // expand/collapse
  el.querySelector('.card-header').addEventListener('click', (e) => {
    if(e.target.closest('button')) return; // não expandir ao clicar nos botões
    qs('#body-'+card.id).classList.toggle('show');
  });
  // editar
  el.querySelector('.btn-edit').addEventListener('click', async () => {
    const children = prompt('Nomes das crianças (separe por vírgula):', card.childrenNames.join(', '));
    const resp = prompt('Nomes dos responsáveis (separe por vírgula):', card.responsibleNames.join(', '));
    const years = prompt('Idade (anos):', card.ageYears);
    const months = prompt('Idade (meses 0-11):', card.ageMonths);
    const address = prompt('Endereço completo:', card.address);
    const contact = prompt('Contato:', card.contactInfo);
    const cpf = prompt('CPF:', card.cpf);
    try {
      const csrf = getCsrf();
      const { card: updated } = await api('/api/cards/'+card.id, {
        method: 'PUT',
        headers: { 'X-CSRF-Token': csrf },
        body: JSON.stringify({
          childrenNames: (children||'').split(',').map(s=>s.trim()).filter(Boolean),
          responsibleNames: (resp||'').split(',').map(s=>s.trim()).filter(Boolean),
          ageYears: Number(years||0),
          ageMonths: Number(months||0),
          address, contactInfo: contact, cpf
        })
      });
      await refreshCards();
    } catch(err){ alert(err.message); }
  });
  // excluir
  el.querySelector('.btn-del').addEventListener('click', async () => {
    if(!confirm('Excluir este card?')) return;
    try {
      const csrf = getCsrf();
      await api('/api/cards/'+card.id, { method: 'DELETE', headers: { 'X-CSRF-Token': csrf } });
      await refreshCards();
    } catch(err){ alert(err.message); }
  });
  return el;
}

async function refreshCards(){
  const holder = qs('#cards');
  holder.innerHTML = '';
  try {
    const { cards } = await api('/api/cards');
    cards.sort((a,b)=> new Date(b.updatedAt) - new Date(a.updatedAt));
    if(cards.length === 0){
      const empty = document.createElement('p');
      empty.className = 'hint';
      empty.textContent = 'Nenhum acompanhamento cadastrado ainda.';
      holder.appendChild(empty);
    } else {
      cards.forEach(c => holder.appendChild(buildCardElement(c)));
    }
  } catch(err){ holder.innerHTML = `<p class="error">${err.message}</p>`; }
}

function getCsrf(){
  const cookies = document.cookie.split(';').map(v=>v.trim());
  const pair = cookies.find(c => c.startsWith('csrf='));
  return pair ? decodeURIComponent(pair.split('=')[1]) : '';
}

// Login
qs('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  qs('#login-error').textContent = '';
  const fd = new FormData(e.currentTarget);
  const email = fd.get('email');
  const password = fd.get('password');
  try {
    await api('/api/login', { method: 'POST', body: JSON.stringify({ email, password }) });
    await checkAuth();
  } catch(err){ qs('#login-error').textContent = err.message; }
});

// Logout
qs('#btn-logout').addEventListener('click', async () => {
  try { await api('/api/logout', { method: 'POST' }); } catch {}
  toggleLogin(true);
});

// Form de criação
qs('#isGestante').addEventListener('change', (e) => {
  qs('#children-section').style.display = e.target.checked ? 'none' : 'block';
});

qs('#add-child').addEventListener('click', () => {
  const wrap = qs('#more-children');
  const inp = document.createElement('input');
  inp.type = 'text';
  inp.placeholder = 'Nome da outra criança';
  inp.className = 'child-name';
  wrap.appendChild(inp);
});

qs('#add-resp').addEventListener('click', () => {
  const wrap = qs('#more-resp');
  const inp = document.createElement('input');
  inp.type = 'text';
  inp.placeholder = 'Outro responsável';
  wrap.appendChild(inp);
});

qs('#create-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  qs('#create-error').textContent = '';
  const isGestante = qs('#isGestante').checked;
  const childrenNames = isGestante ? [] : collectArrayInputs('.child-name');
  const responsibleNames = [qs('#responsible-0').value.trim(), ...collectArrayInputs('#more-resp input')].filter(Boolean);
  const ageYears = Number(qs('#ageYears').value || 0);
  const ageMonths = Number(qs('#ageMonths').value || 0);
  const address = qs('#address').value.trim();
  const contactInfo = qs('#contactInfo').value.trim();
  const cpf = qs('#cpf').value.trim();

  if(!isGestante && childrenNames.length === 0){
    qs('#create-error').textContent = 'Informe ao menos uma criança ou marque Gestante.';
    return;
  }
  try {
    const csrf = getCsrf();
    await api('/api/cards', {
      method: 'POST',
      headers: { 'X-CSRF-Token': csrf },
      body: JSON.stringify({ isGestante, childrenNames, responsibleNames, ageYears, ageMonths, address, contactInfo, cpf })
    });
    e.currentTarget.reset();
    qs('#children-section').style.display = isGestante ? 'none' : 'block';
    qs('#more-children').innerHTML = '';
    qs('#more-resp').innerHTML = '';
    await refreshCards();
  } catch(err){ qs('#create-error').textContent = err.message; }
});

// Inicialização
checkAuth();