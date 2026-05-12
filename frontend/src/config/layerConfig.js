// Layer configuration for GDM Win Zones
// Edit this file to add/remove layers, change colors, enable/disable radius

// Hex linear interpolation helper
const lerpHex = (a, b, t) => {
  const ai = parseInt(a.slice(1), 16);
  const bi = parseInt(b.slice(1), 16);
  const r = Math.round(((ai >> 16) & 0xff) * (1 - t) + ((bi >> 16) & 0xff) * t);
  const g = Math.round(((ai >> 8) & 0xff) * (1 - t) + ((bi >> 8) & 0xff) * t);
  const bl = Math.round((ai & 0xff) * (1 - t) + (bi & 0xff) * t);
  return '#' + ((r << 16) | (g << 8) | bl).toString(16).padStart(6, '0').toUpperCase();
};

// Expand a set of anchor stops into N evenly-spaced colors via piecewise linear interp.
const expandRamp = (stops, n) => {
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : i / (n - 1);
    const pos = t * (stops.length - 1);
    const lo = Math.floor(pos);
    const hi = Math.min(lo + 1, stops.length - 1);
    out.push(lerpHex(stops[lo], stops[hi], pos - lo));
  }
  return out;
};

// 10-band decile ramps (one color per percentile-rank tier).
// Dairy: pale → sky → bright → royal → deep navy
const DAIRY_RAMP = expandRamp(['#DBEAFE', '#7DD3FC', '#0EA5E9', '#1D4ED8', '#0A2540'], 10);
// Corn: warm white → soft yellow → soft lime → green → dark forest
const CORN_RAMP = expandRamp(['#FFFBEB', '#FEF08A', '#BEF264', '#65A30D', '#14532D'], 10);

export const LAYER_CONFIG = {
  // --- POINT LAYERS ---
  "Beck's Dealers": {
    type: "point",
    radius: { enabled: true, default: 50, options: [25, 50, 100] },
    color: "#1E3A8A",
    markerColor: "#1E3A8A",
    order: 1,
  },
  "Wyffels Reps": {
    type: "point",
    radius: { enabled: true, default: 50, options: [25, 50, 100] },
    color: "#DC2626",
    markerColor: "#DC2626",
    order: 2,
  },

  // --- DENSITY LAYERS (Number of Dairy Cows by herd-size band) ---
  "1-9 Dairy Cows": {
    type: "density",
    group: "dairy_cows",
    radius: { enabled: false },
    color: "#DBEAFE",
    fillOpacity: 0.55,
    order: 50,
  },
  "10-19 Dairy Cows": {
    type: "density",
    group: "dairy_cows",
    radius: { enabled: false },
    color: "#BFDBFE",
    fillOpacity: 0.55,
    order: 51,
  },
  "20-49 Dairy Cows": {
    type: "density",
    group: "dairy_cows",
    radius: { enabled: false },
    color: "#93C5FD",
    fillOpacity: 0.6,
    order: 52,
  },
  "50-99 Dairy Cows": {
    type: "density",
    group: "dairy_cows",
    radius: { enabled: false },
    color: "#60A5FA",
    fillOpacity: 0.6,
    order: 53,
  },
  "100-199 Dairy Cows": {
    type: "density",
    group: "dairy_cows",
    radius: { enabled: false },
    color: "#3B82F6",
    fillOpacity: 0.65,
    order: 54,
  },
  "200-499 Dairy Cows": {
    type: "density",
    group: "dairy_cows",
    radius: { enabled: false },
    color: "#2563EB",
    fillOpacity: 0.7,
    order: 55,
  },
  "500 or more Dairy Cows": {
    type: "density",
    group: "dairy_cows",
    radius: { enabled: false },
    color: "#0A2540",
    fillOpacity: 0.85,
    colorRamp: DAIRY_RAMP,
    order: 56,
  },

  // --- CORN ACRES (county density) ---
  // Backend seeds two separate layers — toggle independently.
  "Corn Acres Corn Belt States": {
    type: "density",
    radius: { enabled: false },
    color: "#14532D",
    fillOpacity: 0.85,
    colorRamp: CORN_RAMP,
    order: 60,
  },
  "Corn Acres All States": {
    type: "density",
    radius: { enabled: false },
    color: "#14532D",
    fillOpacity: 0.85,
    colorRamp: CORN_RAMP,
    order: 61,
  },
};

// Layer groups for sub-filter UI
export const LAYER_GROUPS = {
  dairy_cows: {
    label: 'Number of Dairy Cows',
    layers: [
      '1-9 Dairy Cows',
      '10-19 Dairy Cows',
      '20-49 Dairy Cows',
      '50-99 Dairy Cows',
      '100-199 Dairy Cows',
      '200-499 Dairy Cows',
      '500 or more Dairy Cows',
    ],
  },
};

export const getLayerConfig = (layerName) => {
  return LAYER_CONFIG[layerName] || {
    type: "density",
    radius: { enabled: false },
    color: "#6B7280",
    fillOpacity: 0.5,
    order: 99,
  };
};

export const getPointLayers = () =>
  Object.entries(LAYER_CONFIG)
    .filter(([, c]) => c.type === "point")
    .map(([name]) => name);

export const getDensityLayers = () =>
  Object.entries(LAYER_CONFIG)
    .filter(([, c]) => c.type === "density" || c.type === "base")
    .map(([name]) => name);

export const getRadiusLayers = () =>
  Object.entries(LAYER_CONFIG)
    .filter(([, c]) => c.radius?.enabled)
    .map(([name]) => name);

export const getGroupLayers = (groupKey) => LAYER_GROUPS[groupKey]?.layers || [];

export const getLayerGroup = (layerName) => LAYER_CONFIG[layerName]?.group || null;

export const getGroupedLayerNames = () => {
  const grouped = new Set();
  Object.values(LAYER_GROUPS).forEach((g) => g.layers.forEach((l) => grouped.add(l)));
  return grouped;
};
