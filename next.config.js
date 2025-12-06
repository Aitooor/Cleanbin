/**
 * next.config.js
 * Minimal config with a migration note for the middleware -> proxy change.
 *
 * Next.js 16 deprecates the file-based `middleware` convention and suggests
 * using `proxy` or other alternatives. This project already removed the
 * file named `middleware.*` (renamed to `utils/authHelper.ts`) to avoid the
 * automatic middleware detection. If you want to adopt "proxy" features,
 * extend this file following Next.js docs.
 */

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Enable experimental proxy features if you want Next.js to use the new
  // proxy middleware mechanism. This is opt-in — uncomment to enable.
  experimental: {
    // proxy: true,
  },
};

module.exports = nextConfig;
