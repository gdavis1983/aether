/**
 * Technical Analysis Indicators implemented in pure JavaScript
 */

/**
 * Calculate Simple Moving Average (SMA)
 * @param {number[]} prices - Array of close prices
 * @param {number} period - SMA period
 * @returns {number[]} Array of SMA values matching the input array length (null for initial periods)
 */
function calculateSMA(prices, period) {
  const sma = [];
  for (let i = 0; i < prices.length; i++) {
    if (i < period - 1) {
      sma.push(null);
    } else {
      let sum = 0;
      for (let j = 0; j < period; j++) {
        sum += prices[i - j];
      }
      sma.push(Number((sum / period).toFixed(2)));
    }
  }
  return sma;
}

/**
 * Calculate Exponential Moving Average (EMA)
 * @param {number[]} prices - Array of close prices
 * @param {number} period - EMA period
 * @returns {number[]} Array of EMA values matching the input array length (null for initial periods)
 */
function calculateEMA(prices, period) {
  const ema = [];
  if (prices.length === 0) return ema;

  const k = 2 / (period + 1);
  let prevEma = null;

  for (let i = 0; i < prices.length; i++) {
    if (i < period - 1) {
      ema.push(null);
    } else if (i === period - 1) {
      // First EMA is simple SMA
      let sum = 0;
      for (let j = 0; j < period; j++) {
        sum += prices[i - j];
      }
      prevEma = sum / period;
      ema.push(Number(prevEma.toFixed(2)));
    } else {
      const currentEma = prices[i] * k + prevEma * (1 - k);
      prevEma = currentEma;
      ema.push(Number(currentEma.toFixed(2)));
    }
  }
  return ema;
}

/**
 * Calculate Relative Strength Index (RSI)
 * @param {number[]} prices - Array of close prices
 * @param {number} period - RSI period (default 14)
 * @returns {number[]} Array of RSI values matching the input array length (null for initial periods)
 */
function calculateRSI(prices, period = 14) {
  const rsi = [];
  if (prices.length <= period) {
    return Array(prices.length).fill(null);
  }

  // Calculate price changes
  const changes = [];
  for (let i = 1; i < prices.length; i++) {
    changes.push(prices[i] - prices[i - 1]);
  }

  let avgGain = 0;
  let avgLoss = 0;

  // First values
  for (let i = 0; i < period; i++) {
    const change = changes[i];
    if (change > 0) {
      avgGain += change;
    } else {
      avgLoss += Math.abs(change);
    }
  }

  avgGain = avgGain / period;
  avgLoss = avgLoss / period;

  // Fill initial values with null
  for (let i = 0; i <= period; i++) {
    rsi.push(null);
  }

  // Calculate Wilder's smoothing RSI
  for (let i = period; i < changes.length; i++) {
    const change = changes[i];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? Math.abs(change) : 0;

    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;

    if (avgLoss === 0) {
      rsi.push(100);
    } else {
      const rs = avgGain / avgLoss;
      const rsiVal = 100 - 100 / (1 + rs);
      rsi.push(Number(rsiVal.toFixed(2)));
    }
  }

  return rsi;
}

/**
 * Calculate Moving Average Convergence Divergence (MACD)
 * @param {number[]} prices - Array of close prices
 * @param {number} fastPeriod - Fast EMA period (default 12)
 * @param {number} slowPeriod - Slow EMA period (default 26)
 * @param {number} signalPeriod - Signal line period (default 9)
 * @returns {object} Object containing arrays for macdLine, signalLine, and histogram
 */
function calculateMACD(prices, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
  const fastEma = calculateEMA(prices, fastPeriod);
  const slowEma = calculateEMA(prices, slowPeriod);

  const macdLine = [];
  for (let i = 0; i < prices.length; i++) {
    if (fastEma[i] === null || slowEma[i] === null) {
      macdLine.push(null);
    } else {
      macdLine.push(Number((fastEma[i] - slowEma[i]).toFixed(4)));
    }
  }

  // Filter out the nulls from macdLine to calculate signal line
  const firstMacdIndex = macdLine.findIndex(val => val !== null);
  const validMacdLine = macdLine.slice(firstMacdIndex);

  // Calculate signal line (EMA of MACD line)
  const validSignalLine = calculateEMA(validMacdLine, signalPeriod);

  // Re-align signal line with the original array size
  const signalLine = Array(firstMacdIndex).fill(null).concat(validSignalLine);

  // Calculate histogram (MACD - Signal)
  const histogram = [];
  for (let i = 0; i < prices.length; i++) {
    if (macdLine[i] === null || signalLine[i] === null) {
      histogram.push(null);
    } else {
      histogram.push(Number((macdLine[i] - signalLine[i]).toFixed(4)));
    }
  }

  return {
    macdLine,
    signalLine,
    histogram
  };
}

/**
 * Calculate Awesome Oscillator (AO)
 * AO = SMA(Median Price, 5) - SMA(Median Price, 34)
 * @param {object[]} candles - Array of candle objects { high, low }
 * @returns {number[]} Array of AO values matching input length
 */
function calculateAwesomeOscillator(candles) {
  const medianPrices = candles.map(c => (c.high + c.low) / 2);
  const sma5 = calculateSMA(medianPrices, 5);
  const sma34 = calculateSMA(medianPrices, 34);

  const ao = [];
  for (let i = 0; i < candles.length; i++) {
    if (sma5[i] === null || sma34[i] === null) {
      ao.push(null);
    } else {
      ao.push(Number((sma5[i] - sma34[i]).toFixed(4)));
    }
  }
  return ao;
}

/**
 * Calculate Fibonacci Retracement Levels based on recent high/low
 * @param {object[]} candles - Array of candle objects
 * @param {number} lookback - Lookback window size (default 50)
 * @returns {object} Object containing price points for Fib levels
 */
function calculateFibonacciLevels(candles, lookback = 50) {
  const slice = candles.slice(-lookback);
  if (slice.length === 0) return {};
  
  const highs = slice.map(c => c.high);
  const lows = slice.map(c => c.low);
  const maxHigh = Math.max(...highs);
  const minLow = Math.min(...lows);
  const diff = maxHigh - minLow;

  return {
    high: maxHigh,
    low: minLow,
    level236: Number((maxHigh - diff * 0.236).toFixed(2)),
    level382: Number((maxHigh - diff * 0.382).toFixed(2)),
    level500: Number((maxHigh - diff * 0.500).toFixed(2)),
    level618: Number((maxHigh - diff * 0.618).toFixed(2)),
  };
}

/**
 * Simple Algorithmic Elliott Wave Detector
 * Identifies local swings and labels them 1-2-3-4-5 based on rules.
 */
function calculateElliottWaves(candles) {
  const waves = Array(candles.length).fill(null);
  const decisions = Array(candles.length).fill({ decision: 'HOLD', reasoning: 'No pattern detected' });

  // 1. Identify local swing highs and lows (using a window of N = 4 candles on either side)
  const window = 4;
  const swings = []; // elements: { index, type: 'high'|'low', price, time }

  for (let i = window; i < candles.length - window; i++) {
    const current = candles[i];
    
    // Check if local low
    let isLow = true;
    for (let j = 1; j <= window; j++) {
      if (candles[i - j].low < current.low || candles[i + j].low < current.low) {
        isLow = false;
        break;
      }
    }

    // Check if local high
    let isHigh = true;
    for (let j = 1; j <= window; j++) {
      if (candles[i - j].high > current.high || candles[i + j].high > current.high) {
        isHigh = false;
        break;
      }
    }

    if (isLow) {
      swings.push({ index: i, type: 'low', price: current.low, time: current.time });
    } else if (isHigh) {
      swings.push({ index: i, type: 'high', price: current.high, time: current.time });
    }
  }

  // 2. Filter duplicate adjacent swing types (keep the extreme value)
  const cleanSwings = [];
  for (let i = 0; i < swings.length; i++) {
    const current = swings[i];
    if (cleanSwings.length === 0) {
      cleanSwings.push(current);
      continue;
    }
    const last = cleanSwings[cleanSwings.length - 1];
    if (last.type === current.type) {
      // Keep the more extreme swing
      if (last.type === 'low' && current.price < last.price) {
        cleanSwings[cleanSwings.length - 1] = current;
      } else if (last.type === 'high' && current.price > last.price) {
        cleanSwings[cleanSwings.length - 1] = current;
      }
    } else {
      cleanSwings.push(current);
    }
  }

  // 3. Scan forward to identify 5-wave structures
  // We need at least 5 swings to form waves 1-2-3-4-5
  for (let i = 4; i < cleanSwings.length; i++) {
    const s0 = cleanSwings[i - 4]; // low (start of 1)
    const s1 = cleanSwings[i - 3]; // high (wave 1 peak)
    const s2 = cleanSwings[i - 2]; // low (wave 2 bottom)
    const s3 = cleanSwings[i - 1]; // high (wave 3 peak)
    const s4 = cleanSwings[i];     // low (wave 4 bottom)

    // Check alternate structure: s0=low, s1=high, s2=low, s3=high, s4=low
    if (s0.type === 'low' && s1.type === 'high' && s2.type === 'low' && s3.type === 'high' && s4.type === 'low') {
      
      // Rule 1: Wave 2 cannot retrace > 100% of Wave 1
      const isRule1 = s2.price > s0.price;

      // Rule 2: Wave 3 cannot be the shortest (compare Wave 3 height to Wave 1 height)
      const wave1Height = s1.price - s0.price;
      const wave3Height = s3.price - s2.price;
      const isRule2 = wave3Height > 0 && wave3Height > wave1Height * 0.5; // Wave 3 is strong

      // Rule 3: Wave 4 cannot overlap with Wave 1 price territory
      const isRule3 = s4.price > s1.price;

      // Rule 4: Wave 3 peak must exceed Wave 1 peak
      const isRule4 = s3.price > s1.price;

      if (isRule1 && isRule2 && isRule3 && isRule4) {
        // Label waves
        waves[s1.index] = 'Wave 1';
        waves[s2.index] = 'Wave 2';
        waves[s3.index] = 'Wave 3';
        waves[s4.index] = 'Wave 4';

        // Set decisions for these points
        // Buying at the end of Wave 2 (index of s2) to ride Wave 3
        decisions[s2.index] = {
          decision: 'BUY',
          amount_pct: 100,
          confidence: 0.9,
          reasoning: `Algorithmic EW: Completed Wave 2 correction at $${s2.price.toFixed(4)} (above Wave 1 start $${s0.price.toFixed(4)}). Capturing start of impulsive Wave 3.`
        };

        // Buying at the end of Wave 4 (index of s4) to ride Wave 5
        decisions[s4.index] = {
          decision: 'BUY',
          amount_pct: 100,
          confidence: 0.9,
          reasoning: `Algorithmic EW: Wave 4 bottom at $${s4.price.toFixed(4)} did not overlap Wave 1 peak $${s1.price.toFixed(4)}. Capturing impulsive Wave 5.`
        };

        // Search for a Wave 5 peak after Wave 4
        const nextSwing = cleanSwings[i + 1];
        if (nextSwing && nextSwing.type === 'high' && nextSwing.price > s3.price) {
          waves[nextSwing.index] = 'Wave 5';
          decisions[nextSwing.index] = {
            decision: 'SELL',
            amount_pct: 100,
            confidence: 0.9,
            reasoning: `Algorithmic EW: Impulsive Wave 5 peak reached at $${nextSwing.price.toFixed(4)} (above Wave 3 peak $${s3.price.toFixed(4)}). Exiting before ABC correction.`
          };
        }
      }
    }
  }

  return { waves, decisions };
}

/**
 * Calculate Average True Range (ATR)
 * @param {object[]} candles - Array of candle objects { high, low, close }
 * @param {number} period - ATR period (default 14)
 * @returns {number[]} Array of ATR values matching input length (null for initial periods)
 */
function calculateATR(candles, period = 14) {
  const atr = [];
  if (candles.length === 0) return atr;

  const tr = [];
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    if (i === 0) {
      tr.push(c.high - c.low);
    } else {
      const prevC = candles[i - 1];
      const trVal = Math.max(
        c.high - c.low,
        Math.abs(c.high - prevC.close),
        Math.abs(c.low - prevC.close)
      );
      tr.push(trVal);
    }
  }

  let prevAtr = null;
  for (let i = 0; i < candles.length; i++) {
    if (i < period - 1) {
      atr.push(null);
    } else if (i === period - 1) {
      let sum = 0;
      for (let j = 0; j < period; j++) {
        sum += tr[j];
      }
      prevAtr = sum / period;
      atr.push(Number(prevAtr.toFixed(4)));
    } else {
      const currentAtr = (prevAtr * (period - 1) + tr[i]) / period;
      prevAtr = currentAtr;
      atr.push(Number(currentAtr.toFixed(4)));
    }
  }

  return atr;
}

/**
 * Calculate Relative Volume (RVol)
 * @param {object[]} candles - Array of candle objects { volume }
 * @param {number} period - SMA period for volume (default 20)
 * @returns {number[]} Array of RVol values matching input length (null for initial periods)
 */
function calculateRelativeVolume(candles, period = 20) {
  const rvol = [];
  if (candles.length === 0) return rvol;

  const volumes = candles.map(c => c.volume);
  
  for (let i = 0; i < volumes.length; i++) {
    if (i < period - 1) {
      rvol.push(null);
    } else {
      let sum = 0;
      for (let j = 0; j < period; j++) {
        sum += volumes[i - j];
      }
      const avgVolume = sum / period;
      
      const rvolVal = avgVolume > 0 ? (volumes[i] / avgVolume) : 1.0;
      rvol.push(Number(rvolVal.toFixed(4)));
    }
  }
  return rvol;
}

/**
 * Calculate Average Directional Index (ADX)
 * @param {object[]} candles - Array of candle objects { high, low, close }
 * @param {number} period - lookback period (default 14)
 * @returns {object} Object containing arrays for adx, plusDI, minusDI
 */
function calculateADX(candles, period = 14) {
  const length = candles.length;
  const adx = Array(length).fill(null);
  const plusDI = Array(length).fill(null);
  const minusDI = Array(length).fill(null);

  if (length <= period * 2) {
    return { adx, plusDI, minusDI };
  }

  const tr = Array(length).fill(0);
  const plusDM = Array(length).fill(0);
  const minusDM = Array(length).fill(0);

  // 1. Calculate TR and raw DM values
  for (let i = 1; i < length; i++) {
    const c = candles[i];
    const prev = candles[i - 1];

    tr[i] = Math.max(
      c.high - c.low,
      Math.abs(c.high - prev.close),
      Math.abs(c.low - prev.close)
    );

    const upMove = c.high - prev.high;
    const downMove = prev.low - c.low;

    if (upMove > downMove && upMove > 0) {
      plusDM[i] = upMove;
    } else {
      plusDM[i] = 0;
    }

    if (downMove > upMove && downMove > 0) {
      minusDM[i] = downMove;
    } else {
      minusDM[i] = 0;
    }
  }

  // 2. Initial values (Wilder's Smoothing)
  let smoothedTR = 0;
  let smoothedPlusDM = 0;
  let smoothedMinusDM = 0;

  for (let i = 1; i <= period; i++) {
    smoothedTR += tr[i];
    smoothedPlusDM += plusDM[i];
    smoothedMinusDM += minusDM[i];
  }

  // Calculate DI values for index = period
  plusDI[period] = Number((smoothedTR > 0 ? (100 * smoothedPlusDM / smoothedTR) : 0).toFixed(2));
  minusDI[period] = Number((smoothedTR > 0 ? (100 * smoothedMinusDM / smoothedTR) : 0).toFixed(2));

  const dx = Array(length).fill(null);
  
  const calcDX = (pDI, mDI) => {
    const sum = pDI + mDI;
    const diff = Math.abs(pDI - mDI);
    return sum > 0 ? (100 * diff / sum) : 0;
  };

  dx[period] = calcDX(plusDI[period], minusDI[period]);

  // Smoothed lines calculation loop
  for (let i = period + 1; i < length; i++) {
    smoothedTR = smoothedTR - (smoothedTR / period) + tr[i];
    smoothedPlusDM = smoothedPlusDM - (smoothedPlusDM / period) + plusDM[i];
    smoothedMinusDM = smoothedMinusDM - (smoothedMinusDM / period) + minusDM[i];

    plusDI[i] = Number((smoothedTR > 0 ? (100 * smoothedPlusDM / smoothedTR) : 0).toFixed(2));
    minusDI[i] = Number((smoothedTR > 0 ? (100 * smoothedMinusDM / smoothedTR) : 0).toFixed(2));
    
    dx[i] = calcDX(plusDI[i], minusDI[i]);
  }

  // Calculate first ADX (Simple average of DX over first N periods)
  let sumDX = 0;
  const adxStartIndex = period * 2 - 1;
  
  for (let i = period; i <= adxStartIndex; i++) {
    sumDX += dx[i];
  }
  
  let prevADX = sumDX / period;
  adx[adxStartIndex] = Number(prevADX.toFixed(2));

  // Calculate subsequent smoothed ADX
  for (let i = adxStartIndex + 1; i < length; i++) {
    const currentADX = (prevADX * (period - 1) + dx[i]) / period;
    prevADX = currentADX;
    adx[i] = Number(currentADX.toFixed(2));
  }

  return { adx, plusDI, minusDI };
}

module.exports = {
  calculateSMA,
  calculateEMA,
  calculateRSI,
  calculateMACD,
  calculateAwesomeOscillator,
  calculateFibonacciLevels,
  calculateElliottWaves,
  calculateATR,
  calculateADX,
  calculateRelativeVolume
};
