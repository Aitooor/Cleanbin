/**
 * next.config.js
 */

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Native addons must stay outside the server bundle: bundling better-sqlite3
  // breaks the lookup of its prebuilt binding at runtime.
  serverExternalPackages: ['better-sqlite3'],
};

module.exports = nextConfig;
