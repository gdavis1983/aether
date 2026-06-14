const fs = require('fs');
const path = require('path');

async function sendLogsToTelegram() {
  // 1. Read settings to get Telegram bot credentials
  const dbPath = path.join(__dirname, 'db.json');
  if (!fs.existsSync(dbPath)) {
    console.error("Database file (db.json) not found in backend!");
    return;
  }

  const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
  const token = db.settings?.telegramBotToken;
  const chatId = db.settings?.telegramChatId;

  if (!token || !chatId) {
    console.error("Error: Telegram credentials (bot token or chat ID) are not configured in settings!");
    return;
  }

  // 2. Identify the active conversation transcript file path
  // Using absolute path matching your conversation directory
  const transcriptPath = "C:\\Users\\Garre\\.gemini\\antigravity\\brain\\f2f57afa-f23a-407e-a712-5ce7f75b012a\\.system_generated\\logs\\transcript.jsonl";

  if (!fs.existsSync(transcriptPath)) {
    console.error(`Error: Transcript file not found at: ${transcriptPath}`);
    return;
  }

  console.log("Analyzing transcript log...");
  const rawContent = fs.readFileSync(transcriptPath, 'utf8');
  const lines = rawContent.split('\n');

  let readableText = "==================================================\n";
  readableText += "      AETHER EW BOT: CONVERSATION HISTORY\n";
  readableText += `      Exported: ${new Date().toLocaleString()}\n`;
  readableText += "==================================================\n\n";

  let totalMessages = 0;

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      const time = entry.created_at ? new Date(entry.created_at).toLocaleString() : "Unknown Time";
      
      if (entry.type === 'USER_INPUT') {
        let cleanContent = entry.content || "";
        // Strip XML tags if present
        cleanContent = cleanContent.replace(/<USER_REQUEST>|<\/USER_REQUEST>/g, '').trim();
        cleanContent = cleanContent.replace(/<ADDITIONAL_METADATA>[\s\S]*?<\/ADDITIONAL_METADATA>/g, '').trim();
        
        readableText += `[USER - ${time}]:\n${cleanContent}\n`;
        readableText += "--------------------------------------------------\n\n";
        totalMessages++;
      } else if (entry.type === 'PLANNER_RESPONSE' && entry.content) {
        readableText += `[BOT - ${time}]:\n${entry.content}\n`;
        readableText += "--------------------------------------------------\n\n";
        totalMessages++;
      }
    } catch (e) {
      // Skip malformed lines
    }
  }

  console.log(`Parsed ${totalMessages} conversation messages successfully.`);

  // Write temporary files in the backend folder to upload
  const txtExportPath = path.join(__dirname, 'conversation_history.txt');
  fs.writeFileSync(txtExportPath, readableText, 'utf8');

  try {
    // 3. Upload the human-readable text file to Telegram
    console.log("Uploading readable conversation transcript to Telegram...");
    const formData = new FormData();
    formData.append('chat_id', chatId);
    
    const txtBuffer = fs.readFileSync(txtExportPath);
    const txtBlob = new Blob([txtBuffer], { type: 'text/plain' });
    formData.append('document', txtBlob, 'conversation_history.txt');

    const url = `https://api.telegram.org/bot${token}/sendDocument`;
    const res = await fetch(url, {
      method: 'POST',
      body: formData
    });

    if (res.ok) {
      const resJson = await res.json();
      console.log("Success! Readable log file has been pushed to Telegram.");
    } else {
      const errText = await res.text();
      console.error("Failed to upload readable logs to Telegram:", errText);
    }
  } catch (err) {
    console.error("Error communicating with Telegram API:", err.message);
  } finally {
    // Cleanup temporary file
    if (fs.existsSync(txtExportPath)) {
      fs.unlinkSync(txtExportPath);
    }
  }
}

sendLogsToTelegram();
