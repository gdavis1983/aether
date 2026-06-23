const fs = require('fs');
const path = require('path');

/**
 * Helper to ensure a directory exists recursively
 */
function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * Format date to standard Obsidian note timestamp filenames
 */
function formatTimestamp(dateStr) {
  const date = new Date(dateStr);
  const pad = (num) => String(num).padStart(2, '0');
  const yyyy = date.getFullYear();
  const mm = pad(date.getMonth() + 1);
  const dd = pad(date.getDate());
  const hh = pad(date.getHours());
  const min = pad(date.getMinutes());
  return `${yyyy}-${mm}-${dd}_${hh}-${min}`;
}

/**
 * Write a State Node
 * @param {string} vaultPath - Root path of the Obsidian Vault
 * @param {string} timestamp - ISO timestamp of the state
 * @param {object} data - Quantitative indicator measurements
 * @param {string} reasoning - AI's reasoning or narrative context
 */
function writeStateNode(vaultPath, timestamp, data, reasoning) {
  if (!vaultPath) return;
  try {
    const targetDir = path.join(vaultPath, 'States');
    ensureDir(targetDir);

    const timeId = formatTimestamp(timestamp);
    const filename = `State_${timeId}.md`;
    const filePath = path.join(targetDir, filename);

    // Calculate previous and next state timestamps (hourly interval)
    const currentDate = new Date(timestamp);
    const prevDate = new Date(currentDate.getTime() - 60 * 60 * 1000);
    const nextDate = new Date(currentDate.getTime() + 60 * 60 * 1000);
    
    const prevId = `[[State_${formatTimestamp(prevDate)}]]`;
    const nextId = `[[State_${formatTimestamp(nextDate)}]]`;

    const primary = data.primary_indicators || {};
    const secondary = data.secondary_indicators || {};
    const btc = data.btc_context || { price: null, rsi: null, smaCross: "UNKNOWN", trend: "UNKNOWN" };
    const ob = data.order_book || { imbalanceRatio: null, wallStatus: "UNKNOWN" };

    const frontmatter = `---
timestamp: "${timestamp}"
symbol: "${data.symbol || 'XRP/USDC'}"
primary_indicators:
  ao: ${primary.ao !== undefined ? primary.ao : 'null'}
  wave: ${primary.wave !== undefined ? `"${primary.wave}"` : 'null'}
  fib: ${primary.fib !== undefined ? primary.fib : 'null'}
  sma9: ${primary.sma9 !== undefined ? primary.sma9 : 'null'}
  sma21: ${primary.sma21 !== undefined ? primary.sma21 : 'null'}
secondary_indicators:
  rsi: ${secondary.rsi !== undefined ? secondary.rsi : 'null'}
  macd: "${secondary.macd || 'null'}"
  rvol: ${secondary.rvol !== undefined ? secondary.rvol : 'null'}
  adx: ${secondary.adx !== undefined ? secondary.adx : 'null'}
  market_regime: "${secondary.market_regime || 'UNKNOWN'}"
btc_context:
  price: ${btc.price !== undefined && btc.price !== null ? btc.price : 'null'}
  rsi: ${btc.rsi !== undefined && btc.rsi !== null ? btc.rsi : 'null'}
  sma_cross: "${btc.smaCross || 'UNKNOWN'}"
  trend: "${btc.trend || 'UNKNOWN'}"
order_book:
  imbalance_ratio: ${ob.imbalanceRatio !== undefined && ob.imbalanceRatio !== null ? ob.imbalanceRatio : 'null'}
  wall_status: "${ob.wallStatus || 'UNKNOWN'}"
prev_state: "${prevId}"
next_state: "${nextId}"
type: "market_state"
---
`;

    const content = `${frontmatter}
# Market State: ${timestamp}

## Chronological Chain
- **Previous State**: ${prevId}
- **Next State**: ${nextId}

## Market Context
- **Asset**: ${data.symbol || 'XRP/USDC'}
- **Current Price**: $${data.price || 'N/A'}
- **Volume SMA Ratio (RVol)**: ${secondary.rvol || 'N/A'}
- **ADX Regime**: ${secondary.market_regime || 'N/A'}

## Bitcoin Macro Context
- **BTC Price**: $${btc.price !== null && btc.price !== undefined ? btc.price.toLocaleString() : 'N/A'}
- **BTC Daily RSI**: ${btc.rsi !== null && btc.rsi !== undefined ? btc.rsi : 'N/A'}
- **BTC SMA Cross**: ${btc.smaCross || 'N/A'}
- **BTC Trend**: ${btc.trend || 'N/A'}

## Order Book Depth
- **Imbalance Ratio**: ${ob.imbalanceRatio !== null && ob.ob !== undefined && ob.imbalanceRatio !== undefined ? ob.imbalanceRatio : (ob.imbalanceRatio !== null && ob.imbalanceRatio !== undefined ? ob.imbalanceRatio : 'N/A')}
- **Whale Wall Status**: ${ob.wallStatus || 'N/A'}

## Core Quantitative Signals
- **Awesome Oscillator**: ${primary.ao || 'N/A'}
- **Elliott Wave Estimate**: ${primary.wave || 'N/A'}
- **Fibonacci Retracement Level**: ${primary.fib || 'N/A'}

## Brain Narrative & Decision Reasonings
\`\`\`text
${reasoning || 'No narrative logged for this interval.'}
\`\`\`
`;

    fs.writeFileSync(filePath, content, 'utf8');
    return filePath;
  } catch (err) {
    console.error("Error writing State Node to Obsidian:", err.message);
  }
}

/**
 * Update a State Node with a resolved trade outcome
 */
function updateStateNodeWithOutcome(vaultPath, timestamp, outcomeLink, takeawayText = '') {
  if (!vaultPath) return;
  try {
    const timeId = formatTimestamp(timestamp);
    const filePath = path.join(vaultPath, 'States', `State_${timeId}.md`);
    if (fs.existsSync(filePath)) {
      let content = fs.readFileSync(filePath, 'utf8');
      
      // Update frontmatter and body for outcome
      if (content.includes('outcome:')) {
        content = content.replace(/outcome:\s*".*?"/, `outcome: "${outcomeLink}"`);
      } else {
        content = content.replace('type: "market_state"', `type: "market_state"\noutcome: "${outcomeLink}"`);
      }

      // Update frontmatter for takeaway if provided
      if (takeawayText) {
        if (content.includes('takeaway:')) {
          content = content.replace(/takeaway:\s*".*?"/, `takeaway: "${takeawayText.replace(/"/g, '\\"')}"`);
        } else {
          content = content.replace('type: "market_state"', `type: "market_state"\ntakeaway: "${takeawayText.replace(/"/g, '\\"')}"`);
        }
      }
      
      // Append resolved outcome section to the end of the body
      if (!content.includes('## Resolved Outcome')) {
        content += `\n\n## Resolved Outcome\n- **Trade Resolution**: ${outcomeLink}\n`;
        if (takeawayText) {
          content += `- **Post-Mortem Takeaway**: ${takeawayText}\n`;
        }
      } else {
        if (takeawayText && !content.includes('Post-Mortem Takeaway')) {
          content = content.replace('## Resolved Outcome', `## Resolved Outcome\n- **Post-Mortem Takeaway**: ${takeawayText}\n- **Trade Resolution**: ${outcomeLink}`);
        }
      }
      
      fs.writeFileSync(filePath, content, 'utf8');
    }
  } catch (err) {
    console.error("Error updating State Node with outcome:", err.message);
  }
}

/**
 * Write a Trade Node
 * @param {string} vaultPath
 * @param {string|number} tradeId
 * @param {object} tradeData
 */
function writeTradeNode(vaultPath, tradeId, tradeData) {
  if (!vaultPath) return;
  try {
    const targetDir = path.join(vaultPath, 'Trades');
    ensureDir(targetDir);

    const filename = `Trade_${tradeId}.md`;
    const filePath = path.join(targetDir, filename);

    const stateLinks = (tradeData.activeStates || [])
      .map(t => `[[State_${formatTimestamp(t)}]]`)
      .join(', ');

    const outcomeLink = `[[Outcomes/Trade-${tradeData.pnlPct >= 0 ? 'Win' : 'Loss'}]]`;

    const frontmatter = `---
trade_id: "${tradeId}"
symbol: "${tradeData.symbol || 'XRP/USDC'}"
entry_price: ${tradeData.entryPrice || 0}
exit_price: ${tradeData.exitPrice || 0}
pnl_pct: ${tradeData.pnlPct || 0}
outcome: "${outcomeLink}"
type: "trade_log"
---
`;

    const content = `${frontmatter}
# Trade Log #${tradeId}

## Parameters
- **Asset**: ${tradeData.symbol}
- **Entry Price**: $${tradeData.entryPrice}
- **Exit Price**: $${tradeData.exitPrice || 'N/A'}
- **PnL (%)**: ${tradeData.pnlPct || 0}%
- **Outcome Status**: ${outcomeLink}

## Core States & Timeline Links
- **States Evaluated**: ${stateLinks || 'N/A'}
- **Debate Record**: [[Debate_${formatTimestamp(tradeData.timestamp)}]]

## Reasoning & Notes
${tradeData.reasoning || 'No reasoning stored.'}
`;

    fs.writeFileSync(filePath, content, 'utf8');

    // Retroactively update all states active during this trade with the outcome
    if (tradeData.activeStates && Array.isArray(tradeData.activeStates)) {
      tradeData.activeStates.forEach(stateTime => {
        updateStateNodeWithOutcome(vaultPath, stateTime, outcomeLink);
      });
    }

    return filePath;
  } catch (err) {
    console.error("Error writing Trade Node to Obsidian:", err.message);
  }
}

/**
 * Write a Simulation / Counterfactual Node
 * @param {string} vaultPath
 * @param {string|number} simId
 * @param {object} simData
 */
function writeSimulationNode(vaultPath, simId, simData) {
  if (!vaultPath) return;
  try {
    const targetDir = path.join(vaultPath, 'Simulations');
    ensureDir(targetDir);

    const filename = `Sim_${simId}.md`;
    const filePath = path.join(targetDir, filename);

    const frontmatter = `---
sim_id: "${simId}"
symbol: "${simData.symbol || 'XRP/USDC'}"
strategy_type: "${simData.strategyType || 'Alternative'}"
pnl_pct: ${simData.pnlPct || 0}
type: "paper_simulation"
---
`;

    const content = `${frontmatter}
# Parallel Simulation #${simId}

## Simulation Parameters
- **Asset**: ${simData.symbol}
- **Strategy Deviation**: ${simData.strategyType} (e.g. Tighter Trail, Loose ATR)
- **Simulated Entry**: $${simData.entryPrice}
- **Simulated Exit**: $${simData.exitPrice}
- **Simulated PnL (%)**: ${simData.pnlPct}%

## Comparison Link
- **Connected Live Trade**: [[Trade_${simData.connectedTradeId || 'None'}]]
- **Connected State Snapshot**: [[State_${formatTimestamp(simData.timestamp)}]]

## Analytical Review
${simData.analysis || 'No simulation review written.'}
`;

    fs.writeFileSync(filePath, content, 'utf8');
    return filePath;
  } catch (err) {
    console.error("Error writing Simulation Node to Obsidian:", err.message);
  }
}

/**
 * Write a Multi-Agent Debate Log
 * @param {string} vaultPath
 * @param {string} timestamp
 * @param {object} debateData - { symbol, currentPrice, transcript: [{role, text}] }
 */
function writeDebateLog(vaultPath, timestamp, debateData) {
  if (!vaultPath) return;
  try {
    const targetDir = path.join(vaultPath, 'Debates');
    ensureDir(targetDir);

    const timeId = formatTimestamp(timestamp);
    const filename = `Debate_${timeId}.md`;
    const filePath = path.join(targetDir, filename);

    const frontmatter = `---
timestamp: "${timestamp}"
symbol: "${debateData.symbol || 'XRP/USDC'}"
price: ${debateData.currentPrice || 0}
decision: "${debateData.finalDecision || 'HOLD'}"
type: "debate_log"
---
`;

    let transcriptMd = '';
    (debateData.transcript || []).forEach(entry => {
      const speaker = entry.role === 'trader' ? '🔴 Aether Trader' : '🔵 Aether Auditor';
      transcriptMd += `### ${speaker}\n${entry.text}\n\n`;
    });

    const content = `${frontmatter}
# 🧠 Multi-Agent Debate Log: ${timestamp}

## Overview
- **Asset**: ${debateData.symbol || 'XRP/USDC'}
- **Current Price**: $${debateData.currentPrice || 0}
- **Associated State**: [[State_${timeId}]]
- **Final Consensus Decision**: **${debateData.finalDecision || 'HOLD'}**

---

## The Debate Transcript

${transcriptMd}
`;

    fs.writeFileSync(filePath, content, 'utf8');
    return filePath;
  } catch (err) {
    console.error("Error writing Debate Log to Obsidian:", err.message);
  }
}

module.exports = {
  writeStateNode,
  writeTradeNode,
  writeSimulationNode,
  writeDebateLog,
  updateStateNodeWithOutcome
};
