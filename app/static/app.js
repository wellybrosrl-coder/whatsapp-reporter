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
    if (page === 'messages') populateMessagesForm();
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
      // Status check failed (transient error or rate limit).
      // If chat is already saved the instance was previously authorized — don't alarm the user.
      if (settings.greenapi_chat_id) {
        waEl.textContent = 'Connesso ✓';
        waEl.className = 'badge badge-green';
      } else {
        waEl.textContent = 'Verifica non disponibile';
        waEl.className = 'badge badge-yellow';
      }
    }
  }

  // Setup hint
  const missing = [];
  if (!settings.ipratico_email || !settings.has_ipratico_password) missing.push('credenziali iPratico');
  if (!settings.greenapi_id_instance || !settings.has_greenapi_token) missing.push('credenziali Green API (WhatsApp)');
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
  // If credentials saved, auto-check status and show QR state
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

// Save credentials and start QR flow
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

// ---------- Messages page ----------

const DEFAULT_TEMPLATES = {
  day:          '📊 Incassi del giorno:\n📆 Data: {{data}}\n💰 Vendite: €{{vendite}}',
  month:        '📆 Totale mese di {{mese}}:\n💰 Vendite: €{{vendite_mese}}\n📈 Variazione vs {{anno_prec}}: {{variazione_pct}} | {{variazione_eur}} €',
  month_closed: '🎯 MESE CHIUSO - {{mese}}:\n💰 Vendite totali: €{{vendite_totali}}\n📈 Variazione vs {{anno_prec}}: {{variazione_pct}} | {{variazione_eur}} €',
};

const TAGS_BY_TYPE = {
  day:          ['data', 'vendite'],
  month:        ['mese', 'vendite_mese', 'vendite_anno_prec', 'variazione_pct', 'variazione_eur', 'anno_prec'],
  month_closed: ['mese', 'vendite_totali', 'vendite_anno_prec', 'variazione_pct', 'variazione_eur', 'anno_prec'],
};

const TYPE_LABELS = {
  day: 'Giornaliero',
  month: 'Mensile MTD',
  month_closed: 'Mese chiuso',
};

function _buildTagBar(dataType) {
  const tags = TAGS_BY_TYPE[dataType] || [];
  const bar = document.createElement('div');
  bar.className = 'tag-bar';
  const hint = document.createElement('span');
  hint.className = 'tag-hint';
  hint.textContent = 'Tag:';
  bar.appendChild(hint);
  tags.forEach(tag => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'tag-chip';
    chip.dataset.tag = tag;
    chip.textContent = `{{${tag}}}`;
    bar.appendChild(chip);
  });
  return bar;
}

function _wireTagChips(card) {
  const ta = card.querySelector('.msg-template');
  card.querySelector('.tag-bar').querySelectorAll('.tag-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const insert = `{{${chip.dataset.tag}}}`;
      ta.value = ta.value.slice(0, start) + insert + ta.value.slice(end);
      ta.selectionStart = ta.selectionEnd = start + insert.length;
      ta.focus();
    });
  });
}

function buildMsgCard(msg) {
  const card = document.createElement('div');
  card.className = 'msg-card';
  card.dataset.msgId = msg.id;

  // ── Header ──
  const header = document.createElement('div');
  header.className = 'msg-card-header';

  const titleInput = document.createElement('input');
  titleInput.type = 'text';
  titleInput.className = 'msg-title-input';
  titleInput.placeholder = 'Titolo messaggio';
  titleInput.value = msg.title || '';

  const controls = document.createElement('div');
  controls.className = 'msg-card-controls';

  const typeSelect = document.createElement('select');
  typeSelect.className = 'msg-type-select';
  Object.entries(TYPE_LABELS).forEach(([val, label]) => {
    const opt = document.createElement('option');
    opt.value = val;
    opt.textContent = label;
    if (val === msg.data_type) opt.selected = true;
    typeSelect.appendChild(opt);
  });

  const freqSelect = document.createElement('select');
  freqSelect.className = 'freq-select msg-freq-select';
  [['daily','Ogni giorno'],['weekly','Ogni lunedì'],['monthly','Il 1° del mese'],['disabled','Disattivato']].forEach(([val, label]) => {
    const opt = document.createElement('option');
    opt.value = val;
    opt.textContent = label;
    if (val === msg.freq) opt.selected = true;
    freqSelect.appendChild(opt);
  });

  const delBtn = document.createElement('button');
  delBtn.type = 'button';
  delBtn.className = 'btn-delete-msg';
  delBtn.title = 'Elimina messaggio';
  delBtn.textContent = '✕';

  controls.append(typeSelect, freqSelect, delBtn);
  header.append(titleInput, controls);

  // ── Tag bar ──
  const tagBar = _buildTagBar(msg.data_type);

  // ── Textarea ──
  const ta = document.createElement('textarea');
  ta.className = 'msg-template';
  ta.rows = 4;
  ta.value = msg.template || '';

  card.append(header, tagBar, ta);

  // ── Events ──
  typeSelect.addEventListener('change', () => {
    const newTagBar = _buildTagBar(typeSelect.value);
    card.replaceChild(newTagBar, card.querySelector('.tag-bar'));
    _wireTagChips(card);
  });

  delBtn.addEventListener('click', async () => {
    if (!confirm('Eliminare questo messaggio?')) return;
    try {
      await api('DELETE', `/api/messages/${msg.id}`);
      card.remove();
      if (!document.querySelector('#messages-container .msg-card')) {
        document.getElementById('messages-container').innerHTML =
          '<div class="msg-empty">Nessun messaggio. Clicca "+ Aggiungi messaggio" per crearne uno.</div>';
      }
    } catch (ex) {
      alert('Errore: ' + ex.message);
    }
  });

  _wireTagChips(card);
  return card;
}

async function loadMessages() {
  const container = document.getElementById('messages-container');
  container.innerHTML = '<p style="color:var(--text-muted);font-size:.85rem">Caricamento...</p>';
  try {
    const msgs = await api('GET', '/api/messages') || [];
    container.innerHTML = '';
    if (msgs.length === 0) {
      container.innerHTML = '<div class="msg-empty">Nessun messaggio. Clicca "+ Aggiungi messaggio" per crearne uno.</div>';
    } else {
      msgs.forEach(m => container.appendChild(buildMsgCard(m)));
    }
  } catch (ex) {
    container.innerHTML = `<p class="feedback err">✗ ${ex.message}</p>`;
  }
}

// Called from nav click
function populateMessagesForm() {
  loadMessages();
}

document.getElementById('btn-add-message').addEventListener('click', async () => {
  const btn = document.getElementById('btn-add-message');
  setLoading(btn, true);
  try {
    const msg = await api('POST', '/api/messages', {
      title: '📊 Nuovo messaggio',
      template: DEFAULT_TEMPLATES.day,
      freq: 'daily',
      data_type: 'day',
    });
    const container = document.getElementById('messages-container');
    const empty = container.querySelector('.msg-empty');
    if (empty) empty.remove();
    container.appendChild(buildMsgCard(msg));
    container.lastElementChild.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (ex) {
    document.getElementById('messages-feedback').textContent = '✗ ' + ex.message;
    document.getElementById('messages-feedback').className = 'feedback err';
  } finally {
    setLoading(btn, false);
  }
});

document.getElementById('form-messages').addEventListener('submit', async e => {
  e.preventDefault();
  const fb = document.getElementById('messages-feedback');
  const btn = document.getElementById('btn-save-messages');
  fb.textContent = '';
  setLoading(btn, true);
  try {
    const cards = document.querySelectorAll('#messages-container .msg-card[data-msg-id]');
    await Promise.all(Array.from(cards).map(card =>
      api('PUT', `/api/messages/${card.dataset.msgId}`, {
        title:     card.querySelector('.msg-title-input').value.trim(),
        template:  card.querySelector('.msg-template').value,
        freq:      card.querySelector('.msg-freq-select').value,
        data_type: card.querySelector('.msg-type-select').value,
      })
    ));
    fb.textContent = '✓ Messaggi salvati';
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
