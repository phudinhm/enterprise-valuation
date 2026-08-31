/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Plotly ships its own bundled dependencies; transpiling keeps the custom
  // partial bundle in lib/plotly.ts working under the app router.
  transpilePackages: ["plotly.js"],
};

export default nextConfig;
