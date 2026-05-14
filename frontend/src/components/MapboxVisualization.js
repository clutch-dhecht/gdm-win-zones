import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import Map, { Source, Layer, Popup, NavigationControl } from 'react-map-gl/mapbox';
import 'mapbox-gl/dist/mapbox-gl.css';
import circle from '@turf/circle';
import { getLayerConfig } from '../config/layerConfig';
// Sales territories removed in GDM Win Zones — stubs keep dead-code paths inert.
const SALES_REPS = [];
const getRepForCounty = () => null;

const MAPBOX_TOKEN = process.env.REACT_APP_MAPBOX_TOKEN;
const COUNTIES_SOURCE = 'https://raw.githubusercontent.com/plotly/datasets/master/geojson-counties-fips.json';

const FIPS_TO_STATE = {
  '01': 'Alabama', '02': 'Alaska', '04': 'Arizona', '05': 'Arkansas',
  '06': 'California', '08': 'Colorado', '09': 'Connecticut', '10': 'Delaware',
  '11': 'District of Columbia', '12': 'Florida', '13': 'Georgia', '15': 'Hawaii',
  '16': 'Idaho', '17': 'Illinois', '18': 'Indiana', '19': 'Iowa',
  '20': 'Kansas', '21': 'Kentucky', '22': 'Louisiana', '23': 'Maine',
  '24': 'Maryland', '25': 'Massachusetts', '26': 'Michigan', '27': 'Minnesota',
  '28': 'Mississippi', '29': 'Missouri', '30': 'Montana', '31': 'Nebraska',
  '32': 'Nevada', '33': 'New Hampshire', '34': 'New Jersey', '35': 'New Mexico',
  '36': 'New York', '37': 'North Carolina', '38': 'North Dakota', '39': 'Ohio',
  '40': 'Oklahoma', '41': 'Oregon', '42': 'Pennsylvania', '44': 'Rhode Island',
  '45': 'South Carolina', '46': 'South Dakota', '47': 'Tennessee', '48': 'Texas',
  '49': 'Utah', '50': 'Vermont', '51': 'Virginia', '53': 'Washington',
  '54': 'West Virginia', '55': 'Wisconsin', '56': 'Wyoming'
};

const normalizeCountyName = (name) => {
  let n = name.toUpperCase().trim();
  n = n.replace(/ CITY$/, '');
  n = n.replace(/^SAINT /i, 'ST ').replace(/^SAINTE /i, 'STE ');
  n = n.replace(/^ST\. /i, 'ST ').replace(/^STE\. /i, 'STE ');
  n = n.replace(/\./g, '').replace(/'/g, '').replace(/\u00D1/g, 'N').replace(/\u00F1/g, 'N');
  n = n.replace(/^DE /, 'DE').replace(/^LA /, 'LA').replace(/^LE /, 'LE');
  n = n.replace(/-/g, ' ');
  // USDA encodes apostrophe counties as "O BRIEN" \u2014 collapse single-letter prefix + space.
  // Maps both "O BRIEN" and "O'BRIEN" to "OBRIEN" so the join works for either form.
  n = n.replace(/^([A-Z]) /, '$1');
  return n;
};

const normalizeStateName = (s) => {
  if (!s) return '';
  return s.trim().split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
};

const slugify = (name) => name.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();

const getColor = (layerName, layerColors) => {
  if (layerColors[layerName]) return layerColors[layerName];
  const config = getLayerConfig(layerName);
  return config.markerColor || config.color;
};

const getDensityColor = (layerName, layerColors) => {
  if (layerColors[layerName]) return layerColors[layerName];
  return getLayerConfig(layerName).color;
};

const haversine = (lon1, lat1, lon2, lat2) => {
  const R = 3959;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const getCentroid = (geometry) => {
  let coords = [];
  if (geometry.type === 'Polygon') coords = geometry.coordinates[0];
  else if (geometry.type === 'MultiPolygon') coords = geometry.coordinates[0][0];
  if (coords.length === 0) return null;
  let sumLon = 0, sumLat = 0;
  for (const c of coords) { sumLon += c[0]; sumLat += c[1]; }
  return [sumLon / coords.length, sumLat / coords.length];
};

// Andrew's monotone chain convex hull. Input: array of [lon, lat] points.
// Returns the hull as a closed ring [p0, p1, ..., pN, p0].
const convexHull = (points) => {
  if (points.length <= 1) return points.slice();
  const pts = [...points].sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
  const cross = (O, A, B) => (A[0] - O[0]) * (B[1] - O[1]) - (A[1] - O[1]) * (B[0] - O[0]);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  const hull = lower.concat(upper);
  if (hull.length > 0) hull.push(hull[0]); // close ring
  return hull;
};

// Polygon perimeter in miles (sum of haversines along the ring)
const ringPerimeterMi = (ring) => {
  let total = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    total += haversineLL(ring[i], ring[i + 1]);
  }
  return total;
};

// Polygon area in sq miles via the spherical excess approximation
// (good enough for cluster compactness; we only use the ratio)
const ringAreaSqMi = (ring) => {
  if (ring.length < 4) return 0;
  let total = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [lon1, lat1] = ring[i];
    const [lon2, lat2] = ring[i + 1];
    total += (lon2 - lon1) * (2 + Math.sin(lat1 * Math.PI / 180) + Math.sin(lat2 * Math.PI / 180));
  }
  const earthRSqMi = 3959 * 3959;
  return Math.abs(total * earthRSqMi * Math.PI / 360);
};

const haversineLL = (a, b) => haversine(a[0], a[1], b[0], b[1]);

const MapboxVisualization = ({
  pointData,       // aggregated (CLS Customers)
  locationData,    // individual points [{name, layer, city, state, lat, lon, address}]
  densityData,
  activeLayers,
  radiusSettings,
  layerColors = {},
  winZonesEnabled = false,
  winZones = [],
  weightedWinZones = [],
  territoriesEnabled = false,
  visibleReps = {},
  onWinZoneRankings,
  onEnrichedFeatures,
  onMapZoom,
  selectedStates,
  hasData,
  winZoneSettings = { densityFloor: 0.6, coverageRadiusMi: 30, minClusterSize: 5, targetZones: 19 },
  onWinClustersComputed,
}) => {
  const [viewState, setViewState] = useState({ longitude: -97, latitude: 39, zoom: 4, pitch: 0, bearing: 0 });
  const [popupInfo, setPopupInfo] = useState(null);
  const [hoverInfo, setHoverInfo] = useState(null);
  const [mapStyle, setMapStyle] = useState('mapbox://styles/mapbox/light-v11');
  const [countiesGeoJSON, setCountiesGeoJSON] = useState(null);
  const [territoryBorderGeoJSON, setTerritoryBorderGeoJSON] = useState(null);
  const mapRef = useRef(null);

  useEffect(() => {
    fetch(COUNTIES_SOURCE)
      .then(res => res.json())
      .then(data => setCountiesGeoJSON(data))
      .catch(err => console.error('Error loading counties GeoJSON:', err));
  }, []);

  // Build dissolved territory border from US states GeoJSON (one MultiPolygon per rep)
  useEffect(() => {
    if (!territoriesEnabled) { setTerritoryBorderGeoJSON(null); return; }
    fetch('https://raw.githubusercontent.com/PublicaMundi/MappingAPI/master/data/geojson/us-states.json')
      .then(r => r.json())
      .then(statesGeo => {
        // Collect all assigned states (including partial)
        const assignedStates = new Set();
        SALES_REPS.forEach(rep => {
          rep.states.forEach(s => assignedStates.add(s));
          Object.keys(rep.partialStates).forEach(s => assignedStates.add(s));
        });

        const features = [];
        const unassignedCoords = [];

        // For each rep, collect their state features and color them
        SALES_REPS.forEach(rep => {
          if (visibleReps[rep.id] === false) return;
          rep.states.forEach(stateName => {
            const stateFeature = statesGeo.features.find(f => f.properties.name === stateName);
            if (stateFeature) {
              features.push({
                ...stateFeature,
                properties: { ...stateFeature.properties, rep_id: rep.id, rep_color: rep.color, is_unassigned: false }
              });
            }
          });
          // Also include partial states (Montana) — show full state border in this rep's color
          Object.keys(rep.partialStates).forEach(stateName => {
            const stateFeature = statesGeo.features.find(f => f.properties.name === stateName);
            if (stateFeature) {
              features.push({
                ...stateFeature,
                properties: { ...stateFeature.properties, rep_id: rep.id, rep_color: rep.color, is_unassigned: false }
              });
            }
          });
        });

        // Unassigned states
        statesGeo.features.forEach(f => {
          if (!assignedStates.has(f.properties.name)) {
            unassignedCoords.push({
              ...f,
              properties: { ...f.properties, rep_id: 'unassigned', rep_color: '#D4D4D4', is_unassigned: true }
            });
          }
        });

        const allFeatures = [...features, ...unassignedCoords];
        setTerritoryBorderGeoJSON(allFeatures.length > 0 ? { type: 'FeatureCollection', features: allFeatures } : null);
      })
      .catch(() => setTerritoryBorderGeoJSON(null));
  }, [territoriesEnabled, visibleReps]);



  const activeDensityLayers = useMemo(() => {
    return Object.keys(activeLayers).filter(layer => {
      if (!activeLayers[layer]) return false;
      const config = getLayerConfig(layer);
      return config.type === 'density' || config.type === 'base';
    });
  }, [activeLayers]);

  const hasDensityActive = activeDensityLayers.length > 0;

  // All active point positions (for win zone coverage calc)
  const activePointPositions = useMemo(() => {
    const positions = [];
    // From aggregated point data
    (pointData || []).forEach(city => {
      Object.keys(city.layers).forEach(layerName => {
        if (!activeLayers[layerName]) return;
        if (getLayerConfig(layerName).type === 'point' && city.layers[layerName] > 0) {
          positions.push([city.lon, city.lat]);
        }
      });
    });
    // From individual location data
    (locationData || []).forEach(loc => {
      if (activeLayers[loc.layer]) {
        positions.push([loc.lon, loc.lat]);
      }
    });
    return positions;
  }, [pointData, locationData, activeLayers]);

  // Build individual location points GeoJSON (one feature per location)
  const locationGeoJSON = useMemo(() => {
    if (!locationData || locationData.length === 0) return null;
    const features = [];
    locationData.forEach((loc, idx) => {
      if (!activeLayers[loc.layer]) return;
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [loc.lon, loc.lat] },
        properties: {
          id: `loc-${idx}`,
          name: loc.name || '',
          customer_name: loc.customer_name || '',
          ship_to_name: loc.ship_to_name || '',
          layer: loc.layer,
          city: loc.city,
          state: loc.state,
          address: loc.address || '',
          zip: loc.zip || '',
          capacity: loc.capacity || '',
          type: loc.type || '',
          commodity: loc.commodity || '',
          region: loc.region || '',
          division: loc.division || '',
          color: getColor(loc.layer, layerColors)
        }
      });
    });
    return features.length > 0 ? { type: 'FeatureCollection', features } : null;
  }, [locationData, activeLayers, layerColors]);

  // Build aggregated city markers GeoJSON (CLS Customers)
  const cityMarkersGeoJSON = useMemo(() => {
    if (!pointData || pointData.length === 0) return null;
    const features = [];
    pointData.forEach((city, idx) => {
      let dominantLayer = null, maxVal = 0;
      Object.keys(city.layers).forEach(layerName => {
        if (!activeLayers[layerName]) return;
        if (getLayerConfig(layerName).type !== 'point') return;
        const v = city.layers[layerName];
        if (v > 0 && v > maxVal) { maxVal = v; dominantLayer = layerName; }
      });
      if (!dominantLayer) return;
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [city.lon, city.lat] },
        properties: {
          id: `city-${idx}`, city: city.city, state: city.state,
          layer: dominantLayer, value: maxVal,
          color: getColor(dominantLayer, layerColors),
          allLayers: JSON.stringify(city.layers)
        }
      });
    });
    return features.length > 0 ? { type: 'FeatureCollection', features } : null;
  }, [pointData, activeLayers, layerColors]);

  // Build radius circles from both aggregated + individual points
  const radiusGeoJSON = useMemo(() => {
    const features = [];

    // From aggregated points
    (pointData || []).forEach((city, idx) => {
      Object.keys(city.layers).forEach(layerName => {
        if (!activeLayers[layerName]) return;
        if (city.layers[layerName] <= 0) return;
        const config = getLayerConfig(layerName);
        if (!config.radius?.enabled) return;
        const rs = radiusSettings[layerName];
        if (!rs?.visible) return;
        const miles = rs.miles || config.radius.default;
        const cf = circle([city.lon, city.lat], miles, { steps: 48, units: 'miles' });
        cf.properties = { layer: layerName, color: getDensityColor(layerName, layerColors) };
        features.push(cf);
      });
    });

    // From individual location points
    (locationData || []).forEach((loc, idx) => {
      if (!activeLayers[loc.layer]) return;
      const config = getLayerConfig(loc.layer);
      if (!config.radius?.enabled) return;
      const rs = radiusSettings[loc.layer];
      if (!rs?.visible) return;
      const miles = rs.miles || config.radius.default;
      const cf = circle([loc.lon, loc.lat], miles, { steps: 48, units: 'miles' });
      cf.properties = { layer: loc.layer, color: getDensityColor(loc.layer, layerColors) };
      features.push(cf);
    });

    return features.length > 0 ? { type: 'FeatureCollection', features } : null;
  }, [pointData, locationData, activeLayers, radiusSettings, layerColors]);

  // Enriched county choropleth + win zone scores
  const enrichedCountiesGeoJSON = useMemo(() => {
    if (!countiesGeoJSON) return null;

    const dataLookup = {};
    (densityData || []).forEach(county => {
      const state = normalizeStateName(county.state);
      const countyNorm = normalizeCountyName(county.county);
      const key = `${state}|${countyNorm}`;
      if (!dataLookup[key]) dataLookup[key] = {};
      Object.keys(county.layers).forEach(layer => {
        const config = getLayerConfig(layer);
        if (config.type !== 'density' && config.type !== 'base') return;
        if (config.availableStates && !config.availableStates.includes(state)) return;
        const value = county.layers[layer] || 0;
        if (value > 0) dataLookup[key][layer] = (dataLookup[key][layer] || 0) + value;
      });
    });

    // Build sorted value arrays per layer for percentile-rank normalization.
    // Percentile-rank distributes counties evenly across the color ramp based
    // on relative rank (not raw value), so outliers (e.g. Tulare County dairy)
    // can't crush everyone else into the pale end of the gradient.
    const sortedByLayer = {};
    Object.values(dataLookup).forEach(layers => {
      Object.entries(layers).forEach(([l, v]) => {
        if (!sortedByLayer[l]) sortedByLayer[l] = [];
        sortedByLayer[l].push(v);
      });
    });
    Object.keys(sortedByLayer).forEach(l => sortedByLayer[l].sort((a, b) => a - b));

    // Binary search for the first index >= value → percentile rank in [0, 1]
    const percentileRank = (value, sorted) => {
      if (!sorted || sorted.length === 0) return 0;
      if (sorted.length === 1) return 1.0;
      let lo = 0, hi = sorted.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (sorted[mid] < value) lo = mid + 1;
        else hi = mid;
      }
      return lo / (sorted.length - 1);
    };

    // Keep linear max for win-zone math (separate from coloring).
    const layerMaxes = {};
    Object.entries(sortedByLayer).forEach(([l, vals]) => {
      layerMaxes[l] = vals[vals.length - 1];
    });

    const enrichedFeatures = countiesGeoJSON.features.map(feature => {
      const countyNorm = normalizeCountyName(feature.properties.NAME || '');
      const stateFips = feature.properties.STATE || '';
      const stateName = FIPS_TO_STATE[stateFips] || '';
      const key = `${stateName}|${countyNorm}`;

      const countyLayers = dataLookup[key] || {};
      const extraProps = { state_name: stateName };
      let totalAllLayers = 0;
      const layerBreakdown = {};

      Object.entries(countyLayers).forEach(([layer, value]) => {
        const slug = slugify(layer);
        // Percentile-rank intensity — outlier-resistant, evenly distributes
        // counties across the full ramp.
        let intensity = percentileRank(value, sortedByLayer[layer]);
        intensity = Math.max(0.05, Math.min(1.0, intensity));
        extraProps[`val_${slug}`] = value;
        extraProps[`int_${slug}`] = intensity;
        totalAllLayers += value;
        layerBreakdown[layer] = value;
      });

      extraProps.density_total = totalAllLayers;
      extraProps.density_layers = JSON.stringify(layerBreakdown);

      // Win zone scores (active layers only)
      let activeDensityTotal = 0;
      activeDensityLayers.forEach(l => { if (layerBreakdown[l]) activeDensityTotal += layerBreakdown[l]; });

      let densityScore = 0;
      if (activeDensityTotal > 0) {
        let activeMax = 1;
        Object.values(dataLookup).forEach(layers => {
          let t = 0;
          activeDensityLayers.forEach(l => { if (layers[l]) t += layers[l]; });
          if (t > activeMax) activeMax = t;
        });
        densityScore = Math.log(activeDensityTotal + 1) / Math.log(activeMax + 1);
      }

      let coverageScore = 0, nearestDist = Infinity;
      if (activePointPositions.length > 0 && activeDensityTotal > 0) {
        const centroid = getCentroid(feature.geometry);
        if (centroid) {
          for (const pos of activePointPositions) {
            const d = haversine(centroid[0], centroid[1], pos[0], pos[1]);
            if (d < nearestDist) nearestDist = d;
          }
          coverageScore = Math.max(0, 1 - (nearestDist / 200));
        }
      }

      extraProps.win_score = densityScore * (1 - coverageScore);
      extraProps.coverage_strength = activeDensityTotal > 0 ? (densityScore * coverageScore) : 0;
      extraProps.market_score = densityScore;
      extraProps.coverage_pct = coverageScore;
      extraProps.nearest_point_miles = nearestDist === Infinity ? -1 : Math.round(nearestDist);

      return { ...feature, properties: { ...feature.properties, ...extraProps } };
    });

    return { type: 'FeatureCollection', features: enrichedFeatures };
  }, [countiesGeoJSON, densityData, activePointPositions, activeDensityLayers]);

  // ── COUNTY ADJACENCY (precomputed once when GeoJSON loads) ──
  // Centroid distance heuristic: two counties are "adjacent" if their centroids
  // sit within ADJ_RADIUS_MI. Tuned for Midwest counties (~25 mi across); will
  // miss some pairings in large western counties but those aren't where the
  // dense corn-belt clusters live anyway.
  const ADJ_RADIUS_MI = 55;
  const countyAdjacency = useMemo(() => {
    if (!enrichedCountiesGeoJSON) return null;
    const feats = enrichedCountiesGeoJSON.features;
    const centroids = feats.map(f => getCentroid(f.geometry));
    const adj = feats.map(() => []);
    for (let i = 0; i < feats.length; i++) {
      const a = centroids[i];
      if (!a) continue;
      for (let j = i + 1; j < feats.length; j++) {
        const b = centroids[j];
        if (!b) continue;
        // Quick bbox reject before haversine
        if (Math.abs(a[1] - b[1]) > 1.2 || Math.abs(a[0] - b[0]) > 1.5) continue;
        if (haversine(a[0], a[1], b[0], b[1]) <= ADJ_RADIUS_MI) {
          adj[i].push(j);
          adj[j].push(i);
        }
      }
    }
    return { adj, centroids };
  }, [enrichedCountiesGeoJSON]);

  // ── CLUSTER DETECTION ──
  // Per-mode candidate filter → connected components → score → top-N clusters
  // with convex hulls. Driven by winZonesEnabled and winZoneSettings.
  const winClusters = useMemo(() => {
    if (!winZonesEnabled || !hasDensityActive) return [];
    if (!enrichedCountiesGeoJSON || !countyAdjacency) return [];
    const { densityFloor, coverageRadiusMi, minClusterSize, targetZones } = winZoneSettings;
    const feats = enrichedCountiesGeoJSON.features;
    const { adj, centroids } = countyAdjacency;

    // Precompute "coverage" per county: any active point within coverageRadiusMi.
    const isCovered = feats.map((_, i) => {
      const c = centroids[i];
      if (!c || activePointPositions.length === 0) return false;
      for (const p of activePointPositions) {
        if (haversine(c[0], c[1], p[0], p[1]) <= coverageRadiusMi) return true;
      }
      return false;
    });

    // Density pctile per county for the active layers (max across active layers).
    // Re-use the pre-computed int_<slug> values from enrichedCountiesGeoJSON.
    const slugs = activeDensityLayers.map(slugify);
    const densityPctile = feats.map(f => {
      let max = 0;
      for (const s of slugs) {
        const v = f.properties[`int_${s}`] || 0;
        if (v > max) max = v;
      }
      return max;
    });

    // Per-mode qualifying predicate
    const qualifies = (i) => {
      const f = feats[i];
      if ((f.properties.density_total || 0) <= 0) return false;
      if (densityPctile[i] < densityFloor) return false;
      if (winZonesEnabled === 'opportunity') return !isCovered[i];
      if (winZonesEnabled === 'coverage') return isCovered[i];
      return true; // market mode: anything above the density floor
    };

    // Connected components on the qualifying subgraph
    const seen = new Array(feats.length).fill(false);
    const components = [];
    for (let i = 0; i < feats.length; i++) {
      if (seen[i] || !qualifies(i)) continue;
      const stack = [i];
      const comp = [];
      while (stack.length) {
        const cur = stack.pop();
        if (seen[cur]) continue;
        seen[cur] = true;
        comp.push(cur);
        for (const n of adj[cur]) {
          if (!seen[n] && qualifies(n)) stack.push(n);
        }
      }
      if (comp.length >= minClusterSize) components.push(comp);
    }

    // Score each cluster: sum density × log(size+1) × compactness
    const scored = components.map((indices) => {
      const memberCentroids = indices.map(i => centroids[i]).filter(Boolean);
      const hull = convexHull(memberCentroids);
      const area = ringAreaSqMi(hull);
      const perim = ringPerimeterMi(hull);
      const compactness = (area > 0 && perim > 0) ? Math.min(1, (4 * Math.PI * area) / (perim * perim)) : 0.1;
      const densitySum = indices.reduce((s, i) => s + densityPctile[i], 0);
      const score = densitySum * Math.log(indices.length + 1) * (0.4 + 0.6 * compactness);
      // Bounding box for zoom
      let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
      memberCentroids.forEach(([lon, lat]) => {
        if (lat < minLat) minLat = lat; if (lat > maxLat) maxLat = lat;
        if (lon < minLon) minLon = lon; if (lon > maxLon) maxLon = lon;
      });
      // Counties detail for cards
      const counties = indices.map(i => ({
        name: feats[i].properties.NAME,
        state: feats[i].properties.state_name,
        density_pctile: densityPctile[i],
        density_total: feats[i].properties.density_total,
      })).sort((a, b) => b.density_pctile - a.density_pctile);
      return {
        indices,
        hull,
        size: indices.length,
        compactness,
        densitySum,
        score,
        bbox: { minLat: minLat - 0.4, maxLat: maxLat + 0.4, minLon: minLon - 0.4, maxLon: maxLon + 0.4 },
        counties,
        mode: winZonesEnabled,
      };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, targetZones);
  }, [winZonesEnabled, hasDensityActive, enrichedCountiesGeoJSON, countyAdjacency, activePointPositions, activeDensityLayers, winZoneSettings]);

  // Build hull GeoJSON for rendering as dashed-line + faint fill outlines
  const winClustersGeoJSON = useMemo(() => {
    if (!winClusters || winClusters.length === 0) return null;
    // Cycle through 8 distinct outline colors
    const palette = ['#0EA5E9', '#F97316', '#D946EF', '#FACC15', '#DC2626', '#1E3A8A', '#16A34A', '#0F172A'];
    const features = winClusters.map((c, idx) => ({
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [c.hull] },
      properties: {
        zone_index: idx,
        zone_color: palette[idx % palette.length],
        size: c.size,
        score: c.score,
      },
    }));
    return { type: 'FeatureCollection', features };
  }, [winClusters]);

  // Emit clusters to parent (for WinZoneCards)
  useEffect(() => {
    if (onWinClustersComputed) onWinClustersComputed(winClusters);
  }, [winClusters, onWinClustersComputed]);

  // Extract win zone rankings
  useEffect(() => {
    if (!onWinZoneRankings || !enrichedCountiesGeoJSON) return;
    if (!winZonesEnabled || !hasDensityActive) { onWinZoneRankings([]); return; }

    const scoreKey = winZonesEnabled === 'coverage' ? 'coverage_strength'
      : winZonesEnabled === 'market' ? 'market_score'
      : 'win_score';

    const ranked = enrichedCountiesGeoJSON.features
      .filter(f => f.properties[scoreKey] > 0.05 && f.properties.density_total > 0)
      .map(f => ({
        county: f.properties.NAME, state: f.properties.state_name,
        score: Math.round(f.properties[scoreKey] * 100),
        nearestMiles: f.properties.nearest_point_miles >= 0 ? f.properties.nearest_point_miles : null,
        densityTotal: f.properties.density_total, mode: winZonesEnabled
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 20);

    onWinZoneRankings(ranked);
  }, [enrichedCountiesGeoJSON, winZonesEnabled, hasDensityActive, onWinZoneRankings]);

  // Emit enriched features for WinZoneCards
  useEffect(() => {
    if (onEnrichedFeatures && enrichedCountiesGeoJSON) {
      onEnrichedFeatures(enrichedCountiesGeoJSON.features);
    }
  }, [enrichedCountiesGeoJSON, onEnrichedFeatures]);

  // Zoom function
  const zoomToBbox = useCallback((bbox) => {
    const map = mapRef.current?.getMap();
    if (map && bbox) {
      map.fitBounds(
        [[bbox.minLon, bbox.minLat], [bbox.maxLon, bbox.maxLat]],
        { padding: 60, duration: 1500 }
      );
    }
  }, []);

  // Expose zoom function to parent
  useEffect(() => {
    if (onMapZoom) onMapZoom(zoomToBbox);
  }, [onMapZoom, zoomToBbox]);

  // Force point layers to render above the choropleth and any other overlays.
  // Mapbox layer order depends on insertion sequence; whenever the layer set
  // changes (new fill added, etc.) we re-hoist the dot layers to the top.
  useEffect(() => {
    const map = mapRef.current?.getMap?.();
    if (!map) return;
    const hoist = () => {
      ['location-points-unclustered', 'city-markers-unclustered'].forEach(id => {
        if (map.getLayer(id)) {
          try { map.moveLayer(id); } catch (_) { /* layer might be transitioning */ }
        }
      });
    };
    hoist();
    map.on('styledata', hoist);
    return () => { map.off('styledata', hoist); };
  }, [activeLayers, winZonesEnabled, locationGeoJSON, cityMarkersGeoJSON]);

  // Also handle state filter zoom
  useEffect(() => {
    if (!selectedStates || selectedStates.length === 0 || !enrichedCountiesGeoJSON) return;
    const stateFeatures = enrichedCountiesGeoJSON.features.filter(
      f => selectedStates.includes(f.properties.state_name)
    );
    if (stateFeatures.length === 0) return;

    let minLon = 180, maxLon = -180, minLat = 90, maxLat = -90;
    stateFeatures.forEach(f => {
      const coords = f.geometry.type === 'MultiPolygon'
        ? f.geometry.coordinates.flat(2)
        : f.geometry.coordinates[0] || [];
      coords.forEach(([lon, lat]) => {
        if (lon < minLon) minLon = lon;
        if (lon > maxLon) maxLon = lon;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
      });
    });

    const map = mapRef.current?.getMap();
    if (map && minLon < maxLon) {
      map.fitBounds([[minLon, minLat], [maxLon, maxLat]], { padding: 40, duration: 1200 });
    }
  }, [selectedStates, enrichedCountiesGeoJSON]);

  // Build zone outline GeoJSON from winZones county IDs
  const zoneOutlinesGeoJSON = useMemo(() => {
    if (!winZones || winZones.length === 0 || !enrichedCountiesGeoJSON) return null;

    const features = [];
    const ZONE_COLORS = ['#DC2626', '#F97316', '#FBBF24']; // Zone 1=red, 2=orange, 3=yellow

    winZones.forEach((zone, zoneIdx) => {
      if (!zone.countyIds) return;
      const idSet = new Set(zone.countyIds);

      // Find matching features from enriched GeoJSON
      enrichedCountiesGeoJSON.features.forEach(f => {
        const key = `${f.properties.state_name}|${f.properties.NAME}`;
        if (idSet.has(key)) {
          features.push({
            ...f,
            properties: {
              ...f.properties,
              zone_index: zoneIdx,
              zone_name: zone.name,
              zone_color: ZONE_COLORS[zoneIdx] || '#FBBF24',
            }
          });
        }
      });
    });

    return features.length > 0 ? { type: 'FeatureCollection', features } : null;
  }, [winZones, enrichedCountiesGeoJSON]);

  // Build weighted zone outline GeoJSON
  const weightedZoneOutlinesGeoJSON = useMemo(() => {
    if (!weightedWinZones || weightedWinZones.length === 0 || !enrichedCountiesGeoJSON) return null;
    const features = [];
    const COLORS = ['#0891B2', '#06B6D4', '#67E8F9']; // cyan shades
    weightedWinZones.forEach((zone, zoneIdx) => {
      if (!zone.countyIds) return;
      const idSet = new Set(zone.countyIds);
      enrichedCountiesGeoJSON.features.forEach(f => {
        const key = `${f.properties.state_name}|${f.properties.NAME}`;
        if (idSet.has(key)) {
          features.push({ ...f, properties: { ...f.properties, zone_index: zoneIdx, zone_color: COLORS[zoneIdx] || '#67E8F9' } });
        }
      });
    });
    return features.length > 0 ? { type: 'FeatureCollection', features } : null;
  }, [weightedWinZones, enrichedCountiesGeoJSON]);

  // Build territory overlay GeoJSON from enriched counties (for fill only)
  const territoryGeoJSON = useMemo(() => {
    if (!territoriesEnabled || !enrichedCountiesGeoJSON) return null;
    const features = [];
    enrichedCountiesGeoJSON.features.forEach(f => {
      const stateName = f.properties.state_name;
      let lat = 0;
      const coords = f.geometry.type === 'Polygon' ? f.geometry.coordinates[0] : f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates[0][0] : [];
      if (coords.length > 0) {
        lat = coords.reduce((s, c) => s + c[1], 0) / coords.length;
      }
      const rep = getRepForCounty(stateName, lat);
      if (!rep) return;
      if (visibleReps[rep.id] === false) return;
      features.push({
        ...f,
        properties: { ...f.properties, rep_id: rep.id, rep_name: rep.name, rep_color: rep.color }
      });
    });
    return features.length > 0 ? { type: 'FeatureCollection', features } : null;
  }, [territoriesEnabled, enrichedCountiesGeoJSON, visibleReps]);


  // Click handler
  const onMapClick = useCallback((event) => {
    const features = event.features;
    if (!features || features.length === 0) { setPopupInfo(null); return; }
    const feature = features[0];

    if (feature.layer.id === 'location-points-unclustered') {
      setPopupInfo({
        type: 'location',
        longitude: feature.geometry.coordinates[0],
        latitude: feature.geometry.coordinates[1],
        name: feature.properties.name,
        customer_name: feature.properties.customer_name,
        ship_to_name: feature.properties.ship_to_name,
        layer: feature.properties.layer,
        city: feature.properties.city,
        state: feature.properties.state,
        address: feature.properties.address,
        zip: feature.properties.zip,
        capacity: feature.properties.capacity,
        locType: feature.properties.type,
        commodity: feature.properties.commodity,
        region: feature.properties.region,
        division: feature.properties.division,
      });
    } else if (feature.layer.id === 'city-markers-unclustered') {
      setPopupInfo({
        type: 'city',
        longitude: feature.geometry.coordinates[0],
        latitude: feature.geometry.coordinates[1],
        city: feature.properties.city, state: feature.properties.state,
        allLayers: JSON.parse(feature.properties.allLayers || '{}')
      });
    } else if (feature.layer.id === 'location-clusters' || feature.layer.id === 'clusters') {
      const map = mapRef.current?.getMap();
      if (map) map.easeTo({ center: feature.geometry.coordinates, zoom: viewState.zoom + 2 });
    } else if ((feature.layer.id.startsWith('county-fill-') || feature.layer.id === 'win-cluster-fill') && feature.properties.density_total > 0) {
      const isCov = winZonesEnabled === 'coverage';
      const isMarket = winZonesEnabled === 'market';
      const scoreProp = isCov ? feature.properties.coverage_strength : isMarket ? feature.properties.market_score : feature.properties.win_score;
      setPopupInfo({
        type: 'county',
        longitude: event.lngLat.lng, latitude: event.lngLat.lat,
        county: feature.properties.NAME, state: feature.properties.state_name,
        total: feature.properties.density_total,
        layers: JSON.parse(feature.properties.density_layers || '{}'),
        winScore: scoreProp, winMode: winZonesEnabled || null,
        coveragePct: feature.properties.coverage_pct,
        nearestMiles: feature.properties.nearest_point_miles >= 0 ? feature.properties.nearest_point_miles : null
      });
    }
  }, [viewState.zoom, winZonesEnabled]);

  // Hover handler
  const onMouseMove = useCallback((event) => {
    const features = event.features;
    if (!features || features.length === 0) { setHoverInfo(null); return; }
    const feature = features[0];

    if (feature.layer.id === 'location-points-unclustered') {
      setHoverInfo({
        type: 'location', x: event.point.x, y: event.point.y,
        name: feature.properties.name, layer: feature.properties.layer,
        city: feature.properties.city, state: feature.properties.state
      });
    } else if (feature.layer.id === 'city-markers-unclustered') {
      setHoverInfo({
        type: 'city', x: event.point.x, y: event.point.y,
        city: feature.properties.city, state: feature.properties.state,
        layer: feature.properties.layer, value: feature.properties.value
      });
    } else if ((feature.layer.id.startsWith('county-fill-') || feature.layer.id === 'win-cluster-fill') && feature.properties.density_total > 0) {
      const layers = JSON.parse(feature.properties.density_layers || '{}');
      const activeParts = Object.entries(layers).filter(([l]) => activeLayers[l]).map(([l, v]) => `${l}: ${v.toLocaleString()}`).join(' | ');
      const isCov = winZonesEnabled === 'coverage';
      const isMarket = winZonesEnabled === 'market';
      const scoreProp = isCov ? feature.properties.coverage_strength : isMarket ? feature.properties.market_score : feature.properties.win_score;
      const winPct = Math.round((scoreProp || 0) * 100);
      setHoverInfo({
        type: 'county', x: event.point.x, y: event.point.y,
        county: feature.properties.NAME, state: feature.properties.state_name,
        total: feature.properties.density_total, detail: activeParts,
        winScore: winZonesEnabled ? winPct : null, winMode: winZonesEnabled || null,
        nearestMiles: winZonesEnabled && feature.properties.nearest_point_miles >= 0 ? feature.properties.nearest_point_miles : null
      });
    } else { setHoverInfo(null); }
  }, [activeLayers, winZonesEnabled]);

  const onMouseLeave = useCallback(() => setHoverInfo(null), []);

  const toggleMapStyle = () => {
    setMapStyle(prev => prev === 'mapbox://styles/mapbox/light-v11' ? 'mapbox://styles/mapbox/satellite-streets-v12' : 'mapbox://styles/mapbox/light-v11');
  };
  const isSatellite = mapStyle.includes('satellite');

  const radiusColorExpr = useMemo(() => {
    const entries = [];
    Object.keys(activeLayers).forEach(layer => {
      if (!activeLayers[layer]) return;
      if (getLayerConfig(layer).radius?.enabled) entries.push(layer, getDensityColor(layer, layerColors));
    });
    return entries.length === 0 ? '#888888' : ['match', ['get', 'layer'], ...entries, '#888888'];
  }, [activeLayers, layerColors]);

  const locationColorExpr = useMemo(() => {
    const entries = [];
    Object.keys(activeLayers).forEach(layer => {
      if (!activeLayers[layer]) return;
      if (getLayerConfig(layer).type === 'point') entries.push(layer, getColor(layer, layerColors));
    });
    return entries.length === 0 ? '#888888' : ['match', ['get', 'layer'], ...entries, '#888888'];
  }, [activeLayers, layerColors]);

  const interactiveIds = useMemo(() => {
    const ids = ['location-points-unclustered', 'city-markers-unclustered'];
    activeDensityLayers.forEach(l => ids.push(`county-fill-${slugify(l)}`));
    if (winZonesEnabled) ids.push('win-cluster-fill');
    return ids;
  }, [activeDensityLayers, winZonesEnabled]);

  const cursor = hoverInfo ? 'pointer' : 'grab';

  return (
    <div className="relative w-full h-full" data-testid="map-container">
      {!hasData ? (
        <div className="absolute inset-0 flex items-center justify-center bg-stone-100">
          <div className="text-center p-8">
            <h2 className="text-2xl font-semibold text-stone-900 mb-2" style={{ fontFamily: 'Manrope, sans-serif' }}>Upload Data to Begin</h2>
            <p className="text-sm text-stone-500" style={{ fontFamily: 'IBM Plex Sans, sans-serif' }}>Upload your CSV files to visualize opportunities on the map</p>
          </div>
        </div>
      ) : (
        <>
          <Map
            ref={mapRef} {...viewState}
            onMove={evt => setViewState(evt.viewState)}
            onClick={onMapClick} onMouseMove={onMouseMove} onMouseLeave={onMouseLeave}
            interactiveLayerIds={interactiveIds}
            mapStyle={mapStyle} mapboxAccessToken={MAPBOX_TOKEN}
            style={{ width: '100%', height: '100%' }} cursor={cursor}
          >
            <NavigationControl position="top-left" />

            {/* County choropleth */}
            {hasDensityActive && enrichedCountiesGeoJSON && (
              <Source id="counties" type="geojson" data={enrichedCountiesGeoJSON}>
                {activeDensityLayers.map(layer => {
                  const slug = slugify(layer);
                  const cfg = getLayerConfig(layer);
                  const ramp = cfg.colorRamp;
                  const baseOpacity = cfg.fillOpacity ?? 0.85;
                  // Decile-banded step expression: each color covers one tier
                  // of the percentile-rank intensity (e.g. 10 colors → 10% bands).
                  // Format: ['step', input, defaultColor, thresh1, color1, thresh2, color2, ...]
                  const fillColor = ramp && ramp.length >= 2
                    ? (() => {
                        const expr = ['step', ['coalesce', ['get', `int_${slug}`], 0], ramp[0]];
                        for (let i = 1; i < ramp.length; i++) {
                          expr.push(i / ramp.length, ramp[i]);
                        }
                        return expr;
                      })()
                    : getDensityColor(layer, layerColors);
                  const fillOpacity = ramp
                    ? ['case', ['>', ['coalesce', ['get', `int_${slug}`], 0], 0], baseOpacity, 0]
                    : ['case', ['>', ['coalesce', ['get', `int_${slug}`], 0], 0], ['get', `int_${slug}`], 0];
                  return (
                    <Layer key={`county-fill-${slug}`} id={`county-fill-${slug}`} type="fill"
                      paint={{ 'fill-color': fillColor, 'fill-opacity': fillOpacity }}
                    />
                  );
                })}
                <Layer id="county-outline" type="line" paint={{ 'line-color': '#A8A29E', 'line-width': 0.3 }} />
              </Source>
            )}

            {/* Win Zones overlay — convex-hull outlines around clustered counties */}
            {winZonesEnabled && winClustersGeoJSON && (
              <Source id="win-clusters" type="geojson" data={winClustersGeoJSON}>
                <Layer
                  id="win-cluster-fill"
                  type="fill"
                  paint={{ 'fill-color': ['get', 'zone_color'], 'fill-opacity': 0.08 }}
                />
                <Layer
                  id="win-cluster-outline"
                  type="line"
                  paint={{
                    'line-color': ['get', 'zone_color'],
                    'line-width': 2.5,
                    'line-dasharray': [2, 2],
                    'line-opacity': 0.9,
                  }}
                />
              </Source>
            )}

            {/* Win Zone outlines — bold borders around each zone's counties */}
            {winZonesEnabled && zoneOutlinesGeoJSON && (
              <Source id="zone-outlines" type="geojson" data={zoneOutlinesGeoJSON}>
                <Layer
                  id="zone-outline-fill"
                  type="fill"
                  paint={{
                    'fill-color': ['get', 'zone_color'],
                    'fill-opacity': 0.15
                  }}
                />
                <Layer
                  id="zone-outline-border"
                  type="line"
                  paint={{
                    'line-color': '#1C1917',
                    'line-width': ['interpolate', ['linear'], ['zoom'], 3, 2.5, 6, 4, 10, 5],
                    'line-opacity': 0.85
                  }}
                />
                <Layer
                  id="zone-outline-border-inner"
                  type="line"
                  paint={{
                    'line-color': ['get', 'zone_color'],
                    'line-width': ['interpolate', ['linear'], ['zoom'], 3, 1, 6, 2, 10, 2.5],
                    'line-opacity': 1,
                    'line-dasharray': [3, 2]
                  }}
                />
              </Source>
            )}

            {/* Weighted Win Zone outlines — cyan borders */}
            {weightedZoneOutlinesGeoJSON && (
              <Source id="weighted-zone-outlines" type="geojson" data={weightedZoneOutlinesGeoJSON}>
                <Layer
                  id="weighted-zone-fill"
                  type="fill"
                  paint={{ 'fill-color': ['get', 'zone_color'], 'fill-opacity': 0.12 }}
                />
                <Layer
                  id="weighted-zone-border"
                  type="line"
                  paint={{
                    'line-color': '#0E7490',
                    'line-width': ['interpolate', ['linear'], ['zoom'], 3, 2, 6, 3.5, 10, 4.5],
                    'line-opacity': 0.85
                  }}
                />
                <Layer
                  id="weighted-zone-border-inner"
                  type="line"
                  paint={{
                    'line-color': ['get', 'zone_color'],
                    'line-width': ['interpolate', ['linear'], ['zoom'], 3, 1, 6, 1.5, 10, 2],
                    'line-opacity': 1,
                    'line-dasharray': [2, 3]
                  }}
                />
              </Source>
            )}

            {/* Sales Territory Overlay — fill from counties */}
            {territoryGeoJSON && (
              <Source id="territory-overlay" type="geojson" data={territoryGeoJSON}>
                <Layer
                  id="territory-fill"
                  type="fill"
                  paint={{
                    'fill-color': ['get', 'rep_color'],
                    'fill-opacity': 0.15
                  }}
                />
              </Source>
            )}

            {/* Territory perimeter border — state-level, colored per rep */}
            {territoryBorderGeoJSON && (
              <Source id="territory-border-dissolved" type="geojson" data={territoryBorderGeoJSON}>
                <Layer
                  id="territory-unassigned-fill"
                  type="fill"
                  filter={['==', ['get', 'is_unassigned'], true]}
                  paint={{
                    'fill-color': '#E5E5E5',
                    'fill-opacity': 0.35
                  }}
                />
                <Layer
                  id="territory-border-line"
                  type="line"
                  filter={['==', ['get', 'is_unassigned'], false]}
                  paint={{
                    'line-color': ['get', 'rep_color'],
                    'line-width': 3,
                    'line-opacity': 0.8
                  }}
                />
              </Source>
            )}

            {/* State / Province borders */}
            <Source id="state-borders" type="geojson" data="https://raw.githubusercontent.com/PublicaMundi/MappingAPI/master/data/geojson/us-states.json">
              <Layer id="state-lines" type="line" paint={{ 'line-color': '#1C1917', 'line-width': ['interpolate', ['linear'], ['zoom'], 3, 1.4, 6, 2.2, 10, 3], 'line-opacity': 0.7 }} />
            </Source>
            <Source id="canada-borders" type="geojson" data="https://raw.githubusercontent.com/codeforamerica/click_that_hood/master/public/data/canada.geojson">
              <Layer id="canada-lines" type="line" paint={{ 'line-color': '#1C1917', 'line-width': ['interpolate', ['linear'], ['zoom'], 3, 1.4, 6, 2.2, 10, 3], 'line-opacity': 0.7 }} />
            </Source>

            {/* Radius circles */}
            {radiusGeoJSON && (
              <Source id="radius-circles" type="geojson" data={radiusGeoJSON}>
                <Layer id="radius-fill" type="fill" paint={{ 'fill-color': radiusColorExpr, 'fill-opacity': 0.12 }} />
                <Layer id="radius-outline" type="line" paint={{ 'line-color': radiusColorExpr, 'line-width': 1.5, 'line-opacity': 0.5 }} />
              </Source>
            )}

            {/* Individual location points (clustering disabled) */}
            {locationGeoJSON && (
              <Source id="location-source" type="geojson" data={locationGeoJSON}>
                <Layer id="location-points-unclustered" type="circle" paint={{
                  'circle-radius': 5,
                  'circle-color': locationColorExpr,
                  'circle-opacity': 1,
                  'circle-stroke-width': 1.5,
                  'circle-stroke-color': '#FFFFFF'
                }} />
              </Source>
            )}

            {/* Aggregated city markers (clustering disabled) */}
            {cityMarkersGeoJSON && (
              <Source id="city-markers-source" type="geojson" data={cityMarkersGeoJSON}>
                <Layer id="city-markers-unclustered" type="circle" paint={{
                  'circle-radius': ['interpolate', ['linear'], ['get', 'value'], 0, 5, 10, 7, 50, 10, 200, 13],
                  'circle-color': locationColorExpr,
                  'circle-opacity': 1,
                  'circle-stroke-width': 2, 'circle-stroke-color': '#FFFFFF'
                }} />
              </Source>
            )}

            {/* Click popup */}
            {popupInfo && (
              <Popup longitude={popupInfo.longitude} latitude={popupInfo.latitude} anchor="bottom"
                onClose={() => setPopupInfo(null)} closeButton={true} closeOnClick={false}>
                <div className="p-1 min-w-[180px]" data-testid="map-popup">
                  {popupInfo.type === 'location' && (
                    <>
                      <div className="text-xs font-semibold text-stone-900">{popupInfo.name}</div>
                      {popupInfo.customer_name && popupInfo.customer_name !== popupInfo.name && (
                        <div className="text-[10px] text-stone-500 mt-0.5">{popupInfo.customer_name}</div>
                      )}
                      <div className="text-[10px] text-stone-400 mt-0.5">{popupInfo.layer}</div>
                      {popupInfo.division && <div className="text-[10px] text-stone-500 mt-0.5">{popupInfo.division}</div>}
                      {popupInfo.locType && <div className="text-[10px] text-stone-500 mt-0.5">{popupInfo.locType}</div>}
                      {popupInfo.commodity && <div className="text-[10px] text-stone-500 mt-0.5">{popupInfo.commodity}</div>}
                      {popupInfo.capacity && <div className="text-[10px] text-stone-500 mt-0.5">Capacity: {popupInfo.capacity}</div>}
                      {popupInfo.address && <div className="text-xs text-stone-600 mt-1">{popupInfo.address}</div>}
                      <div className="text-xs text-stone-600">{popupInfo.city}, {popupInfo.state} {popupInfo.zip}</div>
                    </>
                  )}
                  {popupInfo.type === 'city' && (
                    <>
                      <div className="text-sm font-semibold text-stone-900">{popupInfo.city}, {popupInfo.state}</div>
                      <div className="mt-1 space-y-0.5">
                        {Object.entries(popupInfo.allLayers || {}).map(([layer, value]) => (
                          value > 0 && activeLayers[layer] ? (
                            <div key={layer} className="text-xs text-stone-600 flex justify-between gap-3">
                              <span>{layer}:</span><span className="font-medium">{value.toLocaleString()}</span>
                            </div>
                          ) : null
                        ))}
                      </div>
                    </>
                  )}
                  {popupInfo.type === 'county' && (
                    <>
                      <div className="text-sm font-semibold text-stone-900">{popupInfo.county} County, {popupInfo.state}</div>
                      <div className="mt-1 space-y-0.5">
                        {Object.entries(popupInfo.layers || {}).filter(([l]) => activeLayers[l]).map(([layer, value]) => (
                          <div key={layer} className="text-xs text-stone-600 flex justify-between gap-3">
                            <span className="flex items-center gap-1">
                              <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: getDensityColor(layer, layerColors) }} />
                              {layer}:
                            </span>
                            <span className="font-medium">{value.toLocaleString()}</span>
                          </div>
                        ))}
                      </div>
                      {popupInfo.nearestMiles != null && popupInfo.winMode && (
                        <div className="mt-2 pt-2 border-t border-stone-200">
                          <div className="text-xs text-stone-500 flex justify-between">
                            <span>Nearest point:</span><span className="font-medium">{popupInfo.nearestMiles} mi</span>
                          </div>
                          <div className="text-xs flex justify-between mt-0.5">
                            <span className={`font-medium ${popupInfo.winMode === 'coverage' ? 'text-purple-600' : popupInfo.winMode === 'market' ? 'text-green-600' : 'text-orange-600'}`}>
                              {popupInfo.winMode === 'coverage' ? 'Coverage:' : popupInfo.winMode === 'market' ? 'Market:' : 'Opportunity:'}
                            </span>
                            <span className={`font-bold ${popupInfo.winMode === 'coverage' ? 'text-purple-700' : popupInfo.winMode === 'market' ? 'text-green-700' : 'text-orange-700'}`}>
                              {Math.round((popupInfo.winScore || 0) * 100)}%
                            </span>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </Popup>
            )}
          </Map>

          {/* Hover tooltip */}
          {hoverInfo && !popupInfo && (
            <div className="absolute pointer-events-none z-20 bg-stone-900/90 text-white text-xs rounded px-2.5 py-1.5 shadow-lg backdrop-blur-sm max-w-xs"
              style={{ left: hoverInfo.x + 12, top: hoverInfo.y - 12 }} data-testid="hover-tooltip">
              {hoverInfo.type === 'location' && (
                <div><span className="font-medium">{hoverInfo.name}</span> <span className="opacity-60">({hoverInfo.layer})</span></div>
              )}
              {hoverInfo.type === 'city' && (
                <span>{hoverInfo.city}, {hoverInfo.state} — {hoverInfo.layer}: {Number(hoverInfo.value).toLocaleString()}</span>
              )}
              {hoverInfo.type === 'county' && (
                <div>
                  <div className="font-medium">{hoverInfo.county} Co., {hoverInfo.state}</div>
                  {hoverInfo.detail && <div className="opacity-80 mt-0.5">{hoverInfo.detail}</div>}
                </div>
              )}
            </div>
          )}

          <button onClick={toggleMapStyle}
            className="absolute top-4 left-14 bg-white border border-stone-300 rounded px-3 py-1.5 text-xs font-medium text-stone-700 hover:bg-stone-50 shadow-sm z-10"
            data-testid="map-style-toggle">
            {isSatellite ? 'Street View' : 'Satellite'}
          </button>

          {winZonesEnabled && hasDensityActive && (
            <div className="absolute bottom-8 left-4 bg-white/95 backdrop-blur-sm border border-stone-200 rounded-lg px-3 py-2 shadow-md z-10" data-testid="win-zones-legend">
              <div className="text-[10px] font-semibold text-stone-600 uppercase tracking-wider mb-1.5">
                {winZonesEnabled === 'coverage' ? 'Your Coverage' : winZonesEnabled === 'market' ? 'Market Density' : 'Opportunity Score'}
              </div>
              <div className="flex items-center gap-1">
                <span className="text-[9px] text-stone-400">Low</span>
                <div className="flex h-2.5 rounded-full overflow-hidden flex-1">
                  {winZonesEnabled === 'coverage' ? (
                    <><div className="flex-1 bg-purple-100" /><div className="flex-1 bg-purple-300" /><div className="flex-1 bg-purple-500" /><div className="flex-1 bg-purple-700" /><div className="flex-1 bg-purple-900" /></>
                  ) : winZonesEnabled === 'market' ? (
                    <><div className="flex-1 bg-green-100" /><div className="flex-1 bg-green-300" /><div className="flex-1 bg-green-500" /><div className="flex-1 bg-green-700" /><div className="flex-1 bg-green-900" /></>
                  ) : (
                    <><div className="flex-1 bg-amber-100" /><div className="flex-1 bg-amber-400" /><div className="flex-1 bg-orange-500" /><div className="flex-1 bg-red-600" /><div className="flex-1 bg-red-900" /></>
                  )}
                </div>
                <span className="text-[9px] text-stone-400">High</span>
              </div>
              <div className="text-[9px] text-stone-400 mt-1">
                {winZonesEnabled === 'coverage' ? 'Counties near your existing points' : winZonesEnabled === 'market' ? 'Biggest markets regardless of presence' : 'High density + far from existing points'}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default MapboxVisualization;
