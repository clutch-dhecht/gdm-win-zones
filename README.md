# GDM Win Zones

Interactive territory map for GDM with three data layers:

- **Beck's Dealers** — point layer, geocoded by city + state centroid
- **Wyffels Reps** — point layer, street-level geocoding via Mapbox (falls back to city + state centroid if no token configured)
- **Number of Dairy Cows** — county density choropleth in 7 herd-size bands (USDA inventory). Default-on layer is **"500 or more Dairy Cows"**.

## Market presets

| Preset | Default-on layers |
|---|---|
| Dairy *(default)* | 500 or more Dairy Cows |
| Seed Dealers | Beck's Dealers, Wyffels Reps |

## Stack

- React 19 + TailwindCSS + react-map-gl (Mapbox GL JS) + Shadcn UI
- FastAPI + Pandas + Motor (MongoDB async)
- MongoDB collections: `location_points`, `density_data`

## Local development

### Backend

```bash
cd backend
cp .env.example .env   # edit MONGO_URL, MAPBOX_TOKEN
pip install -r requirements.txt
uvicorn server:app --reload --host 0.0.0.0 --port 8000
```

The first launch auto-seeds Beck's, Wyffels, and Dairy Cows from `backend/seed_data/` into MongoDB.

### Frontend

```bash
cd frontend
cp .env.example .env   # edit REACT_APP_BACKEND_URL, REACT_APP_MAPBOX_TOKEN
yarn install
yarn start
```

App opens at http://localhost:3000.

## Data sources

CSV files in `backend/seed_data/`:

- `BecksDealers.csv` — 754 dealers
- `WyffelsReps.csv` — 63 reps
- `DairyCowsUSDA.csv` — USDA NASS milk-cow inventory by county and herd-size band

## Branding

Primary color: `#0A2540` (deep navy). Accent: `#1E3A8A`.
