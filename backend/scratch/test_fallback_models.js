const fs = require('fs');

const DB_PATH = 'c:/Users/Garre/OneDrive - Cabinet IQ/Documents/Gemini Projects/Trading/backend/db.json';

function readKey() {
  try {
    const data = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    return data.settings.geminiApiKey;
  } catch (err) {
    console.error("Error reading key from db.json:", err);
    return null;
  }
}

async function testModel(model, apiKey) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  console.log(`Testing model: ${model}...`);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [{ text: "Hello! Respond with a 1-word greeting." }]
        }]
      })
    });

    const status = res.status;
    const body = await res.text();
    console.log(`  -> Status for ${model}: ${status}`);
    if (status === 200) {
      try {
        const json = JSON.parse(body);
        console.log(`  -> Response: ${json.candidates[0].content.parts[0].text.trim()}`);
        return true;
      } catch (e) {
        console.log(`  -> Response text: ${body.substring(0, 100)}`);
        return false;
      }
    } else {
      console.log(`  -> Error Response: ${body.substring(0, 200)}`);
      return false;
    }
  } catch (err) {
    console.error(`  -> Request failed for ${model}:`, err.message);
    return false;
  }
}

async function run() {
  const apiKey = readKey();
  if (!apiKey) {
    console.log("No Gemini API key found.");
    return;
  }

  const modelsToTest = [
    "gemini-3.5-flash",
    "gemini-2.5-flash",
    "gemini-2.0-flash",
    "gemini-3.1-flash-lite",
    "gemini-flash-latest"
  ];

  for (const model of modelsToTest) {
    await testModel(model, apiKey);
    console.log("");
  }
}

run();
