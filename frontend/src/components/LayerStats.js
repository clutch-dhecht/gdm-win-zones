import React, { useMemo } from 'react';
import { getLayerConfig } from '../config/layerConfig';

// Format large numbers: 37118790 → "37.1M", 25711 → "25,711", 63 → "63"
const formatStat = (value) => {
  if (value >= 1000000) {
    const m = value / 1000000;
    return m >= 10 ? `${Math.round(m)}M+` : `${m.toFixed(1)}M`;
  }
  return value.toLocaleString();
};

// Layers that should collapse into a single "Corn Acres" display card.
// First match wins (used to pick which underlying layer's value to show).
const CORN_LAYER_PRIORITY = ['Corn Acres All States', 'Corn Acres Corn Belt States'];

const LayerStats = ({ activeLayers, allLayers = [], pointData, locationData, densityData, onToggle }) => {
  const stats = useMemo(() => {
    const result = [];

    // 1. Point layers (Beck's Dealers, Wyffels Reps, etc.)
    //    Always show — even when toggled off — so the user can click to enable.
    //    Count reflects the *filtered* locationData (state filter applied).
    const pointLayerNames = allLayers.filter(l => getLayerConfig(l).type === 'point');
    const locationCounts = {};
    (locationData || []).forEach(loc => {
      locationCounts[loc.layer] = (locationCounts[loc.layer] || 0) + 1;
    });
    pointLayerNames.forEach(layer => {
      result.push({
        layer,
        value: locationCounts[layer] || 0,
        kind: 'point',
        active: !!activeLayers[layer],
        clickable: true,
      });
    });

    // 2. Aggregated point layers (legacy CLS Customers etc.) — sum across active
    const aggTotals = {};
    (pointData || []).forEach(city => {
      Object.entries(city.layers).forEach(([layer, value]) => {
        if (!activeLayers[layer]) return;
        aggTotals[layer] = (aggTotals[layer] || 0) + value;
      });
    });
    Object.entries(aggTotals).forEach(([layer, total]) => {
      if (total > 0) result.push({ layer, value: total, kind: 'agg', active: true, clickable: false });
    });

    // 3. Density layers — sum visible values per active layer
    const densityTotals = {};
    (densityData || []).forEach(county => {
      Object.entries(county.layers).forEach(([layer, value]) => {
        if (!activeLayers[layer]) return;
        densityTotals[layer] = (densityTotals[layer] || 0) + value;
      });
    });

    // Collapse Corn Acres variants into a single "Corn Acres" tile
    const cornActive = CORN_LAYER_PRIORITY.find(l => activeLayers[l]);
    if (cornActive && densityTotals[cornActive] > 0) {
      result.push({ layer: 'Corn Acres', value: densityTotals[cornActive], kind: 'density', active: true, clickable: false });
    }
    // Drop the corn underlying layers from the generic loop so they don't double-show
    Object.entries(densityTotals).forEach(([layer, total]) => {
      if (CORN_LAYER_PRIORITY.includes(layer)) return;
      if (total > 0) result.push({ layer, value: total, kind: 'density', active: true, clickable: false });
    });

    return result;
  }, [activeLayers, allLayers, pointData, locationData, densityData]);

  if (stats.length === 0) return null;

  const cols = stats.length <= 2 ? 'grid-cols-2' : 'grid-cols-3';

  return (
    <div className={`grid ${cols} gap-1.5`} data-testid="layer-stats">
      {stats.map(({ layer, value, active, clickable }) => {
        const dimmed = clickable && !active;
        const baseCls = 'border rounded-lg px-2 py-2 text-center transition-all';
        const stateCls = dimmed
          ? 'bg-stone-100/60 border-stone-200 opacity-50 hover:opacity-80 cursor-pointer'
          : clickable
          ? 'bg-stone-50 border-stone-200 hover:border-[#0A2540] hover:shadow-sm cursor-pointer'
          : 'bg-stone-50 border-stone-200';
        const cfg = getLayerConfig(layer);
        const accent = cfg.markerColor || cfg.color || '#0A2540';
        return (
          <div
            key={layer}
            className={`${baseCls} ${stateCls}`}
            data-testid={`stat-${layer}`}
            onClick={clickable && onToggle ? () => onToggle(layer) : undefined}
            role={clickable ? 'button' : undefined}
          >
            <div className="text-lg font-bold leading-tight tracking-tight" style={{ fontFamily: 'Manrope, sans-serif', color: dimmed ? '#94A3B8' : accent }}>
              {formatStat(value)}
            </div>
            <div className="text-[9px] text-stone-600 mt-0.5 leading-tight font-medium">
              {layer}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default LayerStats;
