#!/usr/bin/env python3
"""Build tools/cache/jpop.json: popular Japanese songs (not anime themes) with Deezer previews.

Order: a short seed list of songs famous outside Japan, then kworb's all-time Spotify Japan
totals. Non-Japanese songs and songs already in the anime set are skipped. build-data.py merges
the result into public/data/songs.json as type "JP". Previews are served through the Worker's
/api/preview/<deezer id>, because Deezer preview links expire after ~15 minutes.
Usage: python3 tools/build-jpop.py [--count 400]
"""
import importlib.util, os, re, time, urllib.parse, urllib.request, argparse, html

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('bd', os.path.join(HERE, 'build-data.py'))
bd = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bd)
norm, http, load, save = bd.norm, bd.http, bd.load, bd.save

# Famous outside Japan (TikTok, city pop, global charts) but low or missing on the Japan list.
SEED = [
    ('ponytailmama', 'Supermarket Love'), ('Mariya Takeuchi', 'Plastic Love'), ('Miki Matsubara', 'Mayonaka no Door'),
    ('Fujii Kaze', 'Shinunoga E-Wa'), ('Fujii Kaze', 'Kirari'), ('Fujii Kaze', 'Matsuri'), ('Fujii Kaze', 'Hana'),
    ('imase', 'NIGHT DANCER'), ('AKASAKI', 'Bunny Girl'), ('Kenshi Yonezu', 'Lemon'), ('Kenshi Yonezu', 'Uchiage Hanabi'),
    ('Kenshi Yonezu', 'Paprika'), ('Vaundy', 'Odoriko'), ('Vaundy', 'Tokyo Flash'), ('Tatsuro Yamashita', 'Christmas Eve'),
    ('Tatsuro Yamashita', 'Ride on Time'), ('Anri', 'Last Summer Whisper'), ('Taeko Ohnuki', '4:00A.M.'),
    ('Tomoko Aran', 'Midnight Pretenders'), ('Junko Yagami', 'Bay City'), ('Ado', 'Usseewa'), ('Ado', 'Show'),
    ('Yorushika', 'Itte'), ('ZUTOMAYO', 'Byoushinwo Kamu'), ('Eve', 'Tokyo Ghetto'), ('Aimyon', 'Marigold'),
    ('Hikaru Utada', 'First Love'), ('Hikaru Utada', 'Automatic'), ('Kyu Sakamoto', 'Sukiyaki'), ('tuki.', 'Bansanka'),
    ('Gen Hoshino', 'Koi'), ('YOASOBI', 'Yoru ni Kakeru'),
]
JP_CHARS = re.compile('[぀-ヿ一-鿿]')


def kworb():
    p = os.path.join(bd.CACHE, 'kworb_jp.html')
    if not os.path.exists(p):
        req = urllib.request.Request('https://kworb.net/spotify/country/jp_daily_totals.html', headers={'User-Agent': bd.UA})
        open(p, 'wb').write(urllib.request.urlopen(req, timeout=60).read())
    out = []
    for row in re.findall(r'<tr>(.*?)</tr>', open(p, encoding='utf-8').read(), re.S):
        a = re.findall(r'<a [^>]*>(.*?)</a>', row)
        if len(a) >= 2:
            out.append((html.unescape(a[0]), html.unescape(a[1])))
    return out


def anime_titles():
    return {norm(r['songName']) for rows in load('anisongdb.json', {}).values() for r in rows}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--count', type=int, default=400)
    ap.add_argument('--offline', action='store_true', help='use only cached lookups (for a quick partial deploy)')
    a = ap.parse_args()
    cache = load('jpop-deezer.json', {})
    taken = anime_titles()
    chart = kworb()
    # Japanese artists = anyone with a Japanese-script title on the chart, plus the seed list.
    jp_artists = {norm(ar) for ar, t in chart if JP_CHARS.search(t)} | {norm(ar) for ar, _ in SEED}
    picked, seen, ids = [], set(), set()
    print(f'{len(chart)} chart rows', flush=True)
    for artist, title in SEED + chart:
        if len(picked) >= a.count:
            break
        if norm(artist) not in jp_artists:
            continue                                   # western / K-pop songs on the Japan chart
        base = re.sub(r'\s+[-–]\s+.*$|\s*[(（].*?[)）]\s*$', '', title).strip() or title
        k = f'{norm(base)}|{norm(artist)}'
        if k in seen or norm(base) in taken:
            continue
        seen.add(k)
        if k not in cache and a.offline:
            continue
        if k not in cache:
            cache[k] = bd.deezer(base, artist)
            if cache[k]:
                t = http(f"https://api.deezer.com/track/{cache[k]['dz']}")
                time.sleep(0.25)
                cache[k]['y'] = int((t.get('release_date') or '0')[:4]) or None
                if JP_CHARS.search(base) and not JP_CHARS.search(cache[k]['t'] or ''):
                    cache[k]['native'] = base          # Deezer gave the romanized name; keep the kanji too
            if len(cache) % 25 == 0:
                save('jpop-deezer.json', cache)
                print(f'searched {len(cache)}  kept {len(picked)}', flush=True)
        r = cache[k]
        if r and r['dz'] not in ids and norm(r['t']) not in taken:
            ids.add(r['dz'])
            picked.append(r)
    if not a.offline:
        save('jpop-deezer.json', cache)

    out = []
    clean = lambda t: re.sub(r'\s+[-–]\s+.*$|\s*[(（].*?[)）]\s*$', '', t or '').strip()
    for i, p in enumerate(picked):
        names = [clean(p['t']), p.get('native') or '']
        roman = next((t for t in names if t and not JP_CHARS.search(t)), '')
        song = roman or names[0]
        if song.islower():
            song = song.title()                        # Deezer sometimes lowercases ("odoriko")
        out.append({
            'type': 'JP', 'song': song, 'alt': sorted({t for t in names if t and norm(t) != norm(song)}),
            'artist': p['ar'], 'year': p.get('y'), 'cover': p['c'],
            'diff': round(max(35, 95 - i * 0.15), 1),
            'preview': f"/api/preview/{p['dz']}", 'link': p['u'], 'src': 'deezer',
        })
    save('jpop.json', out)
    print(f'wrote {len(out)} J-pop songs -> tools/cache/jpop.json')


if __name__ == '__main__':
    main()
