# Aether Agent Workspace Rules & Architecture

Welcome to the Aether developer workspace! This guide is written for AI coding assistants (like Antigravity or Claude Code) to help you understand the codebase architecture and developer workflows quickly.

## 🏛️ Application Architecture

Aether is an Electron + React application with a local Node.js Express backend.

- **Root Directory**: Contains Electron configuration (`main.js`, `preload.js`) and repository scripts.
- **`backend/`**: Node.js Express server running the bot execution engine.
  - `backend/server.js`: The main Express server and API endpoints.
  - `backend/brain.js`: The bot's decision engine and trade analysis loop.
  - `backend/indicators.js`: Technical analysis calculations.
  - `backend/notifications.js`: Email and Telegram alert dispatches.
- **`frontend/`**: Vite + React dashboard UI.
  - `frontend/src/App.jsx`: Main React component containing chart rendering, tabs, and logs.
  - `frontend/src/index.css`: Style layout rules.

## 💾 Local Database & Settings

Aether stores settings, trade history, logs, and strategies in a local `db.json` database.
- **Active Path**: Resolved via the environment variable `$env:AETHER_USER_DATA_PATH`.
- **Default Path**: `C:\Users\<User>\AppData\Roaming\ai-crypto-trading-bot\db.json`.
- **Rule**: When editing strategies, rules, or database values, make sure to read and write to the active AppData path, not the repository's `backend/db.json` copy.

## 🛠️ Common Developer Commands

Use the following commands from the root directory to run or build the application:

1. **Install all dependencies**:
   ```powershell
   npm run install-all
   ```
2. **Start the development environment**:
   ```powershell
   npm run dev
   ```
3. **Run the local Electron window**:
   ```powershell
   npm run electron
   ```
4. **Compile the production installer**:
   ```powershell
   npm run dist
   ```
5. **Package user/developer releases**:
   ```powershell
   powershell -ExecutionPolicy Bypass -File C:\Users\Garre\.gemini\antigravity\brain\217872cf-dcb9-4534-ba5e-0fff2053243d\scratch\zip_aether.ps1
   ```

Keep all code modular, clean, and document any changes you make in `walkthrough.md`.
