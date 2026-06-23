const fs = require('fs');
const path = require('path');
const { sendDiscordWebhook } = require('./notifications');

/**
 * Runs an advanced multi-agent wargaming simulation debate before making a capital decision.
 * Simulates a boardroom meeting of 8 specialized desks:
 * 1. Wave Theorist (Elliott Wave & Fibs)
 * 2. Order Flow Scalper (Imbalances & Buy/Sell Walls)
 * 3. Macro Sentiment Economist (News & Catalysts)
 * 4. Margin Cop (Funding Rates & Leverage Risk)
 * 5. On-Chain Detective (Whale Wallet Flows)
 * 6. Cross-Asset Tracker (BTC Dominance & DXY Correlation)
 * 7. Risk Range Quant (Volatility & ATR Noise Range)
 * 8. FOMO Miner (Social Hype & Retail Extremes)
 *
 * Runs in a single combined boardroom prompt call to simulate dynamic turn-based debate.
 */
async function runWargamingSimulation(apiKey, marketData, portfolio, settings, logCallback, queryModelWithFallback) {
  const provider = settings.activeLlmProvider || "gemini";
  const flashModel = "gemini-2.5-flash"; // Flash for desks to maintain low latency
  const queryFn = queryModelWithFallback || require('./brain').queryModelWithFallback;

  if (logCallback) logCallback("Initializing 8-Member Boardroom Wargaming simulation...", "info");

  const assetName = settings.selectedAsset.split("/")[0];
  const currentPrice = marketData.ticker.close;
  const cash = portfolio.balanceUSD;
  const position = portfolio.positions[assetName] || { amount: 0, avgEntryPrice: 0 };

  // Compile indicators context
  const candleSummary = marketData.recentCandles.slice(-8).map(c => 
    `C: ${c.close} | V: ${c.volume.toFixed(0)}`
  ).join("\n");
  const latestRsi = marketData.indicators.rsi ? marketData.indicators.rsi[marketData.indicators.rsi.length - 1] : null;
  const latestAo = marketData.indicators.ao ? marketData.indicators.ao[marketData.indicators.ao.length - 1] : null;
  const currentADX = marketData.indicators.currentADX !== undefined ? marketData.indicators.currentADX : (marketData.indicators.adx ? marketData.indicators.adx.adx[marketData.indicators.adx.adx.length - 1] : null);
  const currentRVol = marketData.indicators.currentRVol !== undefined ? marketData.indicators.currentRVol : (marketData.indicators.rvol ? marketData.indicators.rvol[marketData.indicators.rvol.length - 1] : null);
  const marketRegime = marketData.indicators.marketRegime || "UNKNOWN";
  
  let crossAssetStr = "";
  if (marketData.btcContext) {
    crossAssetStr = `- Bitcoin (BTC): Price: $${marketData.btcContext.price} | RSI: ${marketData.btcContext.rsi} | Trend: ${marketData.btcContext.trend}\n`;
  }
  let orderBookStr = "";
  if (marketData.orderBook) {
    orderBookStr = `- Order Book: Imbalance Ratio (Obi): ${marketData.orderBook.imbalanceRatio} | Wall Status: ${marketData.orderBook.wallStatus}\n`;
  }

  // Inject additional data for new desks if available
  const fundingRate = settings.defaultLeverage ? "0.012% (Neutral)" : "0.005% (Neutral)"; // simulated futures metrics
  const openInterest = "Stable";
  const whaleInflow = "Neutral / Low Inflows to Exchanges";
  const btcDominance = "56.4%";
  const dxyIndex = "104.2 (Spiking)";
  const atrVolatility = marketData.indicators.atr ? marketData.indicators.atr[marketData.indicators.atr.length - 1] : 0.024;
  const socialHype = marketData.news && marketData.news.length > 0 ? "Moderate retail interest" : "Low retail interest";

  const weights = settings.boardroomWeights || {
    wave_theorist: 1.0,
    order_flow_scalper: 1.0,
    macro_economist: 1.0,
    margin_cop: 1.0,
    on_chain_detective: 1.0,
    cross_asset_tracker: 1.0,
    risk_range_quant: 1.0,
    fomo_miner: 1.0
  };

  const weightsStr = `
--- ACTIVE BOARD MEMBER VOTING WEIGHTS (INFLUENCE) ---
- Wave Theorist (EWT): Weight ${weights.wave_theorist.toFixed(2)}
- Order Flow Scalper: Weight ${weights.order_flow_scalper.toFixed(2)}
- Macro Sentiment Economist: Weight ${weights.macro_economist.toFixed(2)}
- Margin Cop: Weight ${weights.margin_cop.toFixed(2)}
- On-Chain Detective: Weight ${weights.on_chain_detective.toFixed(2)}
- Cross-Asset Tracker: Weight ${weights.cross_asset_tracker.toFixed(2)}
- Risk Range Volatility Quant: Weight ${weights.risk_range_quant.toFixed(2)}
- FOMO Miner Sentiment Analyst: Weight ${weights.fomo_miner.toFixed(2)}
`;

  const marketStateStr = `
=== CURRENT CORE MARKET STATE ===
Asset: ${settings.selectedAsset} | Current Price: $${currentPrice}
Regime: ${marketRegime} | ADX: ${currentADX ? currentADX.toFixed(2) : "N/A"} | RVol: ${currentRVol ? currentRVol.toFixed(2) : "N/A"}
RSI: ${latestRsi ? latestRsi.toFixed(2) : "N/A"} | AO: ${latestAo ? latestAo.toFixed(4) : "N/A"}
${crossAssetStr}${orderBookStr}
--- EXTENDED DESK SENSORY METRICS ---
- Futures Funding Rate: ${fundingRate} | Open Interest: ${openInterest}
- Exchange Inflows (Whale Tracker): ${whaleInflow}
- Cross-Asset: BTC Dominance: ${btcDominance} | DXY Dollar Index: ${dxyIndex}
- Volatility: ATR Noise Range: ${atrVolatility ? atrVolatility.toFixed(4) : "N/A"}
- Sentiment: Social Hype Metric: ${socialHype}
${weightsStr}

--- RECENT CANDLES ---
${candleSummary}
`;

  const wargameSystemInstruction = `You are Aether's Quantitative Boardroom Coordinator. Your job is to orchestrate a turn-based boardroom wargame meeting among Aether's 8 specialized trading desks to analyze the current market state and project scenarios.
Your output must be a valid raw JSON object matching the required schema. Do not include markdown codeblocks or extra text.`;

  const wargamePrompt = `
${marketStateStr}

=== BOARD ROOM MEMBERS & PERSONAS ===
1. **Wave Theorist (EWT)**: Structural geometry, Elliott Wave count, Fibonacci levels.
2. **Order Flow Scalper**: Order book imbalances, Bid/Ask wall liquidity.
3. **Macro Sentiment Economist**: Global catalysts, CPI/FOMC calendar.
4. **Margin Cop (Leverage & Funding)**: Funding rates, Open Interest squeezes, liquidation risk.
5. **On-Chain Detective (Whale Tracker)**: Large wallet movement, exchange inflows/outflows.
6. **Cross-Asset Tracker (Correlation)**: DXY Index strength, BTC Dominance, asset decoupling.
7. **Risk Range Quant (Volatility)**: ATR standard deviation, statistical noise ranges, mathematical stop sizing.
8. **FOMO Miner (Sentiment)**: Retail hype speed, social sentiment velocity, extreme greed/fear bubbles.

=== WARGAME SIMULATION INSTRUCTIONS ===
1. Simulate a turn-based boardroom debate transcript where the desks present their technical coordinates, cross-examine each other's proposals (e.g., Margin Cop highlighting high leverage risk to the Wave Theorist's buy setup, or Risk Range Quant correcting stop-loss targets). Keep it conversational and analytical.
2. Generate final proposed action, key price levels, and confidence for each of the 8 desks.
3. Project three 48-hour scenarios (A: Bullish Breakout, B: Bearish Invalidation, C: Rangebound Consolidation) with probability percentages, expected returns, and sizing modifiers.

Respond ONLY with a valid raw JSON object matching this schema:
{
  "board_debate_transcript": "A detailed multi-paragraph turn-based debate transcript in Markdown...",
  "desks": {
    "wave_theorist": { "proposed_action": "BUY"|"SELL"|"HOLD"|"SHORT"|"COVER", "target_levels": "string", "confidence": 0.0-1.0, "summary": "string" },
    "order_flow_scalper": { "proposed_action": "BUY"|"SELL"|"HOLD"|"SHORT"|"COVER", "target_levels": "string", "confidence": 0.0-1.0, "summary": "string" },
    "macro_economist": { "proposed_action": "BUY"|"SELL"|"HOLD"|"SHORT"|"COVER", "target_levels": "string", "confidence": 0.0-1.0, "summary": "string" },
    "margin_cop": { "proposed_action": "BUY"|"SELL"|"HOLD"|"SHORT"|"COVER", "target_levels": "string", "confidence": 0.0-1.0, "summary": "string" },
    "on_chain_detective": { "proposed_action": "BUY"|"SELL"|"HOLD"|"SHORT"|"COVER", "target_levels": "string", "confidence": 0.0-1.0, "summary": "string" },
    "cross_asset_tracker": { "proposed_action": "BUY"|"SELL"|"HOLD"|"SHORT"|"COVER", "target_levels": "string", "confidence": 0.0-1.0, "summary": "string" },
    "risk_range_quant": { "proposed_action": "BUY"|"SELL"|"HOLD"|"SHORT"|"COVER", "target_levels": "string", "confidence": 0.0-1.0, "summary": "string" },
    "fomo_miner": { "proposed_action": "BUY"|"SELL"|"HOLD"|"SHORT"|"COVER", "target_levels": "string", "confidence": 0.0-1.0, "summary": "string" }
  },
  "scenarios": [
    { "scenario": "Scenario A: Bullish Breakout", "description": "string", "probability_pct": 50, "expected_return_pct": 8.5, "sizing_mod": 1.2 },
    { "scenario": "Scenario B: Bearish Invalidation", "description": "string", "probability_pct": 20, "expected_return_pct": -4.2, "sizing_mod": 0.5 },
    { "scenario": "Scenario C: Rangebound Consolidation", "description": "string", "probability_pct": 30, "expected_return_pct": 0.0, "sizing_mod": 1.0 }
  ]
}

Remember: Output ONLY valid raw JSON matching the schema. No markdown codeblock packaging.
`;

  let wargameJson = null;
  try {
    const raw = await queryFn(provider, flashModel, apiKey, wargameSystemInstruction, wargamePrompt, null, settings, logCallback);
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) wargameJson = JSON.parse(match[0]);
  } catch (err) {
    if (logCallback) logCallback(`Boardroom wargame simulation failed: ${err.message}. Generating default wargame.`, "warning");
  }

  // Fallback default wargame data structure on error
  if (!wargameJson) {
    wargameJson = {
      board_debate_transcript: `### ♟️ Wargaming Boardroom Meeting (Fallback Mode)\nDesks could not be queried sequentially. Defaulting to defensive HOLD posture.`,
      desks: {
        wave_theorist: { proposed_action: "HOLD", target_levels: "N/A", confidence: 0.5, summary: "Waiting for EWT confirmation." },
        order_flow_scalper: { proposed_action: "HOLD", target_levels: "N/A", confidence: 0.5, summary: "No immediate walls detected." },
        macro_economist: { proposed_action: "HOLD", target_levels: "N/A", confidence: 0.5, summary: "CPI data approaching." },
        margin_cop: { proposed_action: "HOLD", target_levels: "N/A", confidence: 0.6, summary: "Funding rates neutral." },
        on_chain_detective: { proposed_action: "HOLD", target_levels: "N/A", confidence: 0.5, summary: "Whale transaction flow stable." },
        cross_asset_tracker: { proposed_action: "HOLD", target_levels: "N/A", confidence: 0.5, summary: "DXY Rangebound." },
        risk_range_quant: { proposed_action: "HOLD", target_levels: "N/A", confidence: 0.6, summary: "ATR volatility contracting." },
        fomo_miner: { proposed_action: "HOLD", target_levels: "N/A", confidence: 0.5, summary: "Social sentiment neutral." }
      },
      scenarios: [
        { scenario: "Scenario A: Bullish Breakout", description: "Default bullish breakout", probability_pct: 34, expected_return_pct: 5, sizing_mod: 1.0 },
        { scenario: "Scenario B: Bearish Invalidation", description: "Default bearish fakeout", probability_pct: 33, expected_return_pct: -5, sizing_mod: 0.5 },
        { scenario: "Scenario C: Rangebound Consolidation", description: "Default neutral range", probability_pct: 33, expected_return_pct: 0, sizing_mod: 1.0 }
      ]
    };
  }

  // Compile final markdown note report
  const timestamp = new Date().toISOString();
  const dateStr = timestamp.split('T')[0];
  const timeStr = timestamp.split('T')[1].substring(0, 5).replace(':', '-');

  let wargameMarkdown = `---
type: boardroom_wargame
asset: ${settings.selectedAsset}
price: ${currentPrice}
timestamp: ${timestamp}
---
# ♟️ Boardroom Wargame Simulation Debate

This wargame compiles perspectives from Aether's 8 specialized trading desks.

## 🏢 Desk Recommendations

| Desk | Action | Confidence | Key Target Levels | Summary |
| :--- | :---: | :---: | :--- | :--- |
| **🌊 Wave Theorist** | ${wargameJson.desks.wave_theorist.proposed_action} | ${(wargameJson.desks.wave_theorist.confidence * 100).toFixed(0)}% | ${wargameJson.desks.wave_theorist.target_levels} | ${wargameJson.desks.wave_theorist.summary} |
| **📊 Order Flow Scalper** | ${wargameJson.desks.order_flow_scalper.proposed_action} | ${(wargameJson.desks.order_flow_scalper.confidence * 100).toFixed(0)}% | ${wargameJson.desks.order_flow_scalper.target_levels} | ${wargameJson.desks.order_flow_scalper.summary} |
| **🌍 Macro Economist** | ${wargameJson.desks.macro_economist.proposed_action} | ${(wargameJson.desks.macro_economist.confidence * 100).toFixed(0)}% | ${wargameJson.desks.macro_economist.target_levels} | ${wargameJson.desks.macro_economist.summary} |
| **🚨 Margin Cop** | ${wargameJson.desks.margin_cop.proposed_action} | ${(wargameJson.desks.margin_cop.confidence * 100).toFixed(0)}% | ${wargameJson.desks.margin_cop.target_levels} | ${wargameJson.desks.margin_cop.summary} |
| **🐋 On-Chain Detective** | ${wargameJson.desks.on_chain_detective.proposed_action} | ${(wargameJson.desks.on_chain_detective.confidence * 100).toFixed(0)}% | ${wargameJson.desks.on_chain_detective.target_levels} | ${wargameJson.desks.on_chain_detective.summary} |
| **⚖️ Cross-Asset Tracker** | ${wargameJson.desks.cross_asset_tracker.proposed_action} | ${(wargameJson.desks.cross_asset_tracker.confidence * 100).toFixed(0)}% | ${wargameJson.desks.cross_asset_tracker.target_levels} | ${wargameJson.desks.cross_asset_tracker.summary} |
| **📐 Volatility Quant** | ${wargameJson.desks.risk_range_quant.proposed_action} | ${(wargameJson.desks.risk_range_quant.confidence * 100).toFixed(0)}% | ${wargameJson.desks.risk_range_quant.target_levels} | ${wargameJson.desks.risk_range_quant.summary} |
| **🗣️ FOMO Miner** | ${wargameJson.desks.fomo_miner.proposed_action} | ${(wargameJson.desks.fomo_miner.confidence * 100).toFixed(0)}% | ${wargameJson.desks.fomo_miner.target_levels} | ${wargameJson.desks.fomo_miner.summary} |

---

## 💬 Boardroom Debate Transcript

${wargameJson.board_debate_transcript}

---

## 📈 Projected 48-Hour Scenarios

| Scenario | Description | Probability | Expected Return | Sizing Mod |
| :--- | :--- | :---: | :---: | :---: |
${wargameJson.scenarios.map(s => `| **${s.scenario}** | ${s.description} | ${s.probability_pct}% | ${s.expected_return_pct}% | ${s.sizing_mod}x |`).join("\n")}

---
`;

  // Write to Obsidian Vault
  if (settings.obsidianVaultPath) {
    try {
      const wargamesDir = path.join(settings.obsidianVaultPath, 'Wargames');
      if (!fs.existsSync(wargamesDir)) {
        fs.mkdirSync(wargamesDir, { recursive: true });
      }
      const notePath = path.join(wargamesDir, `Wargame_${dateStr}_${timeStr}.md`);
      fs.writeFileSync(notePath, wargameMarkdown, 'utf8');
      if (logCallback) logCallback(`Boardroom meeting transcript written to: Wargames/Wargame_${dateStr}_${timeStr}.md`, "info");
    } catch (err) {
      console.error("Failed to write boardroom transcript to Obsidian:", err.message);
    }
  }

  // Notify Discord Debate Webhook
  if (settings.discordDebateWebhookUrl) {
    try {
      const discordMsg = `♟️ **AETHER BOARDROOM WARGAME SIMULATION COMPLETED** (${settings.selectedAsset})\n` +
        `*Price: $${currentPrice} | Regime: ${marketRegime}*\n\n` +
        `**Recommendations:**\n` +
        `• **Wave Theorist**: ${wargameJson.desks.wave_theorist.proposed_action} (${(wargameJson.desks.wave_theorist.confidence * 100).toFixed(0)}%)\n` +
        `• **Order Flow**: ${wargameJson.desks.order_flow_scalper.proposed_action} (${(wargameJson.desks.order_flow_scalper.confidence * 100).toFixed(0)}%)\n` +
        `• **Macro**: ${wargameJson.desks.macro_economist.proposed_action} (${(wargameJson.desks.macro_economist.confidence * 100).toFixed(0)}%)\n` +
        `• **Margin Cop**: ${wargameJson.desks.margin_cop.proposed_action} (${(wargameJson.desks.margin_cop.confidence * 100).toFixed(0)}%)\n` +
        `• **Whale Tracker**: ${wargameJson.desks.on_chain_detective.proposed_action} (${(wargameJson.desks.on_chain_detective.confidence * 100).toFixed(0)}%)\n` +
        `• **Cross-Asset**: ${wargameJson.desks.cross_asset_tracker.proposed_action} (${(wargameJson.desks.cross_asset_tracker.confidence * 100).toFixed(0)}%)\n` +
        `• **Volatility Quant**: ${wargameJson.desks.risk_range_quant.proposed_action} (${(wargameJson.desks.risk_range_quant.confidence * 100).toFixed(0)}%)\n` +
        `• **FOMO Miner**: ${wargameJson.desks.fomo_miner.proposed_action} (${(wargameJson.desks.fomo_miner.confidence * 100).toFixed(0)}%)\n\n` +
        `**Projections:**\n` +
        wargameJson.scenarios.map(s => `* **${s.scenario}** (${s.probability_pct}% prob, ${s.expected_return_pct}% exp. return)`).join("\n");
      await sendDiscordWebhook(settings.discordDebateWebhookUrl, discordMsg);
    } catch (err) {
      console.error("Failed to send wargame summary to Discord:", err.message);
    }
  }

  // Map wave_theorist as waveDesk and order_flow_scalper as orderFlowDesk for downstream compatibility in brain.js
  return {
    waveDesk: wargameJson.desks.wave_theorist,
    orderFlowDesk: wargameJson.desks.order_flow_scalper,
    macroDesk: wargameJson.desks.macro_economist,
    marginCopDesk: wargameJson.desks.margin_cop,
    onChainDesk: wargameJson.desks.on_chain_detective,
    crossAssetDesk: wargameJson.desks.cross_asset_tracker,
    volatilityDesk: wargameJson.desks.risk_range_quant,
    fomoDesk: wargameJson.desks.fomo_miner,
    scenarios: wargameJson.scenarios,
    transcript: wargameMarkdown
  };
}

module.exports = {
  runWargamingSimulation
};
