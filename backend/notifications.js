const nodemailer = require('nodemailer');

const CARRIER_DOMAINS = {
  att: 'txt.att.net',
  tmobile: 'tmomail.net',
  verizon: 'vtext.com',
  sprint: 'messaging.sprintpcs.com',
  boost: 'myboostmobile.com',
  cricket: 'sms.cricketwireless.net'
};

/**
 * Send a notification to Telegram Bot Channel
 */
async function sendTelegramAlert(token, chatId, message) {
  if (!token || !chatId) {
    throw new Error("Missing Telegram Bot Token or Chat ID.");
  }
  
  let cleanToken = String(token).trim();
  let cleanChatId = String(chatId).trim();

  // If user prepended 'bot' to the token, strip it
  if (cleanToken.toLowerCase().startsWith('bot')) {
    cleanToken = cleanToken.substring(3);
  }

  // Regex validate Telegram bot token format (e.g. 12345678:ABCdef...)
  if (!/^\d+:[A-Za-z0-9_-]+$/.test(cleanToken)) {
    const displayToken = cleanToken.length > 8 
      ? `${cleanToken.substring(0, 4)}...${cleanToken.substring(cleanToken.length - 4)}` 
      : cleanToken;
    throw new Error(`Invalid Telegram Bot Token format. It must look like '123456789:ABCdef...'. Current parsed value: '${displayToken}' (length ${cleanToken.length}). Check if your browser autofilled a saved password instead!`);
  }

  const url = `https://api.telegram.org/bot${cleanToken}/sendMessage`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: cleanChatId,
      text: message,
      parse_mode: 'HTML'
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Telegram API Error: ${errText}`);
  }
  
  return await response.json();
}

/**
 * Send a notification to SMS Carrier Gateway
 */
async function sendSMSAlert(smtpConfig, phoneNumber, carrier, message) {
  if (!phoneNumber || !carrier) {
    throw new Error("Missing phone number or carrier.");
  }
  if (!smtpConfig || !smtpConfig.host || !smtpConfig.user || !smtpConfig.pass) {
    throw new Error("SMTP server is not configured in settings. Cannot send SMS email-to-text.");
  }

  const domain = CARRIER_DOMAINS[carrier.toLowerCase()];
  if (!domain) {
    throw new Error(`Unsupported SMS carrier: ${carrier}`);
  }

  const cleanPhone = phoneNumber.replace(/\D/g, ''); // strip non-digits
  if (cleanPhone.length !== 10) {
    throw new Error("Phone number must be exactly 10 digits (US).");
  }

  const recipientEmail = `${cleanPhone}@${domain}`;

  const transporter = nodemailer.createTransport({
    host: smtpConfig.host,
    port: Number(smtpConfig.port) || 465,
    secure: smtpConfig.port == 465, // true for 465, false for other ports
    auth: {
      user: smtpConfig.user,
      pass: smtpConfig.pass
    }
  });

  const mailOptions = {
    from: smtpConfig.fromName ? `"${smtpConfig.fromName}" <${smtpConfig.user}>` : smtpConfig.user,
    to: recipientEmail,
    subject: '', // SMS gateways do not need a subject
    text: message
  };

  return await transporter.sendMail(mailOptions);
}

module.exports = {
  sendTelegramAlert,
  sendSMSAlert
};
