'use client';

import { useState, useEffect, useCallback } from 'react';
import { Wifi, WifiOff, RefreshCw, X, ChevronDown, ChevronUp, CheckCircle2 } from 'lucide-react';

export default function NetworkStatusBanner() {
  const [isOnline, setIsOnline] = useState<boolean>(true);
  const [isBuffering, setIsBuffering] = useState<boolean>(false);
  const [isChecking, setIsChecking] = useState<boolean>(false);
  const [isMinimized, setIsMinimized] = useState<boolean>(false);
  const [restoredNotice, setRestoredNotice] = useState<boolean>(false);

  const checkConnectivity = useCallback(async () => {
    if (typeof window === 'undefined') return;

    // First check browser native online flag
    if (!navigator.onLine) {
      setIsOnline(false);
      setIsBuffering(false);
      return;
    }

    setIsChecking(true);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      setIsBuffering(true);
      controller.abort();
    }, 3500);

    try {
      // Light ping to health endpoint
      const res = await fetch('/api/health', {
        method: 'GET',
        cache: 'no-store',
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (res.ok) {
        setIsBuffering(false);
        setIsOnline((wasOnline) => {
          if (!wasOnline) {
            setRestoredNotice(true);
            setTimeout(() => setRestoredNotice(false), 4500);
          }
          return true;
        });
      } else {
        setIsBuffering(true);
      }
    } catch {
      clearTimeout(timeoutId);
      setIsBuffering(false);
      setIsOnline(false);
    } finally {
      setIsChecking(false);
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    setIsOnline(navigator.onLine);

    const handleOnline = () => {
      void checkConnectivity();
    };

    const handleOffline = () => {
      setIsOnline(false);
      setIsBuffering(false);
      setRestoredNotice(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Periodic heartbeat: check every 20s if offline or buffering, or 60s if online
    const intervalTime = !isOnline || isBuffering ? 20000 : 60000;
    const interval = setInterval(() => {
      void checkConnectivity();
    }, intervalTime);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      clearInterval(interval);
    };
  }, [checkConnectivity, isOnline, isBuffering]);

  // If connection was restored, show a quick celebration toast
  if (restoredNotice) {
    return (
      <div className="fixed top-12 end-4 z-50 animate-fade-in">
        <div className="flex items-center gap-3 bg-emerald-600 text-white px-4 py-2.5 rounded-xl shadow-lg border border-emerald-500/40">
          <div className="flex aspect-square size-7 items-center justify-center rounded-lg bg-white/20">
            <CheckCircle2 size={16} className="text-white" />
          </div>
          <div className="text-xs">
            <p className="font-bold">Internet Connection Restored</p>
            <p className="text-emerald-100 text-[11px]">The American Pancakes™ is live and synced.</p>
          </div>
        </div>
      </div>
    );
  }

  const hasIssue = !isOnline || isBuffering;
  if (!hasIssue) return null;

  // Minimized pill state
  if (isMinimized) {
    return (
      <div className="fixed top-12 end-4 z-50 animate-fade-in">
        <button
          type="button"
          onClick={() => setIsMinimized(false)}
          className="flex items-center gap-2.5 bg-amber-500 hover:bg-amber-600 text-white px-3.5 py-1.5 rounded-full shadow-lg border border-amber-400 transition-all cursor-pointer"
          title="Click to view network and buffer status"
        >
          <img
            src="/logo.png"
            alt="Pancake Logo"
            className="size-5 object-contain"
          />
          <span className="text-xs font-bold tracking-tight">
            {!isOnline ? 'Offline Mode Active' : 'Buffering...'}
          </span>
          <ChevronDown size={14} />
        </button>
      </div>
    );
  }

  // Expanded banner state
  return (
    <div
      role="alert"
      className="fixed top-12 start-4 end-4 md:start-auto md:end-6 md:max-w-md z-50 animate-fade-in"
    >
      <div className="bg-white dark:bg-zinc-900 border-2 border-amber-500/80 rounded-2xl p-4 shadow-xl shadow-amber-500/10 flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            {/* Branded Logo with Pulse */}
            <div className="relative size-12 shrink-0 rounded-xl bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800/60 p-1 flex items-center justify-center shadow-xs">
              <img
                src="/logo.png"
                alt="The American Pancakes"
                className="w-full h-full object-contain animate-pulse"
              />
              <span className="absolute -bottom-1 -end-1 size-3.5 rounded-full bg-amber-500 border-2 border-white flex items-center justify-center">
                <WifiOff size={8} className="text-white" />
              </span>
            </div>

            <div>
              <div className="flex items-center gap-1.5">
                <h4 className="text-sm font-bold text-amber-950 dark:text-amber-100">
                  {!isOnline ? 'Offline Mode Active' : 'Buffering Connection...'}
                </h4>
              </div>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                The American Pancakes™ POS
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setIsMinimized(true)}
            className="p-1 text-muted-foreground hover:text-foreground rounded-md hover:bg-muted transition-colors"
            title="Minimize banner"
            aria-label="Minimize offline banner"
          >
            <ChevronUp size={16} />
          </button>
        </div>

        <p className="text-xs text-amber-900/90 dark:text-amber-200/90 leading-relaxed bg-amber-50/70 dark:bg-amber-950/30 p-2.5 rounded-lg border border-amber-100 dark:border-amber-900/40">
          {!isOnline
            ? 'No internet connection detected. Offline Mode is active — you can continue taking pancake orders, making bills, and printing KOTs without interruption.'
            : 'Store server response is buffering or network latency is high. All local orders and billing stay safe and responsive.'}
        </p>

        <div className="flex items-center justify-between gap-2 pt-1">
          <span className="text-[11px] text-muted-foreground font-medium">
            {!isOnline ? 'Automatic reconnection active' : 'Checking connection...'}
          </span>

          <button
            type="button"
            onClick={() => void checkConnectivity()}
            disabled={isChecking}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-amber-600 hover:bg-amber-700 active:bg-amber-800 text-white shadow-xs transition-colors disabled:opacity-60 cursor-pointer"
          >
            <RefreshCw size={12} className={isChecking ? 'animate-spin' : ''} />
            <span>{isChecking ? 'Checking...' : 'Check Connection'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
