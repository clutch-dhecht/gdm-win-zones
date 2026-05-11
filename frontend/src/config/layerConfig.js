// Layer configuration for GDM Win Zones
// Edit this file to add/remove layers, change colors, enable/disable radius

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
    color: "#0EA5E9",
    markerColor: "#0EA5E9",
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
    color: "#1E3A8A",
    fillOpacity: 0.75,
    order: 56,
  },

  // --- CORN ACRES (county density, restricted to 18 corn-region states) ---
  "Corn Acres": {
    type: "density",
    radius: { enabled: false },
    color: "#16A34A",
    fillOpacity: 0.6,
    order: 60,
    availableStates: [
      'North Dakota', 'South Dakota', 'Minnesota', 'Wisconsin',
      'Iowa', 'Nebraska', 'Missouri', 'Indiana',
      'Illinois', 'Ohio', 'Michigan', 'Kansas',
      'Kentucky', 'Tennessee', 'Arkansas', 'Mississippi',
      'Pennsylvania', 'Maryland',
    ],
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
