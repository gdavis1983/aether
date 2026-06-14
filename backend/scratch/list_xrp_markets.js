const ccxt = require('ccxt');

async function run() {
  const exchange = new ccxt.coinbase();
  try {
    await exchange.loadMarkets();
    const xrpMarkets = Object.keys(exchange.markets).filter(symbol => symbol.startsWith('XRP/'));
    console.log("=== Available XRP Markets on Coinbase ===");
    console.log(xrpMarkets);
  } catch (err) {
    console.error("Failed to load markets:", err);
  }
}

run();
