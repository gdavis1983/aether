# Aether: Algorithmic Crypto Trading System (Setup Guide)

Welcome to the user setup and installation guide for Aether, a hybrid quantitative-intelligence trading system for XRP/USDC. This guide covers how to set up the Electron desktop application, access the dashboard from your phone using Tailscale, and configure Telegram bot push notifications.

---

## 💻 1. Desktop Application Setup

The Aether desktop app is built using Electron, wrapping the high-performance Node.js backend and React/Vite glassmorphic frontend into a clean standalone desktop environment.

### Development Mode Setup
To run the desktop application locally for development:
1. **Clone the repository** and navigate to the project directory.
2. **Install all dependencies** across the root, backend, and frontend folders:
   ```bash
   npm run install-all
   ```
3. **Start the environment** in development mode:
   ```bash
   npm run dev
   ```
   *This starts the Express API server (port 5000), runs the Vite frontend compiler (port 5173), and launches the Electron wrapper automatically with DevTools opened.*
4. Alternatively, you can run the backend and Electron manually:
   * Term 1 (Start server): `npm run server`
   * Term 2 (Launch Electron wrapper): `npm run electron`

### Packaging & Distribution (Building the Standalone App)
To compile a standalone executable installer (`.exe` for Windows, `.dmg` for macOS):
1. **Build the production frontend assets** and package the Electron shell using the bundler script:
   ```cmd
   npm run dist
   ```
2. Once the build completes, find the packaged installer in the newly created `dist/` directory (e.g., `dist/Aether-Trading-Bot-Setup-1.0.0.exe`).
3. Run the installer to add Aether to your applications. The desktop app will automatically spin up the database and backend server internally on boot and terminate them when you exit.

---

## 📱 2. Putting Aether on Your Phone (via Tailscale)

Since Aether has been optimized with a touch-responsive mobile layout, expanded chat window, and zero horizontal scrollbars, you can easily monitor your trades and chat with Aether from your phone using **Tailscale**—a secure, private, zero-config VPN.

### Step-by-Step Mobile Configuration:
1. **Install Tailscale on Your Host Computer:**
   * Download and install **Tailscale** on the computer running your Aether bot (from [tailscale.com](https://tailscale.com)).
   * Open the Tailscale app and log into your Tailscale account.
2. **Install Tailscale on Your Phone:**
   * Download the official **Tailscale** app from the iOS App Store or Google Play Store.
   * Log into the **exact same account** you used on your computer.
3. **Connect Your Devices:**
   * Turn Tailscale **ON** on both your computer and your phone. They are now linked in a secure, private encrypted mesh network.
4. **Get Your Computer's Tailscale IP Address:**
   * Open the Tailscale app on your phone or check the Tailscale client on your computer.
   * Copy your computer's Tailscale IP address (it will look like `100.x.y.z`, e.g., `100.115.22.45`).
5. **Load the Dashboard on Your Phone:**
   * Open Safari, Chrome, or any mobile browser on your phone.
   * Navigate to: `http://[Your-Computer-Tailscale-IP]:5000` (e.g., `http://100.115.22.45:5000`).
   * **Result:** You will see the beautiful, dark-mode glassmorphic dashboard on your phone. You can chat with Aether, change safety stop settings, and check current metrics from anywhere!

---

## 🔔 3. Setting Up Telegram Push Notifications

Aether sends real-time, compact 4-sentence push notifications directly to your phone when she executes a trade, triggers a safety stop, or fills a conditional order.

### Step-by-Step Telegram Setup:
1. **Create Your Telegram Bot:**
   * Open Telegram and search for the user **@BotFather** (the official bot-creation utility).
   * Send the command: `/newbot`
   * Type a friendly name for your bot (e.g., `My Aether Bot`).
   * Type a unique username for your bot ending in `bot` (e.g., `aether_trading_123_bot`).
   * BotFather will reply with a success message containing your **HTTP API Token** (e.g., `8942044134:AAG-m8xkUcJvZpCpq99OHBiKLudvNKF7TeQ`). Copy this token.
2. **Find Your Telegram Chat ID:**
   * Search for **@userinfobot** or **@chatIDrobot** on Telegram.
   * Send a message to it (e.g., say "hello").
   * It will instantly reply with your numerical **Chat ID** (e.g., `7188342202`). Copy this ID.
3. **Activate Your Bot:**
   * Search for your new bot's username in Telegram.
   * Click **Start** (or send `/start`) to initiate the conversation. *This step is required so the bot has permission to message you.*
4. **Link Your Bot in the Dashboard:**
   * Open Aether (on desktop or phone).
   * Navigate to the **Settings** tab.
   * Change **Notification Type** to **Telegram**.
   * Paste your **Telegram Bot Token** and **Telegram Chat ID** into the respective input fields.
   * Click **Save Settings** at the bottom.
5. **Verify Your Setup:**
   * Click the **Test Alert** button in the dashboard.
   * Check your Telegram chat—you should receive a message confirming the connection is successful!

## 💬 4. Setting Up Discord Webhook Alerts (Optional)

Aether can also post live trade signals directly to a Discord channel using a **webhook**. This is ideal for sharing signals with friends on a community server. Discord alerts fire **independently** of your Telegram/SMS setting — you can have both active simultaneously.

### Step-by-Step Discord Setup:
1. **Create a Discord Webhook:**
   * Open your Discord server and navigate to the channel where you want signals posted (e.g., `#aether-live-signals`).
   * Click the **gear icon** (Edit Channel) → **Integrations** → **Webhooks** → **New Webhook**.
   * Give it a name (e.g., `Aether Bot`) and optionally upload the Aether logo as the avatar.
   * Click **Copy Webhook URL**. It will look like: `https://discord.com/api/webhooks/123456789/abcDEF...`
2. **Paste the URL in Aether:**
   * Open Aether and go to the **Settings** tab.
   * Scroll to the **Discord Webhook URL** field (below the notification type selector).
   * Paste the webhook URL and click **Save Settings**.
3. **Verify Your Setup:**
   * Click the **Test Connection** button in the dashboard.
   * Check your Discord channel — you should see a rich embed message from Aether Bot!
