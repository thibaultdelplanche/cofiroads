"""Haalt open kaartdata op voor RijExamen Gent en bewaart ze in data/.

Bronnen:
- OpenStreetMap via de Overpass API (© OpenStreetMap-bijdragers, ODbL):
  straten, gebouwen, bomen, straatlantaarns, zebrapaden en verkeerslichten.
- Digitaal Vlaanderen, orthofotomozaïek (luchtfoto's) via WMS, open data.

Gebruik: python3 tools/fetch_data.py   (draait ook automatisch via GitHub Actions)
"""
import json, math, os, time, urllib.parse, urllib.request

LAT0, LON0 = 51.0400, 3.7257                 # Overpoort = oorsprong (0, 0)
S, W, N, E = 51.0368, 3.7185, 51.0502, 3.7345  # Overpoort, Sint-Pietersplein, Sint-Pietersnieuwstraat tot de Vooruit
KX = math.cos(math.radians(LAT0)) * 111320.0
KZ = 110540.0
OUT = os.path.join(os.path.dirname(__file__), '..', 'data')
UA = {'User-Agent': 'RijExamenGent/1.0 (open data, github.com/thibaultdelplanche/cofiroads)'}
OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter',
            'https://maps.mail.ru/osm/tools/overpass/api/interpreter']


def xz(lat, lon):
    return round((lon - LON0) * KX, 1), round(-(lat - LAT0) * KZ, 1)


def latlon(x, z):
    return LAT0 - z / KZ, LON0 + x / KX


def overpass():
    bb = f'{S},{W},{N},{E}'
    q = f"""[out:json][timeout:180];
(
  way["highway"]({bb});
  way["building"]({bb});
  way["building:part"]({bb});
  node["natural"="tree"]({bb});
  node["highway"~"^(street_lamp|crossing|traffic_signals|stop|give_way)$"]({bb});
);
(._;>;);
out body;"""
    data = urllib.parse.urlencode({'data': q}).encode()
    for attempt in range(4):
        for url in OVERPASS:
            try:
                req = urllib.request.Request(url, data=data, headers=UA)
                with urllib.request.urlopen(req, timeout=200) as r:
                    return json.load(r)
            except Exception as e:  # volgende server proberen
                print('Overpass mislukt:', url, e)
        time.sleep(20)
    raise SystemExit('Geen Overpass-server bereikbaar')


DRIVE = {'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street', 'service'}
WALK = {'footway', 'pedestrian', 'cycleway', 'path', 'steps'}


def speed(t):
    v = (t.get('maxspeed') or t.get('zone:maxspeed') or '')
    d = ''.join(c for c in v if c.isdigit())
    return int(d) if d else 0


def num(v, default=0.0):
    try:
        return float(str(v).replace(',', '.').split()[0].rstrip('m'))
    except Exception:
        return default


def main():
    d = overpass()
    nodes = {e['id']: e for e in d['elements'] if e['type'] == 'node'}
    out = {'lat0': LAT0, 'lon0': LON0, 'bbox': [S, W, N, E], 'roads': [], 'walks': [], 'buildings': [],
           'trees': [], 'lamps': [], 'crossings': [], 'signals': [], 'stops': [],
           'bron': 'Kaartdata © OpenStreetMap-bijdragers (ODbL); luchtfoto © Digitaal Vlaanderen'}
    for e in d['elements']:
        t = e.get('tags', {})
        if e['type'] == 'node':
            hw = t.get('highway')
            p = list(xz(e['lat'], e['lon']))
            if t.get('natural') == 'tree':
                out['trees'] += p
            elif hw == 'street_lamp':
                out['lamps'] += p
            elif hw == 'crossing' and t.get('crossing') in ('zebra', 'marked', 'uncontrolled', 'traffic_signals', None):
                out['crossings'] += p
            elif hw == 'traffic_signals':
                out['signals'] += p
            elif hw in ('stop', 'give_way'):
                out['stops'].append(p + [hw])
            continue
        if e['type'] != 'way':
            continue
        pts = [xz(nodes[i]['lat'], nodes[i]['lon']) for i in e['nodes'] if i in nodes]
        if len(pts) < 2:
            continue
        flat = [c for p in pts for c in p]
        hw = t.get('highway')
        if hw in DRIVE and t.get('area') != 'yes':
            if t.get('access') in ('no',) or t.get('motor_vehicle') == 'no':
                continue
            if hw == 'service' and t.get('service') in ('parking_aisle', 'driveway'):
                continue
            priv = 1 if (t.get('vehicle') == 'private' or t.get('motor_vehicle') == 'private' or t.get('access') == 'private') else 0
            oneway = 1 if (t.get('oneway') == 'yes' or t.get('junction') == 'roundabout') else (-1 if t.get('oneway') == '-1' else 0)
            out['roads'].append([hw, t.get('name', ''), speed(t), oneway, t.get('lanes', ''), num(t.get('width'), 0), priv, flat])
        elif hw in WALK:
            out['walks'].append([hw, flat])
        elif 'building' in t or 'building:part' in t:
            if pts[0] != pts[-1] or len(pts) < 4:
                continue
            levels = num(t.get('building:levels'), 0)
            h = num(t.get('height'), 0) or (levels * 3.1 + 1.2 if levels else 0)
            minh = num(t.get('min_height'), 0) or num(t.get('building:min_level'), 0) * 3.1
            kind = t.get('building') or t.get('building:part') or 'yes'
            info = {k: t[k] for k in ('name', 'amenity', 'shop', 'building:material', 'building:colour', 'roof:shape', 'roof:colour', 'addr:street', 'addr:housenumber') if k in t}
            out['buildings'].append([round(h, 1), round(minh, 1), int(levels), kind, info, flat[:-2]])
    os.makedirs(os.path.join(OUT, 'ortho'), exist_ok=True)

    # luchtfoto-tegels van 128 m, 1024 px (12,5 cm per pixel)
    T, PX = 128, 1024
    x0, z0 = xz(N, W)
    x1, z1 = xz(S, E)
    tiles = []
    for ix in range(math.floor(x0 / T), math.ceil(x1 / T)):
        for iz in range(math.floor(z0 / T), math.ceil(z1 / T)):
            tx, tz = ix * T, iz * T
            la1, lo1 = latlon(tx, tz + T)   # zuidwest
            la2, lo2 = latlon(tx + T, tz)   # noordoost
            name = f'{ix}_{iz}.jpg'
            path = os.path.join(OUT, 'ortho', name)
            if not os.path.exists(path):
                q = urllib.parse.urlencode({'SERVICE': 'WMS', 'VERSION': '1.3.0', 'REQUEST': 'GetMap', 'LAYERS': 'Ortho', 'STYLES': '',
                                            'CRS': 'EPSG:4326', 'BBOX': f'{la1},{lo1},{la2},{lo2}', 'WIDTH': PX, 'HEIGHT': PX, 'FORMAT': 'image/jpeg'})
                for attempt in range(3):
                    try:
                        req = urllib.request.Request('https://geo.api.vlaanderen.be/OMWRGBMRVL/wms?' + q, headers=UA)
                        with urllib.request.urlopen(req, timeout=60) as r:
                            img = r.read()
                        if img[:2] == b'\xff\xd8':
                            open(path, 'wb').write(img)
                            break
                    except Exception as e:
                        print('Luchtfoto mislukt:', name, e)
                        time.sleep(3)
            if os.path.exists(path):
                tiles.append([tx, tz, name])
    out['ortho'] = {'tile': T, 'tiles': tiles}
    with open(os.path.join(OUT, 'gent.json'), 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
    print(f"wegen {len(out['roads'])}, gebouwen {len(out['buildings'])}, bomen {len(out['trees']) // 2}, "
          f"lantaarns {len(out['lamps']) // 2}, zebrapaden {len(out['crossings']) // 2}, luchtfoto-tegels {len(tiles)}")


if __name__ == '__main__':
    main()
