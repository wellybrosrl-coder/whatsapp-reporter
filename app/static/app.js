/* iPratico Reporter — frontend SPA */
'use strict';

// ---------- State ----------
let token = localStorage.getItem('token') || null;
let settings = {};
let qrPollTimer = null;

// ---------- API ----------
async function api(method, path, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (token) opts.headers['Authorization'] = `Bearer ${token}`;
  if (body !== undefined) opts.body = JSON.stringify(body);
  const r = await fetch(path, opts);
  if (r.status === 401) { logout(); return null; }
  const json = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(json.detail || `HTTP ${r.status}`);
  return json;
}

// ---------- Auth ----------
function logout() {
  token = null;
  localStorage.removeItem('token');
  showScreen('auth');
}

document.getElementById('btn-logout').addEventListener('click', logout);

// Auth tabs
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`form-${btn.dataset.tab}`).classList.add('active');
  });
});

document.getElementById('form-login').addEventListener('submit', async e => {
  e.preventDefault();
  const err = document.getElementById('login-error');
  err.textContent = '';
  try {
    const data = await api('POST', '/auth/login', {
      email: document.getElementById('login-email').value,
      password: document.getElementById('login-password').value,
    });
    if (!data) return;
    token = data.access_token;
    localStorage.setItem('token', token);
    await initApp();
  } catch (ex) {
    err.textContent = ex.message;
  }
});

document.getElementById('form-register').addEventListener('submit', async e => {
  e.preventDefault();
  const err = document.getElementById('reg-error');
  err.textContent = '';
  try {
    const data = await api('POST', '/auth/register', {
      email: document.getElementById('reg-email').value,
      password: document.getElementById('reg-password').value,
    });
    if (!data) return;
    token = data.access_token;
    localStorage.setItem('token', token);
    await initApp();
  } catch (ex) {
    err.textContent = ex.message;
  }
});

// ---------- Navigation ----------
function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
  document.getElementById(`screen-${name}`).classList.remove('hidden');
}

function showPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
  document.getElementById(`page-${name}`).classList.add('active');
  document.querySelector(`.nav-link[data-page="${name}"]`).classList.add('active');
}

document.querySelectorAll('.nav-link').forEach(link => {
  link.addEventListener('click', () => {
    const page = link.dataset.page;
    showPage(page);
    if (page === 'dashboard') refreshDashboard();
    if (page === 'whatsapp') populateWAForm();
    if (page === 'ipratico') populateIPForm();
    if (page === 'schedule') populateScheduleForm();
  });
});

// ---------- Init ----------
async function initApp() {
  showScreen('app');
  try {
    settings = await api('GET', '/api/settings') || {};
  } catch { settings = {}; }
  showPage('dashboard');
  refreshDashboard();
}

// ---------- Dashboard ----------
async function refreshDashboard() {
  // WhatsApp status
  const waEl = document.getElementById('dash-wa-status');
  try {
    const data = await api('GET', '/api/whatsapp/status');
    if (!data) return;
    const state = data.stateInstance || data.state || 'unknown';
    if (state === 'authorized') {
      waEl.textContent = 'Connesso ✓';
      waEl.className = 'badge badge-green';
    } else if (state === 'notAuthorized') {
      waEl.textContent = 'Non connesso';
      waEl.className = 'badge badge-red';
    } else {
      waEl.textContent = state;
      waEl.className = 'badge badge-yellow';
    }
  } catch {
    waEl.textContent = 'Non configurato';
    waEl.className = 'badge badge-gray';
  }

  // Schedule
  const schedEl = document.getElementById('dash-schedule');
  settings = await api('GET', '/api/settings') || settings;
  if (settings.is_active) {
    schedEl.textContent = `Attivo — ${settings.send_time} (${settings.timezone})`;
    schedEl.className = 'badge badge-green';
  } else {
    schedEl.textContent = 'Disattivo';
    schedEl.className = 'badge badge-gray';
  }
}

document.getElementById('btn-preview').addEventListener('click', async () => {
  const box = document.getElementById('preview-box');
  const fb = document.getElementById('dash-feedback');
  box.classList.add('hidden');
  fb.textContent = 'Caricamento...';
  fb.className = 'feedback';
  try {
    const data = await api('POST', '/api/report/preview');
    if (!data) return;
    box.textContent = data.messages.join('\n\n---\n\n');
    box.classList.remove('hidden');
    fb.textContent = '';
  } catch (ex) {
    fb.textContent = '✗ ' + ex.message;
    fb.className = 'feedback err';
  }
});

document.getElementById('btn-send-now').addEventListener('click', async () => {
  const fb = document.getElementById('dash-feedback');
  if (!confirm('Inviare i messaggi ora?')) return;
  fb.textContent = 'Invio in corso...';
  fb.className = 'feedback';
  try {
    const data = await api('POST', '/api/report/send-now');
    if (!data) return;
    fb.textContent = `✓ Inviati ${data.sent} messaggi`;
    fb.className = 'feedback ok';
  } catch (ex) {
    fb.textContent = '✗ ' + ex.message;
    fb.className = 'feedback err';
  }
});

// ---------- iPratico page ----------
function populateIPForm() {
  document.getElementById('ip-email').value = settings.ipratico_email || '';
  document.getElementById('ip-channel').value = settings.ipratico_channel || 'lct_20572';
}

document.getElementById('form-ipratico').addEventListener('submit', async e => {
  e.preventDefault();
  const fb = document.getElementById('ip-feedback');
  fb.textContent = 'Salvataggio...';
  fb.className = 'feedback';
  const body = { ipratico_email: document.getElementById('ip-email').value, ipratico_channel: document.getElementById('ip-channel').value };
  const pw = document.getElementById('ip-password').value;
  if (pw) body.ipratico_password = pw;
  try {
    settings = await api('PUT', '/api/settings', body) || settings;
    fb.textContent = '✓ Salvato';
    fb.className = 'feedback ok';
    document.getElementById('ip-password').value = '';
  } catch (ex) {
    fb.textContent = '✗ ' + ex.message;
    fb.className = 'feedback err';
  }
});

document.getElementById('btn-test-ipratico').addEventListener('click', async () => {
  const fb = document.getElementById('ip-feedback');
  fb.textContent = 'Test in corso...';
  fb.className = 'feedback';
  try {
    await api('POST', '/api/ipratico/test');
    fb.textContent = '✓ Connessione riuscita';
    fb.className = 'feedback ok';
  } catch (ex) {
    fb.textContent = '✗ ' + ex.message;
    fb.className = 'feedback err';
  }
});

// ---------- WhatsApp page ----------
function populateWAForm() {
  document.getElementById('wa-instance').value = settings.greenapi_id_instance || '';
  document.getElementById('wa-url').value = settings.greenapi_api_url || 'https://7107.api.greenapi.com';
  if (settings.greenapi_chat_id) {
    document.getElementById('current-chat').textContent =
      `Chat attuale: ${settings.greenapi_chat_name || settings.greenapi_chat_id}`;
  }
}

document.getElementById('form-whatsapp-creds').addEventListener('submit', async e => {
  e.preventDefault();
  const fb = document.getElementById('wa-creds-feedback');
  fb.textContent = 'Salvataggio...';
  fb.className = 'feedback';
  const body = {
    greenapi_id_instance: document.getElementById('wa-instance').value,
    greenapi_api_url: document.getElementById('wa-url').value,
  };
  const tok = document.getElementById('wa-token').value;
  if (tok) body.greenapi_api_token = tok;
  try {
    settings = await api('PUT', '/api/settings', body) || settings;
    fb.textContent = '✓ Salvato';
    fb.className = 'feedback ok';
    document.getElementById('wa-token').value = '';
    startQRFlow();
  } catch (ex) {
    fb.textContent = '✗ ' + ex.message;
    fb.className = 'feedback err';
  }
});

async function startQRFlow() {
  stopQRPoll();
  const qrSection = document.getElementById('qr-section');
  const chatSection = document.getElementById('chat-section');
  const qrStatus = document.getElementById('qr-status');
  const qrImg = document.getElementById('qr-img');
  chatSection.classList.add('hidden');

  // Check if already connected
  try {
    const statusData = await api('GET', '/api/whatsapp/status');
    const state = statusData?.stateInstance || statusData?.state;
    if (state === 'authorized') {
      qrSection.classList.remove('hidden');
      qrStatus.textContent = '✓ Connesso a WhatsApp';
      qrStatus.style.color = 'var(--success)';
      qrImg.style.display = 'none';
      await loadChats();
      return;
    }
  } catch { /* will try QR anyway */ }

  // Show QR
  qrSection.classList.remove('hidden');
  qrImg.style.display = '';
  qrStatus.textContent = 'Caricamento QR...';
  qrStatus.style.color = '';
  try {
    const qrData = await api('GET', '/api/whatsapp/qr');
    if (qrData?.type === 'alreadyLogged') {
      qrStatus.textContent = '✓ Già connesso';
      qrStatus.style.color = 'var(--success)';
      qrImg.style.display = 'none';
      await loadChats();
      return;
    }
    if (qrData?.message) {
      qrImg.src = `data:image/png;base64,${qrData.message}`;
    }
  } catch (ex) {
    qrStatus.textContent = '✗ ' + ex.message;
    qrStatus.style.color = 'var(--danger)';
    return;
  }

  // Poll until authorized
  qrStatus.textContent = 'In attesa di scansione...';
  qrPollTimer = setInterval(async () => {
    try {
      const s = await api('GET', '/api/whatsapp/status');
      const state = s?.stateInstance || s?.state;
      if (state === 'authorized') {
        stopQRPoll();
        qrStatus.textContent = '✓ Connesso!';
        qrStatus.style.color = 'var(--success)';
        qrImg.style.display = 'none';
        await loadChats();
      }
    } catch { /* keep polling */ }
  }, 5000);
}

function stopQRPoll() {
  if (qrPollTimer) { clearInterval(qrPollTimer); qrPollTimer = null; }
}

async function loadChats() {
  const chatSection = document.getElementById('chat-section');
  const chatSelect = document.getElementById('chat-select');
  chatSection.classList.remove('hidden');
  chatSelect.innerHTML = '<option value="">-- Caricamento... --</option>';
  try {
    const data = await api('GET', '/api/whatsapp/chats');
    const chats = data?.chats || [];
    chatSelect.innerHTML = '<option value="">-- Seleziona chat --</option>';
    chats.forEach(c => {
      const opt = document.createElement('option');
      opt.value = JSON.stringify({ chatId: c.chatId, name: c.name });
      opt.textContent = c.name || c.chatId;
      if (c.chatId === settings.greenapi_chat_id) opt.selected = true;
      chatSelect.appendChild(opt);
    });
  } catch (ex) {
    chatSelect.innerHTML = `<option value="">Errore: ${ex.message}</option>`;
  }
}

document.getElementById('btn-save-chat').addEventListener('click', async () => {
  const fb = document.getElementById('chat-feedback');
  const val = document.getElementById('chat-select').value;
  if (!val) return;
  const { chatId, name } = JSON.parse(val);
  fb.textContent = 'Salvataggio...';
  fb.className = 'feedback';
  try {
    settings = await api('PUT', '/api/settings', { greenapi_chat_id: chatId, greenapi_chat_name: name }) || settings;
    fb.textContent = '✓ Chat salvata';
    fb.className = 'feedback ok';
    document.getElementById('current-chat').textContent = `Chat attuale: ${name}`;
  } catch (ex) {
    fb.textContent = '✗ ' + ex.message;
    fb.className = 'feedback err';
  }
});

// ---------- Schedule page ----------
function populateScheduleForm() {
  document.getElementById('sched-time').value = settings.send_time || '01:00';
  document.getElementById('sched-active').checked = !!settings.is_active;
  const tzEl = document.getElementById('sched-tz');
  tzEl.value = settings.timezone || 'Europe/Rome';
  if (!tzEl.value) tzEl.value = 'Europe/Rome';
}

document.getElementById('form-schedule').addEventListener('submit', async e => {
  e.preventDefault();
  const fb = document.getElementById('sched-feedback');
  fb.textContent = 'Salvataggio...';
  fb.className = 'feedback';
  try {
    settings = await api('PUT', '/api/settings', {
      send_time: document.getElementById('sched-time').value,
      timezone: document.getElementById('sched-tz').value,
      is_active: document.getElementById('sched-active').checked,
    }) || settings;
    fb.textContent = '✓ Orario salvato';
    fb.className = 'feedback ok';
  } catch (ex) {
    fb.textContent = '✗ ' + ex.message;
    fb.className = 'feedback err';
  }
});

// ---------- Boot ----------
(async () => {
  if (token) {
    try {
      await initApp();
    } catch {
      logout();
    }
  } else {
    showScreen('auth');
  }
})();
