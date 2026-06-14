const fs = require('fs');
const ccxt = require('ccxt');

const DB_PATH = 'c:/Users/Garre/OneDrive - Cabinet IQ/Documents/Gemini Projects/Trading/backend/db.json';

function readDB() {
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
}

// Clean up Coinbase CDP API Key formatting
function cleanCDPApiKey(key) {
  if (!key) return key;
  let clean = String(key).trim();
  
  if (clean.includes('organizations/')) {
    const startIdx = clean.indexOf('organizations/');
    const afterStart = clean.substring(startIdx);
    const nextQuote = afterStart.indexOf('"');
    const nextSingleQuote = afterStart.indexOf("'");
    
    let resolvedNextQuote = -1;
    if (nextQuote !== -1 && nextSingleQuote !== -1) {
      resolvedNextQuote = Math.min(nextQuote, nextSingleQuote);
    } else if (nextQuote !== -1) {
      resolvedNextQuote = nextQuote;
    } else if (nextSingleQuote !== -1) {
      resolvedNextQuote = nextSingleQuote;
    }
    
    if (resolvedNextQuote !== -1) {
      clean = afterStart.substring(0, resolvedNextQuote);
    } else {
      clean = afterStart;
    }
  }

  if (clean.startsWith('"') && clean.endsWith('"')) {
    clean = clean.substring(1, clean.length - 1);
  }
  if (clean.startsWith("'") && clean.endsWith("'")) {
    clean = clean.substring(1, clean.length - 1);
  }
  
  return clean.trim();
}

// Clean up Coinbase CDP Private Key PEM string formatting
function cleanCDPSecret(secret) {
  if (!secret) return secret;
  let clean = String(secret).trim();
  
  if (clean.includes('-----BEGIN EC PRIVATE KEY-----')) {
    const startIdx = clean.indexOf('-----BEGIN');
    const endIdx = clean.indexOf('-----END PRIVATE KEY-----');
    const endIdxAlt = clean.indexOf('-----END EC PRIVATE KEY-----');
    
    let resolvedEndIdx = -1;
    let pemLength = 0;
    
    if (endIdxAlt !== -1) {
      resolvedEndIdx = endIdxAlt;
      pemLength = '-----END EC PRIVATE KEY-----'.length;
    } else if (endIdx !== -1) {
      resolvedEndIdx = endIdx;
      pemLength = '-----END PRIVATE KEY-----'.length;
    }
    
    if (startIdx !== -1 && resolvedEndIdx !== -1) {
      clean = clean.substring(startIdx, resolvedEndIdx + pemLength);
    }
  }

  // Replace literal '\n' sequences with real newlines
  clean = clean.replace(/\\n/g, '\n');
  
  if (clean.startsWith('"') && clean.endsWith('"')) {
    clean = clean.substring(1, clean.length - 1);
  }
  if (clean.startsWith("'") && clean.endsWith("'")) {
    clean = clean.substring(1, clean.length - 1);
  }
  
  return clean.trim();
}

async function run() {
  const db = readDB();
  const settings = db.settings;

  console.log("Exchange API Key:", settings.exchangeApiKey);
  console.log("Exchange Secret Length:", settings.exchangeApiSecret ? settings.exchangeApiSecret.length : 0);

  const cleanKey = cleanCDPApiKey(settings.exchangeApiKey);
  const cleanSecret = cleanCDPSecret(settings.exchangeApiSecret);

  console.log("\n--- Cleaned Values ---");
  console.log("Clean Key:", cleanKey);
  console.log("Clean Secret:\n" + cleanSecret);

  console.log("\nAttempting to connect to Coinbase via CCXT...");
  const exchange = new ccxt.coinbase({
    apiKey: cleanKey,
    secret: cleanSecret
  });

  try {
    await exchange.loadMarkets();
    console.log("Markets loaded successfully!");
    
    console.log("Fetching balance...");
    const balance = await exchange.fetchBalance();
    console.log("Balance fetched successfully!");
    console.log("Free balance:", JSON.stringify(balance.free, null, 2));
  } catch (err) {
    console.error("Coinbase connection/balance check failed:", err);
  }
}

run();
