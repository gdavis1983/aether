import React, { useState, useEffect, useRef } from 'react';
import { 
  TrendingUp, 
  Cpu, 
  Activity, 
  Terminal as TermIcon, 
  Settings as SettingsIcon, 
  RefreshCw, 
  Play, 
  Square, 
  AlertTriangle, 
  DollarSign, 
  ArrowUpRight, 
  ArrowDownRight, 
  Sliders, 
  History,
  Layers,
  HelpCircle,
  Database
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

export default function App() {
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
  
  // Settings Form State
  const [settingsForm, setSettingsForm] = useState({
    geminiApiKey: '',
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
    multiTimeframeEnabled: false,
    macroTimeframe: '1d',
    trailingStopEnabled: false,
    trailingStopPct: 2.5,
    takeProfitEnabled: false,
    takeProfitPct: 10.0,
    atrStopEnabled: false,
    atrStopMultiplier: 2.0,
    newsSentimentEnabled: false
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

  // UI Refs
  const chartContainerRef = useRef(null);
  const btChartContainerRef = useRef(null);

  // Fetch bot status, logs, and trades
  const fetchData = async () => {
    try {
      const [statusRes, logsRes, tradesRes] = await Promise.all([
        fetch(`${BACKEND_URL}/api/status`),
        fetch(`${BACKEND_URL}/api/logs`),
        fetch(`${BACKEND_URL}/api/trades`)
      ]);

      const statusData = await statusRes.json();
      const logsData = await logsRes.json();
      const tradesData = await tradesRes.json();

      setStatus(statusData);
      setLogs(logsData);
      setTrades(tradesData);
      
      // Sync settings form once on initial load
      if (loading) {
        setSettingsForm(statusData.settings);
        setManualTrade(prev => ({ ...prev, symbol: statusData.settings.selectedAsset }));
        setBacktestConfig(prev => ({ ...prev, symbol: statusData.settings.selectedAsset, timeframe: statusData.settings.selectedTimeframe }));
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

  // Scroll to bottom of logs internally when logs update or tab changes
  useEffect(() => {
    const terminals = document.querySelectorAll('.log-terminal');
    terminals.forEach(term => {
      term.scrollTop = term.scrollHeight;
    });
  }, [logs, activeTab, dashboardSubTab]);

  // Fetch latest price data for manual trade calculations
  useEffect(() => {
    if (!status) return;

    let isMounted = true;
    const loadPriceData = async () => {
      setChartLoading(true);
      try {
        const res = await fetch(`${BACKEND_URL}/api/market/candles?symbol=${status.settings.selectedAsset}&timeframe=${status.settings.selectedTimeframe}&limit=120`);
        const data = await res.json();
        
        if (!isMounted) return;
        
        if (res.ok && Array.isArray(data)) {
          setCandleData(data);
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

    return () => {
      window.removeEventListener('resize', handleResize);
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
    <div className="app-container">
      
      {/* HEADER SECTION */}
      <header className="app-header">
        <div className="brand-section">
          <div className="brand-icon">
            <Cpu size={28} />
          </div>
          <div>
            <h1 className="brand-title">AETHER AI</h1>
            <p style={{ fontSize: '0.65rem', color: 'var(--color-text-muted)', letterSpacing: '0.5px' }}>CRYPTOCURRENCY ALGORITHMIC BOT</p>
          </div>
        </div>

        {/* Navigation */}
        <nav className="nav-tabs">
          <button className={`tab-btn ${activeTab === 'dashboard' ? 'active' : ''}`} onClick={() => setActiveTab('dashboard')}>
            <TrendingUp size={16} /> Dashboard
          </button>
          <button className={`tab-btn ${activeTab === 'terminal' ? 'active' : ''}`} onClick={() => setActiveTab('terminal')}>
            <Activity size={16} /> Live Terminal
          </button>
          <button className={`tab-btn ${activeTab === 'backtest' ? 'active' : ''}`} onClick={() => setActiveTab('backtest')}>
            <History size={16} /> Backtester
          </button>
          <button className={`tab-btn ${activeTab === 'logs' ? 'active' : ''}`} onClick={() => setActiveTab('logs')}>
            <TermIcon size={16} /> Brain Logs
          </button>
          <button className={`tab-btn ${activeTab === 'settings' ? 'active' : ''}`} onClick={() => setActiveTab('settings')}>
            <SettingsIcon size={16} /> Settings
          </button>
          <button className={`tab-btn ${activeTab === 'manual' ? 'active' : ''}`} onClick={() => setActiveTab('manual')}>
            <HelpCircle size={16} /> System Manual
          </button>
        </nav>

        {/* Status indicator */}
        <div className="bot-status-badge">
          <span className={`status-dot ${status?.isBotRunning ? 'active' : ''}`}></span>
          <span>BOT: {status?.isBotRunning ? 'RUNNING' : 'IDLE'}</span>
        </div>
      </header>

      {/* DASHBOARD TAB */}
      {activeTab === 'dashboard' && (
        <div className={`dashboard-grid fade-in show-subtab-${dashboardSubTab}`}>
          {/* Mobile-only Sub-navigation Bar */}
          <div className="mobile-subtabs-bar">
            <button 
              className={`mobile-subtab-btn ${dashboardSubTab === 'portfolio' ? 'active' : ''}`}
              onClick={() => setDashboardSubTab('portfolio')}
            >
              Portfolio & Positions
            </button>
            <button 
              className={`mobile-subtab-btn ${dashboardSubTab === 'logs' ? 'active' : ''}`}
              onClick={() => setDashboardSubTab('logs')}
            >
              Operations & Fills
            </button>
          </div>

          {/* Left Column: Account info & controls */}
          <aside className="dashboard-sidebar">
            <div className="glass-panel">
              <div className="panel-header">
                <span className="panel-title"><Layers size={16} /> Valuation</span>
                {status?.settings?.tradingMode === 'live' ? (
                  <span style={{ fontSize: '0.65rem', background: 'rgba(239, 68, 68, 0.15)', color: 'var(--color-danger)', padding: '2px 8px', borderRadius: '4px', fontWeight: 'bold', border: '1px solid rgba(239, 68, 68, 0.25)' }}>LIVE</span>
                ) : (
                  <span style={{ fontSize: '0.65rem', background: 'rgba(59, 130, 246, 0.1)', color: 'var(--color-secondary)', padding: '2px 8px', borderRadius: '4px', fontWeight: 'bold' }}>PAPER</span>
                )}
              </div>
              
              <div className="balance-section">
                <p className="balance-label">Total Portfolio Net Worth</p>
                <h2 className="balance-value">${totalPortfolioValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</h2>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div className="stat-row">
                  <span className="stat-label">Available USD Cash</span>
                  <span className="stat-val">${status?.portfolio?.balanceUSD?.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                </div>
                <div className="stat-row">
                  <span className="stat-label">Holdings Valuation</span>
                  <span className="stat-val">${holdingsValuation.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                </div>
                <div className="stat-row">
                  <span className="stat-label">Trading Asset</span>
                  <span className="stat-val" style={{ color: 'var(--color-secondary)' }}>{status?.settings?.selectedAsset}</span>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '10px', marginTop: '8px' }}>
                {status?.isBotRunning ? (
                  <button className="btn btn-danger" style={{ flex: 1 }} onClick={() => handleToggleBot(false)}>
                    <Square size={16} /> Pause Bot
                  </button>
                ) : (
                  <button className="btn btn-success" style={{ flex: 1 }} onClick={() => handleToggleBot(true)}>
                    <Play size={16} /> Start Bot
                  </button>
                )}
                <button className="btn btn-secondary" onClick={handleResetPortfolio} title="Reset portfolio balance">
                  <RefreshCw size={16} />
                </button>
              </div>
            </div>

            {/* Position display */}
            <div className="glass-panel">
              <div className="panel-header">
                <span className="panel-title"><Database size={16} /> Active Positions</span>
              </div>
              {holdingsInfo.amount > 0 ? (
                <div className="position-card">
                  <div className="position-header">
                    <span>{assetName} Long</span>
                    <span style={{ color: 'var(--color-success)' }}>Open</span>
                  </div>
                  <div className="position-body">
                    <div>
                      <p className="text-muted">Size</p>
                      <p style={{ color: '#fff', fontWeight: 'bold' }}>{holdingsInfo.amount.toFixed(6)}</p>
                    </div>
                    <div>
                      <p className="text-muted">Entry Price</p>
                      <p style={{ color: '#fff', fontWeight: 'bold' }}>${holdingsInfo.avgEntryPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}</p>
                    </div>
                    <div style={{ gridColumn: 'span 2', marginTop: '6px', borderTop: '1px solid rgba(255,255,255,0.03)', paddingTop: '6px' }}>
                      <p className="text-muted">Estimated P&L</p>
                      <p style={{ 
                        fontWeight: 'bold', 
                        fontSize: '0.9rem',
                        color: currentAssetPrice >= holdingsInfo.avgEntryPrice ? 'var(--color-success)' : 'var(--color-danger)'
                      }}>
                        {currentAssetPrice >= holdingsInfo.avgEntryPrice ? '+' : ''}
                        {((currentAssetPrice - holdingsInfo.avgEntryPrice) * holdingsInfo.amount).toLocaleString(undefined, { style: 'currency', currency: 'USD' })}
                        {' '}({(((currentAssetPrice - holdingsInfo.avgEntryPrice) / holdingsInfo.avgEntryPrice) * 100).toFixed(2)}%)
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
                <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--color-text-dark)', fontSize: '0.8rem' }}>
                  No open positions. Cash is 100% liquid.
                </div>
              )}
            </div>

            {/* Recent Trade Fills in Sidebar */}
            <div className="glass-panel" style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
              <div className="panel-header">
                <span className="panel-title"><History size={16} /> Recent Trade Fills</span>
              </div>
              <div className="trades-list" style={{ flex: 1, minHeight: 0, maxHeight: 'none' }}>
                {trades.length > 0 ? (
                  trades.map((t, idx) => (
                    <div className="trade-item" key={idx}>
                      <div className="trade-item-left">
                        <span className={`trade-badge ${t.action.toLowerCase()}`}>{t.action}</span>
                        <span style={{ fontWeight: '600' }}>{t.symbol}</span>
                      </div>
                      <div className="trade-item-right">
                        <span>{(t.amount || 0).toFixed(6)} @ ${(t.price || 0).toLocaleString()}</span>
                        <span className="text-muted">Fee: ${(t.fee || 0).toFixed(2)} | Balance: ${(t.balanceAfter || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                      </div>
                    </div>
                  ))
                ) : (
                  <div style={{ textAlign: 'center', padding: '16px 0', color: 'var(--color-text-dark)', fontSize: '0.8rem' }}>
                    No trade executions recorded yet.
                  </div>
                )}
              </div>
            </div>
          </aside>

          {/* Right Column: Execution logs & stats */}
          <main className="dashboard-main">
            {status?.latestDecision && (
              <div className="glass-panel ai-diagnostic-panel">
                <div className="panel-header">
                  <span className="panel-title" style={{ color: 'var(--color-warning)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Cpu size={16} /> Aether AI Diagnostic Panel
                  </span>
                  <span style={{ fontSize: '0.65rem', color: 'var(--color-text-dark)' }}>
                    Last Run: {status.latestDecision.timestamp ? new Date(status.latestDecision.timestamp).toLocaleTimeString() : 'N/A'}
                  </span>
                </div>
                
                <div className="diagnostic-summary-grid">
                  <div className="diag-stat-card">
                    <span className="diag-label">Market Cycle / Structure</span>
                    <span className="diag-val" style={{ color: '#fff', fontSize: '0.85rem', fontWeight: 'bold' }}>
                      {status.latestDecision.market_structure || 'N/A'}
                    </span>
                  </div>

                  <div className="diag-stat-card">
                    <span className="diag-label">AI Confidence</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
                      <span className="diag-val" style={{ color: 'var(--color-success)', fontWeight: 'bold' }}>
                        {status.latestDecision.confidence ? (status.latestDecision.confidence * 100).toFixed(0) : '0'}%
                      </span>
                      <div className="diag-progress-bg">
                        <div 
                          className="diag-progress-bar" 
                          style={{ 
                            width: `${status.latestDecision.confidence ? (status.latestDecision.confidence * 100) : 0}%`,
                            backgroundColor: 'var(--color-success)'
                          }}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="diag-stat-card">
                    <span className="diag-label">News Sentiment Score</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
                      <span 
                        className="diag-val" 
                        style={{ 
                          color: (status.latestDecision.news_sentiment_score || 0) > 0 
                            ? 'var(--color-success)' 
                            : (status.latestDecision.news_sentiment_score || 0) < 0 
                              ? 'var(--color-danger)' 
                              : 'var(--color-text-muted)',
                          fontWeight: 'bold'
                        }}
                      >
                        {(status.latestDecision.news_sentiment_score || 0) > 0 ? '+' : ''}
                        {status.latestDecision.news_sentiment_score || 0}/10
                      </span>
                      <div className="diag-progress-bg" style={{ position: 'relative' }}>
                        <div 
                          className="diag-progress-bar" 
                          style={{ 
                            width: `${Math.abs(status.latestDecision.news_sentiment_score || 0) * 10}%`,
                            left: (status.latestDecision.news_sentiment_score || 0) >= 0 ? '50%' : 'auto',
                            right: (status.latestDecision.news_sentiment_score || 0) < 0 ? '50%' : 'auto',
                            position: 'absolute',
                            backgroundColor: (status.latestDecision.news_sentiment_score || 0) >= 0 ? 'var(--color-success)' : 'var(--color-danger)'
                          }}
                        />
                        <div style={{ position: 'absolute', left: '50%', top: 0, width: '1px', height: '100%', background: 'rgba(255,255,255,0.2)' }} />
                      </div>
                    </div>
                  </div>

                  <div className="diag-stat-card">
                    <span className="diag-label">Key Trade Zones</span>
                    <div style={{ display: 'flex', gap: '10px', marginTop: '4px', fontSize: '0.75rem' }}>
                      <span style={{ color: 'var(--color-success)', background: 'rgba(16, 185, 129, 0.08)', padding: '2px 6px', borderRadius: '4px', border: '1px solid rgba(16, 185, 129, 0.15)' }}>
                        Floor: ${status.latestDecision.support_level ? status.latestDecision.support_level.toLocaleString(undefined, { maximumFractionDigits: 4 }) : '0.00'}
                      </span>
                      <span style={{ color: 'var(--color-danger)', background: 'rgba(239, 68, 68, 0.08)', padding: '2px 6px', borderRadius: '4px', border: '1px solid rgba(239, 68, 68, 0.15)' }}>
                        Ceiling: ${status.latestDecision.resistance_level ? status.latestDecision.resistance_level.toLocaleString(undefined, { maximumFractionDigits: 4 }) : '0.00'}
                      </span>
                    </div>
                  </div>

                  <div className="diag-stat-card">
                    <span className="diag-label">Risk-to-Reward Ratio</span>
                    <span className="diag-val" style={{ color: 'var(--color-secondary)', fontWeight: 'bold' }}>
                      {status.latestDecision.risk_reward_ratio || '1:1'} R:R
                    </span>
                  </div>
                </div>

                <div className="diagnostic-rationale-box">
                  <span className="diag-label">AI Rationale & Wave Strategy</span>
                  <p className="diagnostic-rationale-text">
                    "{status.latestDecision.reasoning}"
                  </p>
                </div>
              </div>
            )}

            <div className="glass-panel">
              <div className="panel-header">
                <span className="panel-title"><TermIcon size={16} /> System Operations Log</span>
                <span style={{ fontSize: '0.7rem', color: 'var(--color-text-dark)', cursor: 'pointer' }} onClick={handleClearLogs}>Clear</span>
              </div>
              <div className="log-terminal">
                {logs.slice().reverse().map((log, idx) => (
                  <div key={idx} className={`log-entry ${log.type}`}>
                    <span className="log-time">{new Date(log.timestamp).toLocaleTimeString()}</span>
                    <span className="log-message">{log.message}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* AETHER MARKET INTELLIGENCE PANEL */}
            <div className="glass-panel" style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
              <div className="panel-header">
                <span className="panel-title" style={{ color: 'var(--color-secondary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Activity size={16} /> Aether Market Intelligence
                </span>
              </div>
              
              <div className="market-intel-grid">
                <div className="intel-column">
                  <span className="intel-title">Technical Signals Matrix</span>
                  <div className="intel-table">
                    <div className="intel-row">
                      <span className="intel-label">SMA Trend (9/21)</span>
                      <span className="intel-value">
                        {status?.latestDecision?.indicators?.sma9 && status?.latestDecision?.indicators?.sma21 ? (
                          status.latestDecision.indicators.sma9 > status.latestDecision.indicators.sma21 ? (
                            <span className="intel-badge bullish">Bullish (Golden Cross)</span>
                          ) : (
                            <span className="intel-badge bearish">Bearish (Death Cross)</span>
                          )
                        ) : (
                          <span className="intel-badge neutral">N/A</span>
                        )}
                      </span>
                    </div>
                    
                    <div className="intel-row">
                      <span className="intel-label">RSI Strength (14)</span>
                      <span className="intel-value">
                        {status?.latestDecision?.indicators?.rsi ? (
                          <>
                            <span style={{ marginRight: '6px' }}>{status.latestDecision.indicators.rsi.toFixed(2)}</span>
                            {status.latestDecision.indicators.rsi > 70 ? (
                              <span className="intel-badge bearish">Overbought</span>
                            ) : status.latestDecision.indicators.rsi < 30 ? (
                              <span className="intel-badge bullish">Oversold</span>
                            ) : (
                              <span className="intel-badge neutral">Neutral</span>
                            )}
                          </>
                        ) : 'N/A'}
                      </span>
                    </div>

                    <div className="intel-row">
                      <span className="intel-label">MACD Momentum</span>
                      <span className="intel-value">
                        {status?.latestDecision?.indicators?.macd ? (
                          <>
                            <span style={{ marginRight: '6px' }}>{status.latestDecision.indicators.macd.toFixed(4)}</span>
                            {status.latestDecision.indicators.macd > 0 ? (
                              <span className="intel-badge bullish">Positive Hist</span>
                            ) : (
                              <span className="intel-badge bearish">Negative Hist</span>
                            )}
                          </>
                        ) : 'N/A'}
                      </span>
                    </div>

                    <div className="intel-row">
                      <span className="intel-label">Awesome Oscillator (AO)</span>
                      <span className="intel-value">
                        {status?.latestDecision?.indicators?.ao ? (
                          <>
                            <span style={{ marginRight: '6px' }}>{status.latestDecision.indicators.ao.toFixed(4)}</span>
                            {status.latestDecision.indicators.ao > 0 ? (
                              <span className="intel-badge bullish">Bullish Wave</span>
                            ) : (
                              <span className="intel-badge bearish">Bearish Wave</span>
                            )}
                          </>
                        ) : 'N/A'}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="intel-column">
                  <span className="intel-title">Active Risk Safeguards</span>
                  <div className="intel-table">
                    {holdingsInfo.amount > 0 ? (
                      <>
                        <div className="intel-row">
                          <span className="intel-label">Hard Stop-Loss</span>
                          <span className="intel-value">
                            {status?.settings?.stopLossPct > 0 ? (
                              <>
                                <span style={{ marginRight: '6px' }}>
                                  ${(holdingsInfo.avgEntryPrice * (1 - status.settings.stopLossPct / 100)).toFixed(4)}
                                </span>
                                <span className="intel-badge bearish">
                                  -{status.settings.stopLossPct}% Stop
                                </span>
                              </>
                            ) : (
                              <span className="intel-badge neutral">Disabled</span>
                            )}
                          </span>
                        </div>

                        <div className="intel-row">
                          <span className="intel-label">Trailing Stop-Loss</span>
                          <span className="intel-value">
                            {status?.settings?.trailingStopEnabled ? (
                              <>
                                <span style={{ marginRight: '6px' }}>
                                  ${(peakPrice * (1 - (status.settings.trailingStopPct || 2.5) / 100)).toFixed(4)}
                                </span>
                                <span className="intel-badge bearish">
                                  -{status.settings.trailingStopPct}% Trail (Peak: ${peakPrice.toFixed(4)})
                                </span>
                              </>
                            ) : (
                              <span className="intel-badge neutral">Disabled</span>
                            )}
                          </span>
                        </div>

                        <div className="intel-row">
                          <span className="intel-label">ATR Volatility Stop</span>
                          <span className="intel-value">
                            {status?.settings?.atrStopEnabled && status?.latestDecision?.indicators?.atr ? (
                              <>
                                <span style={{ marginRight: '6px' }}>
                                  ${(holdingsInfo.avgEntryPrice - (status.settings.atrStopMultiplier || 2.0) * status.latestDecision.indicators.atr).toFixed(4)}
                                </span>
                                <span className="intel-badge bearish">
                                  {status.settings.atrStopMultiplier}x ATR (ATR: {status.latestDecision.indicators.atr.toFixed(4)})
                                </span>
                              </>
                            ) : (
                              <span className="intel-badge neutral">Disabled</span>
                            )}
                          </span>
                        </div>

                        <div className="intel-row">
                          <span className="intel-label">Take-Profit Target</span>
                          <span className="intel-value">
                            {status?.settings?.takeProfitEnabled ? (
                              <>
                                <span style={{ marginRight: '6px' }}>
                                  ${(holdingsInfo.avgEntryPrice * (1 + (status.settings.takeProfitPct || 10.0) / 100)).toFixed(4)}
                                </span>
                                <span className="intel-badge bullish">
                                  +{status.settings.takeProfitPct}% Target
                                </span>
                              </>
                            ) : (
                              <span className="intel-badge neutral">Disabled</span>
                            )}
                          </span>
                        </div>
                      </>
                    ) : (
                      <div style={{ textAlign: 'center', padding: '16px 0', color: 'var(--color-text-dark)', fontSize: '0.8rem' }}>
                        No open positions. Safety stops will initialize upon trade entry.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </main>
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
            
            {status?.settings?.tradingMode === 'live' ? (
              <div className="alert-banner" style={{ background: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.25)', color: '#fca5a5' }}>
                <AlertTriangle size={18} style={{ flexShrink: 0 }} />
                <span><strong>REAL MONEY ORDER:</strong> Buys and sells placed here will execute live market orders on Coinbase Advanced. Proceed with caution!</span>
              </div>
            ) : (
              <div className="alert-banner info">
                <AlertTriangle size={18} style={{ flexShrink: 0 }} />
                <span>Simulate manual fills on the paper exchange. Feeds trade logs and updates portfolio cash balance.</span>
              </div>
            )}

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
                  <option value="1h">1 Hour</option>
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
                              <span className="text-muted">{new Date(t.time).toLocaleTimeString()}</span>
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
                <span className="log-time">{new Date(log.timestamp).toLocaleString()}</span>
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
              <div className="form-group">
                <label className="form-label">Gemini Developer API Key</label>
                <input 
                  type="password" 
                  placeholder={status.settings.geminiApiKey ? '••••••••' : 'Enter API Key...'} 
                  className="form-input"
                  value={settingsForm.geminiApiKey}
                  onChange={(e) => setSettingsForm({ ...settingsForm, geminiApiKey: e.target.value })}
                />
                <span className="text-muted">Stored locally on your machine. Generates trading decisions.</span>
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
                    <option value="1h">1h</option>
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
                
                {settingsForm.notificationType !== 'none' && (
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
  );
}
