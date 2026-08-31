// Plotly's partial-bundle entry points ship without type declarations. The
// public surface we use is small and typed at the call sites in Plot.tsx.
declare module "plotly.js/lib/core" {
  interface PlotlyCore {
    register(modules: unknown[]): void;
    react(
      root: HTMLElement | string,
      data: unknown[],
      layout?: Record<string, unknown>,
      config?: Record<string, unknown>,
    ): Promise<unknown>;
    newPlot(
      root: HTMLElement | string,
      data: unknown[],
      layout?: Record<string, unknown>,
      config?: Record<string, unknown>,
    ): Promise<unknown>;
    purge(root: HTMLElement | string): void;
  }
  const Plotly: PlotlyCore;
  export default Plotly;
}
declare module "plotly.js/lib/bar";
declare module "plotly.js/lib/scatter";
declare module "plotly.js/lib/candlestick";
declare module "plotly.js/lib/waterfall";
declare module "plotly.js/lib/heatmap";
declare module "plotly.js/lib/treemap";
declare module "plotly.js/lib/histogram";
declare module "plotly.js/lib/pie";
