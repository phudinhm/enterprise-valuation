"use client";

// A partial Plotly bundle. The full distribution is several megabytes; this
// registers only the trace types the terminal actually draws, which keeps the
// chart chunk to a fraction of that while still covering waterfalls,
// candlesticks, heatmaps and treemaps that lighter chart libraries cannot do.

import Plotly from "plotly.js/lib/core";
import bar from "plotly.js/lib/bar";
import scatter from "plotly.js/lib/scatter";
import candlestick from "plotly.js/lib/candlestick";
import waterfall from "plotly.js/lib/waterfall";
import heatmap from "plotly.js/lib/heatmap";
import treemap from "plotly.js/lib/treemap";
import histogram from "plotly.js/lib/histogram";
import pie from "plotly.js/lib/pie";

Plotly.register([bar, scatter, candlestick, waterfall, heatmap, treemap, histogram, pie]);

export default Plotly;
