import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  TrendingUp, 
  Cpu, 
  Activity, 
  Terminal as TermIcon, 
  Settings as SettingsIcon, 
  RefreshCw, 
  Play, 
  Pause,
  Square, 
  AlertTriangle, 
  DollarSign, 
  ArrowUpRight, 
  ArrowDownRight, 
  Sliders, 
  History,
  Layers,
  HelpCircle,
  Database,
  MessageSquare,
  Trash2,
  UploadCloud,
  Target,
  Shield,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';
import { createChart, CandlestickSeries, LineSeries, createSeriesMarkers } from 'lightweight-charts';

const BACKEND_URL = `http://${window.location.hostname}:5000`;

// Simple indicator calculations for UI overlay
function calculateSMA(data, period) {
  const sma = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) continue;
    let sum = 0;
    for (let j = 0; j < period; j++) {
      sum += data[i - j].close;
    }
    sma.push({ time: data[i].time, value: sum / period });
  }
  return sma;
}

// Convert CCXT symbol (BTC/USDT) to TradingView symbol (e.g. COINBASE:BTCUSDT or BINANCE:BTCUSDT)
function getTradingViewSymbol(asset, exchange) {
  const cleanAsset = asset.replace('/', '').toUpperCase();
  const cleanExchange = (exchange || 'coinbase').toUpperCase();
  return `${cleanExchange}:${cleanAsset}`;
}

// Robust date/time formatter with safety check
function safeFormatDate(ts, includeTimeOnly = false) {
  if (!ts) return 'N/A';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return 'N/A';
  if (includeTimeOnly) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }
  return d.toLocaleString();
}

// Simple inline parser for bold **text**, code `code`, and math $$formulas$$
function parseInlineMarkdown(text) {
  if (!text) return '';
  const parts = [];
  let currentIndex = 0;
  
  const regex = /(\*\*.*?\*\*|`.*?`|\$\$.*?\$\$)/g;
  let match;
  
  while ((match = regex.exec(text)) !== null) {
    const matchStr = match[0];
    const matchIndex = match.index;
    
    if (matchIndex > currentIndex) {
      parts.push(text.substring(currentIndex, matchIndex));
    }
    
    if (matchStr.startsWith('**') && matchStr.endsWith('**')) {
      parts.push(<strong key={matchIndex} style={{ color: '#fff', fontWeight: '700' }}>{matchStr.slice(2, -2)}</strong>);
    } else if (matchStr.startsWith('`') && matchStr.endsWith('`')) {
      parts.push(<code key={matchIndex} style={{ background: 'rgba(255,255,255,0.08)', padding: '2px 6px', borderRadius: '4px', fontFamily: 'var(--font-mono)', fontSize: '0.8em', color: 'var(--color-secondary)' }}>{matchStr.slice(1, -1)}</code>);
    } else if (matchStr.startsWith('$$') && matchStr.endsWith('$$')) {
      parts.push(<div key={matchIndex} style={{ display: 'block', textAlign: 'center', margin: '12px 0', fontFamily: 'var(--font-mono)', fontSize: '0.95rem', color: '#fff' }}>{matchStr.slice(2, -2)}</div>);
    }
    
    currentIndex = regex.lastIndex;
  }
  
  if (currentIndex < text.length) {
    parts.push(text.substring(currentIndex));
  }
  
  return parts.length > 0 ? parts : text;
}

// Simple dynamic styled parser for operations manual markdown
function MarkdownRenderer({ content }) {
  if (!content) return <p style={{ color: 'var(--color-text-dark)' }}>No manual content available.</p>;

  const lines = content.split('\n');
  let inList = false;
  let listItems = [];
  const renderedElements = [];
  let elementKey = 0;

  const flushList = () => {
    if (listItems.length > 0) {
      renderedElements.push(
        <ul key={`ul-${elementKey++}`} style={{ paddingLeft: '20px', marginBottom: '16px', listStyleType: 'disc', display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {listItems}
        </ul>
      );
      listItems = [];
      inList = false;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith('# ')) {
      flushList();
      renderedElements.push(
        <h1 key={elementKey++} style={{ fontSize: '1.6rem', color: '#fff', borderBottom: '1px solid rgba(255, 255, 255, 0.1)', paddingBottom: '10px', marginTop: '24px', marginBottom: '16px', fontWeight: '800', letterSpacing: '0.5px' }}>
          {line.substring(2)}
        </h1>
      );
      continue;
    }
    if (line.startsWith('## ')) {
      flushList();
      renderedElements.push(
        <h2 key={elementKey++} style={{ fontSize: '1.2rem', color: 'var(--color-secondary)', marginTop: '20px', marginBottom: '12px', fontWeight: '700', letterSpacing: '0.5px' }}>
          {line.substring(3)}
        </h2>
      );
      continue;
    }
    if (line.startsWith('### ')) {
      flushList();
      renderedElements.push(
        <h3 key={elementKey++} style={{ fontSize: '0.95rem', color: '#fff', marginTop: '16px', marginBottom: '8px', fontWeight: '600' }}>
          {line.substring(4)}
        </h3>
      );
      continue;
    }

    if (line.trim() === '---') {
      flushList();
      renderedElements.push(<hr key={elementKey++} style={{ border: 'none', borderTop: '1px solid rgba(255,255,255,0.05)', margin: '20px 0' }} />);
      continue;
    }

    if (line.startsWith('> [!')) {
      flushList();
      const type = line.includes('WARNING') || line.includes('CAUTION') ? 'warning' : 'info';
      let blockText = '';
      i++;
      while (i < lines.length && lines[i].startsWith('> ')) {
        blockText += lines[i].substring(2) + ' ';
        i++;
      }
      i--;
      
      renderedElements.push(
        <div key={elementKey++} className={`alert-banner ${type}`} style={{ margin: '16px 0', borderRadius: '12px', display: 'flex', gap: '12px', alignItems: 'center' }}>
          <AlertTriangle size={18} style={{ flexShrink: 0 }} />
          <span>{blockText.trim()}</span>
        </div>
      );
      continue;
    }

    if (line.startsWith('> ')) {
      flushList();
      renderedElements.push(
        <blockquote key={elementKey++} style={{ borderLeft: '3px solid var(--color-primary)', paddingLeft: '16px', color: 'var(--color-text-muted)', margin: '16px 0', fontStyle: 'italic' }}>
          {line.substring(2)}
        </blockquote>
      );
      continue;
    }

    if (line.startsWith('```')) {
      flushList();
      let codeLines = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      renderedElements.push(
        <pre key={elementKey++} style={{ 
          background: 'rgba(0, 0, 0, 0.3)', 
          border: '1px solid rgba(255,255,255,0.05)', 
          padding: '16px', 
          borderRadius: '12px', 
          fontFamily: 'var(--font-mono)', 
          fontSize: '0.75rem', 
          color: '#e5e7eb', 
          overflowX: 'auto',
          marginBottom: '16px',
          lineHeight: '1.4'
        }}>
          <code>{codeLines.join('\n')}</code>
        </pre>
      );
      continue;
    }

    if (line.trim().startsWith('* ') || line.trim().startsWith('- ')) {
      inList = true;
      const cleanLine = line.trim().substring(2);
      listItems.push(
        <li key={`li-${elementKey++}`} style={{ fontSize: '0.85rem', color: 'var(--color-text-light)', lineHeight: '1.5' }}>
          {parseInlineMarkdown(cleanLine)}
        </li>
      );
      continue;
    }

    if (line.trim() !== '') {
      flushList();
      renderedElements.push(
        <p key={elementKey++} style={{ fontSize: '0.85rem', color: 'var(--color-text-light)', lineHeight: '1.6', marginBottom: '16px' }}>
          {parseInlineMarkdown(line)}
        </p>
      );
    } else {
      flushList();
    }
  }

  flushList();
  return <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>{renderedElements}</div>;
}

// Extract Elliott Wave circled characters from text reasoning (①-⑤, Ⓐ-Ⓒ)
function extractWaveMarker(reasoning, action) {
  if (!reasoning) return action;
  const text = reasoning.toUpperCase();
  if (text.includes('WAVE 1')) return '①';
  if (text.includes('WAVE 2')) return '②';
  if (text.includes('WAVE 3')) return '③';
  if (text.includes('WAVE 4')) return '④';
  if (text.includes('WAVE 5')) return '⑤';
  if (text.includes('WAVE A')) return 'Ⓐ';
  if (text.includes('WAVE B')) return 'Ⓑ';
  if (text.includes('WAVE C')) return 'Ⓒ';
  return action;
}

// TradingView Advanced Charting Widget Component
function TradingViewWidget({ symbol }) {
  const container = useRef();

  useEffect(() => {
    const containerId = 'tradingview_widget_' + Math.random().toString(36).substring(2, 9);
    if (container.current) {
      container.current.id = containerId;
    }

    const script = document.createElement('script');
    script.src = 'https://s3.tradingview.com/tv.js';
    script.type = 'text/javascript';
    script.async = true;
    script.onload = () => {
      if (typeof TradingView !== 'undefined' && document.getElementById(containerId)) {
        new TradingView.widget({
          autosize: true,
          symbol: symbol,
          interval: '60',
          timezone: 'Etc/UTC',
          theme: 'dark',
          style: '1',
          locale: 'en',
          enable_publishing: false,
          allow_symbol_change: true,
          container_id: containerId,
          hide_side_toolbar: false, // Show all drawing tools
          withdateranges: true,
          hide_volume: false,
          calendar: true,
          studies: [
            'RSI@tv-basicstudies',
            'MACD@tv-basicstudies'
          ],
        });
      }
    };
    document.head.appendChild(script);

    return () => {
      script.remove();
    };
  }, [symbol]);

  return (
    <div style={{ height: '100%', width: '100%' }}>
      <div ref={container} style={{ height: '100%', width: '100%' }} />
    </div>
  );
}

// Custom Canvas Candlestick Chart component — supports zoom (wheel), pan (drag), history load (scroll left), reset (dbl-click)
function CustomTradingChart({ candleData, setCandleData, symbol, selectedAsset, selectedTimeframe, backendUrl }) {
  const chartContainerRef = useRef(null);
  const chartRef = useRef(null);
  const candlestickSeriesRef = useRef(null);
  const sma9SeriesRef = useRef(null);
  const sma21SeriesRef = useRef(null);
  const loadingMoreRef = useRef(false);
  const [legendInfo, setLegendInfo] = useState(null);

  const fetchOlderCandles = useCallback(async () => {
    if (loadingMoreRef.current || !candleData || candleData.length === 0) return;
    loadingMoreRef.current = true;
    try {
      const oldest = candleData[0].time;
      const url = `${backendUrl}/api/market/candles?symbol=${encodeURIComponent(selectedAsset)}&timeframe=${selectedTimeframe}&limit=300&before=${oldest}`;
      const res = await fetch(url);
      if (!res.ok) return;
      const older = await res.json();
      if (Array.isArray(older) && older.length > 0) {
        setCandleData(prev => {
          const existing = new Set(prev.map(c => c.time));
          const fresh = [];
          const seen = new Set();
          older.forEach(c => {
            if (!existing.has(c.time) && !seen.has(c.time)) {
              fresh.push(c);
              seen.add(c.time);
            }
          });
          if (fresh.length === 0) return prev;
          return [...fresh, ...prev];
        });
      }
    } catch (e) {
      console.warn('Failed to fetch older candles:', e);
    } finally {
      loadingMoreRef.current = false;
    }
  }, [candleData, selectedAsset, selectedTimeframe, backendUrl, setCandleData]);

  // Handle initialization and window resize
  useEffect(() => {
    if (!chartContainerRef.current) return;

    // Create the chart
    const chart = createChart(chartContainerRef.current, {
      width: chartContainerRef.current.clientWidth,
      height: 350,
      layout: {
        background: { type: 'solid', color: 'transparent' },
        textColor: '#d1d5db',
        fontFamily: '"JetBrains Mono", monospace',
        attributionLogo: false,
      },
      grid: {
        vertLines: { visible: false },
        horzLines: { color: 'rgba(255, 255, 255, 0.02)' },
      },
      rightPriceScale: {
        borderColor: 'rgba(255, 255, 255, 0.08)',
      },
      timeScale: {
        borderColor: 'rgba(255, 255, 255, 0.08)',
        timeVisible: true,
        secondsVisible: false,
      },
      crosshair: {
        mode: 1, // Magnet mode
        vertLine: {
          color: 'rgba(255, 255, 255, 0.2)',
          width: 1,
          style: 3, // Dashed
        },
        horzLine: {
          color: 'rgba(255, 255, 255, 0.2)',
          width: 1,
          style: 3, // Dashed
        },
      },
    });

    // Add series
    const candlestickSeries = chart.addSeries(CandlestickSeries, {
      upColor: 'rgba(255, 255, 255, 0.08)',
      downColor: '#333333',
      borderVisible: true,
      borderUpColor: '#ffffff',
      borderDownColor: '#555555',
      wickUpColor: '#ffffff',
      wickDownColor: '#555555',
    });

    const sma9Series = chart.addSeries(LineSeries, {
      color: 'rgba(255, 255, 255, 0.6)',
      lineWidth: 1.2,
      priceLineVisible: false,
    });

    const sma21Series = chart.addSeries(LineSeries, {
      color: 'rgba(255, 255, 255, 0.25)',
      lineWidth: 1.2,
      priceLineVisible: false,
    });

    chartRef.current = chart;
    candlestickSeriesRef.current = candlestickSeries;
    sma9SeriesRef.current = sma9Series;
    sma21SeriesRef.current = sma21Series;

    // Handle crosshair hover movement to update legend info
    chart.subscribeCrosshairMove((param) => {
      if (
        param === null ||
        param.time === null ||
        param.point === null ||
        !param.seriesData.has(candlestickSeries)
      ) {
        setLegendInfo(null);
        return;
      }
      
      const data = param.seriesData.get(candlestickSeries);
      const sma9Val = param.seriesData.get(sma9Series);
      const sma21Val = param.seriesData.get(sma21Series);
      
      const dateObj = new Date(Number(param.time) * 1000);
      const dateStr = isNaN(dateObj.getTime())
        ? 'N/A'
        : dateObj.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

      setLegendInfo({
        time: dateStr,
        open: data.open,
        high: data.high,
        low: data.low,
        close: data.close,
        volume: data.volume || 0,
        sma9: sma9Val ? sma9Val.value : null,
        sma21: sma21Val ? sma21Val.value : null,
      });
    });

    // Handle auto-resize
    const handleResize = () => {
      if (chartContainerRef.current && chartRef.current) {
        chartRef.current.applyOptions({
          width: chartContainerRef.current.clientWidth,
        });
      }
    };
    window.addEventListener('resize', handleResize);

    // Support middle-mouse button dragging (scroll wheel click & drag) to pan
    const container = chartContainerRef.current;
    let isMiddleDragging = false;
    let dragTarget = null;

    const handleMouseDown = (e) => {
      if (e.button === 1) { // Middle mouse click
        e.preventDefault();
        e.stopPropagation();
        isMiddleDragging = true;
        dragTarget = e.target;
        
        const fakeEvent = new MouseEvent('mousedown', {
          bubbles: true,
          cancelable: true,
          view: window,
          button: 0,
          buttons: 1,
          clientX: e.clientX,
          clientY: e.clientY,
          screenX: e.screenX,
          screenY: e.screenY,
        });
        dragTarget.dispatchEvent(fakeEvent);
      }
    };

    const handleMouseMove = (e) => {
      if (isMiddleDragging && dragTarget) {
        e.preventDefault();
        const fakeEvent = new MouseEvent('mousemove', {
          bubbles: true,
          cancelable: true,
          view: window,
          button: 0,
          buttons: 1,
          clientX: e.clientX,
          clientY: e.clientY,
          screenX: e.screenX,
          screenY: e.screenY,
        });
        dragTarget.dispatchEvent(fakeEvent);
      }
    };

    const handleMouseUp = (e) => {
      if (e.button === 1 && isMiddleDragging && dragTarget) {
        e.preventDefault();
        e.stopPropagation();
        isMiddleDragging = false;
        
        const fakeEvent = new MouseEvent('mouseup', {
          bubbles: true,
          cancelable: true,
          view: window,
          button: 0,
          buttons: 0,
          clientX: e.clientX,
          clientY: e.clientY,
          screenX: e.screenX,
          screenY: e.screenY,
        });
        dragTarget.dispatchEvent(fakeEvent);
        dragTarget = null;
      }
    };

    const handleScrollClick = (e) => {
      if (e.button === 1) {
        e.preventDefault();
      }
    };

    if (container) {
      container.addEventListener('mousedown', handleMouseDown, true);
      container.addEventListener('click', handleScrollClick, true);
    }
    window.addEventListener('mousemove', handleMouseMove, { capture: true, passive: false });
    window.addEventListener('mouseup', handleMouseUp, true);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (container) {
        container.removeEventListener('mousedown', handleMouseDown, true);
        container.removeEventListener('click', handleScrollClick, true);
      }
      window.removeEventListener('mousemove', handleMouseMove, true);
      window.removeEventListener('mouseup', handleMouseUp, true);
      chart.remove();
    };
  }, []);

  // Sync scroll left boundary to trigger lazy history load
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    const handleVisibleLogicalRangeChange = (newRange) => {
      if (newRange === null) return;
      // When scrolling close to the left edge (e.g., logical range starts before index 10)
      if (newRange.from < 10 && !loadingMoreRef.current) {
        fetchOlderCandles();
      }
    };

    chart.timeScale().subscribeVisibleLogicalRangeChange(handleVisibleLogicalRangeChange);
    return () => {
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(handleVisibleLogicalRangeChange);
    };
  }, [fetchOlderCandles]);

  // Sync data updates
  useEffect(() => {
    if (!candlestickSeriesRef.current || !sma9SeriesRef.current || !sma21SeriesRef.current || !candleData || candleData.length === 0) return;

    // Sort to be chronologically ordered and filter unique timestamps
    const prevMap = new Map();
    candleData.forEach(c => prevMap.set(c.time, c));
    const sortedUniqueCandles = Array.from(prevMap.values()).sort((a, b) => a.time - b.time);

    const formattedCandles = sortedUniqueCandles.map(c => ({
      time: c.time,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));

    const sma9Data = [];
    const sma21Data = [];
    for (let i = 0; i < sortedUniqueCandles.length; i++) {
      if (i >= 8) {
        const sum = sortedUniqueCandles.slice(i - 8, i + 1).reduce((acc, c) => acc + c.close, 0);
        sma9Data.push({ time: sortedUniqueCandles[i].time, value: sum / 9 });
      }
      if (i >= 20) {
        const sum = sortedUniqueCandles.slice(i - 20, i + 1).reduce((acc, c) => acc + c.close, 0);
        sma21Data.push({ time: sortedUniqueCandles[i].time, value: sum / 21 });
      }
    }

    candlestickSeriesRef.current.setData(formattedCandles);
    sma9SeriesRef.current.setData(sma9Data);
    sma21SeriesRef.current.setData(sma21Data);

  }, [candleData]);

  // Get current last candle price for default legend display
  const lastCandle = candleData && candleData.length > 0 ? candleData[candleData.length - 1] : null;

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      {/* Chart Legend Overlay */}
      <div style={{
        position: 'absolute',
        top: 8,
        left: 12,
        zIndex: 10,
        fontFamily: '"JetBrains Mono", monospace',
        fontSize: '0.66rem',
        color: '#9ca3af',
        backgroundColor: 'rgba(12, 13, 15, 0.85)',
        padding: '4px 8px',
        borderRadius: '4px',
        border: '1px solid rgba(255, 255, 255, 0.05)',
        pointerEvents: 'none',
        display: 'flex',
        flexWrap: 'wrap',
        gap: '8px',
        maxWidth: '90%'
      }}>
        {legendInfo ? (
          <>
            <span style={{ color: '#fff', fontWeight: 'bold' }}>{legendInfo.time}</span>
            <span>O:<span style={{ color: '#fff', marginLeft: 2 }}>{legendInfo.open.toFixed(2)}</span></span>
            <span>H:<span style={{ color: '#fff', marginLeft: 2 }}>{legendInfo.high.toFixed(2)}</span></span>
            <span>L:<span style={{ color: '#fff', marginLeft: 2 }}>{legendInfo.low.toFixed(2)}</span></span>
            <span>C:<span style={{ color: legendInfo.close >= legendInfo.open ? '#10b981' : '#ef4444', marginLeft: 2 }}>{legendInfo.close.toFixed(2)}</span></span>
            {legendInfo.sma9 && (
              <span>SMA9:<span style={{ color: 'rgba(255,255,255,0.8)', marginLeft: 2 }}>{legendInfo.sma9.toFixed(2)}</span></span>
            )}
            {legendInfo.sma21 && (
              <span>SMA21:<span style={{ color: 'rgba(255,255,255,0.4)', marginLeft: 2 }}>{legendInfo.sma21.toFixed(2)}</span></span>
            )}
          </>
        ) : (
          <>
            <span style={{ color: '#fff', fontWeight: 'bold' }}>ASSET: {symbol}</span>
            {lastCandle && (
              <>
                <span>PRICE:<span style={{ color: '#fff', marginLeft: 2 }}>${lastCandle.close.toFixed(2)}</span></span>
                <span>SMA(9) [White]</span>
                <span>SMA(21) [Dim]</span>
              </>
            )}
          </>
        )}
        {loadingMoreRef.current && (
          <span style={{ color: 'var(--term-accent-cyan)', fontWeight: 'bold', marginLeft: 'auto' }}>LOADING HISTORY...</span>
        )}
      </div>

      <div ref={chartContainerRef} style={{ width: '100%', height: '350px' }} />
    </div>
  );
}

// Markdown formatter for chat messages
function formatChatMessage(text) {
  if (!text) return "";
  
  // Basic markdown parser
  let html = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
    
  // Bold **text**
  html = html.replace(/\*\*([\s\S]*?)\*\*/g, "<strong>$1</strong>");
  
  // Codeblocks ```javascript ... ```
  html = html.replace(/```(?:[a-zA-Z]+)?([\s\S]*?)```/g, "<pre class='chat-code' style='background:rgba(0,0,0,0.3);padding:10px;border-radius:6px;overflow-x:auto;font-family:monospace;font-size:0.8rem;margin:8px 0;'><code>$1</code></pre>");
  
  // Inline code `code`
  html = html.replace(/`([^`]+)`/g, "<code class='chat-inline-code' style='background:rgba(0,0,0,0.2);padding:2px 6px;border-radius:4px;font-family:monospace;font-size:0.85rem;'>$1</code>");
  
  // Bullet points
  html = html.replace(/^\s*[-*]\s+(.*)$/gm, "<li style='margin-left:16px;list-style-type:disc;'>$1</li>");
  
  // Linebreaks
  html = html.replace(/\n/g, "<br />");
  
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}

// Typewriter effect for streaming chat text (Word-by-word, matching Antigravity's smooth flow)
function TypewriterMessage({ content, onComplete, scrollContainerRef, chatAutoScroll }) {
  const [displayedText, setDisplayedText] = useState("");
  const wordsRef = useRef([]);
  const indexRef = useRef(0);

  // Sync scroll setting and callback to refs to prevent triggering useEffect rerun
  const autoScrollRef = useRef(chatAutoScroll);
  useEffect(() => {
    autoScrollRef.current = chatAutoScroll;
  }, [chatAutoScroll]);

  const onCompleteRef = useRef(onComplete);
  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  useEffect(() => {
    // Convert newlines to individual tokens and split other text by space
    const tokens = content
      .split(" ")
      .map(t => {
        if (t.includes("\n")) {
          return t.split(/(\n)/g);
        }
        return t;
      })
      .flat()
      .filter(t => t !== "");

    wordsRef.current = tokens;
    indexRef.current = 0;
    setDisplayedText("");
    
    const interval = setInterval(() => {
      if (indexRef.current < wordsRef.current.length) {
        // Grab 2 words at a time for a fast, organic reading speed
        const nextWords = wordsRef.current.slice(indexRef.current, indexRef.current + 2);
        indexRef.current += 2;
        
        setDisplayedText(prev => {
          let updated = prev;
          for (const token of nextWords) {
            if (token === "\n") {
              updated += "\n";
            } else {
              const lastChar = updated.slice(-1);
              if (updated && lastChar !== "\n" && lastChar !== " ") {
                updated += " ";
              }
              updated += token;
            }
          }
          if (autoScrollRef.current && scrollContainerRef && scrollContainerRef.current) {
            scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
          }
          return updated;
        });
      } else {
        clearInterval(interval);
        if (onCompleteRef.current) onCompleteRef.current();
      }
    }, 45); // Comfortable pacing for reading

    return () => clearInterval(interval);
  }, [content]); // Only rerun when the actual message content changes

  return formatChatMessage(displayedText);
}

const thinkingStages = [
  "Initializing Aether Brain context...",
  "Retrieving live technical indicators (RSI, SMA, ADX)...",
  "Analyzing market structure and volume regimes...",
  "Evaluating active portfolio positioning and stop-losses...",
  "Consulting active strategy guidelines (.md guidelines)...",
  "Synthesizing logical reasoning and trading actions...",
  "Finalizing reply..."
];

function JarvisCore({ animating }) {
  const strokeColor = '#FFFFFF';
  
  return (
    <div className="jarvis-hud-container background-watermark" style={{
      position: 'absolute',
      top: '335px',
      left: '50%',
      transform: 'translate(-50%, -50%)',
      width: 'min(80vw, 80vh)',
      height: 'min(80vw, 80vh)',
      maxWidth: '850px',
      maxHeight: '850px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      pointerEvents: 'none',
      zIndex: 100,
      opacity: 0.02,
      background: 'none'
    }}>
      <svg className="jarvis-core-svg" viewBox="0 0 100 100" style={{ width: '100%', height: '100%', overflow: 'visible' }}>
        {animating && (
          <>
            <circle cx="50" cy="50" r="44" fill="none" stroke={strokeColor} strokeWidth="0.5" className="jarvis-ripple-ring" style={{ animationDelay: '0s' }} />
            <circle cx="50" cy="50" r="44" fill="none" stroke={strokeColor} strokeWidth="0.5" className="jarvis-ripple-ring" style={{ animationDelay: '0.6s' }} />
            <circle cx="50" cy="50" r="44" fill="none" stroke={strokeColor} strokeWidth="0.5" className="jarvis-ripple-ring" style={{ animationDelay: '1.2s' }} />
          </>
        )}
        <circle
          cx="50"
          cy="50"
          r="38"
          fill="none"
          stroke={strokeColor}
          strokeWidth="0.8"
          strokeDasharray="6 4"
          className="jarvis-spin-clockwise"
        />
        <circle
          cx="50"
          cy="50"
          r="30"
          fill="none"
          stroke={strokeColor}
          strokeWidth="0.6"
          strokeDasharray="20 10 5 10"
          className="jarvis-spin-counter"
          opacity="0.8"
        />
        <circle cx="50" cy="50" r="22" fill="none" stroke={strokeColor} strokeWidth="0.4" opacity="0.5" />
        <circle cx="50" cy="50" r="14" fill="none" stroke={strokeColor} strokeWidth="0.4" opacity="0.3" />
        <circle
          cx="50"
          cy="50"
          r="6"
          fill="none"
          stroke={strokeColor}
          strokeWidth="0.8"
          className="jarvis-core-center"
        />
        {/* Aether CPU Logo in the center */}
        <g stroke={strokeColor} strokeWidth="0.4" fill="none" opacity="0.9" className="jarvis-core-center">
          {/* Main CPU body */}
          <rect x="46.5" y="46.5" width="7" height="7" rx="1" ry="1" />
          {/* Inner core */}
          <rect x="48.5" y="48.5" width="3" height="3" />
          {/* Top pins */}
          <line x1="48.5" y1="44.5" x2="48.5" y2="46.5" />
          <line x1="50" y1="44.5" x2="50" y2="46.5" />
          <line x1="51.5" y1="44.5" x2="51.5" y2="46.5" />
          {/* Bottom pins */}
          <line x1="48.5" y1="53.5" x2="48.5" y2="55.5" />
          <line x1="50" y1="53.5" x2="50" y2="55.5" />
          <line x1="51.5" y1="53.5" x2="51.5" y2="55.5" />
          {/* Left pins */}
          <line x1="44.5" y1="48.5" x2="46.5" y2="48.5" />
          <line x1="44.5" y1="50" x2="46.5" y2="50" />
          <line x1="44.5" y1="51.5" x2="46.5" y2="51.5" />
          {/* Right pins */}
          <line x1="53.5" y1="48.5" x2="55.5" y2="48.5" />
          <line x1="53.5" y1="50" x2="55.5" y2="50" />
          <line x1="53.5" y1="51.5" x2="55.5" y2="51.5" />
        </g>
      </svg>
    </div>
  );
}

function CognitiveAnalysis({ status }) {
  const latestDecision = status?.latestDecision;
  
  if (!latestDecision) {
    return (
      <div className="term-panel horizontal-analysis" style={{ height: '54px', display: 'flex', flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
        <Activity size={18} style={{ color: 'var(--color-text-dark)' }} />
        <span style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          Awaiting Cognitive Input...
        </span>
      </div>
    );
  }

  const { decision, confidence, amount_pct, timestamp, indicators } = latestDecision;
  const confidencePct = confidence ? (confidence * 100).toFixed(0) : '0';
  const timeStr = timestamp ? new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : 'N/A';

  // Get decision color
  let decisionColor = '#a1a1aa';
  if (decision === 'BUY') decisionColor = 'var(--color-success)';
  if (decision === 'SELL') decisionColor = 'var(--color-danger)';

  return (
    <div className="term-panel horizontal-analysis" style={{ height: '54px', display: 'flex', flexDirection: 'row', gap: '16px', flexShrink: 0, padding: '6px 12px', alignItems: 'center', justifyContent: 'space-between' }}>
      
      {/* Title block */}
      <div style={{ display: 'flex', flexDirection: 'row', gap: '8px', alignItems: 'center', borderRight: '1px solid rgba(255, 255, 255, 0.05)', paddingRight: '16px', flexShrink: 0 }}>
        <Cpu size={15} style={{ color: 'var(--color-primary)', flexShrink: 0 }} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
          <span style={{ fontSize: '0.75rem', fontWeight: 'bold', letterSpacing: '0.5px' }}>COGNITIVE OPERATIONS</span>
          <span style={{ fontSize: '0.55rem', color: 'var(--color-text-muted)' }}>SYNC: {timeStr}</span>
        </div>
      </div>

      {/* Metrics Row */}
      <div style={{ display: 'flex', gap: '12px', flex: 1, justifyContent: 'space-around', alignItems: 'center' }}>
        {/* Decision */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '0.65rem', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.3px' }}>AI Decision</span>
          <span style={{ fontSize: '0.95rem', fontWeight: 'bold', color: decisionColor }}>
            {decision || 'HOLD'}
          </span>
        </div>
        
        {/* Confidence */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '0.65rem', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.3px' }}>Confidence</span>
          <span style={{ fontSize: '0.95rem', fontWeight: 'bold', color: '#fff' }}>
            {confidencePct}%
          </span>
        </div>

        {/* Allocation */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '0.65rem', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.3px' }}>Allocation</span>
          <span style={{ fontSize: '0.95rem', fontWeight: 'bold', color: 'var(--color-primary)' }}>
            {amount_pct || 0}%
          </span>
        </div>

        {/* Market Regime */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '0.65rem', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.3px' }}>Market Regime</span>
          <span style={{ fontSize: '0.8rem', fontWeight: 'bold', color: '#fff' }}>
            {indicators?.marketRegime ? indicators.marketRegime.replace(/_/g, ' ') : 'N/A'}
          </span>
        </div>

        {/* ADX */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '0.65rem', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.3px' }}>ADX</span>
          <span style={{ fontSize: '0.8rem', fontWeight: 'bold', color: '#fff' }}>
            {indicators?.adx !== undefined && indicators?.adx !== null ? indicators.adx.toFixed(1) : 'N/A'}
          </span>
        </div>

        {/* RVol */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '0.65rem', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.3px' }}>RVol</span>
          <span style={{ fontSize: '0.8rem', fontWeight: 'bold', color: '#fff' }}>
            {indicators?.rvol !== undefined && indicators?.rvol !== null ? `${indicators.rvol.toFixed(1)}x` : 'N/A'}
          </span>
        </div>

        {/* Bot Status (Running/Idle) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', paddingLeft: '12px', borderLeft: '1px solid rgba(255, 255, 255, 0.08)' }}>
          <span style={{
            width: '6px',
            height: '6px',
            borderRadius: '50%',
            backgroundColor: status?.isBotRunning ? 'var(--color-success)' : 'var(--color-danger)',
            boxShadow: status?.isBotRunning ? '0 0 6px var(--color-success)' : '0 0 6px var(--color-danger)',
            display: 'inline-block'
          }} />
          <span style={{ fontSize: '0.75rem', fontWeight: 'bold', letterSpacing: '0.3px', color: status?.isBotRunning ? 'var(--color-success)' : 'var(--color-danger)' }}>
            BOT: {status?.isBotRunning ? 'RUNNING' : 'IDLE'}
          </span>
        </div>
      </div>

    </div>
  );
}

export default function App() {
  const [isNavExpanded, setIsNavExpanded] = useState(true);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [dashboardSubTab, setDashboardSubTab] = useState('portfolio');
  const [terminalSubTab, setTerminalSubTab] = useState('chart');
  const [status, setStatus] = useState(null);
  const [logs, setLogs] = useState([]);
  const [trades, setTrades] = useState([]);
  const [manualMarkdown, setManualMarkdown] = useState('');
  const [manualLoading, setManualLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [candleData, setCandleData] = useState([]);
  const [chartLoading, setChartLoading] = useState(false);

  // AI Chat State
  const [chatMessages, setChatMessages] = useState([
    { role: 'assistant', content: 'Hello! I am Aether AI. How can I help you manage your portfolio or analyze the market today?' }
  ]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [chatToolLogs, setChatToolLogs] = useState([]);

  // Custom Plugins & Strategies State
  const [customTools, setCustomTools] = useState([]);
  const [strategies, setStrategies] = useState([]);
  
  // Settings Form State
  const [settingsForm, setSettingsForm] = useState({
    geminiApiKey: '',
    openaiApiKey: '',
    claudeApiKey: '',
    activeLlmProvider: 'gemini',
    activeLlmModel: 'gemini-2.5-flash',
    enabledTools: [],
    enabledStrategies: [],
    selectedAsset: 'BTC/USD',
    selectedTimeframe: '1h',
    tradingMode: 'paper',
    botIntervalMin: 5,
    botEnabled: false,
    maxTradeSizePct: 50,
    stopLossPct: 5.0,
    customPrompt: '',
    exchangeName: 'coinbase',
    exchangeApiKey: '',
    exchangeApiSecret: '',
    notificationType: 'none',
    phoneNumber: '',
    phoneCarrier: 'att',
    telegramBotToken: '',
    telegramChatId: '',
    smtpHost: '',
    smtpPort: '465',
    smtpUser: '',
    smtpPass: '',
    discordWebhookUrl: '',
    multiTimeframeEnabled: false,
    macroTimeframe: '1d',
    trailingStopEnabled: true,
    trailingStopPct: 4.0,
    takeProfitEnabled: false,
    takeProfitPct: 10.0,
    atrStopEnabled: true,
    atrStopMultiplier: 2.0,
    newsSentimentEnabled: false,
    maxPositionAllocationPct: 75
  });

  // Manual trade form state
  const [manualTrade, setManualTrade] = useState({
    action: 'BUY',
    amountPct: 50,
    symbol: 'BTC/USD'
  });

  // Backtester state
  const [backtestConfig, setBacktestConfig] = useState({
    symbol: 'BTC/USD',
    timeframe: '1h',
    limit: 50,
    useLlm: false,
    strategy: 'rules',
    startCash: 10000
  });
  const [backtestRunning, setBacktestRunning] = useState(false);
  const [backtestResults, setBacktestResults] = useState(null);
  const [backtestError, setBacktestError] = useState('');
  const [multiIndicators, setMultiIndicators] = useState(null);

  // UI Refs
  const chartContainerRef = useRef(null);
  const btChartContainerRef = useRef(null);
  const chatScrollRef = useRef(null);
  const chatInputRef = useRef(null);
  const isInitialLogsLoaded = useRef(false);
  const [thinkingStep, setThinkingStep] = useState(0);
  const [chatAutoScroll, setChatAutoScroll] = useState(true);

  const handleChatScroll = (e) => {
    const { scrollTop, scrollHeight, clientHeight } = e.target;
    const isAtBottom = scrollHeight - scrollTop - clientHeight <= 25;
    setChatAutoScroll(isAtBottom);
  };

  // Fetch bot status, logs, and trades
  const fetchData = async () => {
    try {
      const [statusRes, logsRes, tradesRes, multiIndicatorsRes] = await Promise.all([
        fetch(`${BACKEND_URL}/api/status`),
        fetch(`${BACKEND_URL}/api/logs`),
        fetch(`${BACKEND_URL}/api/trades`),
        fetch(`${BACKEND_URL}/api/market/multi-indicators`).catch(e => {
          console.warn("Could not load multi timeframe indicators:", e.message);
          return null;
        })
      ]);

      const statusData = await statusRes.json();
      const logsData = await logsRes.json();
      const tradesData = await tradesRes.json();
      let multiIndData = null;
      if (multiIndicatorsRes) {
        try {
          multiIndData = await multiIndicatorsRes.json();
        } catch (e) {
          console.warn("Error parsing multi-timeframe indicators json:", e);
        }
      }

      setStatus(statusData);
      setLogs(logsData);
      setTrades(tradesData);
      if (multiIndData && !multiIndData.error) {
        setMultiIndicators(multiIndData);
      }
      
      // Sync settings form once on initial load
      if (loading) {
        setSettingsForm(statusData.settings);
        setManualTrade(prev => ({ ...prev, symbol: statusData.settings.selectedAsset }));
        setBacktestConfig(prev => ({ ...prev, symbol: statusData.settings.selectedAsset, timeframe: statusData.settings.selectedTimeframe }));
        
        try {
          const chatRes = await fetch(`${BACKEND_URL}/api/chat/history`);
          const chatData = await chatRes.json();
          if (Array.isArray(chatData)) {
            setChatMessages(chatData);
          }
        } catch (chatErr) {
          console.error("Error fetching chat history:", chatErr);
        }
        
        setLoading(false);
      }
    } catch (err) {
      console.error("Error fetching bot data:", err);
    }
  };

  // Poll data periodically
  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 4000);
    return () => clearInterval(interval);
  }, [loading]);

  // Thinking steps progression timer
  useEffect(() => {
    if (!chatLoading) {
      setThinkingStep(0);
      return;
    }

    const interval = setInterval(() => {
      setThinkingStep(prev => {
        if (prev < 6) return prev + 1;
        return prev;
      });
    }, 1200);

    return () => clearInterval(interval);
  }, [chatLoading]);

  // Auto-scroll chat console to bottom on update if enabled
  useEffect(() => {
    if (chatAutoScroll && chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [chatMessages.length, chatLoading, chatAutoScroll]);

  const handleTypewriterComplete = (index) => {
    setChatMessages(prev => {
      const next = [...prev];
      if (next[index]) {
        next[index] = { ...next[index], isNew: false };
      }
      return next;
    });
  };

  // Scroll to bottom of logs on tab changes
  useEffect(() => {
    const scrollAll = () => {
      const terminals = document.querySelectorAll('.log-terminal');
      terminals.forEach(term => {
        term.scrollTop = term.scrollHeight;
      });
    };
    // Use staggered timeouts to guarantee scrolling after DOM update and browser layout calculations
    setTimeout(scrollAll, 50);
    setTimeout(scrollAll, 200);
  }, [activeTab, dashboardSubTab]);

  // Scroll to bottom of logs on initial load completion (transition from loading screen to dashboard)
  useEffect(() => {
    if (!loading) {
      const scrollAll = () => {
        const terminals = document.querySelectorAll('.log-terminal');
        terminals.forEach(term => {
          term.scrollTop = term.scrollHeight;
        });
      };
      setTimeout(scrollAll, 50);
      setTimeout(scrollAll, 250);
      setTimeout(scrollAll, 600);
    }
  }, [loading]);

  // Handle auto-scroll on new logs (scrolls on initial load, or if already near bottom)
  useEffect(() => {
    if (logs.length > 0) {
      const terminals = document.querySelectorAll('.log-terminal');
      
      const scrollAll = () => {
        terminals.forEach(term => {
          term.scrollTop = term.scrollHeight;
        });
      };

      if (!isInitialLogsLoaded.current) {
        isInitialLogsLoaded.current = true;
        setTimeout(scrollAll, 50);
        setTimeout(scrollAll, 250);
        setTimeout(scrollAll, 600);
      } else {
        terminals.forEach(term => {
          const isNearBottom = term.scrollHeight - term.scrollTop - term.clientHeight <= 150;
          if (isNearBottom) {
            term.scrollTop = term.scrollHeight;
          }
        });
      }
    }
  }, [logs]);

  // Fetch latest price data for manual trade calculations
  useEffect(() => {
    if (!status) return;

    let isMounted = true;
    const loadPriceData = async () => {
      setChartLoading(true);
      try {
        const res = await fetch(`${BACKEND_URL}/api/market/candles?symbol=${status.settings.selectedAsset}&timeframe=${status.settings.selectedTimeframe}&limit=600`);
        const data = await res.json();
        
        if (!isMounted) return;
        
        if (res.ok && Array.isArray(data)) {
          setCandleData(prev => {
            if (!prev || prev.length === 0) return data;
            const prevMap = new Map(prev.map(c => [c.time, c]));
            data.forEach(c => prevMap.set(c.time, c));
            return Array.from(prevMap.values()).sort((a, b) => a.time - b.time);
          });
        }
      } catch (err) {
        console.error("Failed to load price tick:", err);
      } finally {
        setChartLoading(false);
      }
    };

    loadPriceData();
    const interval = setInterval(loadPriceData, 5000); // Poll price ticks every 5s

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [status?.settings?.selectedAsset, status?.settings?.selectedTimeframe]);

  // RENDER BACKTEST CHART
  useEffect(() => {
    if (activeTab !== 'backtest' || !backtestResults || !btChartContainerRef.current) return;

    btChartContainerRef.current.innerHTML = '';

    const chart = createChart(btChartContainerRef.current, {
      width: btChartContainerRef.current.clientWidth,
      height: 350,
      layout: {
        background: { color: 'rgba(17, 24, 39, 0.45)' },
        textColor: '#d1d5db',
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: 'rgba(255, 255, 255, 0.05)' },
        horzLines: { color: 'rgba(255, 255, 255, 0.05)' },
      },
      rightPriceScale: {
        borderColor: 'rgba(255, 255, 255, 0.1)',
      },
      timeScale: {
        borderColor: 'rgba(255, 255, 255, 0.1)',
      },
    });

    // Asset price line series
    const priceSeries = chart.addSeries(LineSeries, {
      color: '#9ca3af',
      lineWidth: 1.5,
      title: `${backtestConfig.symbol} Price`,
      priceScaleId: 'left',
    });
    
    // Scale asset prices
    priceSeries.priceScale().applyOptions({
      position: 'left',
      borderColor: 'rgba(255, 255, 255, 0.1)',
    });

    const priceData = backtestResults.results.map(r => ({ time: r.time, value: r.price }));
    priceSeries.setData(priceData);

    // Portfolio Value growth series
    const portfolioSeries = chart.addSeries(LineSeries, {
      color: '#10b981',
      lineWidth: 2.5,
      title: 'Portfolio Value ($)',
      priceScaleId: 'right',
    });
    const portfolioData = backtestResults.results.map(r => ({ time: r.time, value: r.portfolioValue }));
    portfolioSeries.setData(portfolioData);

    // Add markers for trades
    const markers = backtestResults.trades.map(t => ({
      time: t.time / 1000,
      position: t.action === 'BUY' ? 'belowBar' : 'aboveBar',
      color: t.action === 'BUY' ? '#10b981' : '#ef4444',
      shape: t.action === 'BUY' ? 'arrowUp' : 'arrowDown',
      text: extractWaveMarker(t.reasoning, t.action)
    }));
    createSeriesMarkers(priceSeries, markers);

    const handleResize = () => {
      if (chart && btChartContainerRef.current) {
        chart.applyOptions({ width: btChartContainerRef.current.clientWidth });
      }
    };
    window.addEventListener('resize', handleResize);

    // Support middle-mouse button dragging (scroll wheel click & drag) to pan
    const container = btChartContainerRef.current;
    let isMiddleDragging = false;
    let dragTarget = null;

    const handleMouseDown = (e) => {
      if (e.button === 1) { // Middle mouse click
        e.preventDefault();
        e.stopPropagation();
        isMiddleDragging = true;
        dragTarget = e.target;
        
        const fakeEvent = new MouseEvent('mousedown', {
          bubbles: true,
          cancelable: true,
          view: window,
          button: 0,
          buttons: 1,
          clientX: e.clientX,
          clientY: e.clientY,
          screenX: e.screenX,
          screenY: e.screenY,
        });
        dragTarget.dispatchEvent(fakeEvent);
      }
    };

    const handleMouseMove = (e) => {
      if (isMiddleDragging && dragTarget) {
        e.preventDefault();
        const fakeEvent = new MouseEvent('mousemove', {
          bubbles: true,
          cancelable: true,
          view: window,
          button: 0,
          buttons: 1,
          clientX: e.clientX,
          clientY: e.clientY,
          screenX: e.screenX,
          screenY: e.screenY,
        });
        dragTarget.dispatchEvent(fakeEvent);
      }
    };

    const handleMouseUp = (e) => {
      if (e.button === 1 && isMiddleDragging && dragTarget) {
        e.preventDefault();
        e.stopPropagation();
        isMiddleDragging = false;
        
        const fakeEvent = new MouseEvent('mouseup', {
          bubbles: true,
          cancelable: true,
          view: window,
          button: 0,
          buttons: 0,
          clientX: e.clientX,
          clientY: e.clientY,
          screenX: e.screenX,
          screenY: e.screenY,
        });
        dragTarget.dispatchEvent(fakeEvent);
        dragTarget = null;
      }
    };

    const handleScrollClick = (e) => {
      if (e.button === 1) {
        e.preventDefault();
      }
    };

    if (container) {
      container.addEventListener('mousedown', handleMouseDown, true);
      container.addEventListener('click', handleScrollClick, true);
    }
    window.addEventListener('mousemove', handleMouseMove, { capture: true, passive: false });
    window.addEventListener('mouseup', handleMouseUp, true);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (container) {
        container.removeEventListener('mousedown', handleMouseDown, true);
        container.removeEventListener('click', handleScrollClick, true);
      }
      window.removeEventListener('mousemove', handleMouseMove, true);
      window.removeEventListener('mouseup', handleMouseUp, true);
      chart.remove();
    };
  }, [activeTab, backtestResults]);

  // API Call: Fetch manual content
  const fetchManual = async () => {
    setManualLoading(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/manual`);
      const data = await res.json();
      if (res.ok) {
        setManualMarkdown(data.markdown);
      }
    } catch (err) {
      console.error("Error fetching manual:", err);
      setManualMarkdown("# Operations Manual\nFailed to sync manual content from backend server.");
    } finally {
      setManualLoading(false);
    }
  };

  // Sync manual when tab opens
  useEffect(() => {
    if (activeTab === 'manual') {
      fetchManual();
    }
  }, [activeTab]);

  // Fetch tools and strategies list from backend
  const fetchPlugins = async () => {
    try {
      const [toolsRes, strategiesRes] = await Promise.all([
        fetch(`${BACKEND_URL}/api/tools`),
        fetch(`${BACKEND_URL}/api/strategies`)
      ]);
      const toolsData = await toolsRes.json();
      const strategiesData = await strategiesRes.json();
      setCustomTools(toolsData);
      setStrategies(strategiesData);
    } catch (err) {
      console.error("Error fetching plugins:", err);
    }
  };

  // Sync plugins when settings or chat tabs open
  useEffect(() => {
    if (activeTab === 'settings') {
      fetchPlugins();
    }
  }, [activeTab]);

  // Plugins API Handlers
  const handleToggleTool = async (filename) => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/tools/${filename}/toggle`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        fetchPlugins();
        fetchData();
      }
    } catch (err) {
      console.error("Error toggling tool:", err);
    }
  };

  const handleDeleteTool = async (filename) => {
    if (!confirm(`Are you sure you want to delete tool '${filename}'?`)) return;
    try {
      await fetch(`${BACKEND_URL}/api/tools/${filename}`, { method: 'DELETE' });
      fetchPlugins();
      fetchData();
    } catch (err) {
      console.error("Error deleting tool:", err);
    }
  };

  const handleUploadTool = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = async (evt) => {
      const code = evt.target.result;
      try {
        const res = await fetch(`${BACKEND_URL}/api/tools/upload`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filename: file.name, code })
        });
        const data = await res.json();
        if (data.success) {
          alert("Tool uploaded and compiled successfully!");
          fetchPlugins();
          fetchData();
        } else {
          alert(`Upload failed: ${data.error}`);
        }
      } catch (err) {
        alert(`Upload error: ${err.message}`);
      }
    };
    reader.readAsText(file);
  };

  const handleToggleStrategy = async (filename) => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/strategies/${filename}/toggle`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        fetchPlugins();
        fetchData();
      }
    } catch (err) {
      console.error("Error toggling strategy:", err);
    }
  };

  const handleDeleteStrategy = async (filename) => {
    if (!confirm(`Are you sure you want to delete strategy guideline '${filename}'?`)) return;
    try {
      await fetch(`${BACKEND_URL}/api/strategies/${filename}`, { method: 'DELETE' });
      fetchPlugins();
      fetchData();
    } catch (err) {
      console.error("Error deleting strategy:", err);
    }
  };

  const handleUploadStrategy = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = async (evt) => {
      const content = evt.target.result;
      try {
        const res = await fetch(`${BACKEND_URL}/api/strategies/upload`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filename: file.name, content })
        });
        const data = await res.json();
        if (data.success) {
          alert("Strategy guideline uploaded successfully!");
          fetchPlugins();
          fetchData();
        } else {
          alert(`Upload failed: ${data.error}`);
        }
      } catch (err) {
        alert(`Upload error: ${err.message}`);
      }
    };
    reader.readAsText(file);
  };

  // Chat Submission Handler
  const handleSendChatMessage = async (e) => {
    e.preventDefault();
    if (!chatInput.trim() || chatLoading) return;

    const userMsg = { role: 'user', content: chatInput };
    const newMessages = [...chatMessages, userMsg];
    setChatMessages(newMessages);
    setChatInput('');
    setChatLoading(true);
    setChatToolLogs([]);

    try {
      const res = await fetch(`${BACKEND_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: newMessages })
      });
      const data = await res.json();
      if (data.error) {
        setChatMessages(prev => [...prev, { role: 'assistant', content: `Error: ${data.error}`, isNew: true }]);
      } else {
        setChatMessages(prev => [...prev, { role: 'assistant', content: data.response, isNew: true }]);
        if (data.toolLogs && data.toolLogs.length > 0) {
          setChatToolLogs(data.toolLogs);
        }
      }
    } catch (err) {
      setChatMessages(prev => [...prev, { role: 'assistant', content: `Network error: ${err.message}`, isNew: true }]);
    } finally {
      setChatLoading(false);
      setTimeout(() => {
        chatInputRef.current?.focus();
      }, 50);
    }
  };

  // Clear Chat History Handler
  const handleClearChat = async () => {
    if (!window.confirm("Are you sure you want to clear the chat history?")) return;
    try {
      const res = await fetch(`${BACKEND_URL}/api/chat/clear`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setChatMessages([]);
      }
    } catch (err) {
      console.error("Failed to clear chat history:", err);
    }
  };

  // API Call: Save settings
  const handleSaveSettings = async (e) => {
    e?.preventDefault();
    try {
      const res = await fetch(`${BACKEND_URL}/api/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settingsForm)
      });
      const data = await res.json();
      if (data.success) {
        alert("Settings successfully updated!");
        fetchData();
      }
    } catch (err) {
      alert("Failed to save settings: " + err.message);
    }
  };

  // API Call: Test phone alert signal connection
  const handleTestAlert = async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/test-alert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settingsForm)
      });
      const data = await res.json();
      if (res.ok) {
        alert(data.message);
      } else {
        alert("Failed to send test alert: " + data.message);
      }
    } catch (err) {
      alert("Error sending test alert: " + err.message);
    }
  };

  // API Call: Start/Stop Bot Loop
  const handleToggleBot = async (enable) => {
    const nextSettings = { ...settingsForm, botEnabled: enable };
    setSettingsForm(nextSettings);
    try {
      const res = await fetch(`${BACKEND_URL}/api/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(nextSettings)
      });
      const data = await res.json();
      if (data.success) {
        fetchData();
      }
    } catch (err) {
      alert("Error toggling bot status: " + err.message);
    }
  };

  // API Call: Execute manual paper trade
  const handleManualTrade = async (action) => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/trade/manual`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          amountPct: manualTrade.amountPct,
          symbol: status.settings.selectedAsset
        })
      });
      const data = await res.json();
      if (data.success) {
        fetchData();
      } else {
        alert("Manual order rejected: " + data.message);
      }
    } catch (err) {
      alert("Error executing trade: " + err.message);
    }
  };

  // API Call: Reset portfolio
  const handleResetPortfolio = async () => {
    if (!confirm("Are you sure you want to reset your simulated portfolio? This will wipe your trade history and restore balance to $10,000.")) return;
    try {
      const res = await fetch(`${BACKEND_URL}/api/reset-portfolio`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        fetchData();
      }
    } catch (err) {
      alert("Error resetting portfolio: " + err.message);
    }
  };

  // API Call: Clear logs
  const handleClearLogs = async () => {
    try {
      await fetch(`${BACKEND_URL}/api/logs/clear`, { method: 'POST' });
      fetchData();
    } catch (err) {
      alert("Error clearing logs: " + err.message);
    }
  };

  // API Call: Run Backtest
  const handleRunBacktest = async (e) => {
    e.preventDefault();
    setBacktestRunning(true);
    setBacktestError('');
    setBacktestResults(null);
    try {
      const res = await fetch(`${BACKEND_URL}/api/backtest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(backtestConfig)
      });
      const data = await res.json();
      if (res.ok) {
        setBacktestResults(data);
      } else {
        setBacktestError(data.error || "Backtest failed");
      }
    } catch (err) {
      setBacktestError("Network error: " + err.message);
    } finally {
      setBacktestRunning(false);
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', gap: '16px' }}>
        <RefreshCw style={{ animation: 'spin 2s linear infinite', color: 'var(--color-primary)' }} size={48} />
        <p style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem', letterSpacing: '1px' }}>SYNCHRONIZING WITH AETHER BOT RUNTIME...</p>
        <style>{`@keyframes spin { 100% { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  // Calculate current holdings valuation
  const assetName = status?.settings?.selectedAsset?.split('/')[0] || 'BTC';
  const holdingsInfo = status?.portfolio?.positions[assetName] || { amount: 0, avgEntryPrice: 0 };
  const currentAssetPrice = candleData[candleData.length - 1]?.close || 0;
  const holdingsValuation = holdingsInfo.amount * currentAssetPrice;
  const totalPortfolioValue = (status?.portfolio?.balanceUSD || 0) + holdingsValuation;
  const peakPrice = status?.highestPriceReached?.[assetName] || holdingsInfo.avgEntryPrice || 0;

  return (
    <div className={`app-container ${isNavExpanded ? 'nav-expanded' : 'nav-collapsed'}`}>
      
      {/* SIDEBAR NAVIGATION */}
      <aside className={`side-nav ${isNavExpanded ? 'expanded' : 'collapsed'}`}>
        <div className="side-nav-brand">
          <div className="brand-icon">
            <img src="/favicon.svg" alt="Aether Logo" style={{ width: '24px', height: '24px', display: 'block' }} />
          </div>
          {isNavExpanded && (
            <div className="brand-details">
              <h1 className="brand-title">AETHER AI</h1>
              <p className="brand-subtitle">CRYPTOCURRENCY ALGORITHMIC BOT</p>
            </div>
          )}
        </div>

        {/* Navigation */}
        <nav className="side-nav-links">
          <button className={`side-nav-btn ${activeTab === 'dashboard' ? 'active' : ''}`} onClick={() => setActiveTab('dashboard')} title="Dashboard">
            <TrendingUp size={16} />
            {isNavExpanded && <span>Dashboard</span>}
          </button>
          <button className={`side-nav-btn ${activeTab === 'terminal' ? 'active' : ''}`} onClick={() => setActiveTab('terminal')} title="Live Terminal">
            <Activity size={16} />
            {isNavExpanded && <span>Live Terminal</span>}
          </button>
          <button className={`side-nav-btn ${activeTab === 'backtest' ? 'active' : ''}`} onClick={() => setActiveTab('backtest')} title="Backtester">
            <History size={16} />
            {isNavExpanded && <span>Backtester</span>}
          </button>
          <button className={`side-nav-btn ${activeTab === 'logs' ? 'active' : ''}`} onClick={() => setActiveTab('logs')} title="Brain Logs">
            <TermIcon size={16} />
            {isNavExpanded && <span>Brain Logs</span>}
          </button>

          <button className={`side-nav-btn ${activeTab === 'settings' ? 'active' : ''}`} onClick={() => setActiveTab('settings')} title="Settings">
            <SettingsIcon size={16} />
            {isNavExpanded && <span>Settings</span>}
          </button>
          <button className={`side-nav-btn ${activeTab === 'manual' ? 'active' : ''}`} onClick={() => setActiveTab('manual')} title="System Manual">
            <HelpCircle size={16} />
            {isNavExpanded && <span>System Manual</span>}
          </button>
        </nav>

        {/* Status indicator / Footer */}
        <div className="side-nav-footer">
          {isNavExpanded ? (
            <div className="side-nav-bot-ops" style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
              padding: '8px 10px',
              background: 'rgba(255, 255, 255, 0.02)',
              border: '1px solid rgba(255, 255, 255, 0.05)',
              borderRadius: '6px',
              width: '100%'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.7rem', fontWeight: 'bold', textTransform: 'uppercase', color: 'var(--color-secondary)', letterSpacing: '0.5px' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  Bot Operations
                  <span style={{
                    width: '6px',
                    height: '6px',
                    borderRadius: '50%',
                    backgroundColor: status?.isBotRunning ? 'var(--color-success)' : 'var(--color-danger)',
                    boxShadow: status?.isBotRunning ? '0 0 6px var(--color-success)' : '0 0 6px var(--color-danger)',
                    display: 'inline-block'
                  }} />
                </span>
              </div>
              <div style={{ display: 'flex', gap: '6px', width: '100%' }}>
                {status?.isBotRunning ? (
                  <button 
                    className="btn btn-danger" 
                    style={{ flex: 1, padding: '5px 8px', fontSize: '0.7rem', height: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }} 
                    onClick={() => handleToggleBot(false)} 
                    type="button"
                  >
                    <Pause size={11} /> Pause Bot
                  </button>
                ) : (
                  <button 
                    className="btn btn-success" 
                    style={{ flex: 1, padding: '5px 8px', fontSize: '0.7rem', height: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }} 
                    onClick={() => handleToggleBot(true)} 
                    type="button"
                  >
                    <Play size={11} /> Start Bot
                  </button>
                )}
                <button 
                  className="btn btn-secondary" 
                  style={{ padding: '5px 8px', fontSize: '0.7rem', height: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center' }} 
                  onClick={handleResetPortfolio} 
                  type="button"
                >
                  Reset
                </button>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'center', width: '100%' }}>
              {status?.isBotRunning ? (
                <button 
                  className="btn btn-danger" 
                  style={{ width: '36px', height: '36px', borderRadius: '50%', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid rgba(248, 113, 113, 0.4)', boxShadow: '0 0 8px rgba(248, 113, 113, 0.2)' }}
                  onClick={() => handleToggleBot(false)} 
                  type="button"
                  title="Pause Bot"
                >
                  <Pause size={14} />
                </button>
              ) : (
                <button 
                  className="btn btn-success" 
                  style={{ width: '36px', height: '36px', borderRadius: '50%', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid rgba(74, 222, 128, 0.4)', boxShadow: '0 0 8px rgba(74, 222, 128, 0.2)' }}
                  onClick={() => handleToggleBot(true)} 
                  type="button"
                  title="Start Bot"
                >
                  <Play size={14} style={{ marginLeft: '1px' }} />
                </button>
              )}
            </div>
          )}

          <button className="side-nav-toggle" onClick={() => setIsNavExpanded(!isNavExpanded)} title={isNavExpanded ? "Collapse Menu" : "Expand Menu"}>
            {isNavExpanded ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
          </button>
        </div>
      </aside>

      <div className="main-viewport" style={{ position: 'relative' }}>
      {activeTab === 'dashboard' && (
        <div className="aether-dashboard-wrapper fade-in">
          <CognitiveAnalysis status={status} />
          <div className="aether-terminal-cols">
            {/* Left Column: Account & Operations Control */}
            <div className="terminal-col-left">
              {/* Valuation Dashboard */}
              <div className="term-panel" style={{ height: '160px', minHeight: '160px', maxHeight: '160px', display: 'flex', flexDirection: 'column' }}>
                <div className="term-panel-header">
                  <span>Valuation Dashboard</span>
                </div>
                <div className="wallet-box" style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '5px', padding: '6px 12px', justifyContent: 'center' }}>
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <span className="text-muted" style={{ textTransform: 'uppercase', fontSize: '0.62rem', letterSpacing: '0.5px' }}>Total Net Worth</span>
                    <span className="wallet-net-worth" style={{ fontSize: '1.25rem', marginTop: '1px' }}>
                      ${totalPortfolioValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </div>
                  <div style={{ borderTop: '1px solid rgba(255,255,255,0.04)', paddingTop: '5px', display: 'flex', flexDirection: 'column', gap: '3px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem' }}>
                      <span className="text-muted">Cash (USD)</span>
                      <span style={{ fontWeight: '600', color: '#fff' }}>
                        ${(status?.portfolio?.balanceUSD || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem' }}>
                      <span className="text-muted">Market Valuation</span>
                      <span style={{ fontWeight: '600', color: holdingsValuation > 0 ? 'var(--term-accent-cyan)' : '#fff' }}>
                        ${holdingsValuation.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                    </div>
                    {holdingsInfo.amount > 0 && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', borderTop: '1px dashed rgba(255,255,255,0.03)', paddingTop: '3px' }}>
                        <span className="text-muted">Active Position</span>
                        <span style={{ color: 'var(--term-green)', fontWeight: 'bold' }}>
                          {holdingsInfo.amount.toFixed(4)} {assetName}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Active Positions & Trust Integrity Visualizer */}
              <div className="term-panel" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
                <div className="term-panel-header">
                  <span>Active Positions & Trust Indicators</span>
                </div>
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, padding: '8px 10px' }}>
                  {holdingsInfo.amount > 0 ? (
                    <div style={{ 
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '8px',
                      flex: 1,
                      minHeight: 0,
                      overflowY: 'auto',
                      paddingRight: '4px'
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontWeight: 'bold', fontSize: '0.8rem', color: '#fff' }}>{assetName.split('/')[0]} Long Position</span>
                        <span className="intel-badge bullish" style={{ fontSize: '0.6rem', padding: '1px 5px', borderRadius: '4px', color: 'var(--term-green)', background: 'rgba(74, 222, 128, 0.08)', border: '1px solid rgba(74, 222, 128, 0.15)' }}>Active</span>
                      </div>
                      
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', background: 'rgba(255, 255, 255, 0.015)', border: '1px solid rgba(255, 255, 255, 0.03)', padding: '6px 8px', borderRadius: '6px' }}>
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                          <span className="text-muted" style={{ fontSize: '0.58rem', textTransform: 'uppercase' }}>Position Size</span>
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.74rem', fontWeight: 'bold', color: '#fff', marginTop: '1px' }}>{holdingsInfo.amount.toFixed(6)} {assetName.split('/')[0]}</span>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                          <span className="text-muted" style={{ fontSize: '0.58rem', textTransform: 'uppercase' }}>Entry Price</span>
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.74rem', fontWeight: 'bold', color: '#fff', marginTop: '1px' }}>${holdingsInfo.avgEntryPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}</span>
                        </div>
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', background: 'rgba(255, 255, 255, 0.015)', border: '1px solid rgba(255, 255, 255, 0.03)', padding: '6px 8px', borderRadius: '6px' }}>
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                          <span className="text-muted" style={{ fontSize: '0.58rem', textTransform: 'uppercase' }}>Current Price</span>
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.74rem', fontWeight: 'bold', color: '#fff', marginTop: '1px' }}>${currentAssetPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}</span>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                          <span className="text-muted" style={{ fontSize: '0.58rem', textTransform: 'uppercase' }}>Unrealized P&L</span>
                          <span style={{ 
                            fontFamily: 'var(--font-mono)', 
                            fontSize: '0.74rem', 
                            fontWeight: 'bold', 
                            marginTop: '1px',
                            color: (currentAssetPrice - holdingsInfo.avgEntryPrice) * holdingsInfo.amount >= 0 ? 'var(--term-green)' : 'var(--term-red)'
                          }}>
                            {((currentAssetPrice - holdingsInfo.avgEntryPrice) * holdingsInfo.amount) >= 0 ? '+' : ''}
                            ${((currentAssetPrice - holdingsInfo.avgEntryPrice) * holdingsInfo.amount).toFixed(2)} 
                            <span style={{ fontSize: '0.62rem', marginLeft: '4px', fontWeight: 'normal' }}>
                              ({holdingsInfo.avgEntryPrice > 0 ? (((currentAssetPrice - holdingsInfo.avgEntryPrice) / holdingsInfo.avgEntryPrice) * 100).toFixed(2) : '0.00'}%)
                            </span>
                          </span>
                        </div>
                      </div>

                      {/* Visual Position progress bar / gauge */}
                      {(() => {
                        const stops = status?.activeTradeStops;
                        if (!stops) return null;

                        const activeStopsList = [];
                        if (stops.stopLossPrice) activeStopsList.push(stops.stopLossPrice);
                        if (stops.atrStopPrice) activeStopsList.push(stops.atrStopPrice);
                        if (stops.trailingStopPrice) activeStopsList.push(stops.trailingStopPrice);
                        
                        const activeFloor = activeStopsList.length > 0 ? Math.max(...activeStopsList) : (holdingsInfo.avgEntryPrice * 0.9);
                        const activeCeiling = stops.takeProfitPrice || (holdingsInfo.avgEntryPrice * 1.1);
                        
                        const totalRange = activeCeiling - activeFloor;
                        const gaugePercent = totalRange > 0 ? Math.max(0, Math.min(100, ((currentAssetPrice - activeFloor) / totalRange) * 100)) : 50;
                        const entryPercent = totalRange > 0 ? Math.max(0, Math.min(100, ((holdingsInfo.avgEntryPrice - activeFloor) / totalRange) * 100)) : 50;
                        
                        return (
                          <div style={{ marginTop: '2px', borderTop: '1px solid rgba(255, 255, 255, 0.04)', paddingTop: '6px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.6rem', fontWeight: 'bold', color: 'var(--term-accent-cyan)', marginBottom: '3px' }}>
                              <span>TRADE INTEGRITY BOUNDARY</span>
                              <span style={{ fontSize: '0.55rem', color: 'var(--term-text-secondary)', fontWeight: 'normal' }}>
                                Floor: {activeStopsList.length > 0 ? 'Active stops' : 'Estimated Floor'}
                              </span>
                            </div>
                            
                            <div style={{ position: 'relative', height: '14px', margin: '6px 0', background: 'rgba(0, 0, 0, 0.3)', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.05)', overflow: 'hidden' }}>
                              {/* Drawdown Zone (Red) */}
                              <div style={{ position: 'absolute', left: '0', width: `${entryPercent}%`, height: '100%', background: 'linear-gradient(90deg, rgba(239, 68, 68, 0.15) 0%, rgba(239, 68, 68, 0.03) 100%)' }} />
                              {/* Profit Zone (Green) */}
                              <div style={{ position: 'absolute', left: `${entryPercent}%`, right: '0', height: '100%', background: 'linear-gradient(90deg, rgba(34, 197, 94, 0.03) 0%, rgba(34, 197, 94, 0.15) 100%)' }} />
                              
                              {/* Entry Price Line marker */}
                              <div style={{ position: 'absolute', left: `${entryPercent}%`, top: '0', bottom: '0', width: '2px', backgroundColor: 'rgba(255,255,255,0.35)', zIndex: 2 }} />
                              
                              {/* Current Price Marker */}
                              <div style={{ 
                                position: 'absolute', 
                                left: `${gaugePercent}%`, 
                                top: '50%', 
                                transform: 'translate(-50%, -50%)', 
                                width: '6px', 
                                height: '6px', 
                                borderRadius: '50%', 
                                backgroundColor: currentAssetPrice >= holdingsInfo.avgEntryPrice ? 'var(--term-green)' : 'var(--term-red)', 
                                boxShadow: `0 0 8px ${currentAssetPrice >= holdingsInfo.avgEntryPrice ? 'var(--term-green)' : 'var(--term-red)'}`,
                                zIndex: 3
                              }} />
                            </div>
                            
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.55rem', color: 'var(--term-text-secondary)', fontFamily: 'var(--font-mono)' }}>
                              <span title="Closest Stop Floor" style={{ color: activeStopsList.length > 0 ? 'var(--term-red)' : 'inherit' }}>
                                Floor: ${activeFloor.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
                              </span>
                              <span title="Entry Price">
                                Entry: ${holdingsInfo.avgEntryPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
                              </span>
                              <span title="Take Profit Target" style={{ color: stops.takeProfitPrice ? 'var(--term-green)' : 'inherit' }}>
                                Target: ${activeCeiling.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
                              </span>
                            </div>
                          </div>
                        );
                      })()}

                      {/* Stop details list */}
                      {(() => {
                        const stops = status?.activeTradeStops;
                        if (!stops) return null;

                        const formatRow = (name, val, isEnabled, isProfit = false) => {
                          if (!isEnabled || !val) return null;
                          const pct = (((val - currentAssetPrice) / currentAssetPrice) * 100);
                          return (
                            <div key={name} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.62rem', padding: '2px 0', borderBottom: '1px dashed rgba(255,255,255,0.015)' }}>
                              <span className="text-muted" style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                                <span style={{ width: '4px', height: '4px', borderRadius: '50%', background: isProfit ? 'var(--term-green)' : 'var(--term-red)' }}></span>
                                {name}
                              </span>
                              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 'bold', color: '#fff' }}>
                                ${val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
                                <span style={{ marginLeft: '4px', fontSize: '0.58rem', color: isProfit ? 'var(--term-green)' : 'var(--term-red)' }}>
                                  ({pct >= 0 ? '+' : ''}{pct.toFixed(2)}%)
                                </span>
                              </span>
                            </div>
                          );
                        };

                        const hasAnyStop = stops.stopLossPrice || stops.atrStopPrice || stops.trailingStopPrice || stops.takeProfitPrice;

                        return hasAnyStop ? (
                          <div style={{ borderTop: '1px dashed rgba(255,255,255,0.03)', paddingTop: '6px', marginTop: '2px' }}>
                            <span style={{ fontSize: '0.58rem', textTransform: 'uppercase', color: 'var(--term-text-secondary)', fontWeight: 'bold', display: 'block', marginBottom: '3px' }}>
                              ACTIVE SAFETY LIMITS
                            </span>
                            {formatRow('Hard Stop Loss', stops.stopLossPrice, !!stops.stopLossPrice)}
                            {formatRow('ATR Volatility Stop', stops.atrStopPrice, !!stops.atrStopPrice)}
                            {formatRow('Trailing Stop Loss', stops.trailingStopPrice, !!stops.trailingStopPrice)}
                            {formatRow('Take Profit Target', stops.takeProfitPrice, !!stops.takeProfitPrice, true)}
                          </div>
                        ) : null;
                      })()}
                    </div>
                  ) : (
                    <div style={{ textAlign: 'center', padding: '16px', color: 'var(--term-text-secondary)', fontSize: '0.72rem', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, gap: '8px' }}>
                      <div className="radar-pulse" style={{ width: '12px', height: '12px', borderRadius: '50%', background: 'var(--term-accent-cyan)', boxShadow: '0 0 10px var(--term-accent-cyan)', animation: 'pulse-glow 2s infinite ease-in-out' }} />
                      <span style={{ color: '#fff', fontSize: '0.75rem', fontWeight: 'bold', letterSpacing: '0.5px' }}>BOT IS ONLINE & SCANNING</span>
                      <span style={{ fontSize: '0.64rem', color: 'var(--term-text-secondary)' }}>Monitoring markets for Elliott Wave patterns and momentum triggers.</span>
                    </div>
                  )}

                  {/* Open Orders Section (Both Coinbase and Aether) */}
                  <div style={{ borderTop: '1px solid rgba(255, 255, 255, 0.04)', paddingTop: '8px', marginTop: '8px' }}>
                    <span style={{ fontSize: '0.58rem', textTransform: 'uppercase', color: 'var(--term-text-secondary)', fontWeight: 'bold', display: 'block', marginBottom: '4px' }}>
                      OPEN ORDERS (COINBASE & AETHER)
                    </span>
                    
                    {(() => {
                      const cbOpenOrders = status?.openOrders || [];
                      const aetherCondOrders = status?.conditionalOrders || [];
                      
                      const allOrders = [
                        ...cbOpenOrders.map(o => ({
                          id: o.id,
                          source: 'Coinbase',
                          action: o.side.toUpperCase(),
                          price: o.price,
                          amount: o.amount,
                          symbol: o.symbol,
                          type: 'limit',
                          details: `Limit Order @ $${o.price.toLocaleString(undefined, { minimumFractionDigits: 2 })}`
                        })),
                        ...aetherCondOrders.map(o => ({
                          id: o.id,
                          source: 'Aether',
                          action: o.action.toUpperCase(),
                          price: o.triggerValue,
                          amount: o.amountTokens,
                          symbol: o.symbol,
                          type: o.executionType,
                          details: `Virtual: ${o.triggerType === 'price_below' ? 'Price <' : o.triggerType === 'price_above' ? 'Price >' : 'Time >'} $${o.triggerValue.toLocaleString(undefined, { minimumFractionDigits: 2 })}`
                        }))
                      ];

                      if (allOrders.length === 0) {
                        return (
                          <div style={{ fontSize: '0.62rem', color: 'var(--term-text-secondary)', fontStyle: 'italic', padding: '2px 0' }}>
                            No active open orders.
                          </div>
                        );
                      }

                      return (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '160px', overflowY: 'auto' }}>
                          {allOrders.map(order => {
                            const isBuy = order.action === 'BUY';
                            return (
                              <div key={order.id} style={{ 
                                display: 'flex', 
                                justifyContent: 'space-between', 
                                alignItems: 'center', 
                                padding: '4px 6px', 
                                background: 'rgba(255, 255, 255, 0.01)', 
                                border: '1px solid rgba(255, 255, 255, 0.03)', 
                                borderRadius: '4px',
                                fontSize: '0.64rem'
                              }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                  <span style={{ 
                                    fontSize: '0.52rem', 
                                    padding: '1px 3px', 
                                    borderRadius: '3px',
                                    fontWeight: 'bold',
                                    color: isBuy ? 'var(--term-green)' : 'var(--term-accent-coral)',
                                    background: isBuy ? 'rgba(74, 222, 128, 0.08)' : 'rgba(248, 113, 113, 0.08)'
                                  }}>
                                    {order.action}
                                  </span>
                                  <span style={{ 
                                    fontSize: '0.52rem', 
                                    padding: '1px 3px', 
                                    borderRadius: '3px',
                                    fontWeight: 'bold',
                                    color: order.source === 'Coinbase' ? '#55c2ff' : '#d280ff',
                                    background: order.source === 'Coinbase' ? 'rgba(85, 194, 255, 0.08)' : 'rgba(210, 128, 255, 0.08)',
                                    border: `1px solid ${order.source === 'Coinbase' ? 'rgba(85, 194, 255, 0.15)' : 'rgba(210, 128, 255, 0.15)'}`
                                  }}>
                                    {order.source}
                                  </span>
                                  <span style={{ color: 'var(--term-text-secondary)', fontFamily: 'var(--font-mono)' }}>
                                    {order.amount ? `${order.amount.toFixed(2)} ${order.symbol.split('/')[0]}` : `${order.symbol.split('/')[0]}`}
                                  </span>
                                </div>
                                <span style={{ color: '#fff', fontWeight: 'bold', fontFamily: 'var(--font-mono)' }}>
                                  {order.details}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })()}
                  </div>
                </div>
              </div>

              {/* Recent Execution Fills (Simplified Left-Column Log) */}
              <div className="term-panel" style={{ height: '240px', minHeight: '240px', maxHeight: '240px', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
                <div className="term-panel-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>Recent Execution Fills</span>
                  <span className="text-muted" style={{ fontSize: '0.6rem', textTransform: 'none' }}>Fills Ledger</span>
                </div>
                <div style={{ flex: 1, overflowY: 'auto', padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: '6px', minHeight: 0 }}>
                  {trades.length === 0 ? (
                    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--term-text-secondary)', fontSize: '0.72rem' }}>
                      No recent executions.
                    </div>
                  ) : (
                    trades.slice(0, 10).map((trade, idx) => {
                      const tradeTime = new Date(trade.timestamp);
                      const formattedTime = tradeTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' ' + tradeTime.toLocaleDateString([], { month: 'short', day: 'numeric' });
                      const assetName = trade.symbol.split('/')[0];
                      const isBuy = trade.action.toUpperCase() === 'BUY';
                      
                      return (
                        <div key={`fill-${idx}`} style={{ 
                          display: 'flex', 
                          justifyContent: 'space-between', 
                          alignItems: 'center', 
                          padding: '5px 8px', 
                          background: 'rgba(255, 255, 255, 0.01)', 
                          border: '1px solid rgba(255, 255, 255, 0.03)', 
                          borderRadius: '6px',
                          fontSize: '0.7rem'
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{ 
                              fontSize: '0.58rem', 
                              padding: '2px 5px', 
                              borderRadius: '4px',
                              fontWeight: 'bold',
                              textTransform: 'uppercase',
                              color: isBuy ? 'var(--term-green)' : 'var(--term-accent-coral)',
                              background: isBuy ? 'rgba(74, 222, 128, 0.08)' : 'rgba(248, 113, 113, 0.08)'
                            }}>
                              {trade.action}
                            </span>
                            <div>
                              <span style={{ color: '#fff', fontWeight: 'bold' }}>{assetName}</span>
                              <span style={{ color: 'var(--term-text-secondary)', marginLeft: '6px', fontSize: '0.65rem' }}>
                                {trade.amount.toFixed(4)} @ ${trade.price.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                              </span>
                            </div>
                          </div>
                          <span style={{ color: 'var(--term-text-secondary)', fontSize: '0.62rem', fontFamily: 'var(--font-mono)' }}>
                            {formattedTime}
                          </span>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>

            {/* Center Column: AI Assistant & Custom Canvas Chart */}
            <div className="terminal-col-center" style={{ position: 'relative' }}>
              <JarvisCore animating={chatLoading} />
              <div className="term-panel term-chat-panel" style={{ height: '460px', minHeight: '460px', maxHeight: '460px', display: 'flex', flexDirection: 'column', flexShrink: 0, padding: 0 }}>
                <div className="term-panel-header" style={{ padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.04)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <MessageSquare size={16} /> Aether AI Assistant
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <button 
                      type="button"
                      onClick={handleClearChat}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: 'rgba(255,255,255,0.4)',
                        cursor: 'pointer',
                        fontSize: '0.7rem',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                        padding: '2px 6px',
                        borderRadius: '4px',
                        transition: 'all 0.2s'
                      }}
                      onMouseOver={(e) => { e.currentTarget.style.color = 'var(--term-red)'; e.currentTarget.style.background = 'rgba(239, 68, 68, 0.08)'; }}
                      onMouseOut={(e) => { e.currentTarget.style.color = 'rgba(255,255,255,0.4)'; e.currentTarget.style.background = 'none'; }}
                      title="Clear chat history"
                    >
                      Clear History
                    </button>
                    <span className="intel-badge neutral" style={{ fontSize: '0.65rem' }}>Core Online</span>
                  </div>
                </div>



                {/* Chat messages scrolling log */}
                <div 
                  ref={chatScrollRef}
                  onScroll={handleChatScroll}
                  className="term-chat-messages"
                  style={{ position: 'relative', zIndex: 1 }}
                >
                  {chatMessages.map((msg, idx) => (
                    <div
                      key={`dash-msg-${idx}`}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        width: '100%',
                        alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start',
                      }}
                    >
                      <div className={msg.role === 'user' ? 'term-chat-bubble-user' : ''} style={{
                        maxWidth: '85%',
                        padding: '6px 10px',
                        borderRadius: '12px',
                        background: msg.role === 'user' ? 'rgba(255, 255, 255, 0.04)' : 'rgba(255, 255, 255, 0.02)',
                        border: msg.role === 'user' ? '1px solid rgba(255, 255, 255, 0.08)' : '1px solid rgba(255, 255, 255, 0.04)',
                        color: '#fff',
                        fontSize: '0.75rem',
                        lineHeight: '1.3'
                      }}>
                        {msg.role === 'user' ? (
                          <div style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</div>
                        ) : (
                          msg.isNew ? (
                            <TypewriterMessage 
                              content={msg.content} 
                              scrollContainerRef={chatScrollRef}
                              chatAutoScroll={chatAutoScroll}
                              onComplete={() => handleTypewriterComplete(idx)}
                            />
                          ) : (
                            formatChatMessage(msg.content)
                          )
                        )}
                      </div>
                      <span style={{ fontSize: '0.6rem', color: 'var(--term-text-secondary)', marginTop: '3px' }}>
                        {msg.role === 'user' ? 'You' : 'Aether Bot'}
                      </span>
                    </div>
                  ))}

                  {chatLoading && (
                    <div style={{
                      alignSelf: 'flex-start',
                      width: '100%',
                      maxWidth: '85%',
                      padding: '8px 12px',
                      borderRadius: '12px',
                      background: 'rgba(255, 255, 255, 0.015)',
                      border: '1px dashed rgba(255, 255, 255, 0.15)',
                      color: '#fff',
                      fontSize: '0.75rem',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '8px',
                      boxShadow: 'var(--shadow-glow-orange)'
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <div style={{ position: 'relative', width: '24px', height: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <Cpu size={14} style={{ color: 'var(--term-accent-coral)', animation: 'spin-slow 3s linear infinite' }} />
                          <span style={{
                            position: 'absolute', width: '100%', height: '100%', borderRadius: '50%',
                            border: '1px dashed var(--term-accent-coral)', animation: 'spin-slow 8s linear infinite'
                          }} />
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                          <span style={{ fontWeight: '700', letterSpacing: '0.5px', color: 'var(--term-accent-coral)', fontSize: '0.72rem' }}>AETHER COGNITIVE ENGINE</span>
                          <span style={{ fontSize: '0.6rem', color: 'var(--term-text-secondary)', fontWeight: '500' }}>STATUS: ACTIVE REASONING LOOP</span>
                        </div>
                      </div>
                      
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', borderTop: '1px solid rgba(255, 255, 255, 0.05)', paddingTop: '8px' }}>
                        {thinkingStages.map((stage, sIdx) => {
                          const isDone = sIdx < thinkingStep;
                          const isActive = sIdx === thinkingStep;
                          return (
                            <div key={sIdx} style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '8px',
                              fontSize: '0.7rem',
                              color: isDone ? 'var(--term-green)' : isActive ? '#fff' : 'var(--term-text-secondary)',
                              transition: 'color 0.2s ease',
                              fontWeight: isActive ? '600' : '400'
                            }}>
                              <span style={{
                                width: '4px',
                                height: '4px',
                                borderRadius: '50%',
                                background: isDone ? 'var(--term-green)' : isActive ? 'var(--term-accent-coral)' : 'rgba(255,255,255,0.1)',
                                boxShadow: isActive ? '0 0 6px var(--term-accent-coral)' : 'none',
                                display: 'inline-block'
                              }} />
                              <span>{stage}</span>
                              {isActive && <span style={{ animation: 'flash 1s infinite alternate', fontSize: '0.7rem', color: 'var(--term-accent-coral)', marginLeft: '2px' }}>▌</span>}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>

                {/* Chat Input form */}
                <form onSubmit={handleSendChatMessage} className="term-chat-input-form">
                  <input
                    ref={chatInputRef}
                    type="text"
                    className="term-chat-input"
                    placeholder="Ask about your portfolio, trades, or market structure..."
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                  />
                  <button
                    type="submit"
                    className="term-chat-send"
                    disabled={chatLoading || !chatInput.trim()}
                  >
                    Send
                  </button>
                </form>
              </div>

              {/* Custom Candlestick Trading Chart (Native, Transparent) */}
              <div className="term-panel term-chart-card">
                <div className="term-panel-header">
                  <span>{status?.settings?.selectedAsset || 'BTC/USD'} Chart Terminal</span>
                </div>
                <div className="term-chart-frame">
                  <CustomTradingChart
                    candleData={candleData}
                    setCandleData={setCandleData}
                    symbol={status?.settings?.selectedAsset || 'BTC/USD'}
                    selectedAsset={status?.settings?.selectedAsset || 'BTC/USD'}
                    selectedTimeframe={status?.settings?.selectedTimeframe || '1h'}
                    backendUrl={BACKEND_URL}
                  />
                </div>
              </div>
            </div>

            {/* Right Column: Cognitive Operations Analysis & Technical Indicators Matrix */}
            <div className="terminal-col-right">

              {/* Multi-Timeframe Trend & Regime Matrix */}
              <div className="term-panel multi-tf-term-panel" style={{ height: '330px', minHeight: '330px', maxHeight: '330px', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
                <div className="term-panel-header">
                  <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Activity size={16} style={{ color: 'var(--color-primary)' }} />
                    <span>Multi-Timeframe Trend Matrix</span>
                  </span>
                </div>
                <div style={{ 
                  flex: 1, 
                  minHeight: 0, 
                  background: 'rgba(0, 0, 0, 0.2)', 
                  border: '1px solid rgba(255, 255, 255, 0.04)', 
                  borderRadius: '6px',
                  padding: '8px 10px',
                  overflow: 'hidden'
                }}>
                  {multiIndicators ? (
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.06)', textTransform: 'uppercase', fontSize: '0.62rem', letterSpacing: '0.5px' }}>
                          <th style={{ textAlign: 'left', padding: '6px 4px', color: 'var(--color-text)' }}>TF</th>
                          <th style={{ textAlign: 'right', padding: '6px 4px', color: 'var(--color-text)' }}>Price</th>
                          <th style={{ textAlign: 'center', padding: '6px 4px', color: 'var(--color-text)' }}>Regime</th>
                          <th style={{ textAlign: 'center', padding: '6px 4px', color: 'var(--color-text)' }}>RSI</th>
                          <th style={{ textAlign: 'center', padding: '6px 4px', color: 'var(--color-text)' }}>SMA Cross</th>
                          <th style={{ textAlign: 'center', padding: '6px 4px', color: 'var(--color-text)' }}>ADX</th>
                          <th style={{ textAlign: 'center', padding: '6px 4px', color: 'var(--color-text)' }}>RVol</th>
                        </tr>
                      </thead>
                      <tbody>
                        {['15m', '1h', '4h', '1d'].map(tf => {
                          const tfData = multiIndicators[tf] || {};
                          
                          const rsiVal = tfData.rsi;
                          const rsiStatus = rsiVal === undefined ? 'neutral' : rsiVal < 30 ? 'bullish' : rsiVal > 70 ? 'bearish' : 'neutral';
                          
                          const smaStatus = tfData.sma9 === undefined ? 'neutral' : tfData.sma9 > tfData.sma21 ? 'bullish' : 'bearish';
                          const adxStatus = tfData.adx === undefined ? 'neutral' : tfData.adx > 25 ? 'bullish' : 'neutral';
                          const rvolStatus = tfData.rvol === undefined ? 'neutral' : tfData.rvol > 1.5 ? 'bullish' : 'neutral';
                          
                          const regimeText = tfData.regime ? tfData.regime.replace(/_/g, ' ') : 'LOADING';
                          
                          const getRegimeColor = (regime) => {
                            if (regime === 'TRENDING_BULLISH') return 'var(--term-green)';
                            if (regime === 'TRENDING_BEARISH') return 'var(--term-red)';
                            return 'rgba(255, 255, 255, 0.4)'; // neutral
                          };
                          
                          const getRegimeShadow = (regime) => {
                            const color = getRegimeColor(regime);
                            return `0 0 6px ${color}`;
                          };

                          const getCellColor = (status) => {
                            if (status === 'bullish') return 'var(--term-green)';
                            if (status === 'bearish') return 'var(--term-red)';
                            return 'var(--color-text-muted)';
                          };

                          return (
                            <tr key={tf} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.02)', height: '38px' }}>
                              <td style={{ fontWeight: 'bold', color: '#fff', padding: '4px' }}>{tf}</td>
                              <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', padding: '4px', color: '#fff' }}>
                                {tfData.price ? `$${tfData.price.toLocaleString(undefined, { minimumFractionDigits: 2 })}` : '-'}
                              </td>
                              <td style={{ textAlign: 'center', padding: '4px' }}>
                                <div 
                                  title={regimeText}
                                  style={{ 
                                    width: '8px', 
                                    height: '8px', 
                                    borderRadius: '50%', 
                                    backgroundColor: getRegimeColor(tfData.regime), 
                                    boxShadow: getRegimeShadow(tfData.regime), 
                                    display: 'inline-block',
                                    verticalAlign: 'middle',
                                    cursor: 'help'
                                  }} 
                                />
                              </td>
                              <td style={{ textAlign: 'center', padding: '4px', fontFamily: 'var(--font-mono)', color: getCellColor(rsiStatus), fontWeight: rsiStatus !== 'neutral' ? 'bold' : 'normal' }}>
                                {rsiVal ? rsiVal.toFixed(1) : '-'}
                              </td>
                              <td style={{ textAlign: 'center', padding: '4px', color: getCellColor(smaStatus), fontWeight: 'bold', fontSize: '0.65rem' }}>
                                {tfData.sma9 ? `${tfData.sma9 > tfData.sma21 ? 'Golden' : 'Death'}` : '-'}
                              </td>
                              <td style={{ textAlign: 'center', padding: '4px', fontFamily: 'var(--font-mono)', color: getCellColor(adxStatus) }}>
                                {tfData.adx ? tfData.adx.toFixed(1) : '-'}
                              </td>
                              <td style={{ textAlign: 'center', padding: '4px', fontFamily: 'var(--font-mono)', color: getCellColor(rvolStatus) }}>
                                {tfData.rvol ? `${tfData.rvol.toFixed(1)}x` : '-'}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: '12px', color: 'var(--color-text-muted)' }}>
                      <div className="spinner" style={{ width: '24px', height: '24px', borderRadius: '50%', border: '2px solid rgba(255,255,255,0.05)', borderTopColor: 'var(--color-primary)', animation: 'spin 1s linear infinite' }} />
                      <span style={{ fontSize: '0.75rem', letterSpacing: '0.5px' }}>Retrieving live multi-timeframe market matrix...</span>
                    </div>
                  )}
                </div>
              </div>

              {/* System Operations Log (Dashboard View - Expanded) */}
              <div className="term-panel" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
                <div className="term-panel-header">
                  <span style={{ display: 'flex', alignItems: 'center', gap: '8px', fontFamily: 'var(--font-mono)' }}>
                    {`>_`} SYSTEM OPERATIONS LOG
                  </span>
                </div>
                <div className="log-terminal" style={{ flex: 1, minHeight: 0, background: 'rgba(0, 0, 0, 0.2)', border: '1px solid rgba(255,255,255,0.02)', borderRadius: '8px', padding: '8px' }}>
                  {logs.slice(0, 30).reverse().map((log, idx) => (
                    <div key={idx} className={`log-entry ${log.type}`} style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '2px', paddingBottom: '6px', borderBottom: '1px solid rgba(255,255,255,0.02)' }}>
                      <span className="log-message" style={{ width: '100%', wordBreak: 'break-word', fontSize: '0.72rem' }}>{log.message}</span>
                      <span className="log-time" style={{ fontSize: '0.58rem', marginTop: '1px' }}>{safeFormatDate(log.timestamp, true)}</span>
                    </div>
                  ))}
                </div>
              </div>

              {(() => {
                const indicators = status?.latestDecision?.indicators || {};
                const rsi = indicators.rsi !== undefined && indicators.rsi !== null ? indicators.rsi : 48.5;
                const sma9 = indicators.sma9 || 0;
                const sma21 = indicators.sma21 || 0;
                const ao = indicators.ao !== undefined && indicators.ao !== null ? indicators.ao : 12.4;
                const macd = indicators.macd !== undefined && indicators.macd !== null ? indicators.macd : 0.05;
                const adx = indicators.adx !== undefined && indicators.adx !== null ? indicators.adx : 24.2;
                const rvol = indicators.rvol !== undefined && indicators.rvol !== null ? indicators.rvol : 1.15;
                const regime = indicators.marketRegime || "TRANSITIONING_ZONE";

                // helper for indicator status class
                const getRsiStatus = (val) => val < 30 ? 'bullish' : val > 70 ? 'bearish' : 'neutral';
                const getMacdStatus = (val) => val > 0 ? 'bullish' : val < 0 ? 'bearish' : 'neutral';
                const getAoStatus = (val) => val > 0 ? 'bullish' : val < 0 ? 'bearish' : 'neutral';
                const getSmaStatus = (s9, s21) => {
                  if (!s9 || !s21) return 'neutral';
                  return s9 > s21 ? 'bullish' : 'bearish';
                };
                const getAdxStatus = (val) => val > 25 ? 'bullish' : val < 20 ? 'bearish' : 'neutral';
                const getRvolStatus = (val) => val > 1.5 ? 'bullish' : val < 0.8 ? 'bearish' : 'neutral';

                // helper for left-accent border color
                const getStatusColor = (statusName) => {
                  if (statusName === 'bullish') return 'var(--term-green)';
                  if (statusName === 'bearish') return 'var(--term-red)';
                  return '#475569';
                };

                return (
                  <div className="term-panel" style={{ gap: '6px', padding: '8px 10px', flexShrink: 0 }}>
                    <div className="term-panel-header" style={{ paddingBottom: '4px', borderBottom: '1px solid rgba(255, 255, 255, 0.04)' }}>
                      <span>Indicators</span>
                      <span style={{ fontSize: '0.62rem', fontWeight: 'bold', letterSpacing: '0.2px', color: regime.includes('BULL') ? 'var(--term-green)' : regime.includes('BEAR') ? 'var(--term-red)' : '#fff' }}>
                        {regime.replace(/_/g, ' ')}
                      </span>
                    </div>

                    <div className="indicators-term-grid">
                      {/* RSI */}
                      <div className="indicator-tile" style={{ borderLeft: `3px solid ${getStatusColor(getRsiStatus(rsi))}` }}>
                        <div className="indicator-tile-header">
                          <span className="indicator-tile-name">RSI (14)</span>
                          <span className={`indicator-tile-status ${getRsiStatus(rsi)}`}>
                            {rsi < 30 ? 'Oversold' : rsi > 70 ? 'Overbought' : 'Neutral'}
                          </span>
                        </div>
                        <span className="indicator-tile-val">{rsi.toFixed(2)}</span>
                      </div>

                      {/* MACD */}
                      <div className="indicator-tile" style={{ borderLeft: `3px solid ${getStatusColor(getMacdStatus(macd))}` }}>
                        <div className="indicator-tile-header">
                          <span className="indicator-tile-name">MACD Hist</span>
                          <span className={`indicator-tile-status ${getMacdStatus(macd)}`}>
                            {macd > 0 ? 'Bullish' : macd < 0 ? 'Bearish' : 'Neutral'}
                          </span>
                        </div>
                        <span className="indicator-tile-val">{macd.toFixed(4)}</span>
                      </div>

                      {/* AO */}
                      <div className="indicator-tile" style={{ borderLeft: `3px solid ${getStatusColor(getAoStatus(ao))}` }}>
                        <div className="indicator-tile-header">
                          <span className="indicator-tile-name">Awesome Osc</span>
                          <span className={`indicator-tile-status ${getAoStatus(ao)}`}>
                            {ao > 0 ? 'Bull' : ao < 0 ? 'Bear' : 'Neutral'}
                          </span>
                        </div>
                        <span className="indicator-tile-val">{ao.toFixed(2)}</span>
                      </div>

                      {/* SMA Cross */}
                      <div className="indicator-tile" style={{ borderLeft: `3px solid ${getStatusColor(getSmaStatus(sma9, sma21))}` }}>
                        <div className="indicator-tile-header">
                          <span className="indicator-tile-name">SMA Cross</span>
                          <span className={`indicator-tile-status ${getSmaStatus(sma9, sma21)}`}>
                            {sma9 > sma21 ? 'Golden' : sma9 < sma21 ? 'Death' : 'Neutral'}
                          </span>
                        </div>
                        <span className="indicator-tile-val" style={{ fontSize: '0.72rem', whiteSpace: 'nowrap', marginTop: '1px' }}>
                          {sma9 ? `${sma9.toFixed(1)} / ${sma21.toFixed(1)}` : 'No Data'}
                        </span>
                      </div>

                      {/* ADX */}
                      <div className="indicator-tile" style={{ borderLeft: `3px solid ${getStatusColor(getAdxStatus(adx))}` }}>
                        <div className="indicator-tile-header">
                          <span className="indicator-tile-name">ADX (14)</span>
                          <span className={`indicator-tile-status ${getAdxStatus(adx)}`}>
                            {adx > 25 ? 'Strong' : adx < 20 ? 'Range' : 'Neutral'}
                          </span>
                        </div>
                        <span className="indicator-tile-val">{adx.toFixed(2)}</span>
                      </div>

                      {/* RVol */}
                      <div className="indicator-tile" style={{ borderLeft: `3px solid ${getStatusColor(getRvolStatus(rvol))}` }}>
                        <div className="indicator-tile-header">
                          <span className="indicator-tile-name">Rel Vol</span>
                          <span className={`indicator-tile-status ${getRvolStatus(rvol)}`}>
                            {rvol > 1.5 ? 'High' : rvol < 0.8 ? 'Low' : 'Normal'}
                          </span>
                        </div>
                        <span className="indicator-tile-val">{rvol.toFixed(2)}x</span>
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* LIVE TERMINAL TAB */}
      {activeTab === 'terminal' && (
        <div className={`dashboard-grid fade-in show-subtab-${terminalSubTab}`}>
          {/* Mobile-only Sub-navigation Bar */}
          <div className="mobile-subtabs-bar">
            <button 
              className={`mobile-subtab-btn ${terminalSubTab === 'chart' ? 'active' : ''}`}
              onClick={() => setTerminalSubTab('chart')}
            >
              Live Chart
            </button>
            <button 
              className={`mobile-subtab-btn ${terminalSubTab === 'trade' ? 'active' : ''}`}
              onClick={() => setTerminalSubTab('trade')}
            >
              Manual Execute
            </button>
          </div>

          {/* Quick Manual Trade Pad (Left Column - 350px Sidebar) */}
          <aside className="glass-panel dashboard-sidebar">
            <div className="panel-header">
              <span className="panel-title"><Sliders size={16} /> Manual Execution</span>
            </div>
            
            <div className="form-group" style={{ marginTop: '8px' }}>
              <label className="form-label">Position Allocation ({manualTrade.amountPct}%)</label>
              <input 
                type="range" 
                min="10" 
                max="100" 
                step="10" 
                value={manualTrade.amountPct} 
                onChange={(e) => setManualTrade({ ...manualTrade, amountPct: Number(e.target.value) })}
                style={{ width: '100%', accentColor: 'var(--color-primary)' }}
              />
              <div style={{ display: 'flex', justifyContent: 'between', fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>
                <span>10%</span>
                <span style={{ marginLeft: 'auto' }}>100%</span>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '12px' }}>
              <button className="btn btn-success" onClick={() => handleManualTrade('BUY')}>
                <ArrowUpRight size={18} /> BUY {assetName}
              </button>
              <button className="btn btn-danger" onClick={() => handleManualTrade('SELL')}>
                <ArrowDownRight size={18} /> SELL {assetName}
              </button>
            </div>

            <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '16px', marginTop: '12px' }}>
              <h4 style={{ fontSize: '0.8rem', fontWeight: 'bold', color: 'var(--color-text-muted)', marginBottom: '8px' }}>EXCHANGE BOOK TICK</h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '0.75rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span className="text-muted">Last Price</span>
                  <span style={{ fontWeight: 'bold' }}>${currentAssetPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span className="text-muted">Simulated Fee (0.1%)</span>
                  <span>${(currentAssetPrice * (manualTrade.amountPct / 100) * totalPortfolioValue * 0.001 / currentAssetPrice).toFixed(4)} {assetName}</span>
                </div>
              </div>
            </div>
          </aside>

          {/* Main Chart (Right Column - 1fr Main Window) */}
          <main className="glass-panel chart-container-panel dashboard-main">
            <div className="panel-header">
              <span className="panel-title"><Activity size={16} /> {status?.settings?.selectedAsset} Advanced Charting Terminal</span>
              <span style={{ fontSize: '0.75rem', color: 'var(--color-secondary)' }}>Full TradingView Interface & Drawing Tools</span>
            </div>
            <div style={{ flex: 1, minHeight: 0, borderRadius: '12px', overflow: 'hidden', border: '1px solid var(--border-color)' }}>
              <TradingViewWidget symbol={getTradingViewSymbol(status.settings.selectedAsset, status.settings.exchangeName)} />
            </div>
          </main>
        </div>
      )}

      {/* BACKTESTER TAB */}
      {activeTab === 'backtest' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }} className="fade-in">
          <div className="glass-panel">
            <div className="panel-header">
              <span className="panel-title"><History size={16} /> Backtesting Strategy Sandbox</span>
            </div>

            <form onSubmit={handleRunBacktest} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '16px', alignItems: 'flex-end' }}>
              <div className="form-group">
                <label className="form-label">Asset Pairs</label>
                <select 
                  className="form-select"
                  value={backtestConfig.symbol}
                  onChange={(e) => setBacktestConfig({ ...backtestConfig, symbol: e.target.value })}
                >
                  <option value="BTC/USD">BTC/USD</option>
                  <option value="BTC/USDC">BTC/USDC</option>
                  <option value="ETH/USD">ETH/USD</option>
                  <option value="ETH/USDC">ETH/USDC</option>
                  <option value="SOL/USD">SOL/USD</option>
                  <option value="ADA/USD">ADA/USD</option>
                  <option value="XRP/USD">XRP/USD</option>
                  <option value="XRP/USDC">XRP/USDC</option>
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Timeframe</label>
                <select 
                  className="form-select"
                  value={backtestConfig.timeframe}
                  onChange={(e) => setBacktestConfig({ ...backtestConfig, timeframe: e.target.value })}
                >
                  <option value="1m">1 Minute</option>
                  <option value="5m">5 Minutes</option>
                  <option value="15m">15 Minutes</option>
                  <option value="30m">30 Minutes</option>
                  <option value="1h">1 Hour</option>
                  <option value="2h">2 Hours</option>
                  <option value="4h">4 Hours</option>
                  <option value="6h">6 Hours</option>
                  <option value="1d">1 Day</option>
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Candle Limit (Depth)</label>
                <select 
                  className="form-select"
                  value={backtestConfig.limit}
                  onChange={(e) => setBacktestConfig({ ...backtestConfig, limit: Number(e.target.value) })}
                >
                  <option value={30}>30 Candles</option>
                  <option value={50}>50 Candles</option>
                  <option value={100}>100 Candles</option>
                  <option value={150}>150 Candles (Fast Rules Only)</option>
                  <option value={200}>200 Candles (Fast Rules Only)</option>
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Strategy Brain</label>
                <select 
                  className="form-select"
                  value={backtestConfig.strategy || (backtestConfig.useLlm ? 'llm' : 'rules')}
                  onChange={(e) => {
                    const val = e.target.value;
                    setBacktestConfig({ 
                      ...backtestConfig, 
                      strategy: val,
                      useLlm: val === 'llm' 
                    });
                  }}
                >
                  <option value="rules">Fast Script Rules (RSI/SMA crossings)</option>
                  <option value="ew_rules">Fast Script Elliott Wave (Math Scanner)</option>
                  <option value="llm">(Recommended) Gemini LLM Brain (Queries API)</option>
                </select>
              </div>

              <button className="btn btn-primary" type="submit" disabled={backtestRunning} style={{ height: '42px' }}>
                {backtestRunning ? (
                  <>
                    <RefreshCw style={{ animation: 'spin 2s linear infinite' }} size={16} /> Backtesting...
                  </>
                ) : "Run Simulation"}
              </button>
            </form>

            {backtestConfig.useLlm && (
              <div className="alert-banner" style={{ marginTop: '8px' }}>
                <AlertTriangle size={18} style={{ flexShrink: 0 }} />
                <span><strong>Rate Limit Warning:</strong> LLM backtesting performs real Gemini API evaluations back-to-back with a throttle delay. Limit depth to 30-50 candles. Running a deep LLM backtest can take 1-2 minutes and consume API quota.</span>
              </div>
            )}

            {backtestError && (
              <div className="alert-banner" style={{ background: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.25)', color: '#fca5a5', marginTop: '12px' }}>
                <span>{backtestError}</span>
              </div>
            )}
          </div>

          {/* Backtest Results */}
          {backtestResults && (
            <div className="backtest-results-panel fade-in">
              <div className="glass-panel" style={{ minHeight: '400px' }}>
                <div className="panel-header">
                  <span className="panel-title"><TrendingUp size={16} /> Backtest Equity Performance Curve</span>
                </div>
                <div className="chart-wrapper" ref={btChartContainerRef} style={{ height: '350px' }}></div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div className="glass-panel">
                  <div className="panel-header">
                    <span className="panel-title"><Sliders size={16} /> Simulation Statistics</span>
                  </div>
                  
                  <div className="backtest-stat-grid">
                    <div className="backtest-card">
                      <p className="backtest-card-label">Ending Value</p>
                      <p className="backtest-card-value" style={{ color: backtestResults.pctChange >= 0 ? 'var(--color-success)' : 'var(--color-danger)' }}>
                        ${backtestResults.finalValue.toLocaleString()}
                      </p>
                      <span className="text-muted">({backtestResults.pctChange >= 0 ? '+' : ''}{backtestResults.pctChange}%)</span>
                    </div>

                    <div className="backtest-card">
                      <p className="backtest-card-label">Buy & Hold</p>
                      <p className="backtest-card-value" style={{ color: backtestResults.buyAndHoldPct >= 0 ? 'var(--color-success)' : 'var(--color-danger)' }}>
                        ${backtestResults.buyAndHoldValue.toLocaleString()}
                      </p>
                      <span className="text-muted">({backtestResults.buyAndHoldPct >= 0 ? '+' : ''}{backtestResults.buyAndHoldPct}%)</span>
                    </div>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '0.8rem' }}>
                    <div className="stat-row">
                      <span className="stat-label">Total Trades Filled</span>
                      <span className="stat-val">{backtestResults.tradesCount}</span>
                    </div>
                    <div className="stat-row">
                      <span className="stat-label">Win Rate (Sells)</span>
                      <span className="stat-val" style={{ color: backtestResults.winRate >= 50 ? 'var(--color-success)' : '#fff' }}>
                        {backtestResults.winRate}%
                      </span>
                    </div>
                    <div className="stat-row">
                      <span className="stat-label">Max Drawdown</span>
                      <span className="stat-val" style={{ color: backtestResults.maxDrawdown > 15 ? 'var(--color-danger)' : 'var(--color-success)' }}>
                        {backtestResults.maxDrawdown}%
                      </span>
                    </div>
                    <div className="stat-row">
                      <span className="stat-label">Sharpe Ratio</span>
                      <span className="stat-val" style={{ color: backtestResults.sharpeRatio >= 1.5 ? 'var(--color-success)' : '#fff' }}>
                        {backtestResults.sharpeRatio}
                      </span>
                    </div>
                    <div className="stat-row">
                      <span className="stat-label">Profit Factor</span>
                      <span className="stat-val" style={{ color: backtestResults.profitFactor >= 1.5 ? 'var(--color-success)' : (backtestResults.profitFactor < 1.0 ? 'var(--color-danger)' : '#fff') }}>
                        {backtestResults.profitFactor === 999 ? '∞ (All Wins)' : backtestResults.profitFactor}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="glass-panel" style={{ flex: 1, maxHeight: '260px' }}>
                  <div className="panel-header">
                    <span className="panel-title"><History size={16} /> Simulated Fills</span>
                  </div>
                  <div className="trades-list">
                    {backtestResults.trades.length > 0 ? (
                      backtestResults.trades.map((t, idx) => (
                        <div className="trade-item" key={idx}>
                          <div className="trade-item-left" style={{ width: '100%' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                              <span className={`trade-badge ${t.action.toLowerCase()}`}>{t.action}</span>
                              <span className="text-muted">{safeFormatDate(t.time, true)}</span>
                            </div>
                            <span style={{ fontWeight: '600', color: '#fff', fontSize: '0.75rem', marginTop: '2px' }}>
                              {(t.amount || 0).toFixed(4)} {backtestConfig.symbol.split('/')[0]} @ ${(t.price || 0).toLocaleString()}
                            </span>
                            <span className="text-muted" style={{ display: 'block', fontSize: '0.65rem', marginTop: '4px', fontStyle: 'italic', borderLeft: '1px solid var(--border-color)', paddingLeft: '6px' }}>
                              "{t.reasoning}"
                            </span>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div style={{ textAlign: 'center', padding: '16px 0', color: 'var(--color-text-dark)', fontSize: '0.8rem' }}>
                        The strategy generated no trade triggers.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* BRAIN LOGS TAB */}
      {activeTab === 'logs' && (
        <div className="glass-panel fade-in" style={{ flex: 1, minHeight: 0 }}>
          <div className="panel-header">
            <span className="panel-title"><TermIcon size={16} /> Full Brain Operations Console</span>
            <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
              <span style={{ fontSize: '0.7rem', color: 'var(--color-text-dark)', cursor: 'pointer' }} onClick={handleClearLogs}>Wipe Logs</span>
            </div>
          </div>
          <div className="log-terminal" style={{ flex: 1 }}>
            {logs.slice().reverse().map((log, idx) => (
              <div key={idx} className={`log-entry ${log.type}`}>
                <span className="log-time">{safeFormatDate(log.timestamp)}</span>
                <span className="log-message">{log.message}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* SETTINGS TAB */}
      {activeTab === 'settings' && (
        <div className="settings-grid fade-in">
          {/* Main settings form */}
          <main className="glass-panel scrollable" style={{ gridColumn: 'span 1' }}>
            <div className="panel-header">
              <span className="panel-title"><SettingsIcon size={16} /> System Configurations</span>
            </div>

            <form onSubmit={handleSaveSettings} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Active LLM Provider</label>
                  <select 
                    className="form-select"
                    value={settingsForm.activeLlmProvider}
                    onChange={(e) => {
                      const prov = e.target.value;
                      let defModel = "gemini-2.5-flash";
                      if (prov === "openai") defModel = "gpt-4o";
                      else if (prov === "claude") defModel = "claude-3-5-sonnet-latest";
                      setSettingsForm({ ...settingsForm, activeLlmProvider: prov, activeLlmModel: defModel });
                    }}
                  >
                    <option value="gemini">Google Gemini</option>
                    <option value="openai">OpenAI ChatGPT</option>
                    <option value="claude">Anthropic Claude</option>
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label">Active LLM Model</label>
                  {settingsForm.activeLlmProvider === "gemini" ? (
                    <select 
                      className="form-select"
                      value={settingsForm.activeLlmModel}
                      onChange={(e) => setSettingsForm({ ...settingsForm, activeLlmModel: e.target.value })}
                    >
                      <option value="gemini-2.5-flash">gemini-2.5-flash (Default)</option>
                      <option value="gemini-2.5-pro">gemini-2.5-pro</option>
                      <option value="gemini-1.5-flash">gemini-1.5-flash</option>
                    </select>
                  ) : settingsForm.activeLlmProvider === "openai" ? (
                    <select 
                      className="form-select"
                      value={settingsForm.activeLlmModel}
                      onChange={(e) => setSettingsForm({ ...settingsForm, activeLlmModel: e.target.value })}
                    >
                      <option value="gpt-4o">gpt-4o (Default)</option>
                      <option value="gpt-4o-mini">gpt-4o-mini</option>
                      <option value="o1-mini">o1-mini</option>
                    </select>
                  ) : (
                    <select 
                      className="form-select"
                      value={settingsForm.activeLlmModel}
                      onChange={(e) => setSettingsForm({ ...settingsForm, activeLlmModel: e.target.value })}
                    >
                      <option value="claude-3-5-sonnet-latest">claude-3-5-sonnet-latest (Default)</option>
                      <option value="claude-3-5-haiku-latest">claude-3-5-haiku-latest</option>
                    </select>
                  )}
                </div>
              </div>

              <div className="form-group" style={{ background: 'rgba(255,255,255,0.01)', padding: '16px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <h4 style={{ fontSize: '0.8rem', fontWeight: 'bold', color: 'var(--color-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>LLM Developer API Keys</h4>
                
                <div className="form-group">
                  <label className="form-label" style={{ fontSize: '0.75rem' }}>Gemini Developer API Key</label>
                  <input 
                    type="password" 
                    placeholder={status?.settings?.geminiApiKey ? '••••••••' : 'Enter API Key...'} 
                    className="form-input"
                    value={settingsForm.geminiApiKey}
                    onChange={(e) => setSettingsForm({ ...settingsForm, geminiApiKey: e.target.value })}
                    style={{ padding: '8px 12px', fontSize: '0.8rem' }}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label" style={{ fontSize: '0.75rem' }}>OpenAI API Key</label>
                  <input 
                    type="password" 
                    placeholder={status?.settings?.openaiApiKey ? '••••••••' : 'Enter API Key...'} 
                    className="form-input"
                    value={settingsForm.openaiApiKey}
                    onChange={(e) => setSettingsForm({ ...settingsForm, openaiApiKey: e.target.value })}
                    style={{ padding: '8px 12px', fontSize: '0.8rem' }}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label" style={{ fontSize: '0.75rem' }}>Claude API Key</label>
                  <input 
                    type="password" 
                    placeholder={status?.settings?.claudeApiKey ? '••••••••' : 'Enter API Key...'} 
                    className="form-input"
                    value={settingsForm.claudeApiKey}
                    onChange={(e) => setSettingsForm({ ...settingsForm, claudeApiKey: e.target.value })}
                    style={{ padding: '8px 12px', fontSize: '0.8rem' }}
                  />
                </div>
                <span className="text-muted" style={{ fontSize: '0.7rem', display: 'block', marginTop: '4px' }}>Keys are stored locally on your machine and never shared.</span>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Trading Asset</label>
                  <select 
                    className="form-select"
                    value={settingsForm.selectedAsset}
                    onChange={(e) => setSettingsForm({ ...settingsForm, selectedAsset: e.target.value })}
                  >
                    <option value="BTC/USD">BTC/USD</option>
                    <option value="BTC/USDC">BTC/USDC</option>
                    <option value="ETH/USD">ETH/USD</option>
                    <option value="ETH/USDC">ETH/USDC</option>
                    <option value="SOL/USD">SOL/USD</option>
                    <option value="ADA/USD">ADA/USD</option>
                    <option value="XRP/USD">XRP/USD</option>
                    <option value="XRP/USDC">XRP/USDC</option>
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label">
                    {settingsForm.multiTimeframeEnabled ? "Micro Timeframe" : "Loop Interval Timeframe"}
                  </label>
                  <select 
                    className="form-select"
                    value={settingsForm.selectedTimeframe}
                    onChange={(e) => setSettingsForm({ ...settingsForm, selectedTimeframe: e.target.value })}
                  >
                    <option value="1m">1m (Test Mode)</option>
                    <option value="5m">5m</option>
                    <option value="15m">15m</option>
                    <option value="30m">30m</option>
                    <option value="1h">1h</option>
                    <option value="2h">2h</option>
                    <option value="4h">4h</option>
                    <option value="6h">6h</option>
                    <option value="1d">1d</option>
                  </select>
                </div>
              </div>

              {/* Multi-Timeframe Controls */}
              <div className="form-group" style={{ background: 'rgba(255, 255, 255, 0.02)', padding: '12px', borderRadius: '8px', border: '1px solid rgba(255, 255, 255, 0.05)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <input 
                    type="checkbox" 
                    id="multiTimeframeEnabled"
                    checked={settingsForm.multiTimeframeEnabled}
                    onChange={(e) => setSettingsForm({ ...settingsForm, multiTimeframeEnabled: e.target.checked })}
                    style={{ accentColor: 'var(--color-secondary)', cursor: 'pointer', width: '16px', height: '16px' }}
                  />
                  <label htmlFor="multiTimeframeEnabled" style={{ fontWeight: '600', fontSize: '0.85rem', color: '#fff', cursor: 'pointer' }}>
                    Enable Multi-Timeframe Analysis (MTF)
                  </label>
                </div>
                <span className="text-muted" style={{ display: 'block', fontSize: '0.7rem', marginTop: '4px', marginLeft: '24px' }}>
                  Analyze daily macro wave structures alongside hourly execution triggers.
                </span>

                {settingsForm.multiTimeframeEnabled && (
                  <div className="form-group" style={{ marginTop: '12px', paddingLeft: '24px', paddingRight: '24px', width: 'auto' }}>
                    <label className="form-label">Macro Trend Timeframe</label>
                    <select 
                      className="form-select"
                      value={settingsForm.macroTimeframe}
                      onChange={(e) => setSettingsForm({ ...settingsForm, macroTimeframe: e.target.value })}
                    >
                      <option value="1h">1h</option>
                      <option value="2h">2h</option>
                      <option value="4h">4h</option>
                      <option value="6h">6h</option>
                      <option value="1d">1d (Daily Chart)</option>
                    </select>
                    <span className="text-muted">Determines the long-term trend bias for wave analysis.</span>
                  </div>
                )}
              </div>

              {/* Sentiment News Analysis */}
              <div className="form-group" style={{ background: 'rgba(255, 255, 255, 0.02)', padding: '12px', borderRadius: '8px', border: '1px solid rgba(255, 255, 255, 0.05)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <input 
                    type="checkbox" 
                    id="newsSentimentEnabled"
                    checked={settingsForm.newsSentimentEnabled}
                    onChange={(e) => setSettingsForm({ ...settingsForm, newsSentimentEnabled: e.target.checked })}
                    style={{ accentColor: 'var(--color-secondary)', cursor: 'pointer', width: '16px', height: '16px' }}
                  />
                  <label htmlFor="newsSentimentEnabled" style={{ fontWeight: '600', fontSize: '0.85rem', color: '#fff', cursor: 'pointer' }}>
                    Enable News Sentiment Analysis
                  </label>
                </div>
                <span className="text-muted" style={{ display: 'block', fontSize: '0.7rem', marginTop: '4px', marginLeft: '24px' }}>
                  Fetch real-time crypto headlines and inject them into Gemini for news-aware decisions.
                </span>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Execution Check Frequency</label>
                  <select 
                    className="form-select"
                    value={settingsForm.botIntervalMin}
                    onChange={(e) => setSettingsForm({ ...settingsForm, botIntervalMin: Number(e.target.value) })}
                  >
                    <option value={1}>Every 1 Minute</option>
                    <option value={5}>Every 5 Minutes</option>
                    <option value={15}>Every 15 Minutes</option>
                    <option value={30}>Every 30 Minutes</option>
                    <option value={60}>Every 1 Hour</option>
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label">Portfolio Sandbox Risk Mode</label>
                  <select 
                    className="form-select"
                    value={settingsForm.tradingMode}
                    onChange={(e) => setSettingsForm({ ...settingsForm, tradingMode: e.target.value })}
                  >
                    <option value="paper">Simulated Paper Trading (Default)</option>
                    <option value="live">Live Exchange Execution (Coinbase Advanced)</option>
                  </select>
                </div>
              </div>

              {settingsForm.tradingMode === 'live' && (
                <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '16px', marginTop: '8px' }}>
                  <h3 style={{ fontSize: '0.85rem', fontWeight: 'bold', color: 'var(--color-warning)', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Exchange API Credentials (Coinbase)</h3>
                  
                  <div className="alert-banner" style={{ background: 'rgba(245, 158, 11, 0.05)', border: '1px solid rgba(245, 158, 11, 0.2)', color: '#fcd34d', marginBottom: '12px' }}>
                    <AlertTriangle size={18} style={{ flexShrink: 0 }} />
                    <span><strong>CRITICAL SECURITY REMINDER:</strong> Ensure your Coinbase Advanced API key has <strong>Withdrawal permissions DISABLED</strong>. Do not expose these keys publicly.</span>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    <div className="form-group">
                      <label className="form-label">Exchange API Key Name</label>
                      <input 
                        type="text" 
                        placeholder={status.settings.exchangeApiKey ? '••••••••' : 'organizations/org-uuid/apiKeys/key-uuid'} 
                        className="form-input"
                        value={settingsForm.exchangeApiKey}
                        onChange={(e) => setSettingsForm({ ...settingsForm, exchangeApiKey: e.target.value })}
                      />
                      <span className="text-muted">CDP API Key Name (format: organizations/.../apiKeys/...)</span>
                    </div>

                    <div className="form-group">
                      <label className="form-label">Exchange API Private Key (Secret)</label>
                      <textarea 
                        placeholder={status.settings.exchangeApiSecret ? '••••••••' : 'Paste private key beginning with -----BEGIN EC PRIVATE KEY-----'} 
                        className="form-textarea"
                        style={{ minHeight: '100px', fontFamily: 'var(--font-mono)', fontSize: '0.75rem' }}
                        value={settingsForm.exchangeApiSecret}
                        onChange={(e) => setSettingsForm({ ...settingsForm, exchangeApiSecret: e.target.value })}
                      />
                      <span className="text-muted">Coinbase CDP Private Key PEM string (include BEGIN and END lines).</span>
                    </div>
                  </div>
                </div>
              )}

              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Max Trade Allocation ({settingsForm.maxTradeSizePct}%)</label>
                  <input 
                    type="number" 
                    min="1" 
                    max="100" 
                    className="form-input"
                    value={settingsForm.maxTradeSizePct}
                    onChange={(e) => setSettingsForm({ ...settingsForm, maxTradeSizePct: Number(e.target.value) })}
                  />
                  <span className="text-muted">Max percentage of portfolio value allowed in a single order.</span>
                </div>

                <div className="form-group">
                  <label className="form-label">Hard Stop-Loss ({settingsForm.stopLossPct}%)</label>
                  <input 
                    type="number" 
                    min="0.5" 
                    max="50" 
                    step="0.5" 
                    className="form-input"
                    value={settingsForm.stopLossPct}
                    onChange={(e) => setSettingsForm({ ...settingsForm, stopLossPct: Number(e.target.value) })}
                  />
                  <span className="text-muted">Auto-liquidation limit triggered locally. Overrides LLM decision.</span>
                </div>
              </div>

              <div className="form-row" style={{ marginTop: '12px' }}>
                <div className="form-group">
                  <label className="form-label">Max Position Allocation Cap ({settingsForm.maxPositionAllocationPct || 75}%)</label>
                  <input 
                    type="number" 
                    min="1" 
                    max="100" 
                    className="form-input"
                    value={settingsForm.maxPositionAllocationPct || 75}
                    onChange={(e) => setSettingsForm({ ...settingsForm, maxPositionAllocationPct: Number(e.target.value) })}
                  />
                  <span className="text-muted">Max percentage of total portfolio value allowed to be held in this asset.</span>
                </div>
                <div className="form-group">
                  {/* Empty to balance layout columns */}
                </div>
              </div>

              {/* Advanced Risk Management Panel */}
              <div className="form-group" style={{ background: 'rgba(255, 255, 255, 0.02)', padding: '16px', borderRadius: '12px', border: '1px solid rgba(255, 255, 255, 0.05)', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <h3 style={{ fontSize: '0.85rem', fontWeight: 'bold', color: 'var(--color-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  🛡️ Advanced Volatility & Trailing Stops
                </h3>
                
                {/* ATR Volatility Stop */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <input 
                      type="checkbox" 
                      id="atrStopEnabled"
                      checked={settingsForm.atrStopEnabled}
                      onChange={(e) => setSettingsForm({ ...settingsForm, atrStopEnabled: e.target.checked })}
                      style={{ accentColor: 'var(--color-secondary)', cursor: 'pointer', width: '16px', height: '16px' }}
                    />
                    <label htmlFor="atrStopEnabled" style={{ fontWeight: '600', fontSize: '0.8rem', color: '#fff', cursor: 'pointer' }}>
                      Enable ATR Volatility Stop
                    </label>
                  </div>
                  {settingsForm.atrStopEnabled && (
                    <div style={{ paddingLeft: '24px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <label className="form-label" style={{ fontSize: '0.7rem' }}>ATR Multiplier</label>
                      <input 
                        type="number" 
                        min="0.5" 
                        max="10" 
                        step="0.1" 
                        className="form-input"
                        value={settingsForm.atrStopMultiplier}
                        onChange={(e) => setSettingsForm({ ...settingsForm, atrStopMultiplier: Number(e.target.value) })}
                        style={{ padding: '6px 10px', fontSize: '0.8rem' }}
                      />
                      <span className="text-muted" style={{ fontSize: '0.65rem' }}>Liquidates if price drops below Entry - (Multiplier * ATR)</span>
                    </div>
                  )}
                </div>

                {/* Trailing Stop-Loss */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', borderTop: '1px solid rgba(255,255,255,0.03)', paddingTop: '10px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <input 
                      type="checkbox" 
                      id="trailingStopEnabled"
                      checked={settingsForm.trailingStopEnabled}
                      onChange={(e) => setSettingsForm({ ...settingsForm, trailingStopEnabled: e.target.checked })}
                      style={{ accentColor: 'var(--color-secondary)', cursor: 'pointer', width: '16px', height: '16px' }}
                    />
                    <label htmlFor="trailingStopEnabled" style={{ fontWeight: '600', fontSize: '0.8rem', color: '#fff', cursor: 'pointer' }}>
                      Enable Trailing Stop-Loss
                    </label>
                  </div>
                  {settingsForm.trailingStopEnabled && (
                    <div style={{ paddingLeft: '24px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <label className="form-label" style={{ fontSize: '0.7rem' }}>Trailing Percentage (%)</label>
                      <input 
                        type="number" 
                        min="0.1" 
                        max="20" 
                        step="0.1" 
                        className="form-input"
                        value={settingsForm.trailingStopPct}
                        onChange={(e) => setSettingsForm({ ...settingsForm, trailingStopPct: Number(e.target.value) })}
                        style={{ padding: '6px 10px', fontSize: '0.8rem' }}
                      />
                      <span className="text-muted" style={{ fontSize: '0.65rem' }}>Trailing floor follows price peaks, liquidating on drop from high water mark.</span>
                    </div>
                  )}
                </div>

                {/* Take Profit */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', borderTop: '1px solid rgba(255,255,255,0.03)', paddingTop: '10px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <input 
                      type="checkbox" 
                      id="takeProfitEnabled"
                      checked={settingsForm.takeProfitEnabled}
                      onChange={(e) => setSettingsForm({ ...settingsForm, takeProfitEnabled: e.target.checked })}
                      style={{ accentColor: 'var(--color-secondary)', cursor: 'pointer', width: '16px', height: '16px' }}
                    />
                    <label htmlFor="takeProfitEnabled" style={{ fontWeight: '600', fontSize: '0.8rem', color: '#fff', cursor: 'pointer' }}>
                      Enable Take-Profit Target
                    </label>
                  </div>
                  {settingsForm.takeProfitEnabled && (
                    <div style={{ paddingLeft: '24px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <label className="form-label" style={{ fontSize: '0.7rem' }}>Target Profit (%)</label>
                      <input 
                        type="number" 
                        min="0.5" 
                        max="100" 
                        step="0.5" 
                        className="form-input"
                        value={settingsForm.takeProfitPct}
                        onChange={(e) => setSettingsForm({ ...settingsForm, takeProfitPct: Number(e.target.value) })}
                        style={{ padding: '6px 10px', fontSize: '0.8rem' }}
                      />
                      <span className="text-muted" style={{ fontSize: '0.65rem' }}>Auto-locks profits if price increases by this percentage above entry.</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Signal Alerts Dispatcher Configurations */}
              <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '16px', marginTop: '8px' }}>
                <h3 style={{ fontSize: '0.85rem', fontWeight: 'bold', color: 'var(--color-secondary)', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Signal Alerts Dispatcher</h3>
                
                <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '16px' }}>
                  <div className="form-group">
                    <label className="form-label">Notification Type</label>
                    <select 
                      className="form-select"
                      value={settingsForm.notificationType}
                      onChange={(e) => setSettingsForm({ ...settingsForm, notificationType: e.target.value })}
                    >
                      <option value="none">Disabled (No alerts)</option>
                      <option value="sms">SMS Text Alert (Carrier Email Gateway)</option>
                      <option value="telegram">Telegram Bot Push Alert</option>
                    </select>
                  </div>
                </div>

                {settingsForm.notificationType === 'telegram' && (
                  <div className="form-row" style={{ marginTop: '12px' }}>
                    <div className="form-group">
                      <label className="form-label">Telegram Bot Token</label>
                      <input 
                        type="password"
                        placeholder={status.settings.telegramBotToken ? '••••••••' : 'Enter Bot Token...'}
                        className="form-input"
                        value={settingsForm.telegramBotToken}
                        onChange={(e) => setSettingsForm({ ...settingsForm, telegramBotToken: e.target.value })}
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Telegram Chat ID</label>
                      <input 
                        type="text"
                        placeholder="Enter Chat ID..."
                        className="form-input"
                        value={settingsForm.telegramChatId}
                        onChange={(e) => setSettingsForm({ ...settingsForm, telegramChatId: e.target.value })}
                      />
                    </div>
                  </div>
                )}

                {settingsForm.notificationType === 'sms' && (
                  <div style={{ marginTop: '12px' }}>
                    <div className="form-row">
                      <div className="form-group">
                        <label className="form-label">10-Digit Mobile Number</label>
                        <input 
                          type="text"
                          placeholder="e.g. 5551234567"
                          className="form-input"
                          value={settingsForm.phoneNumber}
                          onChange={(e) => setSettingsForm({ ...settingsForm, phoneNumber: e.target.value })}
                        />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Carrier</label>
                        <select 
                          className="form-select"
                          value={settingsForm.phoneCarrier}
                          onChange={(e) => setSettingsForm({ ...settingsForm, phoneCarrier: e.target.value })}
                        >
                          <option value="att">AT&T</option>
                          <option value="tmobile">T-Mobile</option>
                          <option value="verizon">Verizon</option>
                          <option value="sprint">Sprint</option>
                        </select>
                      </div>
                    </div>

                    <div className="form-row-four" style={{ marginTop: '12px' }}>
                      <div className="form-group" style={{ gridColumn: 'span 2' }}>
                        <label className="form-label">SMTP Sender Host</label>
                        <input 
                          type="text"
                          placeholder="e.g. smtp.gmail.com"
                          className="form-input"
                          value={settingsForm.smtpHost}
                          onChange={(e) => setSettingsForm({ ...settingsForm, smtpHost: e.target.value })}
                        />
                      </div>
                      <div className="form-group" style={{ gridColumn: 'span 1' }}>
                        <label className="form-label">Port</label>
                        <input 
                          type="text"
                          placeholder="465"
                          className="form-input"
                          value={settingsForm.smtpPort}
                          onChange={(e) => setSettingsForm({ ...settingsForm, smtpPort: e.target.value })}
                        />
                      </div>
                      <div className="form-group" style={{ gridColumn: 'span 1' }}>
                        <label className="form-label">SMTP Auth User</label>
                        <input 
                          type="text"
                          placeholder="e.g. sender@gmail.com"
                          className="form-input"
                          value={settingsForm.smtpUser}
                          onChange={(e) => setSettingsForm({ ...settingsForm, smtpUser: e.target.value })}
                        />
                      </div>
                      <div className="form-group" style={{ gridColumn: 'span 2' }}>
                        <label className="form-label">SMTP Auth Password</label>
                        <input 
                          type="password"
                          placeholder={status.settings.smtpPass ? '••••••••' : 'Enter Password...'}
                          className="form-input"
                          value={settingsForm.smtpPass}
                          onChange={(e) => setSettingsForm({ ...settingsForm, smtpPass: e.target.value })}
                        />
                      </div>
                    </div>
                  </div>
                )}

                {/* Discord Webhook (independent of notification type) */}
                <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                  <div className="form-group">
                    <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" style={{ color: '#5865F2' }}>
                        <path d="M13.55 3.15A13.27 13.27 0 0010.24 2a9.14 9.14 0 00-.42.85 12.33 12.33 0 00-3.64 0A9.3 9.3 0 005.76 2a13.36 13.36 0 00-3.31 1.15A14.1 14.1 0 00.08 12.76a13.4 13.4 0 004.08 2.06 10.1 10.1 0 00.87-1.41 8.66 8.66 0 01-1.37-.66c.11-.08.23-.17.34-.26a9.55 9.55 0 008.16 0c.11.09.22.18.34.26a8.7 8.7 0 01-1.37.66c.25.5.54.97.87 1.41a13.36 13.36 0 004.08-2.06A14.07 14.07 0 0013.55 3.15zM5.35 10.84c-.85 0-1.55-.78-1.55-1.74s.68-1.74 1.55-1.74c.86 0 1.56.78 1.55 1.74 0 .96-.69 1.74-1.55 1.74zm5.3 0c-.85 0-1.55-.78-1.55-1.74s.68-1.74 1.55-1.74c.86 0 1.56.78 1.55 1.74 0 .96-.69 1.74-1.55 1.74z"/>
                      </svg>
                      Discord Webhook URL <span style={{ fontSize: '0.7rem', opacity: 0.5 }}>(Optional — fires alongside Telegram/SMS)</span>
                    </label>
                    <input 
                      type="password"
                      placeholder={status.settings.discordWebhookUrl ? '••••••••' : 'https://discord.com/api/webhooks/...'}
                      className="form-input"
                      value={settingsForm.discordWebhookUrl}
                      onChange={(e) => setSettingsForm({ ...settingsForm, discordWebhookUrl: e.target.value })}
                    />
                  </div>
                </div>
                
                {(settingsForm.notificationType !== 'none' || settingsForm.discordWebhookUrl) && (
                  <button 
                    type="button" 
                    className="btn btn-secondary" 
                    onClick={handleTestAlert}
                    style={{ marginTop: '12px', width: '100%' }}
                  >
                    Test Connection (Send Test Notification)
                  </button>
                )}
              </div>

              <button className="btn btn-primary" type="submit" style={{ marginTop: '8px' }}>
                Save Configurations
              </button>
            </form>
          </main>

          {/* Right column: Strategy prompt customizer */}
          <aside className="glass-panel scrollable" style={{ gridColumn: 'span 1' }}>
            <div className="panel-header">
              <span className="panel-title"><Cpu size={16} /> Brain Prompt Engineering</span>
            </div>

            <div className="alert-banner info">
              <HelpCircle size={18} style={{ flexShrink: 0 }} />
              <span>Modify the prompt injected into the LLM runtime context. Define risk conditions, trend indicators, or specific trading logic rules.</span>
            </div>

            <div className="form-group" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
              <label className="form-label">System Decision Instructions</label>
              <textarea 
                className="form-textarea" 
                style={{ flex: 1, minHeight: '300px' }}
                value={settingsForm.customPrompt}
                onChange={(e) => setSettingsForm({ ...settingsForm, customPrompt: e.target.value })}
              />
            </div>
            
            <button className="btn btn-secondary" onClick={handleSaveSettings} style={{ width: '100%' }}>
              Save Custom Strategy Prompt
            </button>
          </aside>

          {/* Plugins, Tools & Strategies Card Manager */}
          <div className="glass-panel" style={{ gridColumn: '1 / -1', display: 'flex', flexDirection: 'column', gap: '16px', marginTop: '16px' }}>
            <div className="panel-header" style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.05)', paddingBottom: '10px' }}>
              <span className="panel-title" style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--color-secondary)' }}>
                <Layers size={18} /> Plugins, Custom Tools & Strategy Manager
              </span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '20px' }}>
              {/* Custom Action Tools (.js) Card */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', background: 'rgba(255,255,255,0.01)', padding: '16px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '8px' }}>
                  <h4 style={{ fontSize: '0.85rem', fontWeight: 'bold', color: '#fff', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Cpu size={14} style={{ color: 'var(--color-primary)' }} /> Custom Action Tools (.js)
                  </h4>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'rgba(16, 185, 129, 0.15)', color: '#10b981', border: '1px solid rgba(16, 185, 129, 0.25)', padding: '4px 10px', borderRadius: '6px', cursor: 'pointer', fontSize: '0.75rem', fontWeight: '600' }}>
                    <UploadCloud size={14} /> Upload JS Tool
                    <input type="file" accept=".js" onChange={handleUploadTool} style={{ display: 'none' }} />
                  </label>
                </div>
                <p className="text-muted" style={{ fontSize: '0.7rem' }}>
                  User-defined functions executed in a safe backend Node VM sandbox. Tools can invoke web calls, fetch prices, or trigger alerts.
                </p>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '300px', overflowY: 'auto', marginTop: '4px' }}>
                  {customTools.length > 0 ? (
                    customTools.map((tool) => (
                      <div key={tool.filename} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(0,0,0,0.2)', padding: '10px 12px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.03)' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', flex: 1, minWidth: 0, marginRight: '12px' }}>
                          <span style={{ fontSize: '0.8rem', fontWeight: 'bold', color: tool.error ? 'var(--color-danger)' : '#fff', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                            {tool.name}
                          </span>
                          <span className="text-muted" style={{ fontSize: '0.68rem', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                            {tool.description}
                          </span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <label className="switch" style={{ position: 'relative', display: 'inline-block', width: '34px', height: '20px' }}>
                            <input 
                              type="checkbox" 
                              checked={tool.enabled} 
                              disabled={!!tool.error}
                              onChange={() => handleToggleTool(tool.filename)} 
                              style={{ opacity: 0, width: 0, height: 0 }}
                            />
                            <span className="slider" style={{
                              position: 'absolute', cursor: 'pointer', top: 0, left: 0, right: 0, bottom: 0,
                              backgroundColor: tool.enabled ? 'var(--color-primary)' : 'rgba(255,255,255,0.1)',
                              transition: '.2s', borderRadius: '20px'
                            }}>
                              <span style={{
                                position: 'absolute', content: '""', height: '14px', width: '14px', left: tool.enabled ? '17px' : '3px', bottom: '3px',
                                backgroundColor: '#fff', transition: '.2s', borderRadius: '50%'
                              }} />
                            </span>
                          </label>
                          <button 
                            className="btn btn-secondary" 
                            onClick={() => handleDeleteTool(tool.filename)}
                            style={{ padding: '4px', height: 'auto', background: 'rgba(239, 68, 68, 0.1)', color: 'var(--color-danger)', border: '1px solid rgba(239, 68, 68, 0.15)' }}
                            title="Delete tool"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div style={{ textAlign: 'center', padding: '20px', color: 'var(--color-text-dark)', fontSize: '0.75rem', border: '1px dashed rgba(255,255,255,0.05)', borderRadius: '8px' }}>
                      No custom tools uploaded yet.
                    </div>
                  )}
                </div>
              </div>

              {/* Strategy Guidelines (.md) Card */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', background: 'rgba(255,255,255,0.01)', padding: '16px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '8px' }}>
                  <h4 style={{ fontSize: '0.85rem', fontWeight: 'bold', color: '#fff', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Sliders size={14} style={{ color: 'var(--color-secondary)' }} /> Strategy Guidelines (.md)
                  </h4>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'rgba(16, 185, 129, 0.15)', color: '#10b981', border: '1px solid rgba(16, 185, 129, 0.25)', padding: '4px 10px', borderRadius: '6px', cursor: 'pointer', fontSize: '0.75rem', fontWeight: '600' }}>
                    <UploadCloud size={14} /> Upload Markdown
                    <input type="file" accept=".md" onChange={handleUploadStrategy} style={{ display: 'none' }} />
                  </label>
                </div>
                <p className="text-muted" style={{ fontSize: '0.7rem' }}>
                  Modular rules (e.g. risk management, choppy regime filters) appended directly to the LLM system prompt context on execution. Limit: &lt; 10KB.
                </p>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '300px', overflowY: 'auto', marginTop: '4px' }}>
                  {strategies.length > 0 ? (
                    strategies.map((strat) => (
                      <div key={strat.filename} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(0,0,0,0.2)', padding: '10px 12px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.03)' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', flex: 1, minWidth: 0, marginRight: '12px' }}>
                          <span style={{ fontSize: '0.8rem', fontWeight: 'bold', color: '#fff', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                            {strat.title}
                          </span>
                          <span className="text-muted" style={{ fontSize: '0.68rem', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                            {strat.description}
                          </span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <label className="switch" style={{ position: 'relative', display: 'inline-block', width: '34px', height: '20px' }}>
                            <input 
                              type="checkbox" 
                              checked={strat.enabled} 
                              onChange={() => handleToggleStrategy(strat.filename)} 
                              style={{ opacity: 0, width: 0, height: 0 }}
                            />
                            <span className="slider" style={{
                              position: 'absolute', cursor: 'pointer', top: 0, left: 0, right: 0, bottom: 0,
                              backgroundColor: strat.enabled ? 'var(--color-secondary)' : 'rgba(255,255,255,0.1)',
                              transition: '.2s', borderRadius: '20px'
                            }}>
                              <span style={{
                                position: 'absolute', content: '""', height: '14px', width: '14px', left: strat.enabled ? '17px' : '3px', bottom: '3px',
                                backgroundColor: '#fff', transition: '.2s', borderRadius: '50%'
                              }} />
                            </span>
                          </label>
                          <button 
                            className="btn btn-secondary" 
                            onClick={() => handleDeleteStrategy(strat.filename)}
                            style={{ padding: '4px', height: 'auto', background: 'rgba(239, 68, 68, 0.1)', color: 'var(--color-danger)', border: '1px solid rgba(239, 68, 68, 0.15)' }}
                            title="Delete strategy"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div style={{ textAlign: 'center', padding: '20px', color: 'var(--color-text-dark)', fontSize: '0.75rem', border: '1px dashed rgba(255,255,255,0.05)', borderRadius: '8px' }}>
                      No strategy guidelines uploaded yet.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}



      {/* SYSTEM OPERATIONS MANUAL TAB */}
      {activeTab === 'manual' && (
        <div className="glass-panel fade-in scrollable" style={{ flex: 1, minHeight: 0, padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px', background: 'rgba(17, 24, 39, 0.45)', border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: '16px' }}>
          <div className="panel-header" style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.08)', paddingBottom: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="panel-title" style={{ fontSize: '1.1rem', fontWeight: 'bold', color: 'var(--color-secondary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <HelpCircle size={20} /> Aether System Operations Manual
            </span>
            <button 
              className="btn btn-secondary" 
              onClick={fetchManual} 
              disabled={manualLoading}
              style={{ padding: '6px 12px', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '6px' }}
            >
              <RefreshCw size={12} className={manualLoading ? 'spin-anim' : ''} /> {manualLoading ? 'Syncing...' : 'Sync Now'}
            </button>
          </div>
          
          <div className="manual-content-body" style={{ flex: 1, minHeight: 0, paddingRight: '8px', overflowY: 'auto' }}>
            {manualLoading && !manualMarkdown ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '200px', gap: '12px' }}>
                <RefreshCw className="spin-anim" style={{ color: 'var(--color-primary)' }} size={24} />
                <p style={{ color: 'var(--color-text-dark)', fontSize: '0.8rem' }}>Loading manual from server...</p>
              </div>
            ) : (
              <div style={{ maxWidth: '800px', margin: '0 auto' }}>
                <MarkdownRenderer content={manualMarkdown} />
              </div>
            )}
          </div>
          <style>{`
            .spin-anim { animation: spin 1.5s linear infinite; }
            @keyframes spin { 100% { transform: rotate(360deg); } }
          `}</style>
        </div>
      )}

      </div>
    </div>
  );
}
