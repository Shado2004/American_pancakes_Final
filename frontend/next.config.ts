import type { NextConfig } from 'next';
import path from 'node:path';
/**
 * NEXT_BUILD_MODE=desktop or GITHUB_PAGES=true  →  static export (FloDesktop / GitHub Pages)
 * NEXT_BUILD_MODE unset                        →  standard Next.js server mode (FloPOS cloud)
 */
const isStaticExport =
  process.env.NEXT_BUILD_MODE === 'desktop' ||
  process.env.NEXT_BUILD_MODE === 'export' ||
  process.env.GITHUB_PAGES === 'true';

const nextConfig: NextConfig = {
  // Static export: required for Electron & GitHub Pages
  output: isStaticExport ? 'export' : undefined,

  // Trailing slashes make static paths predictable: /pos → /pos/index.html
  trailingSlash: isStaticExport,

  // Expose Supabase and API environment variables across both Next.js and Vite conventions
  env: {
    NEXT_PUBLIC_SUPABASE_URL:
      process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL || '',
    NEXT_PUBLIC_SUPABASE_ANON_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '',
    VITE_SUPABASE_URL:
      process.env.VITE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    VITE_SUPABASE_ANON_KEY:
      process.env.VITE_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
  },

  // Release builds with PostHog credentials emit browser maps for scripts/posthog-sourcemaps.cjs,
  // which uploads and then deletes them; other builds ship no maps.
  productionBrowserSourceMaps:
    isStaticExport &&
    Boolean(process.env.POSTHOG_CLI_API_KEY?.trim() && process.env.POSTHOG_CLI_PROJECT_ID?.trim()),

  // next/image optimisation requires a running server; disable for static export.
  images: {
    unoptimized: isStaticExport,
  },

  // Silence the "multiple lockfiles / inferred workspace root" warning.
  // Allow imports from /main (countries derivation shared with backend) via alias;
  // root must encompass both frontend/ and main/, so it points at the repo root.
  turbopack: {
    root: path.resolve(process.cwd(), '..'),
    resolveAlias: {
      '@countries': '../main/countries.ts',
    },
  },
};

export default nextConfig;
