import React, { useState } from 'react';
import { ChevronDown, ChevronRight, Crosshair } from 'lucide-react';

// Format big counts compactly
const formatNum = (v) => {
  if (v >= 1000000) return `${(v / 1000000).toFixed(1)}M`;
  return Math.round(v).toLocaleString();
};

// Derive a name from member counties: dominant state, with optional second state.
// If a cluster spans multiple states, include the secondary one.
const nameCluster = (counties) => {
  const stateCounts = {};
  counties.forEach((c) => {
    stateCounts[c.state] = (stateCounts[c.state] || 0) + 1;
  });
  const sortedStates = Object.entries(stateCounts).sort((a, b) => b[1] - a[1]);
  const dominantState = sortedStates[0]?.[0] || 'Unknown';
  const secondary = sortedStates[1]?.[0];
  const multi = secondary && stateCounts[secondary] >= 3;
  return multi ? `${dominantState} / ${secondary}` : dominantState;
};

// Mode-based color tokens
const MODE_TOKENS = {
  market: { border: 'border-green-200', bg: 'bg-green-50/50', header: 'bg-green-100/50', text: 'text-green-700' },
  coverage: { border: 'border-purple-200', bg: 'bg-purple-50/50', header: 'bg-purple-100/50', text: 'text-purple-700' },
  opportunity: { border: 'border-orange-200', bg: 'bg-orange-50/50', header: 'bg-orange-100/50', text: 'text-orange-700' },
};

const WinZoneCards = ({ winClusters = [], winZonesMode, onZoomToZone }) => {
  const [expanded, setExpanded] = useState(null);
  const [showAll, setShowAll] = useState(false);

  if (!winClusters || winClusters.length === 0) return null;
  const tokens = MODE_TOKENS[winZonesMode] || MODE_TOKENS.opportunity;
  const visibleCount = showAll ? winClusters.length : Math.min(5, winClusters.length);
  const hasMore = winClusters.length > 5;

  return (
    <div className="space-y-2" data-testid="win-zone-cards">
      {winClusters.slice(0, visibleCount).map((cluster, idx) => {
        const isExpanded = expanded === idx;
        const name = nameCluster(cluster.counties);
        const topCounty = cluster.counties[0];
        const sumDensity = cluster.counties.reduce((s, c) => s + (c.density_total || 0), 0);

        return (
          <div
            key={idx}
            className={`rounded-lg border ${tokens.border} ${tokens.bg} overflow-hidden`}
            data-testid={`win-zone-card-${idx}`}
          >
            <div
              onClick={() => setExpanded(isExpanded ? null : idx)}
              className={`w-full px-3 py-2.5 flex items-start gap-2 text-left cursor-pointer ${tokens.header}`}
            >
              <span className={`text-sm font-bold ${tokens.text} mt-0.5`}>#{idx + 1}</span>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-stone-900 leading-tight">{name}</div>
                <div className="text-[10px] text-stone-500 mt-0.5">
                  {cluster.size} counties · {formatNum(sumDensity)} total
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onZoomToZone?.(cluster);
                  }}
                  className="p-1 rounded hover:bg-white/60 transition-colors"
                  title="Zoom to zone"
                  data-testid={`zoom-zone-${idx}`}
                >
                  <Crosshair className="w-3.5 h-3.5 text-stone-500" />
                </button>
                {isExpanded ? (
                  <ChevronDown className="w-3.5 h-3.5 text-stone-400" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5 text-stone-400" />
                )}
              </div>
            </div>

            {isExpanded && (
              <div className="px-3 py-2 space-y-2">
                <div>
                  <div className="text-[9px] uppercase tracking-wider font-semibold text-stone-400 mb-1">
                    Top {Math.min(10, cluster.counties.length)} counties
                  </div>
                  {cluster.counties.slice(0, 10).map((c, ci) => (
                    <div key={ci} className="flex justify-between text-[11px] text-stone-700 py-0.5">
                      <span>
                        {c.name}, {c.state}
                      </span>
                      <span className="font-medium text-stone-800">{formatNum(c.density_total)}</span>
                    </div>
                  ))}
                </div>
                {topCounty && cluster.counties.length > 10 && (
                  <div className="text-[10px] text-stone-400">+{cluster.counties.length - 10} more counties</div>
                )}
                <div className="text-[10px] text-stone-400">
                  Compactness: {Math.round(cluster.compactness * 100)}% · Score: {cluster.score.toFixed(1)}
                </div>
              </div>
            )}
          </div>
        );
      })}

      {hasMore && (
        <button
          onClick={() => setShowAll((v) => !v)}
          className="w-full text-center text-[10px] text-stone-400 hover:text-stone-600 py-1"
          data-testid="show-all-zones"
        >
          {showAll ? 'Show less' : `Show all ${winClusters.length} zones`}
        </button>
      )}
    </div>
  );
};

export default WinZoneCards;
