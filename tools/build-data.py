#!/usr/bin/env python3
"""Build public/data/songs.json for Ending Credits.

1. AniList: the most popular anime, with sequel/prequel links so seasons share one franchise.
2. AnisongDB: every opening and ending of those anime (song, artist, AMQ difficulty).
3. iTunes Search: an official 30 s Apple Music preview for each song (US store first, JP fallback).

Every network answer is cached in tools/cache/, so reruns only fetch what is new.
Usage: python3 tools/build-data.py [--anime 900] [--itunes-max 4000]
"""
import json, os, re, sys, time, unicodedata, urllib.request, urllib.parse, argparse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, 'tools', 'cache')
OUT = os.path.join(ROOT, 'public', 'data', 'songs.json')
os.makedirs(CACHE, exist_ok=True)
UA = 'EndingCredits-data/1.0'


def http(url, body=None, tries=6):
    data = json.dumps(body).encode() if body is not None else None
    for i in range(tries):
        req = urllib.request.Request(url, data=data, headers={'Content-Type': 'application/json', 'Accept': 'application/json', 'User-Agent': UA})
        try:
            with urllib.request.urlopen(req, timeout=40) as r:
                return json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            wait = 65 if e.code in (403, 429) else 5 * (i + 1)
            print(f'  http {e.code} on {url[:70]}... waiting {wait}s', flush=True)
            time.sleep(wait)
        except Exception as e:
            print(f'  {type(e).__name__} on {url[:70]}... retry', flush=True)
            time.sleep(5 * (i + 1))
    raise SystemExit(f'gave up on {url}')


def load(name, default):
    p = os.path.join(CACHE, name)
    return json.load(open(p)) if os.path.exists(p) else default


def save(name, obj):
    p = os.path.join(CACHE, name)
    json.dump(obj, open(p + '.tmp', 'w'), ensure_ascii=False)
    os.replace(p + '.tmp', p)


# ---------- 1. AniList ----------
ANI_Q = '''query($page:Int){Page(page:$page,perPage:50){media(type:ANIME,sort:POPULARITY_DESC,isAdult:false){
 id idMal format seasonYear popularity genres
 title{romaji english native} synonyms
 coverImage{large color}
 studios(isMain:true){nodes{name}}
 relations{edges{relationType node{id type}}}
}}}'''


def anilist(n):
    pages = load('anilist.json', {})
    for page in range(1, (n + 49) // 50 + 1):
        if str(page) in pages:
            continue
        d = http('https://graphql.anilist.co', {'query': ANI_Q, 'variables': {'page': page}})
        pages[str(page)] = d['data']['Page']['media']
        save('anilist.json', pages)
        print(f'anilist page {page}', flush=True)
        time.sleep(2.2)
    out = []
    for page in sorted(pages, key=int):
        out += pages[page]
    return [m for m in out[:n] if m.get('idMal')]


# ---------- 2. AnisongDB ----------
def anisongs(mal_ids):
    cache = load('anisongdb.json', {})
    todo = [i for i in mal_ids if str(i) not in cache]
    for k in range(0, len(todo), 200):
        chunk = todo[k:k + 200]
        rows = http('https://anisongdb.com/api/mal_ids_request', {'mal_ids': chunk})
        for i in chunk:
            cache.setdefault(str(i), [])
        for r in rows:
            mal = (r.get('linked_ids') or {}).get('myanimelist')
            if mal is not None and str(mal) in cache:
                cache[str(mal)].append({k2: r.get(k2) for k2 in ('annSongId', 'songType', 'songName', 'songArtist', 'songDifficulty', 'isDub', 'isRebroadcast', 'songCategory', 'animeENName', 'animeJPName')})
        save('anisongdb.json', cache)
        print(f'anisongdb {k + len(chunk)}/{len(todo)}', flush=True)
        time.sleep(1.5)
    return cache


# ---------- 3. iTunes ----------
def norm(s):
    s = unicodedata.normalize('NFKC', s or '').lower()
    s = re.sub(r'[\(\[（【].*?[\)\]）】]', ' ', s)
    s = re.sub(r'\s+-\s+.*$', ' ', s)            # "Gurenge - From THE FIRST TAKE"
    return re.sub(r'[^0-9a-z぀-ヿ一-鿿]+', '', s)


BAD = re.compile(r'instrumental|off ?vocal|karaoke|remix|first take|acoustic|live|cover|inst\.|カラオケ|オフボーカル|english ver|piano', re.I)


def artist_ok(want, got):
    a, b = norm(want), norm(got)
    if not a or not b:
        return False
    if a in b or b in a:
        return True
    # "Aimer & Lisa" style credits: any listed artist matching is enough
    parts = [norm(p) for p in re.split(r'[,&×x/]| feat\.? | and | with ', want, flags=re.I) if len(norm(p)) >= 3]
    return any(p in b for p in parts)


def itunes_pick(song, artist, results, store):
    want = norm(song)
    best = None
    for r in results:
        if not r.get('previewUrl') or r.get('kind') != 'song':
            continue
        name = r.get('trackName', '')
        if BAD.search(name) or BAD.search(r.get('collectionName', '') or '') and 'live' in (r.get('collectionName') or '').lower():
            continue
        if not artist_ok(artist, r.get('artistName', '')):
            continue
        got = norm(name)
        score = 0
        if got == want:
            score = 3
        elif want and got and (got.startswith(want) or want.startswith(got)):
            score = 2
        elif store == 'JP' and not re.search('[a-z]', got):
            score = 1                             # kanji title; iTunes matched our romaji query to it
        if 'tv' in name.lower() and score:
            score += 0.5                          # TV size = the version that actually aired
        if score and (not best or score > best[0]):
            best = (score, r)
    return best[1] if best else None


def itunes(songs, limit):
    cache = load('itunes.json', {})
    todo = [s for s in songs if s['key'] not in cache][:limit]
    print(f'itunes: {len(todo)} to look up ({len(cache)} cached)', flush=True)
    for n, s in enumerate(todo):
        hit = None
        for store in ('US', 'JP'):
            term = f"{s['song']} {s['artist']}"
            url = 'https://itunes.apple.com/search?' + urllib.parse.urlencode({'term': term, 'media': 'music', 'entity': 'song', 'limit': 15, 'country': store, 'lang': 'en_us'})
            res = http(url).get('results', [])
            time.sleep(1.7)                       # Apple throttles bursts; http() backs off 65 s on 403
            r = itunes_pick(s['song'], s['artist'], res, store)
            if r:
                hit = {'p': r['previewUrl'], 'a': r.get('artworkUrl100', '').replace('100x100bb', '300x300bb'), 't': r.get('trackName'), 'u': r.get('trackViewUrl', '').split('?')[0], 's': store}
                break
        cache[s['key']] = hit
        if n % 10 == 9:
            save('itunes.json', cache)
            ok = sum(1 for v in cache.values() if v)
            print(f'itunes {n + 1}/{len(todo)}  matched so far {ok}', flush=True)
    save('itunes.json', cache)
    return cache


# ---------- franchises ----------
def franchises(anime):
    ids = {m['id'] for m in anime}
    parent = {i: i for i in ids}

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x
    link = {'PREQUEL', 'SEQUEL', 'PARENT', 'SIDE_STORY', 'ALTERNATIVE', 'SUMMARY', 'SPIN_OFF'}
    for m in anime:
        for e in (m.get('relations') or {}).get('edges', []):
            o = e['node']
            if e['relationType'] in link and o['type'] == 'ANIME' and o['id'] in ids:
                parent[find(m['id'])] = find(o['id'])
    groups = {}
    for m in anime:          # anime is popularity-sorted, so the first one seen names the franchise
        groups.setdefault(find(m['id']), []).append(m)
    return groups


def short_title(t):
    # "Attack on Titan Season 3 Part 2" -> "Attack on Titan"
    t = re.split(r'\s*[:：]\s*|\s+(?:season|part|the movie|movie|\d+(?:st|nd|rd|th) season|final season|ii+|2|3|4)\b', t, flags=re.I)[0]
    return t.strip() or t


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--anime', type=int, default=900)
    ap.add_argument('--itunes-max', type=int, default=4000)
    a = ap.parse_args()

    anime = anilist(a.anime)
    print(f'{len(anime)} anime', flush=True)
    songsdb = anisongs([m['idMal'] for m in anime])

    groups = franchises(anime)
    fran_of, fr_out = {}, []
    for gi, (root, ms) in enumerate(sorted(groups.items(), key=lambda kv: -kv[1][0]['popularity'])):
        lead = ms[0]
        name = short_title(lead['title']['english'] or lead['title']['romaji'])
        alts = set()
        for m in ms:
            for t in [m['title']['english'], m['title']['romaji'], m['title']['native']] + (m.get('synonyms') or []):
                if t:
                    alts.add(t)
                    alts.add(short_title(t))
        alts.discard(name)
        fr_out.append({'n': name, 'alt': sorted(alts, key=len)[:14], 'pop': lead['popularity']})
        for m in ms:
            fran_of[m['id']] = gi

    songs, seen = [], set()
    for rank, m in enumerate(anime):
        for r in songsdb.get(str(m['idMal']), []):
            st = r['songType'] or ''
            if not (st.startswith('Opening') or st.startswith('Ending')) or r.get('isDub') or r.get('isRebroadcast'):
                continue
            key = f"{norm(r['songName'])}|{norm(r['songArtist'])}"
            if key in seen or not norm(r['songName']):
                continue
            seen.add(key)
            songs.append({'key': key, 'rank': rank, 'm': m, 'type': st, 'song': r['songName'], 'artist': r['songArtist'], 'diff': r.get('songDifficulty') or 0})
    # Look up the likeliest-known songs first: popular shows, openings before endings, easy before hard.
    songs.sort(key=lambda s: s['rank'] * (1 if s['type'].startswith('Opening') else 1.6) - s['diff'] * 4)
    print(f'{len(songs)} candidate songs', flush=True)

    hits = itunes(songs, a.itunes_max)

    out = []
    for s in songs:
        h = hits.get(s['key'])
        if not h:
            continue
        m = s['m']
        t = m['title']
        kind, _, num = s['type'].partition(' ')
        out.append({
            'id': len(out),
            'f': fran_of[m['id']],
            'anime': t['english'] or t['romaji'],
            'romaji': t['romaji'],
            'type': 'OP' if kind == 'Opening' else 'ED',
            'n': int(num) if num.isdigit() else 1,
            'song': s['song'],
            'artist': s['artist'],
            'year': m.get('seasonYear'),
            'studio': ((m.get('studios') or {}).get('nodes') or [{}])[0].get('name', '') if (m.get('studios') or {}).get('nodes') else '',
            'cover': (m.get('coverImage') or {}).get('large', ''),
            'color': (m.get('coverImage') or {}).get('color') or '',
            'diff': round(s['diff'], 1),
            'pop': m['popularity'],
            'preview': h['p'],
            'art': h['a'],
            'apple': h['u'],
        })
    used = sorted({s['f'] for s in out})
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump({'built': time.strftime('%Y-%m-%d'), 'franchises': fr_out, 'songs': out}, open(OUT, 'w'), ensure_ascii=False, separators=(',', ':'))
    print(f'wrote {len(out)} songs from {len(used)} franchises -> {OUT}')


if __name__ == '__main__':
    main()
