const fs = require('fs');
const path = require('path');
const { evaluateBoardroomPerformance } = require('../rewardEngine');

async function runTestRewardEngine() {
  console.log("====================================================");
  console.log("🚀 STARTING AETHER BOARDROOM REWARD SYSTEM TESTS");
  console.log("====================================================\n");

  const dbPath = path.join(__dirname, '..', 'db.json');
  if (!fs.existsSync(dbPath)) {
    console.error("Error: db.json not found inside backend/.");
    return;
  }

  // Backup original db.json content to restore after test
  const dbBackup = fs.readFileSync(dbPath, 'utf8');
  const db = JSON.parse(dbBackup);

  const testStateTimestamp = "2026-06-22T05:00:00.000Z";

  // Create a mock wargame result where:
  // - wave_theorist (waveDesk): proposed BUY (conf: 0.8)
  // - order_flow_scalper (orderFlowDesk): proposed BUY (conf: 0.6)
  // - macro_economist (macroDesk): proposed BUY (conf: 0.5)
  // - margin_cop (marginCopDesk): proposed HOLD (conf: 0.7)
  // - on_chain_detective (onChainDesk): proposed SELL (conf: 0.4)
  // - cross_asset_tracker (crossAssetDesk): proposed SELL (conf: 0.6)
  // - volatilityDesk (risk_range_quant): proposed HOLD (conf: 0.8)
  // - fomoDesk (fomo_miner): proposed BUY (conf: 0.9)
  const mockWargame = {
    waveDesk: { proposed_action: "BUY", confidence: 0.8, target_levels: "1.25", summary: "Bullish setup" },
    orderFlowDesk: { proposed_action: "BUY", confidence: 0.6, target_levels: "1.22", summary: "Bid wall support" },
    macroDesk: { proposed_action: "BUY", confidence: 0.5, target_levels: "1.20", summary: "Macro tailwinds" },
    marginCopDesk: { proposed_action: "HOLD", confidence: 0.7, target_levels: "N/A", summary: "Slight leverage warning" },
    onChainDesk: { proposed_action: "SELL", confidence: 0.4, target_levels: "1.10", summary: "Whale exchange inflows" },
    crossAssetDesk: { proposed_action: "SELL", confidence: 0.6, target_levels: "1.12", summary: "DXY spiking warning" },
    volatilityDesk: { proposed_action: "HOLD", confidence: 0.8, target_levels: "N/A", summary: "ATR expanding stop range" },
    fomoDesk: { proposed_action: "BUY", confidence: 0.9, target_levels: "1.30", summary: "Retail FOMO starting" },
    scenarios: [],
    transcript: "Mock boardroom debate transcript text..."
  };

  // 1. Setup mock data in db
  if (!db.wargameHistory) db.wargameHistory = {};
  db.wargameHistory[testStateTimestamp] = mockWargame;

  // Initialize weights to 1.0
  db.settings.boardroomWeights = {
    wave_theorist: 1.0,
    order_flow_scalper: 1.0,
    macro_economist: 1.0,
    margin_cop: 1.0,
    on_chain_detective: 1.0,
    cross_asset_tracker: 1.0,
    risk_range_quant: 1.0,
    fomo_miner: 1.0
  };
  
  // Wipe out old performance logs for clean test
  db.settings.boardroomPerformance = {};

  fs.writeFileSync(dbPath, JSON.stringify(db, null, 2), 'utf8');
  console.log("Mock wargame history and default boardroom weights loaded in db.json.");

  // Test Case A: Winning Trade
  console.log("\n----------------------------------------------------");
  console.log("🟢 TEST CASE A: Evaluating a Winning Trade (+10.5% PnL)");
  console.log("----------------------------------------------------");

  const mockWinTrade = {
    symbol: "XRP/USDC",
    action: "SELL",
    price: 1.25,
    amount: 100,
    total: 125,
    netReturnVal: 11.9,
    netReturnPct: 10.5,
    netReturn: "+10.50% (+$11.90)",
    activeStates: [testStateTimestamp]
  };

  try {
    await evaluateBoardroomPerformance(db, mockWinTrade, (msg) => console.log(`[REWARD ENGINE] ${msg}`));
    
    // Read updated DB and assert weights
    const dbAfterWin = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    const weights = dbAfterWin.settings.boardroomWeights;
    
    console.log("\nCalibrated Weights after WIN:");
    Object.entries(weights).forEach(([desk, w]) => {
      console.log(`- ${desk}: ${w.toFixed(3)} (Diff from 1.00: ${(w - 1.0).toFixed(3)})`);
    });

    // Asserts:
    // wave_theorist proposed BUY -> reward: 1.0 + 0.05 * 0.8 = 1.04
    // cross_asset_tracker proposed SELL -> penalty: 1.0 - 0.05 * 0.6 = 0.97
    // margin_cop proposed HOLD -> reward: 1.0 + 0.05 * 0.7 = 1.035
    if (Math.abs(weights.wave_theorist - 1.04) > 0.001) throw new Error("wave_theorist weight incorrect");
    if (Math.abs(weights.cross_asset_tracker - 0.97) > 0.001) throw new Error("cross_asset_tracker weight incorrect");
    if (Math.abs(weights.margin_cop - 1.035) > 0.001) throw new Error("margin_cop weight incorrect");
    
    console.log("\n✅ Test Case A: SUCCESS!");
  } catch (err) {
    console.error("❌ Test Case A Failed:", err.message);
  }

  // Restore baseline settings for Test Case B
  const dbReset = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
  dbReset.settings.boardroomWeights = {
    wave_theorist: 1.0,
    order_flow_scalper: 1.0,
    macro_economist: 1.0,
    margin_cop: 1.0,
    on_chain_detective: 1.0,
    cross_asset_tracker: 1.0,
    risk_range_quant: 1.0,
    fomo_miner: 1.0
  };
  fs.writeFileSync(dbPath, JSON.stringify(dbReset, null, 2), 'utf8');

  // Test Case B: Losing Trade
  console.log("\n----------------------------------------------------");
  console.log("🔴 TEST CASE B: Evaluating a Losing Trade (-5.2% PnL)");
  console.log("----------------------------------------------------");

  const mockLossTrade = {
    symbol: "XRP/USDC",
    action: "SELL",
    price: 1.09,
    amount: 100,
    total: 109,
    netReturnVal: -6.0,
    netReturnPct: -5.2,
    netReturn: "-5.20% (-$6.00)",
    activeStates: [testStateTimestamp]
  };

  try {
    await evaluateBoardroomPerformance(dbReset, mockLossTrade, (msg) => console.log(`[REWARD ENGINE] ${msg}`));
    
    // Read updated DB and assert weights
    const dbAfterLoss = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    const weights = dbAfterLoss.settings.boardroomWeights;
    
    console.log("\nCalibrated Weights after LOSS:");
    Object.entries(weights).forEach(([desk, w]) => {
      console.log(`- ${desk}: ${w.toFixed(3)} (Diff from 1.00: ${(w - 1.0).toFixed(3)})`);
    });

    // Asserts:
    // wave_theorist proposed BUY -> penalty: 1.0 - 0.05 * 0.8 = 0.96
    // cross_asset_tracker proposed SELL -> reward: 1.0 + 0.05 * 0.6 = 1.03
    // margin_cop proposed HOLD -> reward: 1.0 + 0.05 * 0.7 = 1.035
    if (Math.abs(weights.wave_theorist - 0.96) > 0.001) throw new Error("wave_theorist weight incorrect");
    if (Math.abs(weights.cross_asset_tracker - 1.03) > 0.001) throw new Error("cross_asset_tracker weight incorrect");
    if (Math.abs(weights.margin_cop - 1.035) > 0.001) throw new Error("margin_cop weight incorrect");
    
    console.log("\n✅ Test Case B: SUCCESS!");
  } catch (err) {
    console.error("❌ Test Case B Failed:", err.message);
  }

  // Restore original db.json contents to clean up
  fs.writeFileSync(dbPath, dbBackup, 'utf8');
  console.log("\nOriginal db.json backup restored.");
  console.log("====================================================");
  console.log("🎉 BOARDROOM REWARD SYSTEM TESTS COMPLETED!");
  console.log("====================================================");
}

runTestRewardEngine();
