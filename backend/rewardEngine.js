const fs = require('fs');
const path = require('path');
const { sendDiscordWebhook } = require('./notifications');

const DB_PATH = path.join(__dirname, 'db.json');

function readDB() {
  try {
    if (!fs.existsSync(DB_PATH)) {
      return {};
    }
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  } catch (err) {
    console.error("rewardEngine failed to read db:", err.message);
    return {};
  }
}

function writeDB(data) {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error("rewardEngine failed to write db:", err.message);
  }
}

/**
 * Evaluates performance of wargaming boardroom desks when a trade is closed (SELL order).
 * Reads wargaming history, updates voting weights and performance logs in settings/db,
 * writes a report to Obsidian, and posts a summary to Discord.
 */
async function evaluateBoardroomPerformance(db, closedTrade, logCallback) {
  if (logCallback) logCallback("Initiating Boardroom Desk Performance Evaluation...", "info");

  const activeStates = closedTrade.activeStates || [];
  if (activeStates.length === 0) {
    if (logCallback) logCallback("No activeStates linked to this closed trade. Cannot evaluate boardroom history.", "warning");
    return;
  }

  const wargameHistory = db.wargameHistory || {};
  const settings = db.settings || {};
  const vaultPath = settings.obsidianVaultPath;
  const pnlPct = closedTrade.netReturnPct || 0;
  const isWin = pnlPct > 0;

  // 1. Initialize boardroom weights and performance logs if they don't exist
  if (!settings.boardroomWeights) {
    settings.boardroomWeights = {
      wave_theorist: 1.0,
      order_flow_scalper: 1.0,
      macro_economist: 1.0,
      margin_cop: 1.0,
      on_chain_detective: 1.0,
      cross_asset_tracker: 1.0,
      risk_range_quant: 1.0,
      fomo_miner: 1.0
    };
  }
  if (!settings.boardroomPerformance) {
    settings.boardroomPerformance = {};
  }
  
  Object.keys(settings.boardroomWeights).forEach(desk => {
    if (!settings.boardroomPerformance[desk]) {
      settings.boardroomPerformance[desk] = {
        total_predictions: 0,
        correct_predictions: 0,
        cumulative_pnl: 0
      };
    }
  });

  const weightChanges = {};
  Object.keys(settings.boardroomWeights).forEach(desk => {
    weightChanges[desk] = 0;
  });

  let evaluatedWargamesCount = 0;

  const deskKeysMap = {
    wave_theorist: 'waveDesk',
    order_flow_scalper: 'orderFlowDesk',
    macro_economist: 'macroDesk',
    margin_cop: 'marginCopDesk',
    on_chain_detective: 'onChainDesk',
    cross_asset_tracker: 'crossAssetDesk',
    risk_range_quant: 'volatilityDesk',
    fomo_miner: 'fomoDesk'
  };

  // 2. Loop through active states and find corresponding wargames in history
  for (const timestamp of activeStates) {
    const wargame = wargameHistory[timestamp];
    if (!wargame) continue;

    evaluatedWargamesCount++;

    Object.entries(deskKeysMap).forEach(([deskName, wargameKey]) => {
      const deskRec = wargame[wargameKey];
      if (!deskRec) return;

      const action = (deskRec.proposed_action || 'HOLD').toUpperCase();
      const confidence = Number(deskRec.confidence) || 0.5;
      
      const perf = settings.boardroomPerformance[deskName];
      perf.total_predictions++;

      let adjustment = 0;
      let wasCorrect = false;

      if (isWin) {
        // Winning trade: Desks that recommended BUY or HOLD (to accumulate or let trend run) were right
        if (action === 'BUY' || action === 'HOLD') {
          adjustment = 0.05 * confidence;
          wasCorrect = true;
          perf.correct_predictions++;
        } else if (action === 'SELL' || action === 'SHORT') {
          adjustment = -0.05 * confidence;
        }
      } else {
        // Losing trade: Desks that recommended SELL, SHORT, or HOLD (avoiding long setup) were right
        if (action === 'SELL' || action === 'SHORT' || action === 'HOLD') {
          adjustment = 0.05 * confidence;
          wasCorrect = true;
          perf.correct_predictions++;
        } else if (action === 'BUY') {
          adjustment = -0.05 * confidence;
        }
      }

      weightChanges[deskName] += adjustment;
      const deskPnlImpact = (action === 'BUY' || action === 'HOLD') ? pnlPct : -pnlPct;
      perf.cumulative_pnl += deskPnlImpact;
    });
  }

  if (evaluatedWargamesCount === 0) {
    if (logCallback) logCallback("No matching wargame records found in history cache. Weights unchanged.", "info");
    return;
  }

  // 3. Apply changes and clamp weights
  const oldWeights = { ...settings.boardroomWeights };
  Object.keys(settings.boardroomWeights).forEach(desk => {
    let newWeight = settings.boardroomWeights[desk] + weightChanges[desk];
    // Clamp between 0.5 and 2.0
    newWeight = Math.max(0.5, Math.min(2.0, Number(newWeight.toFixed(3))));
    settings.boardroomWeights[desk] = newWeight;
  });

  // Save changes directly back to db.json
  const finalDb = readDB();
  if (finalDb.settings) {
    finalDb.settings.boardroomWeights = settings.boardroomWeights;
    finalDb.settings.boardroomPerformance = settings.boardroomPerformance;
    writeDB(finalDb);
  }

  // 4. Compile Markdown Calibration Report
  const timestampStr = new Date().toISOString();
  const dateStr = timestampStr.split('T')[0];
  const timeStr = timestampStr.split('T')[1].substring(0, 5).replace(':', '-');

  let reportMd = `---
type: boardroom_rewards
pnl_pct: ${pnlPct}%
win: ${isWin}
closed_timestamp: "${timestampStr}"
evaluated_wargames: ${evaluatedWargamesCount}
---
# ⚖️ Boardroom Performance & Voting Weights Calibration

This calibration report evaluates Aether's 8 quantitative desks based on their predictions during the lifecycle of the closed trade:
- **Closed Position**: ${closedTrade.symbol || 'XRP/USDC'}
- **Trade Outcome**: **${isWin ? 'WIN' : 'LOSS'}**
- **PnL**: **${pnlPct.toFixed(2)}%** (${closedTrade.netReturn || 'N/A'})
- **Number of Board Meetings Evaluated**: ${evaluatedWargamesCount}

## 📊 Calibrated Desk Standings

| Desk | Status | Performance (Correct/Total) | Cum. P&L Impact | Old Weight | Change | New Weight |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
`;

  const deskNamesMapReadable = {
    wave_theorist: '🌊 Wave Theorist',
    order_flow_scalper: '📊 Order Flow Scalper',
    macro_economist: '🌍 Macro Economist',
    margin_cop: '🚨 Margin Cop',
    on_chain_detective: '🐋 On-Chain Detective',
    cross_asset_tracker: '⚖️ Cross-Asset Tracker',
    risk_range_quant: '📐 Volatility Quant',
    fomo_miner: '🗣️ FOMO Miner'
  };

  Object.keys(settings.boardroomWeights).forEach(desk => {
    const readable = deskNamesMapReadable[desk] || desk;
    const oldW = oldWeights[desk];
    const newW = settings.boardroomWeights[desk];
    const change = newW - oldW;
    const changeStr = change >= 0 ? `+${change.toFixed(3)}` : change.toFixed(3);
    const perf = settings.boardroomPerformance[desk];
    const rate = perf.total_predictions > 0 ? (perf.correct_predictions / perf.total_predictions * 100).toFixed(0) : '0';

    reportMd += `| **${readable}** | ${change >= 0 ? '🟢 Gain' : '🔴 Penalty'} | ${perf.correct_predictions}/${perf.total_predictions} (${rate}%) | ${perf.cumulative_pnl.toFixed(2)}% | ${oldW.toFixed(2)} | ${changeStr} | **${newW.toFixed(2)}** |\n`;
  });

  reportMd += `
---

## 💬 Calibration Takeaway
The board's voting power has been recalibrated to match their accuracy over this trade's holding period. Desks that successfully predicted and supported this outcome (or warned against it in case of a loss) have gained voting power. Desks that were overconfident in the wrong direction have had their influence reduced.
`;

  // Write to Obsidian
  if (vaultPath) {
    try {
      const wargamesDir = path.join(vaultPath, 'Wargames');
      if (!fs.existsSync(wargamesDir)) {
        fs.mkdirSync(wargamesDir, { recursive: true });
      }
      const notePath = path.join(wargamesDir, `Boardroom_Rewards_${dateStr}_${timeStr}.md`);
      fs.writeFileSync(notePath, reportMd, 'utf8');
      if (logCallback) logCallback(`Boardroom performance note written to: Wargames/Boardroom_Rewards_${dateStr}_${timeStr}.md`, "info");
    } catch (err) {
      console.error("Failed to write boardroom rewards note to Obsidian:", err.message);
    }
  }

  // Post to Discord Webhook
  if (settings.discordDebateWebhookUrl) {
    try {
      let discordMsg = `⚖️ **AETHER BOARDROOM WEIGHTS CALIBRATED**\n` +
        `*Trade Closed: ${closedTrade.symbol || 'XRP/USDC'} | PnL: ${closedTrade.netReturn} (${isWin ? 'Win ✅' : 'Loss ❌'})*\n\n` +
        `**Calibrated Desk Voting Weights:**\n`;
      
      Object.keys(settings.boardroomWeights).forEach(desk => {
        const readable = deskNamesMapReadable[desk] || desk;
        const newW = settings.boardroomWeights[desk];
        const oldW = oldWeights[desk];
        const diff = newW - oldW;
        const diffStr = diff !== 0 ? `(${diff >= 0 ? '+' : ''}${diff.toFixed(2)})` : '';
        discordMsg += `• **${readable}**: **${newW.toFixed(2)}** ${diffStr}\n`;
      });
      
      await sendDiscordWebhook(settings.discordDebateWebhookUrl, discordMsg);
    } catch (err) {
      console.error("Failed to send reward update to Discord:", err.message);
    }
  }

  if (logCallback) logCallback("Boardroom performance calibration complete.", "info");
}

module.exports = {
  evaluateBoardroomPerformance
};
