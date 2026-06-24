import { scenarios } from './scenarios.js';

// ─── EMBEDDED API KEY ──────────────────────────────────────
const EMBEDDED_KEY = process.env.GEMINI_API_KEY;

// ─── APPLICATION STATE ─────────────────────────────────────
const state = {
  apiKey:          localStorage.getItem('germantutor_api_key') || EMBEDDED_KEY,
  activeScenario:  'cafe',
  conversationHistory: [],
  selectedVoiceName: localStorage.getItem('germantutor_voice') || '',
  speakingRate:    parseFloat(localStorage.getItem('germantutor_rate')) || 0.9,
  isListening:     false,
  isSpeaking:      false,
  isThinking:      false,
};

// ─── WEB SPEECH API ────────────────────────────────────────
let recognition     = null;
const synthesis     = window.speechSynthesis;
let currentUtterance = null;

// ─── DOM REFERENCES ────────────────────────────────────────
const el = {
  // Views
  landingPage:      document.getElementById('landing-page'),
  appInterface:     document.getElementById('app-interface'),
  // Landing CTAs
  heroStartBtn:     document.getElementById('hero-start-btn'),
  navLaunchBtn:     document.getElementById('nav-launch-btn'),
  finalCtaBtn:      document.getElementById('final-cta-btn'),
  stripCta:         document.getElementById('strip-cta'),
  feat1Cta:         document.getElementById('feat1-cta'),
  feat2Cta:         document.getElementById('feat2-cta'),
  // Scenario tiles (landing)
  scCafe:           document.getElementById('sc-cafe'),
  scHotel:          document.getElementById('sc-hotel'),
  scDirections:     document.getElementById('sc-directions'),
  scFreetalk:       document.getElementById('sc-freetalk'),
  // App nav
  backBtn:          document.getElementById('back-to-landing-btn'),
  menuToggle:       document.getElementById('menu-toggle'),
  settingsBtn:      document.getElementById('settings-btn'),
  // Sidebar
  sidebar:          document.getElementById('sidebar'),
  scenarioCards:    document.getElementById('scenario-cards'),
  vocabList:        document.getElementById('vocab-list'),
  // Avatar
  avatarSection:    document.getElementById('avatar-section'),
  avatarRing:       document.getElementById('avatar-ring'),
  avatarIcon:       document.getElementById('avatar-icon'),
  avatarName:       document.getElementById('avatar-name'),
  avatarStatus:     document.getElementById('avatar-status'),
  // Chat
  dialogueThread:   document.getElementById('dialogue-thread'),
  suggestionBar:    document.getElementById('suggestion-bar'),
  // Input
  micBtn:           document.getElementById('mic-btn'),
  textInput:        document.getElementById('text-input'),
  sendBtn:          document.getElementById('send-btn'),
  // Settings panel
  settingsPanel:    document.getElementById('settings-drawer'),
  closeSettings:    document.getElementById('close-settings'),
  drawerOverlay:    document.getElementById('drawer-overlay'),
  voiceSelect:      document.getElementById('voice-select'),
  rateInput:        document.getElementById('rate-input'),
  rateVal:          document.getElementById('rate-val'),
  apiKeyInput:      document.getElementById('api-key-input'),
  saveApiKeyBtn:    document.getElementById('save-api-key'),
  // Modal
  modalOverlay:     document.getElementById('modal-overlay'),
  modalKeyInput:    document.getElementById('api-key-input-modal'),
  setupApiKeyBtn:   document.getElementById('setup-api-key'),
  closeModal:       document.getElementById('close-modal'),
};

// ─── INITIALISE ────────────────────────────────────────────
function init() {
  renderSidebarScenarios();
  initSpeechRecognition();
  initSpeechSynthesis();
  loadSettings();
  bindEvents();
}

// ─── LANDING → TUTOR TRANSITION ───────────────────────────
function launchTutor(scenarioKey) {
  if (scenarioKey && scenarios[scenarioKey]) state.activeScenario = scenarioKey;
  el.landingPage.classList.add('hidden');
  el.appInterface.classList.remove('hidden');
  if (state.conversationHistory.length === 0) {
    startScenario(state.activeScenario);
  }
}

function backToLanding() {
  stopAllVoices();
  el.appInterface.classList.add('hidden');
  el.landingPage.classList.remove('hidden');
}

// ─── SCENARIO MANAGEMENT ──────────────────────────────────
function renderSidebarScenarios() {
  el.scenarioCards.innerHTML = '';
  Object.keys(scenarios).forEach(key => {
    const s    = scenarios[key];
    const card = document.createElement('button');
    card.className = `scenario-card ${state.activeScenario === key ? 'active' : ''}`;
    card.dataset.id = key;

    const diffClass = s.difficulty.toLowerCase().includes('beginner') ? 'beginner' : 'intermediate';
    card.innerHTML = `
      <div class="scenario-icon">${s.icon}</div>
      <div class="scenario-info">
        <span class="scenario-name">${s.title}</span>
        <span class="scenario-german-name">${s.germanTitle}</span>
        <span class="scenario-difficulty ${diffClass}">${s.difficulty}</span>
      </div>
    `;
    card.addEventListener('click', () => {
      if (state.activeScenario !== key) switchScenario(key);
      closeSidebar();
    });
    el.scenarioCards.appendChild(card);
  });
}

function switchScenario(key) {
  state.activeScenario = key;
  document.querySelectorAll('.scenario-card').forEach(c =>
    c.classList.toggle('active', c.dataset.id === key)
  );
  startScenario(key);
}

async function startScenario(key) {
  const s = scenarios[key];

  // populate vocabulary
  el.vocabList.innerHTML = '';
  s.vocabulary.forEach(v => {
    const d = document.createElement('div');
    d.className = 'vocab-item';
    d.innerHTML = `<span class="vocab-de">${v.german}</span><span class="vocab-en">${v.english}</span>`;
    el.vocabList.appendChild(d);
  });

  // reset conversation
  state.conversationHistory = [];
  el.dialogueThread.innerHTML = '';
  el.suggestionBar.innerHTML  = '';
  stopAllVoices();

  // update avatar
  el.avatarName.textContent = s.avatarName;
  el.avatarIcon.textContent = s.icon;

  // starter message suggestions per scenario
  const starterSuggestions = {
    cafe:       ['Ich möchte einen Milchkaffee, bitte.', 'Haben Sie ein Croissant?', 'Hallo! Ich nehme einen Espresso.'],
    hotel:      ['Hallo, ich habe eine Reservierung.', 'Auf den Namen Schmidt, bitte.', 'Wann gibt es Frühstück?'],
    directions: ['Entschuldigung, wo ist die Elbphilharmonie?', 'Ich suche den Bahnhof.', 'Wie weit ist es zu Fuß?'],
    freetalk:   ['Hallo! Mir geht es sehr gut.', 'Ich lerne seit drei Monaten Deutsch.', 'Ich komme aus Indien.'],
  };

  addMessage('tutor', {
    tutorGermanReply:       s.starterSentence,
    tutorEnglishTranslation: 'Welcome! Your tutor is ready. Reply in German to begin.',
    grammarCorrection:       null,
    suggestedResponses:      starterSuggestions[key] || [],
  });

  speak(s.starterSentence);
}

// ─── GEMINI API CALL ──────────────────────────────────────
async function fetchTutorResponse(userText) {
  if (!state.apiKey) {
    toast('No API key found. Please check Settings.');
    return null;
  }

  state.isThinking = true;
  updateAvatarState();

  const s   = scenarios[state.activeScenario];
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${state.apiKey}`;

  const apiHistory = [
    ...state.conversationHistory,
    { role: 'user', parts: [{ text: userText }] }
  ];

  const payload = {
    contents: apiHistory,
    systemInstruction: { parts: [{ text: s.systemPrompt }] },
    generationConfig:  { responseMimeType: 'application/json' },
  };

  try {
    const res = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    });

    if (!res.ok) {
      const errData = await res.json();
      throw new Error(errData.error?.message || 'API request failed.');
    }

    const data          = await res.json();
    const rawText       = data.candidates[0].content.parts[0].text;
    const resultObj     = JSON.parse(rawText);

    state.conversationHistory.push({ role: 'user',  parts: [{ text: userText }] });
    state.conversationHistory.push({ role: 'model', parts: [{ text: rawText  }] });

    state.isThinking = false;
    updateAvatarState();
    return resultObj;

  } catch (err) {
    console.error('Gemini API Error:', err);
    state.isThinking = false;
    updateAvatarState();
    toast('AI Tutor error: ' + err.message);
    return {
      tutorGermanReply:       'Entschuldigung, ich habe einen kleinen Fehler. Kannst du das wiederholen?',
      tutorEnglishTranslation: 'Sorry, I had a small error. Can you repeat that?',
      grammarCorrection:       'API error: ' + err.message,
      suggestedResponses:      ['Noch einmal, bitte.'],
    };
  }
}

// ─── SEND MESSAGE ─────────────────────────────────────────
async function handleSend() {
  const text = el.textInput.value.trim();
  if (!text) return;

  el.textInput.value = '';
  el.sendBtn.classList.remove('active');
  stopAllVoices();

  addMessage('user', { text });
  el.suggestionBar.innerHTML = '';

  const data = await fetchTutorResponse(text);
  if (!data) return;

  addMessage('tutor', data);
  speak(data.tutorGermanReply);
}

// ─── RENDER A CHAT BUBBLE ─────────────────────────────────
function addMessage(sender, data) {
  const wrapper = document.createElement('div');
  wrapper.className = `chat-bubble-wrapper ${sender}`;

  const avatar = sender === 'user' ? '👤' : scenarios[state.activeScenario].icon;
  let html = `<div class="bubble-avatar">${avatar}</div><div class="chat-bubble">`;

  if (sender === 'user') {
    html += `<p class="bubble-text">${escHtml(data.text)}</p>`;
  } else {
    const tsId = `trans-${Date.now()}`;
    html += `
      <p class="bubble-text">${escHtml(data.tutorGermanReply)}</p>
      <div class="bubble-translation" id="${tsId}">${escHtml(data.tutorEnglishTranslation)}</div>
    `;
    if (data.grammarCorrection) {
      html += `
        <div class="bubble-correction">
          <span class="correction-title">💡 Tipp</span>
          ${escHtml(data.grammarCorrection)}
        </div>
      `;
    }
    html += `
      <div class="bubble-actions">
        <button class="btn-bubble trans-toggle">👁️ Translate</button>
        <button class="btn-bubble replay-btn">🔊 Replay</button>
      </div>
    `;
  }

  html += `</div>`;
  wrapper.innerHTML = html;
  el.dialogueThread.appendChild(wrapper);
  el.dialogueThread.scrollTop = el.dialogueThread.scrollHeight;

  if (sender === 'tutor') {
    const transDiv  = wrapper.querySelector('.bubble-translation');
    const toggleBtn = wrapper.querySelector('.trans-toggle');
    const replayBtn = wrapper.querySelector('.replay-btn');

    toggleBtn.addEventListener('click', () => transDiv.classList.toggle('visible'));
    replayBtn.addEventListener('click', () => speak(data.tutorGermanReply));

    // render suggestion chips
    el.suggestionBar.innerHTML = '';
    (data.suggestedResponses || []).forEach(phrase => {
      const chip = document.createElement('button');
      chip.className   = 'suggestion-chip';
      chip.textContent = phrase;
      chip.addEventListener('click', () => {
        el.textInput.value = phrase;
        el.sendBtn.classList.add('active');
        el.textInput.focus();
      });
      el.suggestionBar.appendChild(chip);
    });
  }
}

function escHtml(str = '') {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// ─── TEXT-TO-SPEECH ───────────────────────────────────────
function speak(text) {
  if (!synthesis) return;
  stopAllVoices();

  currentUtterance      = new SpeechSynthesisUtterance(text);
  currentUtterance.lang = 'de-DE';
  currentUtterance.rate = state.speakingRate;

  const voices = synthesis.getVoices();
  const picked = voices.find(v => v.name === state.selectedVoiceName && v.lang.startsWith('de'))
               || voices.find(v => v.lang.startsWith('de'));
  if (picked) currentUtterance.voice = picked;

  currentUtterance.onstart = () => { state.isSpeaking = true;  updateAvatarState(); };
  currentUtterance.onend   = () => { state.isSpeaking = false; updateAvatarState(); };
  currentUtterance.onerror = () => { state.isSpeaking = false; updateAvatarState(); };

  synthesis.speak(currentUtterance);
}

function stopAllVoices() {
  synthesis?.cancel();
  state.isSpeaking = false;
  updateAvatarState();
}

// ─── SPEECH RECOGNITION ──────────────────────────────────
function initSpeechRecognition() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { console.warn('Speech recognition not available.'); return; }

  recognition                = new SR();
  recognition.lang           = 'de-DE';
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;

  recognition.onstart  = () => { state.isListening = true;  updateAvatarState(); el.textInput.placeholder = 'Listening… Speak in German!'; };
  recognition.onresult = e => {
    el.textInput.value = e.results[0][0].transcript;
    el.sendBtn.classList.add('active');
  };
  recognition.onerror  = e => {
    state.isListening = false; updateAvatarState();
    el.textInput.placeholder = 'Type or click mic to speak…';
    if (e.error === 'not-allowed') toast('Microphone permission denied.');
    else if (e.error === 'no-speech') toast('No speech detected. Try again.');
  };
  recognition.onend    = () => { state.isListening = false; updateAvatarState(); el.textInput.placeholder = 'Sprechen Sie oder tippen Sie auf Deutsch…'; };
}

function toggleMic() {
  if (!recognition) { toast('Voice recognition unavailable. Try Chrome or Edge.'); return; }
  if (state.isListening) {
    recognition.stop();
  } else {
    stopAllVoices();
    try { recognition.start(); } catch(e) { console.error(e); }
  }
}

// ─── VOICE SYNTHESIS INIT ────────────────────────────────
function initSpeechSynthesis() {
  if (!synthesis) return;
  const populate = () => {
    const voices = synthesis.getVoices();
    el.voiceSelect.innerHTML = '<option value="">Default German voice</option>';
    voices.filter(v => v.lang.startsWith('de')).forEach(v => {
      const opt = document.createElement('option');
      opt.value       = v.name;
      opt.textContent = `${v.name} (${v.lang})`;
      if (v.name === state.selectedVoiceName) opt.selected = true;
      el.voiceSelect.appendChild(opt);
    });
  };
  populate();
  if ('onvoiceschanged' in synthesis) synthesis.onvoiceschanged = populate;
}

// ─── AVATAR STATE ─────────────────────────────────────────
function updateAvatarState() {
  el.avatarRing.className    = 'avatar-ring';
  el.avatarSection.className = 'avatar-strip';
  el.micBtn.classList.remove('listening');

  if (state.isListening) {
    el.avatarRing.classList.add('listening');
    el.avatarSection.classList.add('listening');
    el.micBtn.classList.add('listening');
    el.avatarStatus.textContent = 'Listening…';
  } else if (state.isSpeaking) {
    el.avatarRing.classList.add('speaking');
    el.avatarSection.classList.add('speaking');
    el.avatarStatus.textContent = 'Speaking…';
  } else if (state.isThinking) {
    el.avatarRing.classList.add('thinking');
    el.avatarStatus.textContent = 'Thinking…';
  } else {
    el.avatarStatus.textContent = 'Click mic to speak';
  }
}

// ─── SETTINGS PANEL ───────────────────────────────────────
function openSettings()  { el.settingsPanel.classList.add('open');  el.drawerOverlay.classList.add('visible'); }
function closeSettings() { el.settingsPanel.classList.remove('open'); el.drawerOverlay.classList.remove('visible'); }
function closeSidebar()  { el.sidebar.classList.remove('open');      el.drawerOverlay.classList.remove('visible'); }

function loadSettings() {
  el.apiKeyInput.value    = state.apiKey;
  el.rateInput.value      = state.speakingRate;
  el.rateVal.textContent  = state.speakingRate.toFixed(1) + '×';
}

// ─── TOAST ────────────────────────────────────────────────
function toast(msg) {
  const t = document.createElement('div');
  Object.assign(t.style, {
    position:'fixed', bottom:'80px', left:'50%', transform:'translateX(-50%)',
    background:'#1E293B', color:'#F8FAFC', padding:'.65rem 1.25rem',
    borderRadius:'999px', fontSize:'.82rem', fontFamily:'var(--font-body)',
    fontWeight:'600', zIndex:'9999', boxShadow:'0 4px 16px rgba(0,0,0,.25)',
    animation:'slideUp .2s ease',
  });
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => { t.style.opacity='0'; t.style.transition='opacity .3s'; setTimeout(()=>t.remove(),300); }, 3000);
}

// ─── EVENT BINDING ────────────────────────────────────────
function bindEvents() {
  // Landing → tutor transitions
  const goTutor = (key) => () => launchTutor(key);
  el.heroStartBtn?.addEventListener('click',  goTutor(null));
  el.navLaunchBtn?.addEventListener('click',  goTutor(null));
  el.finalCtaBtn?.addEventListener('click',   goTutor(null));
  el.stripCta?.addEventListener('click',      goTutor(null));
  el.feat1Cta?.addEventListener('click',      goTutor(null));
  el.feat2Cta?.addEventListener('click',      goTutor(null));
  // Scenario tile clicks on landing page
  el.scCafe?.addEventListener('click',        goTutor('cafe'));
  el.scHotel?.addEventListener('click',       goTutor('hotel'));
  el.scDirections?.addEventListener('click',  goTutor('directions'));
  el.scFreetalk?.addEventListener('click',    goTutor('freetalk'));

  // Back button
  el.backBtn?.addEventListener('click', backToLanding);

  // Chat input
  el.micBtn?.addEventListener('click', toggleMic);
  el.sendBtn?.addEventListener('click', handleSend);
  el.textInput?.addEventListener('keydown', e => { if (e.key === 'Enter') handleSend(); });
  el.textInput?.addEventListener('input', () => {
    el.sendBtn.classList.toggle('active', el.textInput.value.trim().length > 0);
  });

  // Settings panel
  el.settingsBtn?.addEventListener('click',   openSettings);
  el.closeSettings?.addEventListener('click', closeSettings);
  el.drawerOverlay?.addEventListener('click', () => { closeSettings(); closeSidebar(); });

  // Mobile sidebar
  el.menuToggle?.addEventListener('click', () => {
    el.sidebar.classList.add('open');
    el.drawerOverlay.classList.add('visible');
  });

  // Save API key from settings panel
  el.saveApiKeyBtn?.addEventListener('click', () => {
    const key = el.apiKeyInput.value.trim();
    if (key) {
      state.apiKey = key;
      localStorage.setItem('germantutor_api_key', key);
      toast('API key saved.');
      closeSettings();
    } else {
      toast('Please enter a valid key.');
    }
  });

  // Save from modal
  el.setupApiKeyBtn?.addEventListener('click', () => {
    const key = (el.modalKeyInput?.value || '').trim() || (el.apiKeyInput?.value || '').trim();
    if (key) {
      state.apiKey = key;
      localStorage.setItem('germantutor_api_key', key);
      if (el.apiKeyInput) el.apiKeyInput.value = key;
      el.modalOverlay.classList.remove('visible');
    } else toast('Please enter a valid key.');
  });
  el.closeModal?.addEventListener('click', () => el.modalOverlay.classList.remove('visible'));

  // Voice / rate changes
  el.voiceSelect?.addEventListener('change', () => {
    state.selectedVoiceName = el.voiceSelect.value;
    localStorage.setItem('germantutor_voice', state.selectedVoiceName);
  });
  el.rateInput?.addEventListener('input', () => {
    state.speakingRate    = parseFloat(el.rateInput.value);
    el.rateVal.textContent = state.speakingRate.toFixed(1) + '×';
    localStorage.setItem('germantutor_rate', String(state.speakingRate));
  });
}

// ─── BOOT ─────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', init);
