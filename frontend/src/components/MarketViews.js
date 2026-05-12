import React from 'react';
import { Milk, Wheat } from 'lucide-react';

const MARKET_PRESETS = {
  dairy: {
    label: '500+ Dairy',
    icon: 'dairy',
    layers: ['500 or more Dairy Cows'],
    states: null,
  },
  corn: {
    label: 'Corn',
    icon: 'corn',
    layers: ["Beck's Dealers", 'Wyffels Reps', 'Corn Acres All States'],
    states: null,
  },
};

export const MARKET_KEYS = Object.keys(MARKET_PRESETS);
export const getMarketPreset = (key) => MARKET_PRESETS[key];

// Given activeLayers, determine which market (if any) is selected
export const detectActiveMarket = (activeLayers) => {
  for (const [key, preset] of Object.entries(MARKET_PRESETS)) {
    const presetLayers = preset.layers;
    const activeNames = Object.keys(activeLayers).filter((l) => activeLayers[l]);
    if (
      presetLayers.length === activeNames.length &&
      presetLayers.every((l) => activeLayers[l]) &&
      activeNames.every((l) => presetLayers.includes(l))
    ) {
      return key;
    }
  }
  const anyOn = Object.values(activeLayers).some((v) => v);
  return anyOn ? 'custom' : null;
};

const MarketIcon = ({ type, className }) => {
  if (type === 'dairy') return <Milk className={className} />;
  if (type === 'corn') return <Wheat className={className} />;
  return null;
};

const MarketViews = ({ onMarketSelect, activeMarket }) => {
  const handleSelect = (key) => {
    if (activeMarket === key) {
      onMarketSelect(null);
    } else {
      onMarketSelect(key);
    }
  };

  return (
    <div data-testid="market-views">
      <div className="grid grid-cols-2 gap-1.5">
        {MARKET_KEYS.map((key) => {
          const preset = MARKET_PRESETS[key];
          const isActive = activeMarket === key;
          return (
            <button
              key={key}
              onClick={() => handleSelect(key)}
              className={`flex flex-col items-center justify-center py-2.5 px-1.5 rounded-lg border text-xs font-medium transition-all ${
                isActive
                  ? 'bg-[#0A2540] text-white border-[#0A2540] shadow-sm'
                  : 'bg-white text-stone-600 border-stone-200 hover:border-stone-400 hover:bg-stone-50'
              }`}
              data-testid={`market-${key}`}
            >
              <MarketIcon
                type={preset.icon}
                className={`w-4 h-4 mb-1 ${isActive ? 'text-white' : 'text-stone-400'}`}
              />
              {preset.label}
            </button>
          );
        })}
        {activeMarket === 'custom' && (
          <div className="col-span-2 flex flex-col items-center justify-center py-2 px-1.5 rounded-lg border border-dashed border-stone-300 text-xs text-stone-400">
            <span className="text-[10px]">Custom</span>
          </div>
        )}
      </div>
    </div>
  );
};

export default MarketViews;
