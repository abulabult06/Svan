// Core engine for the RSI Divergence + Market Structure strategy.
// Shared by both netlify/functions/scan.js (scheduled) and scan-now.js (manual trigger).

const { createClient } = require('@supabase/supabase-js');

const MAX_SYMBOLS = 30;        // how many top-volume USDT pairs to watch
const CONCURRENCY = 8;         // symbols processed in parallel per batch
const EXCLUDE_SUFFIX = /(UP|DOWN|BULL|BEAR)USDT$/;
const STABLE_PAIRS = new Set(['USDCUSDT', 'FDUSDUSDT', 'BUSDUSDT', 'TUSDUSDT', 'DAIUSDT', 'USDPUSDT']);

// ---------- Supabase ----------

let _client = null;
function getSupabaseClient() {
  if (!_client) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables');
    }
    _client = createClient(url, key, { auth: { persistSession: false } });
  }
  return _client;
}

// ---------- Binance ----------

async function fetchTopTickers(limit) {
  const res = await fetch('https://api.binance.com/api/v3/ticker/24hr');
  if (!res.ok) throw new Error(`Binance ticker fetch failed: ${res.status}`);
  const all = await res.json();
  const filtered = all.filter(
    (t) => t.symbol.endsWith('USDT') && !EXCLUDE_SUFFIX.test(t.symbol) && !STABLE_PAIRS.has(t.symbol)
  );
  filtered.sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume));
  return filtered.slice(0, limit);
}

async function fetchKlines(symbol, interval, limit) {
  const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Klines fetch failed for ${symbol} ${interval}: ${res.status}`);
  const raw = await res.json();
  return raw.map((k) => ({
    openTime: k[0],
    open: parseFloat(k[1]),
    high: parseFloat(k[2]),
    low: parseFloat(k[3]),
    close: parseFloat(k[4]),
    volume: parseFloat(k[5]),
    closeTime: k[6],
  }));
}

// ---------- Indicators ----------

function computeRSI(closes, period = 14) {
  const rsi = new Array(closes.length).fill(null);
  if (closes.length <= period) return rsi;
  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gainSum += diff;
    else lossSum -= diff;
  }
  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;
  rsi[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    rsi[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return rsi;
}

function findSwingPoints(candles, lookback = 2) {
  const swings = [];
  for (let i = lookback; i < candles.length - lookback; i++) {
    const windowHighs = candles.slice(i - lookback, i + lookback + 1).map((c) => c.high);
    const windowLows = candles.slice(i - lookback, i + lookback + 1).map((c) => c.low);
    if (candles[i].high === Math.max(...windowHighs)) swings.push({ index: i, type: 'high', price: candles[i].high });
    if (candles[i].low === Math.min(...windowLows)) swings.push({ index: i, type: 'low', price: candles[i].low });
  }
  return swings;
}

function detectTrend(candles) {
  const swings = findSwingPoints(candles, 2);
  const highs = swings.filter((s) => s.type === 'high');
  const lows = swings.filter((s) => s.type === 'low');
  if (highs.length < 2 || lows.length < 2) return 'Neutral';
  const [prevHigh, lastHigh] = highs.slice(-2);
  const [prevLow, lastLow] = lows.slice(-2);
  if (lastHigh.price > prevHigh.price && lastLow.price > prevLow.price) return 'Bullish';
  if (lastHigh.price < prevHigh.price && lastLow.price < prevLow.price) return 'Bearish';
  return 'Neutral';
}

function detectDivergence(candles, rsiValues) {
  const swings = findSwingPoints(candles, 2).filter((s) => rsiValues[s.index] != null);
  const highs = swings.filter((s) => s.type === 'high');
  const lows = swings.filter((s) => s.type === 'low');
  if (highs.length >= 2) {
    const [prev, last] = highs.slice(-2);
    if (last.price > prev.price && rsiValues[last.index] < rsiValues[prev.index]) return 'Bearish';
  }
  if (lows.length >= 2) {
    const [prev, last] = lows.slice(-2);
    if (last.price < prev.price && rsiValues[last.index] > rsiValues[prev.index]) return 'Bullish';
  }
  return null;
}

function buildZones(candles, lookback = 2, clusterPct = 1.0) {
  const swings = findSwingPoints(candles, lookback);
  const cluster = (levels) => {
    const sorted = [...levels].sort((a, b) => a - b);
    const zones = [];
    for (const lvl of sorted) {
      const zone = zones.find((z) => (Math.abs(lvl - z.level) / z.level) * 100 <= clusterPct);
      if (zone) {
        zone.level = (zone.level + lvl) / 2;
        zone.count += 1;
      } else {
        zones.push({ level: lvl, count: 1 });
      }
    }
    return zones;
  };
  return {
    support: cluster(swings.filter((s) => s.type === 'low').map((s) => s.price)),
    resistance: cluster(swings.filter((s) => s.type === 'high').map((s) => s.price)),
  };
}

function nearLevel(price, zones, thresholdPct) {
  return zones.some((z) => (Math.abs(price - z.level) / z.level) * 100 <= thresholdPct);
}

function bodySize(c) { return Math.abs(c.close - c.open); }
function fullRange(c) { return c.high - c.low; }
function upperWick(c) { return c.high - Math.max(c.open, c.close); }
function lowerWick(c) { return Math.min(c.open, c.close) - c.low; }
function isBullishCandle(c) { return c.close > c.open; }
function isBearishCandle(c) { return c.close < c.open; }

function detectCandlestick(candles) {
  const n = candles.length;
  if (n < 3) return { pattern: null, direction: null };
  const c0 = candles[n - 1];
  const c1 = candles[n - 2];
  const c2 = candles[n - 3];

  if (isBearishCandle(c1) && isBullishCandle(c0) && c0.close >= c1.open && c0.open <= c1.close) {
    return { pattern: 'Bullish Engulfing', direction: 'bullish' };
  }
  if (isBullishCandle(c1) && isBearishCandle(c0) && c0.open >= c1.close && c0.close <= c1.open) {
    return { pattern: 'Bearish Engulfing', direction: 'bearish' };
  }
  if (fullRange(c0) > 0 && lowerWick(c0) >= 2 * bodySize(c0) && upperWick(c0) <= bodySize(c0) * 0.3 && bodySize(c0) / fullRange(c0) < 0.4) {
    return { pattern: 'Hammer', direction: 'bullish' };
  }
  if (fullRange(c0) > 0 && upperWick(c0) >= 2 * bodySize(c0) && lowerWick(c0) <= bodySize(c0) * 0.3 && bodySize(c0) / fullRange(c0) < 0.4) {
    return { pattern: 'Shooting Star', direction: 'bearish' };
  }
  if (isBearishCandle(c2) && bodySize(c1) < bodySize(c2) * 0.6 && isBullishCandle(c0) && c0.close > (c2.open + c2.close) / 2) {
    return { pattern: 'Morning Star', direction: 'bullish' };
  }
  if (isBullishCandle(c2) && bodySize(c1) < bodySize(c2) * 0.6 && isBearishCandle(c0) && c0.close < (c2.open + c2.close) / 2) {
    return { pattern: 'Evening Star', direction: 'bearish' };
  }
  return { pattern: null, direction: null };
}

function rsiCondition(rsiSeries) {
  const last = rsiSeries[rsiSeries.length - 1];
  const prev = rsiSeries[rsiSeries.length - 2];
  if (last == null) return { points: 0, bias: null };
  if (last < 30) return { points: 20, bias: 'bullish' };
  if (last > 70) return { points: 20, bias: 'bearish' };
  if (prev != null && prev < 30 && last >= 30) return { points: 15, bias: 'bullish' };
  if (prev != null && prev > 70 && last <= 70) return { points: 15, bias: 'bearish' };
  return { points: 0, bias: null };
}

// ---------- Scoring ----------

function buildSignalForSymbol(symbol, ctx) {
  const { weeklyTrend, dailyTrend, rsiSeries, divergence, zones, lastPrice, candle } = ctx;
  const rc = rsiCondition(rsiSeries);

  let bias = null;
  if (divergence === 'Bullish') bias = 'bullish';
  else if (divergence === 'Bearish') bias = 'bearish';
  else if (dailyTrend === 'Bullish') bias = 'bullish';
  else if (dailyTrend === 'Bearish') bias = 'bearish';

  let trendPoints = 0;
  if (bias === 'bullish') {
    if (weeklyTrend === 'Bullish' && dailyTrend === 'Bullish') trendPoints = 20;
    else if (dailyTrend === 'Bullish' || weeklyTrend === 'Bullish') trendPoints = 12;
  } else if (bias === 'bearish') {
    if (weeklyTrend === 'Bearish' && dailyTrend === 'Bearish') trendPoints = 20;
    else if (dailyTrend === 'Bearish' || weeklyTrend === 'Bearish') trendPoints = 12;
  }

  const rsiPoints = rc.bias === bias ? rc.points : 0;
  const divergencePoints = divergence && bias && divergence.toLowerCase() === bias ? 25 : 0;

  let nearSupport = false;
  let nearResistance = false;
  let srPoints = 0;
  if (bias === 'bullish') {
    nearSupport = nearLevel(lastPrice, zones.support, 1.5);
    srPoints = nearSupport ? 20 : nearLevel(lastPrice, zones.support, 3) ? 10 : 0;
  } else if (bias === 'bearish') {
    nearResistance = nearLevel(lastPrice, zones.resistance, 1.5);
    srPoints = nearResistance ? 20 : nearLevel(lastPrice, zones.resistance, 3) ? 10 : 0;
  }

  const candlePoints = candle.direction === bias ? 15 : 0;
  const score = trendPoints + rsiPoints + divergencePoints + srPoints + candlePoints;
  const grade = score >= 90 ? 'A+' : score >= 80 ? 'A' : score >= 70 ? 'B' : score >= 60 ? 'C' : 'Ignore';
  const signal = score >= 70 && bias === 'bullish' ? 'BUY' : score >= 70 && bias === 'bearish' ? 'SELL' : 'NONE';

  return {
    symbol,
    trend: dailyTrend,
    weeklyTrend,
    dailyTrend,
    rsi: rsiSeries[rsiSeries.length - 1],
    divergence: divergence || 'None',
    supportDetected: nearSupport,
    resistanceDetected: nearResistance,
    candlestickPattern: candle.pattern,
    score,
    grade,
    signal,
  };
}

async function processSymbol(symbol, ticker) {
  const [weekly, daily, entry] = await Promise.all([
    fetchKlines(symbol, '1w', 60),
    fetchKlines(symbol, '1d', 200),
    fetchKlines(symbol, '4h', 60),
  ]);
  if (daily.length < 30) return null;

  const rsiSeries = computeRSI(daily.map((c) => c.close), 14);
  const weeklyTrend = detectTrend(weekly);
  const dailyTrend = detectTrend(daily);
  const divergence = detectDivergence(daily, rsiSeries);
  const zones = buildZones(daily, 2, 1.0);
  const candle = detectCandlestick(entry);
  const lastPrice = daily[daily.length - 1].close;

  const built = buildSignalForSymbol(symbol, { weeklyTrend, dailyTrend, rsiSeries, divergence, zones, lastPrice, candle });
  built.lastPrice = lastPrice;
  built.volume24h = ticker ? parseFloat(ticker.quoteVolume) : null;
  built.priceChangePct = ticker ? parseFloat(ticker.priceChangePercent) : null;
  return built;
}

function toDbRow(r) {
  return {
    symbol: r.symbol,
    price: r.lastPrice,
    volume_24h: r.volume24h,
    price_change_pct: r.priceChangePct,
    price_updated_at: new Date().toISOString(),
    trend: r.trend,
    weekly_trend: r.weeklyTrend,
    daily_trend: r.dailyTrend,
    rsi: r.rsi,
    divergence: r.divergence,
    support_detected: r.supportDetected,
    resistance_detected: r.resistanceDetected,
    candlestick_pattern: r.candlestickPattern,
    score: r.score,
    grade: r.grade,
    signal: r.signal,
    strategy_updated_at: new Date().toISOString(),
  };
}

async function runScan(trigger = 'scheduled') {
  const supabase = getSupabaseClient();
  const { data: runRow, error: insertErr } = await supabase
    .from('scan_runs')
    .insert({ run_type: trigger, status: 'running' })
    .select()
    .single();
  if (insertErr) throw insertErr;

  try {
    const tickers = await fetchTopTickers(MAX_SYMBOLS);
    const tickerMap = new Map(tickers.map((t) => [t.symbol, t]));
    const symbols = tickers.map((t) => t.symbol);

    const rows = [];
    for (let i = 0; i < symbols.length; i += CONCURRENCY) {
      const batch = symbols.slice(i, i + CONCURRENCY);
      const settled = await Promise.allSettled(batch.map((sym) => processSymbol(sym, tickerMap.get(sym))));
      for (const s of settled) {
        if (s.status === 'fulfilled' && s.value) rows.push(s.value);
        else if (s.status === 'rejected') console.error('Symbol scan failed:', s.reason && s.reason.message);
      }
    }

    if (rows.length) {
      const { error: upsertErr } = await supabase.from('coin_state').upsert(rows.map(toDbRow), { onConflict: 'symbol' });
      if (upsertErr) throw upsertErr;
    }

    await supabase
      .from('scan_runs')
      .update({ finished_at: new Date().toISOString(), status: 'success', symbols_scanned: rows.length })
      .eq('id', runRow.id);

    return { scanned: rows.length, signals: rows.filter((r) => r.signal !== 'NONE').length, runId: runRow.id };
  } catch (err) {
    await supabase
      .from('scan_runs')
      .update({ finished_at: new Date().toISOString(), status: 'error', error_message: String((err && err.message) || err) })
      .eq('id', runRow.id);
    throw err;
  }
}

module.exports = { runScan };
