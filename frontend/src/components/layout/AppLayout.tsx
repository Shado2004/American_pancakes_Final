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
    <div className="relative min-h-screen w-full bg-[#FCFBF9] dark:bg-slate-950 overflow-x-hidden selection:bg-pink-100 selection:text-pink-900">
      {/* Layer 1 & 2: Solid Canvas Base + Soft Dessert Restaurant Ambient Gradient */}
      <div
        className="fixed inset-0 pointer-events-none z-0 bg-gradient-to-br from-pink-50/40 via-white to-sky-50/40 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950"
        aria-hidden="true"
      />

      {/* Layer 3: Top-left Brand Logo Watermark */}
      <div
        className="fixed -top-10 -start-10 pointer-events-none z-0 w-64 h-64 md:w-96 md:h-96 opacity-[0.04] bg-no-repeat bg-contain"
        style={{ backgroundImage: 'url(/logo.png)' }}
        aria-hidden="true"
      />

      {/* Layer 4: Bottom-right Pancake-Box Watermark + Vignette */}
      <div
        className="fixed -bottom-16 -end-16 pointer-events-none z-0 w-72 h-72 md:w-[500px] md:h-[500px] opacity-[0.04] rounded-full filter blur-[0.5px] scale-110 bg-no-repeat bg-cover bg-center"
        style={{
          backgroundImage: 'url(/shop-pancakes.jpg)',
          maskImage: 'radial-gradient(circle, rgba(0,0,0,1) 40%, rgba(0,0,0,0) 80%)',
          WebkitMaskImage: 'radial-gradient(circle, rgba(0,0,0,1) 40%, rgba(0,0,0,0) 80%)',
        }}
        aria-hidden="true"
      />

      {/* Layer 5: Top-right Soft Pink Glow & Bottom-left Soft Sky Blue Glow */}
      <div
        className="fixed top-0 end-0 pointer-events-none z-0 w-[350px] h-[350px] md:w-[550px] md:h-[550px] bg-gradient-to-bl from-pink-300/10 to-rose-300/5 rounded-full blur-3xl"
        aria-hidden="true"
      />
      <div
        className="fixed bottom-0 start-0 pointer-events-none z-0 w-[350px] h-[350px] md:w-[550px] md:h-[550px] bg-gradient-to-tr from-sky-300/10 to-blue-300/5 rounded-full blur-3xl"
        aria-hidden="true"
      />

      {/* Foreground z-10: POS Grid, Navbar, Cart */}
      <div className="relative z-10 min-h-screen flex flex-col w-full">
        {children}
      </div>
    </div>
  );
}
