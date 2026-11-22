# Ending Credits

Guess the anime opening or ending from a one-second clip. Every wrong guess or skip unlocks more of it (1s, 2s, 4s, 7s, 11s, 16s). Naming the anime (any season) or the song both count.

**Play:** https://endingcredits.rennko.tech

- **Daily:** one song a day, the same for everyone, with shareable squares and streak stats.
- **Endless:** three lives. Songs get harder as you go. Filter by openings or endings and by era.
- **Rooms:** up to 8 friends hear the same clip at once. Faster right answers score more.

Clips are official 30-second Apple Music and Deezer previews (Deezer links expire, so the Worker looks one up per play at `/api/preview/ID`). J-pop songs come from kworb's all-time Spotify Japan chart plus a seed list. After each round the reveal rolls the credits (anime, song, artist, studio, year) and can pull up the YouTube video.

## How it works

- `tools/build-data.py` builds `public/data/songs.json`:
  - AniList provides the most popular anime and their sequel links, so seasons share one franchise answer.
  - AnisongDB provides every opening and ending.
  - The iTunes Search API matches each song to its Apple preview.
  - Answers are cached in `tools/cache/`.
- `public/`: a plain-JS static app with no bundler. `match.js` and `pools.js` are shared with the Worker.
- `src/worker.js` is a Cloudflare Worker. `/api/yt` finds the video for the reveal. `/api/room/CODE/ws` connects to a `Room` Durable Object that runs the multiplayer rounds and checks guesses on the server.

## Build

```bash
./build.sh            # syntax check
./build.sh data       # rebuild the song list (slow: Apple allows ~20 searches a minute)
./build.sh dev        # http://localhost:8840
./build.sh deploy     # endingcredits.rennko.tech
```

Made by Virat Reddy Kaukuntla ([@learningnihongo934-byte](https://github.com/learningnihongo934-byte)).
