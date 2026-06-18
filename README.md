Crypto Scanner — RSI Divergence + Market Structure
Strategy logic runs as a Netlify scheduled function, writes results to Supabase, and a static dashboard reads from Supabase. No server to manage.
Files in this repo
Code
1. Upload to GitHub
GitHub's web "Add file -> Create new file" lets you type a full path (e.g. netlify/functions/lib/core.js) and it creates the folders automatically — this is the easiest way to do it from a phone.
For each file above: create new file with that exact path, paste the contents, commit. Repeat for all files including the ones inside netlify/functions/ and public/.
2. Connect the repo to Netlify
In your Netlify site (crypto-scanner-rakib) -> Site configuration -> Build & deploy -> Link repository, pick this GitHub repo. Build settings should auto-detect from netlify.toml:
Publish directory: public
Functions directory: netlify/functions
3. Environment variables (Site configuration -> Environment variables)
Key
Value
SUPABASE_URL
already set for you
SUPABASE_SERVICE_ROLE_KEY
you need to add this — Supabase dashboard -> Project Settings -> API -> "service_role" secret key. Paste it to me and I'll add it for you as a secret, or add it yourself in Netlify. Never put this key in the GitHub repo.
The anon key used by the dashboard is already safely embedded in public/config.js — it can only read data, never write, because of Supabase Row Level Security.
4. Deploy
Once the repo is linked and the service role key is set, trigger a deploy. The scheduled function starts running every 15 minutes automatically. You can also hit "Scan now" on the dashboard any time.
Notes / things to watch
Binance's public API sometimes blocks requests from US-based server IPs (HTTP 451). Netlify functions usually run from US regions. After your first deploy, hit "Scan now" — if it errors, tell me and I'll switch the function to use one of Binance's alternate API hosts as a workaround.
The watchlist is the top 30 USDT pairs by 24h volume on Binance, refreshed every scan — not a fixed list.
Strategy timeframes used: Weekly + Daily for trend/divergence/RSI, 4H for candlestick confirmation.
Scoring follows your rubric (Trend 20 / RSI 20 / Divergence 25 / S-R 20 / Candle 15) with partial credit for partial alignment — documented inline in core.js.
