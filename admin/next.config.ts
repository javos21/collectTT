import '../src/lib/load-env';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  experimental: {
    externalDir: true,
  },
  serverExternalPackages: ['pg', 'graphile-worker', 'sharp'],
};

export default nextConfig;
