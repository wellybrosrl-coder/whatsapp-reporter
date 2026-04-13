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
  if (!r.ok) throw new Error(json.detail || `Errore HTTP ${r.status}`);
  return json;
}

// ---------- Button loading helper ----------
function setLoading(btn, loading) {
  if (!btn) return;
  if (loading) {
    btn.dataset.origText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Attendere...';
  } else {
    btn.disabled = false;
    btn.textContent = btn.dataset.origText || btn.textContent;
  }
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
  const btn = document.getElementById('btn-login');
  err.textContent = '';
  setLoading(btn, true);
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
  } finally {
    setLoading(btn, false);
  }
});

document.getElementById('form-register').addEventListener('submit', async e => {
  e.preventDefault();
  const err = document.getElementById('reg-error');
  const btn = document.getElementById('btn-register');
  err.textContent = '';
  setLoading(btn, true);
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
  } finally {
    setLoading(btn, false);
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
  const navEl = document.querySelector(`.nav-link[data-page="${name}"]`);
  if (navEl) navEl.classList.add('active');
}

document.querySelectorAll('.nav-link').forEach(link => {
  link.addEventListener('click', () => {
    const page = link.dataset.page;
    showPage(page);
    if (page === 'dashboard') refreshDashboard();
    if (page === 'whatsapp') loadWhatsAppPage();
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
  const waEl = document.getElementById('dash-wa-status');
  const ipEl = document.getElementById('dash-ip-status');
  const schedEl = document.getElementById('dash-schedule');
  const hintBox = document.getElementById('setup-hint');
  const hintText = document.getElementById('setup-hint-text');

  // Reload settings
  try {
    settings = await api('GET', '/api/settings') || settings;
  } catch { /* use cached */ }

  // iPratico status
  if (settings.ipratico_email && settings.has_ipratico_password) {
    ipEl.textContent = settings.ipratico_email;
    ipEl.className = 'badge badge-green';
  } else {
    ipEl.textContent = 'Non configurato';
    ipEl.className = 'badge badge-gray';
  }

  // Schedule status
  if (settings.is_active) {
    schedEl.textContent = `Attivo — ${settings.send_time} (${settings.timezone})`;
    schedEl.className = 'badge badge-green';
  } else {
    schedEl.textContent = 'Disattivo';
    schedEl.className = 'badge badge-gray';
  }

  // WhatsApp status
  if (!settings.greenapi_id_instance || !settings.has_greenapi_token) {
    waEl.textContent = 'Non configurato';
    waEl.className = 'badge badge-gray';
  } else {
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
      waEl.textContent = 'Errore connessione';
      waEl.className = 'badge badge-red';
    }
  }

  // Setup hint
  const missing = [];
  if (!settings.ipratico_email || !settings.has_ipratico_password) missing.push('credenziali iPratico');
  if (!settings.has_greenapi_token) missing.push('Green API (WhatsApp)');
  if (!settings.greenapi_chat_id) missing.push('chat di destinazione');

  if (missing.length) {
    hintText.textContent = `Configura: ${missing.join(', ')} per iniziare.`;
    hintBox.classList.remove('hidden');
  } else {
    hintBox.classList.add('hidden');
  }
}

document.getElementById('btn-preview').addEventListener('click', async () => {
  const box = document.getElementById('preview-box');
  const fb = document.getElementById('dash-feedback');
  const btn = document.getElementById('btn-preview');
  box.classList.add('hidden');
  fb.textContent = '';
  setLoading(btn, true);
  try {
    const data = await api('POST', '/api/report/preview');
    if (!data) return;
    box.textContent = data.messages.join('\n\n---\n\n');
    box.classList.remove('hidden');
  } catch (ex) {
    fb.textContent = '✗ ' + ex.message;
    fb.className = 'feedback err';
  } finally {
    setLoading(btn, false);
  }
});

document.getElementById('btn-send-now').addEventListener('click', async () => {
  const fb = document.getElementById('dash-feedback');
  const btn = document.getElementById('btn-send-now');
  if (!confirm('Inviare i messaggi ora?')) return;
  fb.textContent = 'Invio in corso...';
  fb.className = 'feedback';
  setLoading(btn, true);
  try {
    const data = await api('POST', '/api/report/send-now');
    if (!data) return;
    fb.textContent = `✓ Inviati ${data.sent} messaggi`;
    fb.className = 'feedback ok';
  } catch (ex) {
    fb.textContent = '✗ ' + ex.message;
    fb.className = 'feedback err';
  } finally {
    setLoading(btn, false);
  }
});

// ---------- iPratico page ----------
function populateIPForm() {
  document.getElementById('ip-email').value = settings.ipratico_email || '';
  document.getElementById('ip-channel').value = settings.ipratico_channel || 'lct_20572';
  // Show indicator if password is already saved
  const pwInput = document.getElementById('ip-password');
  pwInput.placeholder = settings.has_ipratico_password
    ? '(password salvata — lascia vuoto per non modificare)'
    : 'Inserisci password iPratico';
}

document.getElementById('form-ipratico').addEventListener('submit', async e => {
  e.preventDefault();
  const fb = document.getElementById('ip-feedback');
  const btn = document.getElementById('btn-save-ip');
  fb.textContent = '';
  setLoading(btn, true);
  const body = {
    ipratico_email: document.getElementById('ip-email').value,
    ipratico_channel: document.getElementById('ip-channel').value,
  };
  const pw = document.getElementById('ip-password').value;
  if (pw) body.ipratico_password = pw;
  try {
    settings = await api('PUT', '/api/settings', body) || settings;
    fb.textContent = '✓ Credenziali salvate';
    fb.className = 'feedback ok';
    document.getElementById('ip-password').value = '';
    populateIPForm(); // refresh placeholder
  } catch (ex) {
    fb.textContent = '✗ ' + ex.message;
    fb.className = 'feedback err';
  } finally {
    setLoading(btn, false);
  }
});

document.getElementById('btn-test-ipratico').addEventListener('click', async () => {
  const fb = document.getElementById('ip-feedback');
  const btn = document.getElementById('btn-test-ipratico');
  fb.textContent = 'Test in corso...';
  fb.className = 'feedback';
  setLoading(btn, true);
  try {
    await api('POST', '/api/ipratico/test');
    fb.textContent = '✓ Connessione riuscita';
    fb.className = 'feedback ok';
  } catch (ex) {
    fb.textContent = '✗ ' + ex.message;
    fb.className = 'feedback err';
  } finally {
    setLoading(btn, false);
  }
});

// ---------- WhatsApp page ----------
async function loadWhatsAppPage() {
  populateWAForm();
  // If credentials saved, auto-check status and show current state
  if (settings.greenapi_id_instance && settings.has_greenapi_token) {
    showQRStep();
    await checkAndShowWAState();
  }
}

function populateWAForm() {
  document.getElementById('wa-instance').value = settings.greenapi_id_instance || '';
  document.getElementById('wa-url').value = settings.greenapi_api_url || 'https://7107.api.greenapi.com';
  document.getElementById('wa-token').placeholder = settings.has_greenapi_token
    ? '(token salvato — lascia vuoto per non modificare)'
    : 'Incolla qui il token dal dashboard Green API';
  if (settings.greenapi_chat_id) {
    document.getElementById('current-chat').textContent =
      `Chat attuale: ${settings.greenapi_chat_name || settings.greenapi_chat_id}`;
  }
}

function showQRStep() {
  document.getElementById('step-qr-hint').classList.add('hidden');
  document.getElementById('qr-section').classList.remove('hidden');
}

function showChatStep() {
  document.getElementById('step-chat-hint').classList.add('hidden');
  document.getElementById('chat-section').classList.remove('hidden');
}

async function checkAndShowWAState() {
  const qrStatus = document.getElementById('qr-status');
  const qrImg = document.getElementById('qr-img');

  qrStatus.textContent = 'Verifica connessione...';
  qrStatus.style.color = '';
  qrImg.style.display = 'none';

  try {
    const statusData = await api('GET', '/api/whatsapp/status');
    const state = statusData?.stateInstance || statusData?.state;
    if (state === 'authorized') {
      qrStatus.textContent = '✓ WhatsApp connesso';
      qrStatus.style.color = 'var(--success)';
      showChatStep();
      await loadChats();
      return;
    }
  } catch { /* not connected, show QR */ }

  await startQRFlow();
}

async function startQRFlow() {
  stopQRPoll();
  const qrStatus = document.getElementById('qr-status');
  const qrImg = document.getElementById('qr-img');

  showQRStep();
  document.getElementById('chat-section').classList.add('hidden');
  document.getElementById('step-chat-hint').classList.remove('hidden');

  qrImg.style.display = 'none';
  qrStatus.style.color = '';
  qrStatus.textContent = 'Caricamento QR...';

  try {
    const qrData = await api('GET', '/api/whatsapp/qr');
    if (!qrData) return;
    if (qrData.type === 'alreadyLogged') {
      qrStatus.textContent = '✓ Già connesso';
      qrStatus.style.color = 'var(--success)';
      showChatStep();
      await loadChats();
      return;
    }
    if (qrData.message) {
      qrImg.src = `data:image/png;base64,${qrData.message}`;
      qrImg.style.display = '';
      qrStatus.textContent = 'Apri WhatsApp → Impostazioni → Dispositivi collegati → Aggiungi dispositivo';
      // Start polling every 5s
      qrPollTimer = setInterval(async () => {
        try {
          const s = await api('GET', '/api/whatsapp/status');
          const state = s?.stateInstance || s?.state;
          if (state === 'authorized') {
            stopQRPoll();
            qrImg.style.display = 'none';
            qrStatus.textContent = '✓ WhatsApp connesso!';
            qrStatus.style.color = 'var(--success)';
            showChatStep();
            await loadChats();
          }
        } catch { /* keep polling */ }
      }, 4000);
    } else {
      qrStatus.textContent = 'QR non disponibile — riprova tra qualche secondo';
    }
  } catch (ex) {
    qrStatus.textContent = '✗ ' + ex.message;
    qrStatus.style.color = 'var(--danger)';
  }
}

function stopQRPoll() {
  if (qrPollTimer) { clearInterval(qrPollTimer); qrPollTimer = null; }
}

// Single button: save credentials AND start QR flow
document.getElementById('form-whatsapp-creds').addEventListener('submit', async e => {
  e.preventDefault();
  const fb = document.getElementById('wa-creds-feedback');
  const btn = document.getElementById('btn-connect-wa');
  fb.textContent = '';
  setLoading(btn, true);

  const body = {
    greenapi_id_instance: document.getElementById('wa-instance').value.trim(),
    greenapi_api_url: document.getElementById('wa-url').value.trim() || 'https://7107.api.greenapi.com',
  };
  const tok = document.getElementById('wa-token').value.trim();
  if (tok) body.greenapi_api_token = tok;

  if (!body.greenapi_id_instance) {
    fb.textContent = '✗ Inserisci l\'ID istanza';
    fb.className = 'feedback err';
    setLoading(btn, false);
    return;
  }
  if (!tok && !settings.has_greenapi_token) {
    fb.textContent = '✗ Inserisci il token API';
    fb.className = 'feedback err';
    setLoading(btn, false);
    return;
  }

  try {
    settings = await api('PUT', '/api/settings', body) || settings;
    fb.textContent = '✓ Credenziali salvate — caricamento QR...';
    fb.className = 'feedback ok';
    document.getElementById('wa-token').value = '';
    populateWAForm();
    // Immediately show QR
    showQRStep();
    await startQRFlow();
    fb.textContent = '';
  } catch (ex) {
    fb.textContent = '✗ ' + ex.message;
    fb.className = 'feedback err';
  } finally {
    setLoading(btn, false);
  }
});

document.getElementById('btn-refresh-qr').addEventListener('click', async () => {
  await startQRFlow();
});

async function loadChats() {
  const chatSelect = document.getElementById('chat-select');
  chatSelect.innerHTML = '<option value="">Caricamento chat...</option>';
  try {
    const data = await api('GET', '/api/whatsapp/chats');
    const chats = (data?.chats || []).filter(c => c.chatId);
    chatSelect.innerHTML = '<option value="">-- Seleziona chat --</option>';
    chats.forEach(c => {
      const opt = document.createElement('option');
      opt.value = JSON.stringify({ chatId: c.chatId, name: c.name });
      opt.textContent = c.name || c.chatId;
      if (c.chatId === settings.greenapi_chat_id) opt.selected = true;
      chatSelect.appendChild(opt);
    });
    if (chats.length === 0) {
      chatSelect.innerHTML = '<option value="">Nessuna chat trovata</option>';
    }
    // Auto-save if only one chat and none selected yet
    if (chats.length === 1 && !settings.greenapi_chat_id) {
      chatSelect.selectedIndex = 1;
    }
  } catch (ex) {
    chatSelect.innerHTML = `<option value="">Errore: ${ex.message}</option>`;
  }
}

document.getElementById('btn-save-chat').addEventListener('click', async () => {
  const fb = document.getElementById('chat-feedback');
  const btn = document.getElementById('btn-save-chat');
  const val = document.getElementById('chat-select').value;
  if (!val) { fb.textContent = 'Seleziona una chat prima di salvare'; fb.className = 'feedback err'; return; }
  const { chatId, name } = JSON.parse(val);
  setLoading(btn, true);
  try {
    settings = await api('PUT', '/api/settings', { greenapi_chat_id: chatId, greenapi_chat_name: name }) || settings;
    fb.textContent = `✓ Chat salvata: ${name}`;
    fb.className = 'feedback ok';
    document.getElementById('current-chat').textContent = `Chat attuale: ${name}`;
  } catch (ex) {
    fb.textContent = '✗ ' + ex.message;
    fb.className = 'feedback err';
  } finally {
    setLoading(btn, false);
  }
});

// ---------- Schedule page ----------
function populateScheduleForm() {
  document.getElementById('sched-time').value = settings.send_time || '01:00';
  document.getElementById('sched-active').checked = !!settings.is_active;
  const tzEl = document.getElementById('sched-tz');
  if (settings.timezone) tzEl.value = settings.timezone;
  if (!tzEl.value) tzEl.value = 'Europe/Rome';
}

document.getElementById('form-schedule').addEventListener('submit', async e => {
  e.preventDefault();
  const fb = document.getElementById('sched-feedback');
  const btn = document.getElementById('btn-save-sched');
  setLoading(btn, true);
  try {
    settings = await api('PUT', '/api/settings', {
      send_time: document.getElementById('sched-time').value,
      timezone: document.getElementById('sched-tz').value,
      is_active: document.getElementById('sched-active').checked,
    }) || settings;
    fb.textContent = settings.is_active
      ? `✓ Report attivo — invio ogni giorno alle ${settings.send_time}`
      : '✓ Invio automatico disattivato';
    fb.className = 'feedback ok';
  } catch (ex) {
    fb.textContent = '✗ ' + ex.message;
    fb.className = 'feedback err';
  } finally {
    setLoading(btn, false);
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
