import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  serverExternalPackages: ['pg', 'graphile-worker', 'sharp'],
  images: {
    // Images are served straight from MinIO locally / R2 CDN in production.
    // We pre-generate our own variants in the worker, so Next's optimizer is off.
    unoptimized: true,
  },
};

export default nextConfig;
