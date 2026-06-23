const fs = require('fs');
const path = require('path');
const { sendDiscordWebhook } = require('../notifications');

/**
 * Run the Meta-Cognitive Performance Review
 */
async function runWeeklyReview(settings) {
  const vaultPath = settings.obsidianVaultPath;
  if (!vaultPath) {
    console.log("Obsidian Vault path not configured. Skipping Weekly Review.");
    return;
  }

  const apiKey = settings.geminiApiKey || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.log("Gemini API key not found. Skipping Weekly Review.");
    return;
  }

  try {
    const tradesDir = path.join(vaultPath, 'Trades');
    if (!fs.existsSync(tradesDir)) {
      console.log("No Trades directory found in Obsidian vault. Skipping review.");
      return;
    }

    const files = fs.readdirSync(tradesDir).filter(f => f.startsWith('Trade_') && f.endsWith('.md'));
    if (files.length === 0) {
      console.log("No trade logs found in vault. Skipping review.");
      return;
    }

    const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const recentTrades = [];

    // Read trades and filter for those written in the last 7 days
    files.forEach(file => {
      const filePath = path.join(tradesDir, file);
      const stats = fs.statSync(filePath);
      if (stats.mtimeMs >= oneWeekAgo) {
        const content = fs.readFileSync(filePath, 'utf8');
        recentTrades.push(content);
      }
    });

    if (recentTrades.length === 0) {
      console.log("No trades executed in the last 7 days. Skipping review.");
      return;
    }

    console.log(`Analyzing ${recentTrades.length} trades from the past week...`);

    const activeStratPath = path.join(vaultPath, 'Beliefs', 'Strategy-Era-Active.md');
    const activeStrat = fs.existsSync(activeStratPath) ? fs.readFileSync(activeStratPath, 'utf8') : "No active strategy guide loaded.";

    const promptText = `
You are Aether's Meta-Cognitive Auditor. Your job is to perform a weekly performance audit on the Aether trading bot, examine its trading decisions, and formulate updated strategy parameters to enhance performance.

=== CURRENT ACTIVE STRATEGY ===
${activeStrat}

=== TRADE LOGS FROM THE PAST 7 DAYS ===
${recentTrades.join('\n\n--- TRADE ---\n\n')}

=== AUDIT INSTRUCTIONS ===
1. Analyze the wins and losses. Identify if we are repeating mistakes (e.g. buying Wave 4 retracements during low ADX choppy ranges, or selling Wave 3 gains too early).
2. Look at how secondary indicators (RSI, ADX, RVol, MACD) interacted with the main EWT setups in both successful and unsuccessful trades.
3. Formulate an updated "Strategy Era" markdown file. It MUST include:
   - A summary of last week's lessons.
   - Refined **Strategic Guardrails (Heuristics)** that address specific failures (e.g. limiting trade size further under specific conditions, or modifying entry triggers).
4. Do NOT output code or conversational text. Output ONLY the raw markdown of the new Strategy Era document.
`;

    // Query Gemini
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
    const payload = {
      contents: [{
        parts: [{ text: promptText }]
      }],
      systemInstruction: {
        parts: [{ text: "You are a master quantitative trading auditor. Respond only with clean markdown representing the new strategy era document." }]
      }
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Gemini Review API Error: ${errText}`);
    }

    const resJson = await response.json();
    const generatedMarkdown = resJson.candidates[0].content.parts[0].text;

    // Save proposed note to vault
    const proposedPath = path.join(vaultPath, 'Beliefs', 'Strategy-Era-Proposed.md');
    fs.writeFileSync(proposedPath, generatedMarkdown, 'utf8');
    console.log("Written proposed strategy adjustments to:", proposedPath);

    // Notify user via Discord
    if (settings.discordWebhookUrl || settings.discordDebateWebhookUrl) {
      const targetWebhook = settings.discordDebateWebhookUrl || settings.discordWebhookUrl;
      const notificationMsg = `🧠 **AETHER WEEKLY PERFORMANCE AUDIT COMPLETED**\n\n` +
        `Aether has analyzed its trades from the past 7 days and generated a new proposed strategy rules guide.\n\n` +
        `📂 **Proposed Strategy Note**: \`Beliefs/Strategy-Era-Proposed.md\`\n\n` +
        `*Please review the proposed note in your Obsidian vault. If you approve of the changes, copy its contents over to \`Strategy-Era-Active.md\` to activate the new heuristics.*`;
      
      await sendDiscordWebhook(targetWebhook, notificationMsg);
    }

    return proposedPath;
  } catch (err) {
    console.error("Weekly review job failed:", err.message);
  }
}

module.exports = {
  runWeeklyReview
};
