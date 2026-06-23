const fs = require('fs');
const path = require('path');
const { queryModel } = require('./brain');

/**
 * Proposes a new market hypothesis based on a completed trade.
 * Writes it as a human/machine-readable markdown note in Obsidian.
 */
async function proposeNewHypothesis(apiKey, tradeData, settings, logCallback) {
  const vaultPath = settings.obsidianVaultPath;
  if (!vaultPath) {
    if (logCallback) logCallback("Obsidian vault path not configured. Skipping hypothesis proposal.", "warning");
    return;
  }

  const hypothesesDir = path.join(vaultPath, 'Hypotheses');
  if (!fs.existsSync(hypothesesDir)) {
    fs.mkdirSync(hypothesesDir, { recursive: true });
  }

  // Find next ID
  let nextId = 1;
  const files = fs.readdirSync(hypothesesDir).filter(f => f.startsWith('Hypothesis_') && f.endsWith('.md'));
  if (files.length > 0) {
    const ids = files.map(f => {
      const match = f.match(/Hypothesis_(\d+)\.md/);
      return match ? parseInt(match[1]) : 0;
    });
    nextId = Math.max(...ids) + 1;
  }

  const idStr = String(nextId).padStart(3, '0');

  const systemInstruction = `You are Aether's Quantitative Analyst. Your job is to analyze trade post-mortems and formulate a single structured market hypothesis. Your hypothesis must test if a set of technical coordinates leads to a win or loss.
You must respond with raw Markdown containing a YAML frontmatter block and a JSON codeblock for the logical predicate.`;

  const promptText = `
=== TRADE DATA ===
${JSON.stringify(tradeData, null, 2)}

Formulate a new hypothesis based on this trade outcome. Keep the technical conditions specific and testable (e.g. ADX, RSI, Awesome Oscillator, Relative Volume, or Market Regime).

Your output MUST fit this exact markdown template:
\`\`\`markdown
---
id: ${nextId}
description: "In a [REGIME] regime, [technical conditions] results in a [win/loss]"
status: Proposed
credibility_score: Low
win_rate: 0.0
sample_size: 0
p_value: 1.0
last_evaluated: null
---
# Hypothesis ${nextId}: [Short Title]

## Logical Predicate
\\\`\\\`\\\`json
{
  "regime": "TRENDING_BULLISH" | "TRENDING_BEARISH" | "TRANSITIONING_ZONE" | "RANGEBOUND_CHOP",
  "conditions": [
    { "indicator": "rsi", "operator": "gt" | "lt", "value": number },
    { "indicator": "adx", "operator": "gt" | "lt", "value": number },
    { "indicator": "rvol", "operator": "gt" | "lt", "value": number }
  ],
  "outcome_target": "win" | "loss"
}
\\\`\\\`\\\`
\`\`\`

Note: Replace the backslashes in code fences with standard ones. Only return the raw markdown template, no extra text.
`;

  try {
    const provider = settings.activeLlmProvider || "gemini";
    const model = "gemini-2.5-flash"; // Flash is fast and perfect for this analytical templating
    
    let rawMarkdown = await queryModel(provider, model, apiKey, systemInstruction, promptText, null, settings);
    rawMarkdown = rawMarkdown.trim().replace(/^```markdown\s*/, '').replace(/```$/, '');

    const notePath = path.join(hypothesesDir, `Hypothesis_${idStr}.md`);
    fs.writeFileSync(notePath, rawMarkdown, 'utf8');

    if (logCallback) logCallback(`Proposed new hypothesis saved: Hypotheses/Hypothesis_${idStr}.md`, "info");
    return notePath;
  } catch (err) {
    console.error("Failed to propose new hypothesis:", err.message);
  }
}

/**
 * Reads all active, high/medium credibility hypotheses from the Obsidian vault.
 * Returns a formatted text block for injecting into prompt contexts.
 */
function readActiveHypotheses(vaultPath) {
  if (!vaultPath) return "";

  const hypothesesDir = path.join(vaultPath, 'Hypotheses');
  if (!fs.existsSync(hypothesesDir)) return "";

  try {
    const files = fs.readdirSync(hypothesesDir).filter(f => f.startsWith('Hypothesis_') && f.endsWith('.md'));
    let contextBlock = "";
    let count = 0;

    files.forEach(file => {
      const content = fs.readFileSync(path.join(hypothesesDir, file), 'utf8');
      
      // Parse frontmatter
      const lines = content.split('\n');
      let inFrontmatter = false;
      let fmLines = [];
      
      for (let line of lines) {
        if (line.trim() === '---') {
          if (!inFrontmatter) {
            inFrontmatter = true;
          } else {
            inFrontmatter = false;
            break;
          }
        } else if (inFrontmatter) {
          fmLines.push(line);
        }
      }

      const fm = {};
      fmLines.forEach(l => {
        const parts = l.split(':');
        if (parts.length >= 2) {
          const key = parts[0].trim();
          const val = parts.slice(1).join(':').trim().replace(/^["']|["']$/g, '');
          fm[key] = val;
        }
      });

      // Filter: only active and Medium/High credibility
      if (fm.status === 'Active' && (fm.credibility_score === 'High' || fm.credibility_score === 'Medium')) {
        count++;
        contextBlock += `- **Hypothesis #${fm.id}** (${fm.credibility_score} Credibility, Win Rate: ${fm.win_rate || 'N/A'}): "${fm.description}"\n`;
      }
    });

    if (contextBlock) {
      return `\n=== EMPIRICALLY VERIFIED TRADING HYPOTHESES ===\n` +
             `You must adhere to the following active trading theories validated by your hypothesis tester:\n` +
             contextBlock + `\n`;
    }
  } catch (err) {
    console.error("Failed to read active hypotheses:", err.message);
  }

  return "";
}

module.exports = {
  proposeNewHypothesis,
  readActiveHypotheses
};
