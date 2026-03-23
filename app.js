/* ═══════════════════════════════════════
   Focus — Study Timer v3 (Enhanced PWA)
   AhChai Studio · 2025
   Enhanced with notifications, keyboard shortcuts,
   haptics, and improved offline support
═══════════════════════════════════════ */

// ── Register Service Worker ──────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .then(reg => console.log('SW registered:', reg.scope))
      .catch(err => console.log('SW registration failed:', err));
  });
}

// ── Config & State ───────────────────────────────
const CFG = { 
  studyMins: 25, 
  breakMins: 5,
  soundEnabled: true,
  vibrationEnabled: true,
  notificationsEnabled: false
};

let S = {
  mode: 'idle',
  secs: 0,
  pauseFrom: 'study',
  pauseCount: 0,
  studyStart: null,
  studiedSecs: 0,
  timer: null,
  today: dateStr()
};

let deferredPrompt = null;
let chartInst = null;
let activeTab = 'chart';

// ── Helpers ──────────────────────────────────────
function dateStr(d = new Date()) { return d.toISOString().slice(0, 10); }

function fmt(s) {
  const m = String(Math.floor(s / 60)).padStart(2, '0');
  const sec = String(s % 60).padStart(2, '0');
  return `${m}:${sec}`;
}

function fmtMin(totalSecs) {
  const h = Math.floor(totalSecs / 3600);
  const m = Math.floor((totalSecs % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

let _toastTimer;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('on');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('on'), 2800);
}

function vibrate(pattern = [50]) {
  if (CFG.vibrationEnabled && 'vibrate' in navigator) {
    navigator.vibrate(pattern);
  }
}

function bell() {
  if (!CFG.soundEnabled) return;
  try {
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    [[660, 0], [880, 0.2], [1100, 0.4], [880, 0.7]].forEach(([f, t]) => {
      const o = ac.createOscillator(), g = ac.createGain();
      o.connect(g); g.connect(ac.destination);
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.25, ac.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + t + 0.7);
      o.start(ac.currentTime + t);
      o.stop(ac.currentTime + t + 0.8);
    });
  } catch (_) {}
}

async function notify(title, body) {
  if (!CFG.notificationsEnabled) return;
  if (!('Notification' in window)) return;
  
  if (Notification.permission === 'granted') {
    try {
      await navigator.serviceWorker.ready.then(reg => {
        reg.showNotification(title, {
          body,
          icon: './icon-192.png',
          badge: './icon-192.png',
          tag: 'focus-timer',
          requireInteraction: true,
          actions: [
            { action: 'dismiss', title: 'Dismiss' }
          ]
        });
      });
    } catch (e) {
      // Fallback to regular notification
      new Notification(title, { body, icon: './icon-192.png' });
    }
  }
}

const $ = id => document.getElementById(id);

// ── Storage ──────────────────────────────────────
function getLogs() {
  try {
    const cfg = JSON.parse(localStorage.getItem('focus_cfg') || '{}');
    if (cfg.studyMins) CFG.studyMins = cfg.studyMins;
    if (cfg.breakMins) CFG.breakMins = cfg.breakMins;
    if (cfg.soundEnabled !== undefined) CFG.soundEnabled = cfg.soundEnabled;
    if (cfg.vibrationEnabled !== undefined) CFG.vibrationEnabled = cfg.vibrationEnabled;
    if (cfg.notificationsEnabled !== undefined) CFG.notificationsEnabled = cfg.notificationsEnabled;
    return JSON.parse(localStorage.getItem('focus_logs') || '[]');
  } catch { return []; }
}

function setLogs(logs) {
  try { localStorage.setItem('focus_logs', JSON.stringify(logs)); } catch (_) {}
}

function saveCfg() {
  try { 
    localStorage.setItem('focus_cfg', JSON.stringify({ 
      studyMins: CFG.studyMins, 
      breakMins: CFG.breakMins,
      soundEnabled: CFG.soundEnabled,
      vibrationEnabled: CFG.vibrationEnabled,
      notificationsEnabled: CFG.notificationsEnabled
    })); 
  } catch (_) {}
}

// ── Ring ─────────────────────────────────────────
const CIRC = 2 * Math.PI * 68;
function setRing(ratio, mode) {
  const r = $('ringProg');
  r.style.strokeDashoffset = CIRC * (1 - Math.max(0, Math.min(1, ratio)));
  r.className = 'ring-prog' + (mode === 'break' ? ' break' : mode === 'done' ? ' done' : '');
}

// ── Render ───────────────────────────────────────
function render() {
  const sTotal = CFG.studyMins * 60;
  const bTotal = CFG.breakMins * 60;
  const paused = S.mode === 'paused';

  const dot   = $('phaseDot');
  const label = $('phaseLabel');
  const sub   = $('timeSub');

  dot.className = 'phase-dot';
  if      (S.mode === 'study')  { dot.classList.add('study'); label.textContent = 'Study'; }
  else if (S.mode === 'break')  { dot.classList.add('break'); label.textContent = 'Break'; }
  else if (S.mode === 'done')   { dot.classList.add('done');  label.textContent = 'Done'; }
  else if (S.mode === 'paused') { label.textContent = 'Paused'; }
  else                          { label.textContent = 'Ready'; }

  const timeEl = $('bigTime');
  if (S.mode === 'idle') {
    timeEl.textContent = fmt(CFG.studyMins * 60);
    sub.textContent = 'tap to begin';
    setRing(1, 'idle');
  } else if (S.mode === 'study') {
    timeEl.textContent = fmt(S.secs);
    sub.textContent = 'stay focused';
    setRing(S.secs / sTotal, 'study');
  } else if (S.mode === 'break') {
    timeEl.textContent = fmt(S.secs);
    sub.textContent = 'take a breath';
    setRing(S.secs / bTotal, 'break');
  } else if (S.mode === 'paused') {
    sub.textContent = 'paused';
  } else if (S.mode === 'done') {
    timeEl.textContent = '✓';
    sub.textContent = 'well done, Yan!';
    setRing(1, 'done');
  }

  $('pausedBadge').classList.toggle('show', paused);
  $('pCount').textContent = S.pauseCount;
  document.querySelector('.ring-center').style.opacity = paused ? '.4' : '1';

  const idle = S.mode === 'idle' || S.mode === 'done';
  $('endBtn').disabled = idle;
  $('startBtn').textContent = idle ? 'Start' : paused ? 'Resume' : 'Pause';
  
  // Update quick action buttons
  document.querySelectorAll('.quick-btn').forEach(btn => {
    btn.classList.toggle('active', parseInt(btn.dataset.mins) === CFG.studyMins);
  });
}

// ── Tick ─────────────────────────────────────────
function stopTick() { clearInterval(S.timer); S.timer = null; }
function startTick() {
  stopTick();
  S.timer = setInterval(() => {
    S.secs--;
    if (S.mode === 'study') S.studiedSecs++;

    if (S.secs <= 0) {
      if (S.mode === 'study') {
        bell();
        vibrate([100, 50, 100]);
        toast('Study done — break time! 🌿');
        notify('Study Complete!', 'Time for a break. Great work!');
        S.mode = 'break';
        S.secs = CFG.breakMins * 60;
      } else if (S.mode === 'break') {
        stopTick();
        bell();
        vibrate([200, 100, 200, 100, 200]);
        toast('Session complete! Great work, Yan 🎉');
        notify('Session Complete!', 'You\'ve completed a full focus session!');
        commitSession(CFG.studyMins * 60);
        return;
      }
    }
    render();
  }, 1000);
}

// ── Session save ─────────────────────────────────
function commitSession(studied) {
  studied = Math.max(0, studied);
  const log = {
    date: S.today,
    start: S.studyStart
      ? new Date(S.studyStart).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : '--:--',
    end: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    pauses: S.pauseCount,
    studied
  };
  const logs = getLogs();
  logs.push(log);
  setLogs(logs);
  refreshStats(logs);
  if (activeTab === 'chart') showChart(logs);
  S.mode = 'done';
  render();
}

// ── Controls ─────────────────────────────────────
function startSession() {
  if (S.mode === 'idle' || S.mode === 'done') {
    S.mode = 'study';
    S.secs = CFG.studyMins * 60;
    S.pauseCount = 0;
    S.studiedSecs = 0;
    S.studyStart = Date.now();
    S.today = dateStr();
    vibrate([30]);
    render();
    startTick();
  } else if (S.mode === 'study' || S.mode === 'break') {
    S.pauseFrom = S.mode;
    S.mode = 'paused';
    S.pauseCount++;
    stopTick();
    vibrate([50]);
    render();
  } else if (S.mode === 'paused') {
    S.mode = S.pauseFrom;
    vibrate([30]);
    render();
    startTick();
  }
}

$('startBtn').addEventListener('click', startSession);

$('endBtn').addEventListener('click', () => {
  if (S.mode === 'idle' || S.mode === 'done') return;
  stopTick();
  const studied = S.mode === 'break' ? CFG.studyMins * 60 : S.studiedSecs;
  commitSession(studied);
  vibrate([50]);
  toast('Session saved 💾');
});

// ── Quick Actions ────────────────────────────────
document.querySelectorAll('.quick-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    if (S.mode !== 'idle' && S.mode !== 'done') {
      toast('End current session first');
      return;
    }
    CFG.studyMins = parseInt(btn.dataset.mins);
    saveCfg();
    vibrate([30]);
    render();
    toast(`${CFG.studyMins} minutes selected`);
  });
});

// ── Settings ─────────────────────────────────────
function toggleDrawer() {
  const d = $('drawer');
  const open = d.classList.toggle('open');
  $('gearBtn').classList.toggle('open', open);
  if (open) {
    $('studyMins').value = CFG.studyMins;
    $('breakMins').value = CFG.breakMins;
    updateToggleButtons();
  }
}

function updateToggleButtons() {
  const notifyBtn = $('notifyToggle');
  const vibrateBtn = $('vibrateToggle');
  
  notifyBtn.setAttribute('aria-pressed', CFG.notificationsEnabled);
  notifyBtn.querySelector('.toggle-label').textContent = CFG.notificationsEnabled ? 'On' : 'Off';
  
  vibrateBtn.setAttribute('aria-pressed', CFG.vibrationEnabled);
  vibrateBtn.querySelector('.toggle-label').textContent = CFG.vibrationEnabled ? 'On' : 'Off';
}

$('gearBtn').addEventListener('click', toggleDrawer);

$('applyBtn').addEventListener('click', () => {
  CFG.studyMins = Math.max(1, Math.min(90, parseInt($('studyMins').value) || 25));
  CFG.breakMins = Math.max(1, Math.min(30, parseInt($('breakMins').value) || 5));
  saveCfg();
  $('drawer').classList.remove('open');
  $('gearBtn').classList.remove('open');
  if (S.mode === 'idle' || S.mode === 'done') render();
  toast(`${CFG.studyMins}m study / ${CFG.breakMins}m break saved ✓`);
});

// Sound toggle
$('soundBtn').addEventListener('click', () => {
  CFG.soundEnabled = !CFG.soundEnabled;
  $('soundBtn').classList.toggle('muted', !CFG.soundEnabled);
  saveCfg();
  toast(CFG.soundEnabled ? 'Sound enabled 🔊' : 'Sound muted 🔇');
});

// Notification toggle
$('notifyToggle').addEventListener('click', async () => {
  if (!CFG.notificationsEnabled) {
    if (!('Notification' in window)) {
      toast('Notifications not supported');
      return;
    }
    const perm = await Notification.requestPermission();
    if (perm === 'granted') {
      CFG.notificationsEnabled = true;
      toast('Notifications enabled 🔔');
    } else {
      toast('Notification permission denied');
    }
  } else {
    CFG.notificationsEnabled = false;
    toast('Notifications disabled 🔕');
  }
  updateToggleButtons();
  saveCfg();
});

// Vibration toggle
$('vibrateToggle').addEventListener('click', () => {
  CFG.vibrationEnabled = !CFG.vibrationEnabled;
  if (CFG.vibrationEnabled) vibrate([50]);
  updateToggleButtons();
  saveCfg();
  toast(CFG.vibrationEnabled ? 'Vibration enabled 📳' : 'Vibration disabled');
});

// ── Stats ─────────────────────────────────────────
function refreshStats(logs) {
  const today = dateStr();
  const todaySecs = logs.filter(l => l.date === today).reduce((a, l) => a + (l.studied || 0), 0);
  $('todayVal').textContent = fmtMin(todaySecs) || '0m';
  $('totalSessions').textContent = logs.length;

  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());
  weekStart.setHours(0, 0, 0, 0);
  const weekSecs = logs.filter(l => new Date(l.date) >= weekStart).reduce((a, l) => a + (l.studied || 0), 0);
  $('weekVal').textContent = fmtMin(weekSecs) || '0m';

  let streak = 0;
  const d = new Date();
  while (true) {
    const key = dateStr(d);
    if (!logs.some(l => l.date === key)) break;
    streak++;
    d.setDate(d.getDate() - 1);
  }
  $('streakCount').textContent = streak;
}

// ── Chart ─────────────────────────────────────────
function showChart(logs) {
  activeTab = 'chart';
  $('tabChart').classList.add('on');
  $('tabChart').setAttribute('aria-selected', 'true');
  $('tabLog').classList.remove('on');
  $('tabLog').setAttribute('aria-selected', 'false');

  const today = new Date();
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today - (6 - i) * 864e5);
    const key = dateStr(d);
    const min = Math.round(
      logs.filter(l => l.date === key).reduce((a, l) => a + (l.studied || 0), 0) / 60
    );
    return { label: d.toLocaleDateString('en', { weekday: 'short' }), min };
  });

  $('panel').innerHTML = `
    <div class="chart-wrap">
      <div class="chart-head">Last 7 Days · Minutes Studied</div>
      <canvas id="chartCvs" width="316" height="100"></canvas>
    </div>`;

  if (chartInst) { chartInst.destroy(); chartInst = null; }
  chartInst = new Chart($('chartCvs').getContext('2d'), {
    type: 'bar',
    data: {
      labels: days.map(d => d.label),
      datasets: [{
        data: days.map(d => d.min),
        backgroundColor: days.map(d => d.min > 0 ? 'rgba(167,139,250,0.65)' : 'rgba(255,255,255,0.04)'),
        borderColor: days.map(d => d.min > 0 ? 'rgba(167,139,250,1)' : 'transparent'),
        borderWidth: 1.5,
        borderRadius: 6,
      }]
    },
    options: {
      responsive: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#1a1a24',
          titleColor: '#f1f0f5',
          bodyColor: '#a78bfa',
          borderColor: 'rgba(167,139,250,.3)',
          borderWidth: 1,
          callbacks: { label: ctx => ` ${ctx.parsed.y} min` }
        }
      },
      scales: {
        x: { ticks: { color: '#5a5970', font: { size: 10, family: 'Syne' } }, grid: { display: false } },
        y: { beginAtZero: true, ticks: { color: '#5a5970', font: { size: 9, family: 'Syne' }, stepSize: 15 }, grid: { color: 'rgba(255,255,255,0.04)' } }
      }
    }
  });
}

// ── Log ───────────────────────────────────────────
function showLog(logs) {
  activeTab = 'log';
  $('tabLog').classList.add('on');
  $('tabLog').setAttribute('aria-selected', 'true');
  $('tabChart').classList.remove('on');
  $('tabChart').setAttribute('aria-selected', 'false');

  if (!logs.length) {
    $('panel').innerHTML = `<div class="empty-msg">No sessions yet. Start one!</div>`;
    return;
  }
  $('panel').innerHTML = `
    <div class="log-head">
      <span class="log-meta">${logs.length} session${logs.length > 1 ? 's' : ''}</span>
      <button class="clear-btn" id="clearBtn">Clear All</button>
    </div>
    <ul class="log-list">
      ${logs.slice().reverse().map(l => `
        <li>
          <strong>${l.date}</strong> &nbsp; ${l.start} → ${l.end}<br>
          ⏱ <strong>${fmtMin(l.studied)}</strong> studied &nbsp;·&nbsp; ⏸ ${l.pauses} pause${l.pauses !== 1 ? 's' : ''}
        </li>`).join('')}
    </ul>`;

  $('clearBtn').addEventListener('click', () => {
    if (confirm('Clear all session history?')) {
      setLogs([]);
      refreshStats([]);
      showLog([]);
      toast('History cleared');
    }
  });
}

$('tabChart').addEventListener('click', () => { const logs = getLogs(); showChart(logs); });
$('tabLog').addEventListener('click', () => { const logs = getLogs(); showLog(logs); });

// ── PWA Install Prompt ───────────────────────────
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  
  // Show install banner after 3 seconds if not dismissed before
  const dismissed = localStorage.getItem('focus_install_dismissed');
  if (!dismissed) {
    setTimeout(() => {
      $('installBanner').classList.add('show');
    }, 3000);
  }
});

$('installBtn').addEventListener('click', async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  const { outcome } = await deferredPrompt.userChoice;
  if (outcome === 'accepted') {
    toast('Focus installed! 🎉');
    localStorage.setItem('focus_install_dismissed', 'true');
  }
  $('installBanner').classList.remove('show');
  deferredPrompt = null;
});

$('dismissInstall').addEventListener('click', () => {
  $('installBanner').classList.remove('show');
  localStorage.setItem('focus_install_dismissed', 'true');
});

// ── Network Status ───────────────────────────────
function updateNetworkStatus() {
  const status = $('networkStatus');
  const isOnline = navigator.onLine;
  
  status.classList.add('show');
  status.classList.toggle('offline', !isOnline);
  status.querySelector('.network-text').textContent = isOnline ? 'Online' : 'Offline';
  
  if (!isOnline) {
    toast('You\'re offline. Timer will still work!');
  }
  
  // Hide after 3 seconds when online
  if (isOnline) {
    setTimeout(() => status.classList.remove('show'), 3000);
  }
}

window.addEventListener('online', updateNetworkStatus);
window.addEventListener('offline', updateNetworkStatus);

// ── Keyboard Shortcuts ───────────────────────────
document.addEventListener('keydown', (e) => {
  // Ignore if typing in input
  if (e.target.tagName === 'INPUT') return;
  
  switch(e.key) {
    case ' ':
      e.preventDefault();
      startSession();
      break;
    case 'e':
    case 'E':
      if (S.mode !== 'idle' && S.mode !== 'done') {
        $('endBtn').click();
      }
      break;
    case 's':
    case 'S':
      toggleDrawer();
      break;
    case '1':
      if (S.mode === 'idle' || S.mode === 'done') {
        CFG.studyMins = 15;
        saveCfg();
        render();
        toast('15 minutes selected');
      }
      break;
    case '2':
      if (S.mode === 'idle' || S.mode === 'done') {
        CFG.studyMins = 25;
        saveCfg();
        render();
        toast('25 minutes selected');
      }
      break;
    case '3':
      if (S.mode === 'idle' || S.mode === 'done') {
        CFG.studyMins = 45;
        saveCfg();
        render();
        toast('45 minutes selected');
      }
      break;
    case '4':
      if (S.mode === 'idle' || S.mode === 'done') {
        CFG.studyMins = 60;
        saveCfg();
        render();
        toast('60 minutes selected');
      }
      break;
    case 'c':
    case 'C':
      $('tabChart').click();
      break;
    case 'l':
    case 'L':
      $('tabLog').click();
      break;
    case '?':
      $('helpPanel').classList.toggle('show');
      break;
    case 'Escape':
      $('drawer').classList.remove('open');
      $('gearBtn').classList.remove('open');
      $('helpPanel').classList.remove('show');
      break;
  }
});

// Keyboard help toggle
$('helpToggle').addEventListener('click', () => {
  $('helpPanel').classList.toggle('show');
});

// Close help panel when clicking outside
document.addEventListener('click', (e) => {
  if (!e.target.closest('.keyboard-help')) {
    $('helpPanel').classList.remove('show');
  }
});

// ── Visibility API (pause when tab hidden) ───────
document.addEventListener('visibilitychange', () => {
  // Optional: could pause timer when tab is hidden
  // Currently keeping timer running for flexibility
});

// ── Init ─────────────────────────────────────────
(function init() {
  const logs = getLogs();
  S.secs = CFG.studyMins * 60;
  
  // Update sound button state
  $('soundBtn').classList.toggle('muted', !CFG.soundEnabled);
  
  render();
  refreshStats(logs);
  showChart(logs);
  
  // Check initial network status
  updateNetworkStatus();
  
  // Request notification permission on first load if enabled
  if (CFG.notificationsEnabled && 'Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }
  
  console.log('🎯 Focus Timer initialized');
  console.log('⌨️ Press ? for keyboard shortcuts');
})();
