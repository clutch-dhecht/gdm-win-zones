// Layer configuration for GDM Win Zones
// Edit this file to add/remove layers, change colors, enable/disable radius

// Dairy ramp: pale → sky → bright → royal → deep navy
const DAIRY_RAMP = ['#DBEAFE', '#7DD3FC', '#0EA5E9', '#1D4ED8', '#0A2540'];
// Corn ramp: warm white → soft yellow → soft lime → green → dark forest
// Low end fades toward white so the lightest counties read as "near empty"
// and the bright yellow has more breathing room mid-low.
const CORN_RAMP = ['#FFFBEB', '#FEF08A', '#BEF264', '#65A30D', '#14532D'];

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
