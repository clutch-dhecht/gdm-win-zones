"""Startup data seeder — ensures imported datasets exist in MongoDB.

Seeds three layers on app startup if missing:
  - Beck's Dealers (point layer, city+state centroid)
  - Wyffels Reps (point layer, street-level via Mapbox geocoder, falls back to city+state)
  - Number of Dairy Cows (county density, 7 head-count bands)
"""
import os
import re
import time
import logging
import asyncio
from pathlib import Path

import pandas as pd
import httpx

logger = logging.getLogger(__name__)

SEED_DIR = Path(__file__).parent / 'seed_data'

ABBREV_TO_STATE = {
    'AL': 'Alabama', 'AK': 'Alaska', 'AZ': 'Arizona', 'AR': 'Arkansas',
    'CA': 'California', 'CO': 'Colorado', 'CT': 'Connecticut', 'DE': 'Delaware',
    'FL': 'Florida', 'GA': 'Georgia', 'HI': 'Hawaii', 'ID': 'Idaho',
    'IL': 'Illinois', 'IN': 'Indiana', 'IA': 'Iowa', 'KS': 'Kansas',
    'KY': 'Kentucky', 'LA': 'Louisiana', 'ME': 'Maine', 'MD': 'Maryland',
    'MA': 'Massachusetts', 'MI': 'Michigan', 'MN': 'Minnesota', 'MS': 'Mississippi',
    'MO': 'Missouri', 'MT': 'Montana', 'NE': 'Nebraska', 'NV': 'Nevada',
    'NH': 'New Hampshire', 'NJ': 'New Jersey', 'NM': 'New Mexico', 'NY': 'New York',
    'NC': 'North Carolina', 'ND': 'North Dakota', 'OH': 'Ohio', 'OK': 'Oklahoma',
    'OR': 'Oregon', 'PA': 'Pennsylvania', 'RI': 'Rhode Island', 'SC': 'South Carolina',
    'SD': 'South Dakota', 'TN': 'Tennessee', 'TX': 'Texas', 'UT': 'Utah',
    'VT': 'Vermont', 'VA': 'Virginia', 'WA': 'Washington', 'WV': 'West Virginia',
    'WI': 'Wisconsin', 'WY': 'Wyoming', 'PR': 'Puerto Rico',
}

# Map of "INVENTORY OF MILK COWS: (X TO Y HEAD)" -> display layer name
DAIRY_BANDS = {
    'INVENTORY OF MILK COWS: (1 TO 9 HEAD)': '1-9 Dairy Cows',
    'INVENTORY OF MILK COWS: (10 TO 19 HEAD)': '10-19 Dairy Cows',
    'INVENTORY OF MILK COWS: (20 TO 49 HEAD)': '20-49 Dairy Cows',
    'INVENTORY OF MILK COWS: (50 TO 99 HEAD)': '50-99 Dairy Cows',
    'INVENTORY OF MILK COWS: (100 TO 199 HEAD)': '100-199 Dairy Cows',
    'INVENTORY OF MILK COWS: (200 TO 499 HEAD)': '200-499 Dairy Cows',
    'INVENTORY OF MILK COWS: (500 OR MORE HEAD)': '500 or more Dairy Cows',
}

US_CITIES_DF = None


def _load_cities():
    global US_CITIES_DF
    if US_CITIES_DF is None:
        csv_path = Path(__file__).parent / 'us_cities_coordinates.csv'
        US_CITIES_DF = pd.read_csv(csv_path)
        US_CITIES_DF['CITY_UPPER'] = US_CITIES_DF['CITY'].str.upper()
        US_CITIES_DF['STATE_UPPER'] = US_CITIES_DF['STATE_NAME'].str.upper()
    return US_CITIES_DF


_geocode_cache = {}


def _geocode_city(city, state_full):
    """City+state centroid lookup against bundled US cities CSV."""
    df = _load_cities()
    city_clean = re.sub(r'^(elevator|port|terminal)\s+', '', city, flags=re.IGNORECASE).strip()
    cache_key = f"{city_clean.upper()},{state_full.upper()}"
    if cache_key in _geocode_cache:
        return _geocode_cache[cache_key]
    city_upper = city_clean.upper().strip()
    state_upper = state_full.upper().strip()
    matches = df[(df['CITY_UPPER'] == city_upper) & (df['STATE_UPPER'] == state_upper)]
    if matches.empty:
        alt = city_upper.replace('ST.', 'SAINT').replace('ST ', 'SAINT ')
        matches = df[(df['CITY_UPPER'] == alt) & (df['STATE_UPPER'] == state_upper)]
    if matches.empty:
        matches = df[df['CITY_UPPER'] == city_upper]
    if matches.empty:
        _geocode_cache[cache_key] = None
        return None
    row = matches.iloc[0]
    coords = {'lat': float(row['LATITUDE']), 'lon': float(row['LONGITUDE'])}
    _geocode_cache[cache_key] = coords
    return coords


def _to_state_full(raw):
    raw = str(raw).strip()
    return ABBREV_TO_STATE.get(raw.upper(), raw) if len(raw) == 2 else raw


def _mapbox_geocode(query, token):
    """Synchronous Mapbox forward-geocode. Returns {'lat','lon'} or None."""
    import urllib.parse
    try:
        encoded = urllib.parse.quote(query)
        url = f"https://api.mapbox.com/geocoding/v5/mapbox.places/{encoded}.json"
        resp = httpx.get(url, params={'access_token': token, 'country': 'us', 'limit': 1, 'types': 'address,postcode,place'}, timeout=10.0)
        if resp.status_code != 200:
            return None
        feats = resp.json().get('features') or []
        if not feats:
            return None
        lon, lat = feats[0]['center']
        return {'lat': float(lat), 'lon': float(lon)}
    except Exception as e:
        logger.warning(f"Mapbox geocode failed for '{query}': {e}")
        return None


async def seed_all(db):
    """Run all seed checks. Each importer is idempotent: skips when its layer already exists."""
    try:
        existing_point_layers = set(await db.location_points.distinct('layer'))
        logger.info(f"Existing point layers: {existing_point_layers}")

        await _seed_becks(db, existing_point_layers)
        await _seed_wyffels(db, existing_point_layers)
        await _seed_dairy_cows(db)

        logger.info("Seed check complete")
    except Exception as e:
        logger.error(f"Seed error: {e}")


async def _seed_becks(db, existing_set):
    layer = "Beck's Dealers"
    if layer in existing_set:
        count = await db.location_points.count_documents({'layer': layer})
        if count >= 500:
            return
    csv_path = SEED_DIR / 'BecksDealers.csv'
    if not csv_path.exists():
        logger.warning(f"Beck's seed file missing: {csv_path}")
        return
    logger.info("Seeding Beck's Dealers...")
    df = pd.read_csv(csv_path, encoding='utf-8-sig')
    points = []
    skipped = 0
    for _, row in df.iterrows():
        dealer = str(row.get('Dealer Name', '')).strip()
        contact = str(row.get('Contact / Seed Advisor', '')).strip()
        city = str(row.get('City', '')).strip() if pd.notna(row.get('City')) else ''
        county = str(row.get('County', '')).strip() if pd.notna(row.get('County')) else ''
        state_raw = str(row.get('State', '')).strip() if pd.notna(row.get('State')) else ''
        zip_code = str(row.get('Zip', '')).strip() if pd.notna(row.get('Zip')) else ''
        if not city or not state_raw:
            skipped += 1
            continue
        state_full = _to_state_full(state_raw)
        geo = _geocode_city(city, state_full)
        if not geo:
            skipped += 1
            continue
        points.append({
            'name': dealer,
            'contact': contact,
            'layer': layer,
            'city': city.title(),
            'county': county.title(),
            'state': state_full,
            'zip': zip_code,
            'lat': geo['lat'],
            'lon': geo['lon'],
        })
    await db.location_points.delete_many({'layer': layer})
    if points:
        await db.location_points.insert_many(points)
    logger.info(f"Seeded {len(points)} Beck's Dealers ({skipped} skipped)")


async def _seed_wyffels(db, existing_set):
    layer = 'Wyffels Reps'
    if layer in existing_set:
        count = await db.location_points.count_documents({'layer': layer})
        if count >= 50:
            return
    csv_path = SEED_DIR / 'WyffelsReps.csv'
    if not csv_path.exists():
        logger.warning(f"Wyffels seed file missing: {csv_path}")
        return
    mapbox_token = os.environ.get('MAPBOX_TOKEN') or os.environ.get('REACT_APP_MAPBOX_TOKEN')
    if not mapbox_token:
        logger.warning("MAPBOX_TOKEN not set — Wyffels will fall back to city+state centroid for all rows")
    logger.info("Seeding Wyffels Reps...")
    df = pd.read_csv(csv_path, encoding='utf-8-sig')
    points = []
    skipped = 0
    for _, row in df.iterrows():
        name = str(row.get('Name', '')).strip()
        street = str(row.get('Street', '')).strip() if pd.notna(row.get('Street')) else ''
        city = str(row.get('City', '')).strip() if pd.notna(row.get('City')) else ''
        state_raw = str(row.get('State', '')).strip() if pd.notna(row.get('State')) else ''
        zip_code = str(row.get('Zip', '')).strip() if pd.notna(row.get('Zip')) else ''
        if not city or not state_raw:
            skipped += 1
            continue
        state_full = _to_state_full(state_raw)
        geo = None
        if mapbox_token and street:
            query = f"{street}, {city}, {state_raw} {zip_code}".strip().rstrip(',')
            geo = _mapbox_geocode(query, mapbox_token)
            time.sleep(0.05)
        if not geo:
            geo = _geocode_city(city, state_full)
        if not geo:
            skipped += 1
            continue
        points.append({
            'name': name,
            'layer': layer,
            'street': street,
            'city': city.title(),
            'state': state_full,
            'zip': zip_code,
            'lat': geo['lat'],
            'lon': geo['lon'],
        })
    await db.location_points.delete_many({'layer': layer})
    if points:
        await db.location_points.insert_many(points)
    logger.info(f"Seeded {len(points)} Wyffels Reps ({skipped} skipped)")


async def _seed_dairy_cows(db):
    """Pivot DairyCowsUSDA.csv into 7 layers under density_data."""
    target_layers = set(DAIRY_BANDS.values())
    # Skip if all 7 dairy layers already exist with data
    existing = await db.density_data.aggregate([
        {'$project': {'layers': {'$objectToArray': '$layers'}}},
        {'$unwind': '$layers'},
        {'$group': {'_id': '$layers.k'}},
    ]).to_list(1000)
    existing_layer_names = {d['_id'] for d in existing}
    if target_layers.issubset(existing_layer_names):
        logger.info("Dairy Cows layers already present — skipping seed")
        return

    csv_path = SEED_DIR / 'DairyCowsUSDA.csv'
    if not csv_path.exists():
        logger.warning(f"Dairy seed file missing: {csv_path}")
        return
    logger.info("Seeding Number of Dairy Cows (7 county density layers)...")
    df = pd.read_csv(csv_path)
    df['State'] = df['State'].astype(str).str.strip().str.title()
    df['County'] = df['County'].astype(str).str.strip().str.upper()
    df['Domain Category'] = df['Domain Category'].astype(str).str.strip()
    df['Value'] = pd.to_numeric(df['Value'].astype(str).str.replace(',', ''), errors='coerce').fillna(0).astype(int)

    # Pivot: each (state, county) → {layer: value}
    rows_by_key = {}
    for _, row in df.iterrows():
        cat = row['Domain Category']
        layer_name = DAIRY_BANDS.get(cat)
        if not layer_name:
            continue
        key = (row['State'], row['County'])
        if key not in rows_by_key:
            rows_by_key[key] = {}
        rows_by_key[key][layer_name] = rows_by_key[key].get(layer_name, 0) + int(row['Value'])

    # Merge into existing density_data documents
    existing_docs = await db.density_data.find({}, {"_id": 0}).to_list(50000)
    lookup = {(doc['state'], doc['county']): doc for doc in existing_docs}
    for (state, county), bands in rows_by_key.items():
        if (state, county) in lookup:
            lookup[(state, county)]['layers'].update(bands)
        else:
            lookup[(state, county)] = {'state': state, 'county': county, 'layers': bands}

    merged = list(lookup.values())
    await db.density_data.delete_many({})
    if merged:
        await db.density_data.insert_many(merged)
    logger.info(f"Seeded Dairy Cows into {len(rows_by_key)} counties (total density rows: {len(merged)})")
