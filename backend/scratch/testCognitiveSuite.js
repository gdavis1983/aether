const fs = require('fs');
const path = require('path');
const { runWargamingSimulation } = require('../wargame');
const { runHypothesisTester } = require('../jobs/hypothesisTester');
const { mutateAndBacktestSizing } = require('../sizingSandbox');
const { assembleAndVerifyTool } = require('../selfAssembly');

async function runTestCognitiveSuite() {
  console.log("====================================================");
  console.log("🚀 STARTING AETHER COGNITIVE SUITE TEST SUITE");
  console.log("====================================================\n");

  // Read settings from db.json
  const dbPath = path.join(__dirname, '..', 'db.json');
  if (!fs.existsSync(dbPath)) {
    console.error("Error: db.json not found inside backend/.");
    return;
  }
  const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
  const settings = db.settings;
  const apiKey = settings.geminiApiKey || process.env.GEMINI_API_KEY;

  if (!apiKey) {
    console.error("Error: Gemini API Key not configured in db.json or environment.");
    return;
  }

  // Create temporary mock marketData and portfolio for testing
  const mockMarketData = {
    ticker: { close: 1.15 },
    recentCandles: [
      { time: Date.now() - 24000, open: 1.14, high: 1.16, low: 1.13, close: 1.15, volume: 1000 },
      { time: Date.now() - 20000, open: 1.15, high: 1.17, low: 1.14, close: 1.16, volume: 1500 },
      { time: Date.now() - 16000, open: 1.16, high: 1.18, low: 1.15, close: 1.15, volume: 800 },
      { time: Date.now() - 12000, open: 1.15, high: 1.16, low: 1.14, close: 1.14, volume: 1200 },
      { time: Date.now() - 8000, open: 1.14, high: 1.15, low: 1.13, close: 1.15, volume: 900 }
    ],
    indicators: {
      rsi: [45, 48, 52, 47, 50],
      ao: [0.01, 0.02, 0.015, -0.005, 0.01],
      currentADX: 22,
      currentPlusDI: 21,
      currentMinusDI: 19,
      currentRVol: 1.2,
      marketRegime: "TRANSITIONING_ZONE"
    }
  };

  const mockPortfolio = {
    balanceUSD: 5000,
    positions: {
      XRP: { amount: 100, avgEntryPrice: 1.12 }
    }
  };

  // Test 1: Multi-Desk Wargaming Simulation
  console.log("----------------------------------------------------");
  console.log("♟️ TEST 1: Running Multi-Desk Wargaming Simulation...");
  console.log("----------------------------------------------------");
  try {
    const wargameResult = await runWargamingSimulation(
      apiKey,
      mockMarketData,
      mockPortfolio,
      settings,
      (msg) => console.log(`[WARGAME TEST] ${msg}`)
    );
    console.log("✅ Wargaming Debate Result: SUCCESS");
    console.log(`- Wave Desk proposed: ${wargameResult.waveDesk.proposed_action} (Conf: ${wargameResult.waveDesk.confidence})`);
    console.log(`- Projected Scenarios: ${wargameResult.scenarios.map(s => `${s.scenario} (${s.probability_pct}%)`).join(', ')}`);
  } catch (err) {
    console.error("❌ Test 1 (Wargaming) Failed:", err.message);
  }

  // Test 2: Epistemic Hypothesis Testing
  console.log("\n----------------------------------------------------");
  console.log("🧠 TEST 2: Running Hypothesis Tester Evaluation...");
  console.log("----------------------------------------------------");
  try {
    // Generate a temporary hypothesis note to test
    const tempHypoContent = `---
id: 99
description: "In a TRANSITIONING_ZONE regime, RSI < 55 results in a win"
status: Proposed
credibility_score: Low
win_rate: 0.0
sample_size: 0
p_value: 1.0
last_evaluated: null
---
# Hypothesis 99: Test Hypothesis

## Logical Predicate
\`\`\`json
{
  "id": 99,
  "description": "In a TRANSITIONING_ZONE regime, RSI < 55 results in a win",
  "regime": "TRANSITIONING_ZONE",
  "conditions": [
    { "indicator": "rsi", "operator": "lt", "value": 55 }
  ],
  "outcome_target": "win"
}
\`\`\`
`;
    const hypothesesDir = path.join(settings.obsidianVaultPath, 'Hypotheses');
    if (!fs.existsSync(hypothesesDir)) {
      fs.mkdirSync(hypothesesDir, { recursive: true });
    }
    const tempHypoPath = path.join(hypothesesDir, 'Hypothesis_099.md');
    fs.writeFileSync(tempHypoPath, tempHypoContent, 'utf8');
    console.log("Created temporary hypothesis Hypothesis_099.md");

    await runHypothesisTester(settings, (msg) => console.log(`[HYPO TESTER] ${msg}`));
    
    // Read note and verify it updated
    const updatedContent = fs.readFileSync(tempHypoPath, 'utf8');
    console.log("Updated Frontmatter of Hypothesis_099.md:");
    console.log(updatedContent.split('---')[1].trim());

    // Clean up
    fs.unlinkSync(tempHypoPath);
    console.log("✅ Hypothesis Tester: SUCCESS");
  } catch (err) {
    console.error("❌ Test 2 (Hypothesis Tester) Failed:", err.message);
  }

  // Test 3: Sizing Sandbox Optimization (Mutation Loop)
  console.log("\n----------------------------------------------------");
  console.log("🧬 TEST 3: Running Sizing Sandbox Mutation Loop...");
  console.log("----------------------------------------------------");
  try {
    const updatedFormula = await mutateAndBacktestSizing(
      apiKey,
      settings,
      (msg) => console.log(`[SIZING SANDBOX] ${msg}`)
    );
    console.log("✅ Sizing Sandbox: SUCCESS");
    console.log("Optimized sizing formula sample:");
    console.log(updatedFormula.split('\n').slice(0, 5).join('\n') + "\n...");
  } catch (err) {
    console.error("❌ Test 3 (Sizing Sandbox) Failed:", err.message);
  }

  // Test 4: Tool Self-Assembly Verification
  console.log("\n----------------------------------------------------");
  console.log("🛠️ TEST 4: Running Tool Self-Assembly...");
  console.log("----------------------------------------------------");
  try {
    const mockTelegramSender = async (msg) => {
      console.log("[MOCK TELEGRAM ALERT]");
      console.log(msg.replace(/<[^>]*>/g, '')); // print plain text
    };
    
    const selfAssemblyRes = await assembleAndVerifyTool(
      apiKey,
      "Fetch the current Crypto Fear and Greed Index from alternative.me API",
      settings,
      (msg) => console.log(`[SELF-ASSEMBLY] ${msg}`),
      mockTelegramSender
    );

    if (selfAssemblyRes.success) {
      console.log("✅ Self-Assembly: SUCCESS");
      console.log(`- Created tool script: backend/scratch/${selfAssemblyRes.filename}`);
      
      // Clean up temp scratch file
      fs.unlinkSync(selfAssemblyRes.tempPath);
    } else {
      throw new Error(selfAssemblyRes.error);
    }
  } catch (err) {
    console.error("❌ Test 4 (Self-Assembly) Failed:", err.message);
  }

  console.log("\n====================================================");
  console.log("🎉 ALL COGNITIVE SUITE TESTS COMPLETED!");
  console.log("====================================================");
}

runTestCognitiveSuite();
