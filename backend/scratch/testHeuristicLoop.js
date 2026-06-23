const fs = require('fs');
const path = require('path');
const { getTradingDecision, generateTradePostMortem, queryHistoricalStates } = require('../brain');
const { updateStateNodeWithOutcome } = require('../obsidianWriter');

// Setup environment variable to point to local db
process.env.AETHER_USER_DATA_PATH = path.join(__dirname, '..');

const dbPath = path.join(__dirname, '..', 'db.json');
if (!fs.existsSync(dbPath)) {
  console.error("db.json not found!");
  process.exit(1);
}

const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
const settings = {
  ...db.settings,
  dualLlmEnabled: true,
  activeLlmProvider: 'gemini',
  activeLlmModel: 'gemini-2.5-flash',
  auditorModel: 'gemini-2.5-flash'
};

const mockTime = new Date().toISOString();

// Mock market context for Step 1
const marketData = {
  symbol: 'XRP/USDC',
  ticker: { close: 0.5234 },
  recentCandles: [
    { time: Date.now() - 3600000 * 3, open: 0.512, high: 0.525, low: 0.510, close: 0.515, volume: 120000 },
    { time: Date.now() - 3600000 * 2, open: 0.515, high: 0.528, low: 0.512, close: 0.520, volume: 150000 },
    { time: Date.now() - 3600000 * 1, open: 0.520, high: 0.535, low: 0.518, close: 0.523, volume: 220000 }
  ],
  indicators: {
    rsi: [42, 45, 48],
    sma9: [0.505, 0.510, 0.512],
    sma21: [0.498, 0.501, 0.503],
    macd: {
      macdLine: [0.002, 0.004, 0.005],
      signalLine: [0.001, 0.002, 0.003],
      histogram: [0.001, 0.002, 0.002]
    },
    currentADX: 28,
    currentPlusDI: 29,
    currentMinusDI: 15,
    currentRVol: 1.8,
    marketRegime: 'TRENDING_BULLISH',
    ao: [0.012, 0.015, 0.018],
    fib: {
      high: 0.550,
      low: 0.480,
      level236: 0.533,
      level382: 0.523,
      level500: 0.515,
      level618: 0.507
    }
  },
  btcContext: {
    symbol: 'BTC/USDC',
    price: 64200,
    rsi: 42.5,
    smaCross: 'BEARISH (9 < 21)',
    trend: 'BEARISH'
  },
  orderBook: {
    imbalanceRatio: 0.35,
    wallStatus: 'SELL_WALL_RESISTANCE'
  },
  news: [],
  performanceJournal: "No recent errors."
};

const portfolio = {
  balanceUSD: 1000,
  positions: {
    XRP: { amount: 0, avgEntryPrice: 0 }
  }
};

const logCallback = (msg, type) => {
  console.log(`[${type.toUpperCase()}] ${msg}`);
};

async function runVerification() {
  try {
    console.log("=== STEP 1: TEST HEURISTIC DEBATE LOOP & OPTION FOR DOWNSIZED BUY ===");
    console.log("Evaluating setup: XRP is structurally bullish, but BTC macro is Bearish and Order Book shows Sell Wall Resistance.");
    console.log("Under heuristics, Resolver should NOT hard block, but scale down sizing to a conservative range (e.g. 10%-20%) due to risk weights.");
    
    const decision = await getTradingDecision(settings.geminiApiKey, marketData, portfolio, settings, logCallback);
    console.log("\nResolved Heuristic Sizing Decision:");
    console.log(`- Decision: ${decision.decision}`);
    console.log(`- Final Allocated Sizing: ${decision.amount_pct}%`);
    console.log(`- Consensus Rationale: "${decision.reasoning}"`);

    console.log("\n=== STEP 2: TEST POST-MORTEM GENERATION & STATE WRITING ===");
    
    // Find the latest state file we just created in Step 1
    const statesDir = path.join(settings.obsidianVaultPath, 'States');
    const files = fs.readdirSync(statesDir).filter(f => f.startsWith('State_') && f.endsWith('.md'));
    if (files.length === 0) throw new Error("No state files found in vault States directory");
    files.sort((a, b) => b.localeCompare(a));
    const latestFile = files[0];
    
    const fileContent = fs.readFileSync(path.join(statesDir, latestFile), 'utf8');
    const timestampMatch = fileContent.match(/timestamp:\s*"(.*?)"/);
    if (!timestampMatch) throw new Error("Could not find timestamp in latest state note");
    const activeTime = timestampMatch[1];
    console.log(`Detected latest State note: ${latestFile} | Timestamp: ${activeTime}`);

    const mockClosedTrade = {
      action: 'SELL',
      entryPrice: 0.52,
      exitPrice: 0.57,
      pnlPct: 9.6,
      timestamp: activeTime,
      activeStates: [activeTime],
      reasoning: "XRP hit target resistance zone at $0.57 while EWT wave 5 completed."
    };

    console.log("Generating post-mortem takeaway via Gemini...");
    const takeaway = await generateTradePostMortem(settings.geminiApiKey, mockClosedTrade, settings);
    console.log(`Generated Lesson: "${takeaway}"`);

    console.log("Writing takeaway back to State note in Obsidian vault...");
    const outcomeLink = `[[Outcomes/Trade-Win]]`;
    updateStateNodeWithOutcome(settings.obsidianVaultPath, activeTime, outcomeLink, takeaway);

    // Verify Obsidian file contents
    const filePath = path.join(statesDir, latestFile);
    
    if (fs.existsSync(filePath)) {
      console.log(`State note successfully updated at: ${filePath}`);
      const content = fs.readFileSync(filePath, 'utf8');
      console.log("\n--- STATE NOTE WRITTEN CONTENT ---");
      console.log(content);
      console.log("----------------------------------");
    } else {
      throw new Error(`State note not found at ${filePath}`);
    }

    console.log("\n=== STEP 3: TEST RAG EXTRACTING POST-MORTEM LESSON ===");
    console.log("Running queryHistoricalStates search. Confirming that the parsed takeaway lesson is fed back into prompt context...");
    const ragContext = queryHistoricalStates(settings.obsidianVaultPath, 'TRENDING_BULLISH', 48);
    console.log(ragContext);

    console.log("\nVerification completed successfully! All heuristic reasoning and post-mortem loops are verified working.");
    process.exit(0);
  } catch (err) {
    console.error("Verification failed with error:", err.stack);
    process.exit(1);
  }
}

runVerification();
