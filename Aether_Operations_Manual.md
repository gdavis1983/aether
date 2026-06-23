# Aether Operations Manual: Algorithmic Crypto Trading System

Welcome to the **Aether Algorithmic Operations Manual**. This document is a live-updating, comprehensive reference guide for the architecture, risk controls, indicator calculations, and prompt logic governing the Aether Trading Bot.

---

## Chapter 1: System Genesis & Architecture

The Aether bot is designed as a hybrid quantitative-intelligence trading system. Rather than relying solely on rigid math formulas (which fail in unpredictable markets) or raw AI (which is prone to hallucinations and lacks risk awareness), Aether separates these concerns:

1. **The quantitative engine** calculates price movements, support levels, and indicator values locally.
2. **The cognitive engine (Gemini LLM)** interprets these signals under a strict risk management framework to issue execution commands.

### Component Map
* **Frontend Dashboard (`frontend/src/App.jsx`)**: A glassmorphic React dashboard displaying active positions, indicators, system logs, active risk safeguards, and configuration settings.
* **Server Orchestrator (`backend/server.js`)**: The coordinator. Manages the execution timer (hourly polling loop), synchronizes the SQLite/JSON local database (`db.json`), interacts with Coinbase Advanced Trade via CCXT, and handles remote Telegram commands.
* **Indicator Math (`backend/indicators.js`)**: A library that converts raw OHLCV candlestick data into mathematical signals (RSI, MACD, SMAs, Fib levels, and ATR).
* **AI Brain (`backend/brain.js`)**: Packages the quantitative indicators, recent news, and performance journals into a structured prompt, calling the Gemini API fallback stack with strict JSON schema outputs.

---

## Chapter 2: The Analytical Core (Elliott Wave & Indicators)

Aether trades based on **Elliott Wave Theory** combined with trend indicators:

* **Awesome Oscillator (AO)**: Compares 5-period and 34-period SMAs of mid-prices. A peak in AO identifies Wave 3 momentum. Divergence between price highs and AO peaks identifies a Wave 5 climax.
* **Fibonacci Retracement levels**: Scans the last 50 candles to identify local High and Low ranges. The key levels guide entry and exit points:
  * **38.2% Retracement**: Standard support for Wave 4 consolidations.
  * **61.8% Retracement**: Typical support for Wave 2 corrections.
* **SMA (Simple Moving Averages)**: A 9 SMA and 21 SMA cross serves as short-term momentum confirmation.
* **RSI & MACD**: Traditional trend and momentum strength measures.

---

## Chapter 3: Risk Safeguards & Execution Limits

Capital preservation is Aether's highest priority. The following guardrails are hardcoded on the server and execute *before* the AI is even queried:

1. **Trailing Stop-Loss**: Tracks the highest price reached during a trade. If the price falls below this peak by the trailing percentage (e.g. 11%), the server executes an immediate market sell.
2. **Hard Stop-Loss**: An absolute floor set at a percentage (e.g. 10%) below the entry price.
3. **ATR Volatility Stop**: Computes a dynamic safety buffer based on average true range (e.g. Entry - (Multiplier × ATR)).
4. **Take-Profit Target**: A hard cap to lock in profits at a specified target (e.g. 30%).
5. **Exchange Size Controls**: Automatically rounds and scales trade sizes to satisfy Coinbase's $5.00 minimum order sizes and auto-liquidates positions if dust falls below $2.00.

---

## Chapter 4: Active Engineering Plan & Upgrades

We are currently implementing a suite of zero-cost analytical updates to enhance the bot's logical decisions:

### A. Relative Volume (RVol)
Compares current trading volume against a 20-period moving average:
$$\text{RVol} = \frac{\text{Current Volume}}{\text{Average Volume (20 SMA)}}$$
* **RVol > 1.5**: High volume confirming momentum (essential for buying Wave 3 impulses).
* **RVol < 0.75**: Quiet range. AI is instructed to stay defensive.

### B. ADX (Average Directional Index) Regimes
Quantifies trend strength on a 0-100 scale to categorize market state:
* `TRENDING_BULLISH` (ADX > 25, +DI > -DI, Price > 21 SMA)
* `TRENDING_BEARISH` (ADX > 25, -DI > +DI, Price < 21 SMA)
* `CHOPPY_RANGE` (ADX < 20)
* `HIGH_VOLATILITY_SQUEEZE` (ADX rising, RVol spike)

### C. Performance Memory Journal
Injects the last 3 completed trades (including net returns, dates, and the reasoning the AI wrote for entering/exiting) into the prompt context. This enables the bot to reflect on past performance and adapt.

### D. Regime-Based Sizing & Chain-of-Thought
Capping trade allocations in choppy ranges (maximum 30% size) while scaling up to 100% in verified trending environments. Forcing the AI to document its logic step-by-step prior to returning action signals.

---

## Chapter 5: System Changelog

* **v1.0.0 (Launch)**: Basic Express/React architecture. CCXT spot trading loop on Coinbase.
* **v1.1.0 (Quantitative Controls)**: Added ATR stops, Trailing Stops, Take Profits, and two-way Telegram remote controls.
* **v1.2.0 (Completed)**: Implemented ADX market regimes, RVol volume confirmation, Trade Memory Journaling, Telegram notification formatting, and this live-updating system manual.
* **v1.3.0 (Completed)**: Added running weighted average cost-basis math, 75% maximum position allocation cap, default-enabled Trailing and ATR Stops, and Smart Token Bypass pre-screening.
* **v1.0.4 (Active)**: Upgraded to Unboxed Boardroom autonomy, multi-desk wargaming, sandbox self-assembly, performance-calibrated voting weights, and integrated the auto-updater UI and running version indicator in the sidebar.

---

## Chapter 6: Obsidian Vault & Cognitive Boardroom Setup

Aether uses **Obsidian** to store debates, run wargaming simulations, test hypotheses, and learn from past trades. To configure this integration:

### Step 1: Create a Local Obsidian Vault
1. Create a new empty folder on your computer where you want your trading knowledge base to live (e.g., `C:\Users\YourName\Documents\Aether_Brain_Vault`).
2. Download and install **Obsidian** (from [obsidian.md](https://obsidian.md)).
3. Open Obsidian, click **Open folder as vault**, and select the folder you just created.

### Step 2: Link the Vault in Aether's Dashboard
1. Open the Aether desktop application.
2. Navigate to the **Settings** tab.
3. Scroll to the **Obsidian Vault Path** field and paste the absolute path to your vault folder (e.g., `C:\Users\YourName\Documents\Aether_Brain_Vault`).
4. Enter your **Gemini API Key** (and other LLM provider keys) under the API Key sections to power the boardroom desks.
5. Click **Save Settings** at the bottom.

### Step 3: Verify Automated Folder Initialization
Once saved, Aether will automatically initialize the following directories in your vault:
* `/Beliefs` — Contains `Strategy-Era-Active.md` (edit this file in Obsidian to write your custom rules in plain English; Aether will sync and enforce them on every cycle!).
* `/Wargames` — Records the sequentially compiled 8-desk wargaming simulation debates.
* `/Debates` — Records the high-frequency Trader vs. Critic consensus logs.
* `/States` — Holds hourly snapshots of indicator conditions.
* `/Trades` — Contains post-mortem takeaway lessons and results of closed positions.
* `/Backtests` — Contains weekly parameters and code mutation reports from the Genetic Sizing Sandbox.
* `/Hypotheses` — Contains proposed quantitative trading theories currently being backtested.
