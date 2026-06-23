const fs = require('fs');
const path = require('path');
const vm = require('vm');

/**
 * Prompts Gemini to write a self-contained Node.js custom tool script
 * that exports name, description, parameters, and execute(args) function.
 * Saves it to backend/scratch/[toolName].js and runs a sandbox dry-run.
 */
async function assembleAndVerifyTool(apiKey, requirement, settings, logCallback, telegramSender) {
  const provider = settings.activeLlmProvider || "gemini";
  const model = "gemini-2.5-flash"; // Flash is perfect for assembling tool code blocks

  if (logCallback) logCallback(`Self-Assembly: Generating tool for requirement: "${requirement}"...`, "info");

  const systemInstruction = `You are Aether's Tool Assembly Engine. You write self-contained Node.js modules for custom data scrapers or external APIs.
The module MUST export:
- name: string (alphanumeric camelCase)
- description: string
- parameters: JSON schema object for function arguments (or { type: "object", properties: {} } if none needed)
- execute(args): async function that performs the task and returns a string or JSON.

You must write clean, sandboxed JavaScript using node-fetch or global fetch. Do not use require statements except for core node modules like path, fs, url, crypto.
Respond ONLY with the raw JavaScript module code inside standard code blocks (or raw js).`;

  const promptText = `
Generate a tool for: "${requirement}"
The tool code must use global fetch to query the API. For example, if fetching Fear & Greed Index, use: 'https://api.alternative.me/fng/'
If fetching Coinbase Premium index, calculate it using public order book spreads or coinbase/binance tickers.

The script MUST follow this exact structure:
\`\`\`javascript
const crypto = require('crypto'); // optional

module.exports = {
  name: "toolName",
  description: "Detailed explanation of what the tool does...",
  parameters: {
    type: "object",
    properties: {
      // define parameters if any
    }
  },
  execute: async function(args) {
    try {
      const response = await fetch('url');
      const data = await response.json();
      return { success: true, data };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }
};
\`\`\`
`;

  try {
    const { queryModel } = require('./brain');
    let generatedCode = await queryModel(provider, model, apiKey, systemInstruction, promptText, null, settings);
    
    // Clean code block
    generatedCode = generatedCode.trim().replace(/^```javascript\s*/, '').replace(/^```\s*/, '').replace(/```$/, '');

    // Parse name from code
    const nameMatch = generatedCode.match(/name:\s*["']([^"']+)["']/);
    const toolName = nameMatch ? nameMatch[1] : `customTool_${Date.now()}`;
    const filename = `${toolName}.js`;

    // Ensure scratch directory exists
    const scratchDir = path.join(__dirname, 'scratch');
    if (!fs.existsSync(scratchDir)) {
      fs.mkdirSync(scratchDir, { recursive: true });
    }

    const tempPath = path.join(scratchDir, filename);
    fs.writeFileSync(tempPath, generatedCode, 'utf8');
    if (logCallback) logCallback(`Assembled temp tool code saved to backend/scratch/${filename}`, "info");

    // DRY-RUN SANDBOX VERIFICATION
    if (logCallback) logCallback("Self-Assembly: Verifying temp tool execution inside sandbox...", "info");
    
    const sandbox = {
      module: { exports: {} },
      exports: {},
      console: { log: () => {}, error: () => {} },
      fetch: global.fetch || fetch,
      setTimeout,
      clearTimeout,
      Promise,
      Buffer,
      JSON,
      Math,
      Date,
      URL,
      URLSearchParams
    };

    const context = vm.createContext(sandbox);
    const script = new vm.Script(generatedCode);
    script.runInContext(context, { timeout: 3000 });

    const tool = sandbox.module.exports;
    if (!tool || typeof tool.execute !== 'function') {
      throw new Error("Script does not export a valid execute function.");
    }

    // Call execute with mock args
    const result = await tool.execute({});
    if (logCallback) logCallback(`Verification Success! Sample Output: ${JSON.stringify(result).substring(0, 150)}...`, "info");

    // Trigger Telegram / Discord Alert to user asking for approval
    const approveMsg = `🛠️ <b>AETHER TOOL PROPOSAL ASSEMBLED</b>\n\n` +
      `• Tool Name: <b>${toolName}</b>\n` +
      `• Description: <i>${tool.description}</i>\n` +
      `• Status: <b>Verification Passed ✅</b>\n\n` +
      `Do you approve integrating this tool into my active quantitative brain?\n` +
      `Reply with command:\n` +
      `<code>/approve_tool ${filename}</code>`;

    if (telegramSender && typeof telegramSender === 'function') {
      await telegramSender(approveMsg);
    }

    return { success: true, filename, tempPath };

  } catch (err) {
    if (logCallback) logCallback(`Tool self-assembly verification failed: ${err.message}`, "error");
    return { success: false, error: err.message };
  }
}

/**
 * Handles user approval command: moves tool from scratch/ to tools/ and enables it in db.json.
 */
async function approveTool(filename, db, sendResp) {
  const scratchPath = path.join(__dirname, 'scratch', filename);
  const toolsDir = path.join(__dirname, 'tools');
  const targetPath = path.join(toolsDir, filename);

  if (!fs.existsSync(scratchPath)) {
    if (sendResp) await sendResp(`❌ <b>Error:</b> Temporary tool script <code>${filename}</code> does not exist in scratch.`);
    return { success: false };
  }

  if (!fs.existsSync(toolsDir)) {
    fs.mkdirSync(toolsDir, { recursive: true });
  }

  // Move file
  fs.renameSync(scratchPath, targetPath);

  // Enable in settings
  if (!db.settings.enabledTools) db.settings.enabledTools = [];
  if (!db.settings.enabledTools.includes(filename)) {
    db.settings.enabledTools.push(filename);
    const dbPath = path.join(__dirname, 'db.json');
    fs.writeFileSync(dbPath, JSON.stringify(db, null, 2), 'utf8');
  }

  if (sendResp) {
    await sendResp(`✅ <b>Tool successfully approved and enabled!</b>\n` +
      `Tool script <code>${filename}</code> is now active. I am integrating it into my next market tick analysis.`);
  }

  return { success: true };
}

module.exports = {
  assembleAndVerifyTool,
  approveTool
};
