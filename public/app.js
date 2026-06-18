const { SUPABASE_URL, SUPABASE_ANON_KEY } = window.SCANNER_CONFIG;
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const GRADE_COLOR = { 'A+': 'var(--gold)', A: 'var(--gold)', B: 'var(--grey)', C: 'var(--grey)', Ignore: 'var(--grey)' };
const SIGNAL_COLOR = { BUY: 'var(--green)', SELL: 'var(--red)', NONE: 'var(--grey)' };

let allRows = [];
let activeFilter = 'all';

function fmtPrice(p) {
  if (p == null) return '--';
  const n = Number(p);
  if (n >= 100) return n.toFixed(2);
  if (n >= 1) return n.toFixed(3);
  return n.toFixed(6);
}

function fmtAgo(iso) {
  if (!iso) return '--';
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  return `${Math.round(mins / 60)} hr ago`;
}

function renderClock() {
  document.getElementById('clock').textContent = new Date().toLocaleTimeString('en-GB', {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}
setInterval(renderClock, 1000);
renderClock();

function gaugeStyle(score, color) {
  const deg = Math.max(0, Math.min(100, score || 0)) * 3.6;
  return `background: conic-gradient(${color} ${deg}deg, var(--panel-2) ${deg}deg)`;
}

function rowTemplate(r) {
  const edge = SIGNAL_COLOR[r.signal] || 'var(--grey)';
  const gradeColor = GRADE_COLOR[r.grade] || 'var(--grey)';
  const chips = [
    { label: 'Trend', ok: r.weekly_trend === r.daily_trend && r.daily_trend !== 'Neutral' },
    { label: 'RSI', ok: r.rsi != null && (r.rsi < 30 || r.rsi > 70) },
    { label: 'Div', ok: !!r.divergence && r.divergence !== 'None' },
    { label: 'S/R', ok: !!(r.support_detected || r.resistance_detected) },
    { label: 'Candle', ok: !!r.candlestick_pattern },
  ];
  return `
    <div class="ticket" style="--edge:${edge}">
      <div class="ticket-main">
        <div class="ticket-head">
          <span class="grade-tag" style="color:${gradeColor}; border-color:${gradeColor}">${r.grade}</span>
          <span class="symbol">${r.symbol}</span>
          <span class="signal-tag signal-${(r.signal || 'none').toLowerCase()}">${r.signal}</span>
        </div>
        <div class="ticket-sub">
          ${r.daily_trend || 'Neutral'} trend &middot; RSI ${r.rsi != null ? Number(r.rsi).toFixed(1) : '--'} &middot; ${r.divergence || 'None'} divergence
        </div>
        <div class="chip-row">
          ${chips.map((c) => `<span class="chip ${c.ok ? 'chip-on' : ''}">${c.label}</span>`).join('')}
        </div>
        <div class="ticket-foot">
          <span>Price ${fmtPrice(r.price)}</span>
          <span>${r.candlestick_pattern || 'No candle pattern'}</span>
        </div>
      </div>
      <div class="gauge" style="${gaugeStyle(r.score, gradeColor)}">
        <div class="gauge-inner">${r.score}</div>
      </div>
    </div>
  `;
}

function render() {
  const list = document.getElementById('signalList');
  const filtered = allRows.filter((r) => {
    if (r.score == null || r.score < 70) return false;
    if (activeFilter === 'all') return true;
    return r.grade === activeFilter;
  });
  if (!filtered.length) {
    list.innerHTML = '<div class="empty-state">No setups above 70 right now. The scanner re-checks every 15 minutes.</div>';
    return;
  }
  list.innerHTML = filtered.map(rowTemplate).join('');
}

async function loadSignals() {
  const { data, error } = await sb.from('coin_state').select('*').order('score', { ascending: false });
  if (error) {
    document.getElementById('signalList').innerHTML = `<div class="empty-state">Could not load signals: ${error.message}</div>`;
    return;
  }
  allRows = data || [];
  document.getElementById('symbolCount').textContent = allRows.length;
  render();
}

async function loadLastRun() {
  const { data } = await sb.from('scan_runs').select('*').order('started_at', { ascending: false }).limit(1).maybeSingle();
  if (data) {
    document.getElementById('lastScan').textContent = `${fmtAgo(data.finished_at || data.started_at)} (${data.status})`;
  }
}

document.getElementById('filterbar').addEventListener('click', (e) => {
  const btn = e.target.closest('.filter');
  if (!btn) return;
  document.querySelectorAll('.filter').forEach((b) => b.classList.remove('active'));
  btn.classList.add('active');
  activeFilter = btn.dataset.grade;
  render();
});

document.getElementById('scanBtn').addEventListener('click', async () => {
  const btn = document.getElementById('scanBtn');
  const status = document.getElementById('scanStatus');
  btn.disabled = true;
  btn.textContent = 'Scanning…';
  status.textContent = '';
  status.className = 'scan-status';
  try {
    const res = await fetch('/api/scan-now');
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = null; }
    if (!res.ok) {
      status.textContent = `Scan failed (${res.status}): ${(data && data.error) || text || 'unknown error'}`;
      status.className = 'scan-status error';
    } else {
      status.textContent = `Scanned ${data.scanned} pairs, ${data.signals} signal(s) found.`;
      status.className = 'scan-status ok';
    }
  } catch (e) {
    status.textContent = `Could not reach the scanner: ${e.message}`;
    status.className = 'scan-status error';
  } finally {
    await loadSignals();
    await loadLastRun();
    btn.disabled = false;
    btn.textContent = 'Scan now';
  }
});

loadSignals();
loadLastRun();
setInterval(() => { loadSignals(); loadLastRun(); }, 60000);
