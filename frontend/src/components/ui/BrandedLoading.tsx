'use client';

import { useState, useEffect } from 'react';
import { RefreshCw, WifiOff } from 'lucide-react';

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
    ? 'min-h-screen w-full flex flex-col items-center justify-center bg-gradient-to-br from-pink-50/40 via-white to-sky-50/40 dark:from-zinc-950 dark:via-zinc-900 dark:to-zinc-950 p-6'
    : 'w-full py-12 flex flex-col items-center justify-center p-4';

  if (compact) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 p-4 text-center">
        <div className="relative size-16">
          <div className="absolute inset-0 rounded-full border-3 border-pink-200 border-t-pink-500 animate-spin" />
          <div className="absolute inset-1.5 rounded-full bg-white dark:bg-zinc-800 p-1 flex items-center justify-center shadow-xs">
            <img
              src="/logo.png"
              alt="The American Pancakes"
              className="size-9 object-contain"
            />
          </div>
        </div>
        <p className="text-xs font-semibold text-pink-700 dark:text-pink-300">
          {message || 'Baking American Pancakes...'}
        </p>
      </div>
    );
  }

  return (
    <div className={containerClasses} role="status" aria-live="polite">
      <div className="relative flex flex-col items-center max-w-sm text-center">
        {/* Soft Pink & Sky Ambient Glow */}
        <div
          className="absolute -top-10 -start-10 size-48 bg-pink-400/15 rounded-full blur-2xl pointer-events-none"
          aria-hidden="true"
        />
        <div
          className="absolute -top-10 -end-10 size-48 bg-sky-400/15 rounded-full blur-2xl pointer-events-none"
          aria-hidden="true"
        />

        {/* Animated Pancake Brand Logo with Dual Accent Spinner Rings */}
        <div className="relative mb-6">
          {/* Outer Rotating Strawberry Pink Accent Ring */}
          <div className="size-28 sm:size-32 rounded-full border-4 border-pink-200/80 border-t-pink-500 animate-spin" />

          {/* Inner Brand Card with Logo */}
          <div className="absolute inset-2 rounded-full bg-white dark:bg-zinc-900 shadow-xl shadow-pink-500/10 flex items-center justify-center p-3 border border-pink-100 dark:border-zinc-800">
            <img
              src="/logo.png"
              alt="The American Pancakes Logo"
              className="w-full h-full object-contain animate-pulse"
            />
          </div>
        </div>

        {/* Brand Name Title */}
        <h2 className="text-xl sm:text-2xl font-extrabold tracking-tight text-slate-900 dark:text-slate-100 mb-1">
          The American Pancakes<span className="text-pink-500">™</span>
        </h2>
        <p className="text-xs font-bold text-sky-600 uppercase tracking-widest mb-3">
          Dessert Cafe & Restaurant
        </p>

        {/* Dynamic Status Message */}
        <div className="min-h-12 flex flex-col items-center justify-center">
          {!isTakingLong && (
            <p className="text-sm font-medium text-pink-600/90 dark:text-pink-300/90 animate-fade-in">
              {message || 'Baking fresh pancakes for you...'}
            </p>
          )}

          {isTakingLong && !isBufferSlow && (
            <div className="flex flex-col items-center gap-1 animate-fade-in">
              <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                Still baking... connecting to restaurant server
              </p>
              <div className="flex gap-1.5 items-center mt-1">
                <span className="size-2 rounded-full bg-pink-500 animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="size-2 rounded-full bg-sky-500 animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="size-2 rounded-full bg-pink-500 animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          )}

          {isBufferSlow && (
            <div className="mt-2 p-4 rounded-2xl bg-white dark:bg-zinc-900 border border-pink-200/80 shadow-md flex flex-col items-center gap-2 animate-fade-in">
              <div className="flex items-center gap-2 text-xs font-bold text-pink-700 dark:text-pink-300">
                <WifiOff size={14} className="text-pink-500 shrink-0" />
                <span>Taking longer than usual — Buffer check</span>
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed text-center">
                Offline restaurant mode is active. If your internet is fluctuating, local orders remain safe.
              </p>
              <button
                type="button"
                onClick={() => {
                  if (onRetry) onRetry();
                  else window.location.reload();
                }}
                className="mt-1 inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-xl bg-gradient-to-r from-pink-500 to-rose-500 hover:from-pink-600 hover:to-rose-600 text-white shadow-md shadow-pink-500/25 transition-all cursor-pointer"
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
