import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  serverExternalPackages: ['pg', 'graphile-worker', 'sharp'],
  // Browser automation stores console/HMR artifacts in the project root. Keep
  // those generated files out of the dev watcher or every HMR event can cause
  // another HMR event.
  webpack: (config) => {
    config.watchOptions = {
      ...config.watchOptions,
      ignored: [...(Array.isArray(config.watchOptions?.ignored) ? config.watchOptions.ignored : []), '**/.playwright-cli/**'],
    };
    return config;
  },
  images: {
    // Images are served straight from MinIO locally / R2 CDN in production.
    // We pre-generate our own variants in the worker, so Next's optimizer is off.
    unoptimized: true,
  },
};

export default nextConfig;
