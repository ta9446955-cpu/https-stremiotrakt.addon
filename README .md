# 🐍 Snakeeyes Trakt Addon

A Stremio addon that connects to your Trakt account and displays your watch history, watchlist, ratings, and collection as catalogs in Stremio.

## Install

1. Go to the addon page:
   ```
   https://https-stremiotrakt-addon.onrender.com
   ```
2. Click **"Connect Trakt Account"**
3. Go to **trakt.tv/activate** and enter the code shown
4. Copy your personal manifest URL and paste it into Stremio's addon install field

## What's Included

- Trakt History (Movies & Series)
- Trakt Watchlist (Movies & Series)
- Trakt Ratings (Movies & Series)
- Trakt Collection (Movies & Series)

## Notes

- Your session is stored in memory — if the server restarts you'll need to reconnect your Trakt account
- This addon reads your Trakt data without counting as a Trakt device, so it won't affect your Kodi or other Trakt connections

## Tech Stack

- Node.js / Express
- Hosted on Render.com (free tier)
- Trakt OAuth2 Device Auth flow
