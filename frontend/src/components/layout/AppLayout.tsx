import React from 'react';

interface AppLayoutProps {
  children: React.ReactNode;
}

/**
 * AppLayout — Five-Layer Atmosphere Backdrop Architecture
 *
 * Layer 1 — Solid Warm Canvas base: #FAF7F2
 * Layer 2 — Atmosphere gradient (90–95% opacity): from-[#faf7f2]/95 via-[#f8f3ea]/90 to-[#f5ece0]/95
 * Layer 3 — Top-left brand logo watermark: /logo.png, responsive dimensions, grayscale contrast-125
 * Layer 4 — Bottom-right pancake-box watermark: /shop-pancakes.jpg with radial vignette
 * Layer 5 — Centre ambient glow: warm amber/orange blur-3xl glow
 * Foreground z-10: Main POS viewport, navbar, and controls
 */
export default function AppLayout({ children }: AppLayoutProps) {
  return (
    <div className="relative min-h-screen w-full bg-[#faf7f2] overflow-x-hidden selection:bg-amber-200">
      {/* Layer 1 & 2: Solid Canvas Base + Atmosphere Warm Gradient */}
      <div
        className="fixed inset-0 pointer-events-none z-0 bg-gradient-to-br from-[#faf7f2]/95 via-[#f8f3ea]/90 to-[#f5ece0]/95"
        aria-hidden="true"
      />

      {/* Layer 3: Top-left Brand Logo Watermark */}
      <div
        className="fixed -top-12 -start-12 pointer-events-none z-0 w-64 h-64 md:w-96 md:h-96 opacity-[0.035] filter grayscale contrast-125 bg-no-repeat bg-contain"
        style={{ backgroundImage: 'url(/logo.png)' }}
        aria-hidden="true"
      />

      {/* Layer 4: Bottom-right Pancake-Box Watermark + Vignette */}
      <div
        className="fixed -bottom-16 -end-16 pointer-events-none z-0 w-72 h-72 md:w-[520px] md:h-[520px] opacity-[0.045] rounded-full filter blur-[0.5px] scale-110 bg-no-repeat bg-cover bg-center"
        style={{
          backgroundImage: 'url(/shop-pancakes.jpg)',
          maskImage: 'radial-gradient(circle, rgba(0,0,0,1) 40%, rgba(0,0,0,0) 80%)',
          WebkitMaskImage: 'radial-gradient(circle, rgba(0,0,0,1) 40%, rgba(0,0,0,0) 80%)',
        }}
        aria-hidden="true"
      />

      {/* Layer 5: Centre Ambient Glow */}
      <div
        className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none z-0 w-[420px] h-[420px] md:w-[700px] md:h-[700px] bg-gradient-to-tr from-amber-400/[0.025] to-orange-400/[0.025] rounded-full blur-3xl"
        aria-hidden="true"
      />

      {/* Foreground z-10: POS Grid, Navbar, Cart */}
      <div className="relative z-10 min-h-screen flex flex-col w-full">
        {children}
      </div>
    </div>
  );
}
