'use client';

import { useState, useEffect } from 'react';
import { RefreshCw, Wifi, WifiOff } from 'lucide-react';

interface BrandedLoadingProps {
  /** Optional custom initial message. */
  message?: string;
  /** Whether to fill the entire viewport or fit its container. Default true. */
  fullScreen?: boolean;
  /** Optional callback when user clicks retry. */
  onRetry?: () => void;
  /** Compact mode for smaller panels or drawers. */
  compact?: boolean;
}

export default function BrandedLoading({
  message,
  fullScreen = true,
  onRetry,
  compact = false,
}: BrandedLoadingProps) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const startTime = Date.now();
    const interval = setInterval(() => {
      setElapsed(Date.now() - startTime);
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const isTakingLong = elapsed >= 4000;
  const isBufferSlow = elapsed >= 9000;

  const containerClasses = fullScreen
    ? 'min-h-screen w-full flex flex-col items-center justify-center bg-gradient-to-br from-[#faf7f2] via-[#fffaf3] to-[#f5ede2] dark:from-zinc-950 dark:via-zinc-900 dark:to-zinc-950 p-6'
    : 'w-full py-12 flex flex-col items-center justify-center p-4';

  if (compact) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 p-4 text-center">
        <div className="relative size-16">
          <div className="absolute inset-0 rounded-full border-3 border-amber-200 border-t-amber-600 animate-spin" />
          <div className="absolute inset-1.5 rounded-full bg-white dark:bg-zinc-800 p-1 flex items-center justify-center shadow-xs">
            <img
              src="/logo.png"
              alt="The American Pancakes"
              className="size-9 object-contain"
            />
          </div>
        </div>
        <p className="text-xs font-medium text-amber-900 dark:text-amber-200">
          {message || 'Baking American Pancakes...'}
        </p>
      </div>
    );
  }

  return (
    <div className={containerClasses} role="status" aria-live="polite">
      <div className="relative flex flex-col items-center max-w-sm text-center">
        {/* Soft Ambient Glow */}
        <div
          className="absolute -top-10 size-48 bg-amber-400/20 dark:bg-amber-600/15 rounded-full blur-2xl pointer-events-none"
          aria-hidden="true"
        />

        {/* Animated Pancake Brand Logo with Spinner Ring */}
        <div className="relative mb-6">
          {/* Outer Rotating Amber Accent Ring */}
          <div className="size-28 sm:size-32 rounded-full border-4 border-amber-200/80 dark:border-amber-900/60 border-t-amber-500 animate-spin" />

          {/* Inner Brand Card with Logo */}
          <div className="absolute inset-2 rounded-full bg-white dark:bg-zinc-900 shadow-lg shadow-amber-500/10 flex items-center justify-center p-3 border border-amber-100 dark:border-zinc-800">
            <img
              src="/logo.png"
              alt="The American Pancakes Logo"
              className="w-full h-full object-contain animate-pulse"
            />
          </div>
        </div>

        {/* Brand Name Title */}
        <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-amber-950 dark:text-amber-100 mb-2">
          The American Pancakes<span className="text-amber-600">™</span>
        </h2>

        {/* Dynamic Status Message */}
        <div className="min-h-12 flex flex-col items-center justify-center">
          {!isTakingLong && (
            <p className="text-sm font-medium text-amber-800/80 dark:text-amber-300/80 animate-fade-in">
              {message || 'Baking your delicious pancakes...'}
            </p>
          )}

          {isTakingLong && !isBufferSlow && (
            <div className="flex flex-col items-center gap-1 animate-fade-in">
              <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
                Still baking... connecting to store server
              </p>
              <div className="flex gap-1.5 items-center mt-1">
                <span className="size-1.5 rounded-full bg-amber-500 animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="size-1.5 rounded-full bg-amber-500 animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="size-1.5 rounded-full bg-amber-500 animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          )}

          {isBufferSlow && (
            <div className="mt-2 p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 shadow-xs flex flex-col items-center gap-2 animate-fade-in">
              <div className="flex items-center gap-2 text-xs font-semibold text-amber-900 dark:text-amber-200">
                <WifiOff size={14} className="text-amber-600 shrink-0" />
                <span>Taking longer than usual — Slow buffer detected</span>
              </div>
              <p className="text-xs text-amber-800/90 dark:text-amber-300/90 leading-relaxed text-center">
                FloCafe offline cache is active. If your internet is fluctuating, you can wait a moment or reload.
              </p>
              <button
                type="button"
                onClick={() => {
                  if (onRetry) onRetry();
                  else window.location.reload();
                }}
                className="mt-1 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-amber-600 hover:bg-amber-700 text-white shadow-xs transition-colors cursor-pointer"
              >
                <RefreshCw size={12} className="animate-spin-reverse" />
                <span>Retry Connection</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
