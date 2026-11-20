'use client';

import { useState, useEffect, useCallback } from 'react';
import { WifiOff, RefreshCw, ChevronDown, ChevronUp, CheckCircle2 } from 'lucide-react';

export default function NetworkStatusBanner() {
  const [isOnline, setIsOnline] = useState<boolean>(true);
  const [isBuffering, setIsBuffering] = useState<boolean>(false);
  const [isChecking, setIsChecking] = useState<boolean>(false);
  const [isMinimized, setIsMinimized] = useState<boolean>(false);
  const [restoredNotice, setRestoredNotice] = useState<boolean>(false);

  const checkConnectivity = useCallback(async () => {
    if (typeof window === 'undefined') return;

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

  // Connection restored celebration
  if (restoredNotice) {
    return (
      <div className="fixed top-12 end-4 z-50 animate-fade-in">
        <div className="flex items-center gap-3 bg-white dark:bg-zinc-900 text-slate-800 dark:text-slate-100 px-4 py-2.5 rounded-2xl shadow-xl border-2 border-emerald-400">
          <div className="flex aspect-square size-7 items-center justify-center rounded-xl bg-emerald-100 text-emerald-600">
            <CheckCircle2 size={16} />
          </div>
          <div className="text-xs">
            <p className="font-bold text-emerald-700 dark:text-emerald-300">Connection Restored</p>
            <p className="text-slate-500 text-[11px]">The American Pancakes™ is synced with cloud.</p>
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
          className="flex items-center gap-2.5 bg-white dark:bg-zinc-900 hover:bg-pink-50 text-slate-800 px-3.5 py-1.5 rounded-full shadow-lg border-2 border-pink-400 transition-all cursor-pointer"
          title="Click to view network and buffer status"
        >
          <img
            src="/logo.png"
            alt="Pancake Logo"
            className="size-5 object-contain"
          />
          <span className="text-xs font-bold text-pink-600 tracking-tight">
            {!isOnline ? 'Offline Mode Active' : 'Buffering...'}
          </span>
          <ChevronDown size={14} className="text-pink-600" />
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
      <div className="bg-white dark:bg-zinc-900 border-2 border-pink-400/90 rounded-2xl p-4 shadow-xl shadow-pink-500/10 flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="relative size-12 shrink-0 rounded-xl bg-gradient-to-br from-pink-50 to-sky-50 border border-pink-200 p-1 flex items-center justify-center shadow-xs">
              <img
                src="/logo.png"
                alt="The American Pancakes"
                className="w-full h-full object-contain animate-pulse"
              />
              <span className="absolute -bottom-1 -end-1 size-3.5 rounded-full bg-pink-500 border-2 border-white flex items-center justify-center">
                <WifiOff size={8} className="text-white" />
              </span>
            </div>

            <div>
              <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                {!isOnline ? 'Offline Restaurant Mode' : 'Buffering Network Connection...'}
              </h4>
              <p className="text-[11px] font-semibold text-pink-600 mt-0.5">
                The American Pancakes™ POS
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setIsMinimized(true)}
            className="p-1 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100 transition-colors"
            title="Minimize banner"
            aria-label="Minimize offline banner"
          >
            <ChevronUp size={16} />
          </button>
        </div>

        <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed bg-pink-50/60 dark:bg-pink-950/20 p-2.5 rounded-xl border border-pink-100 dark:border-pink-900/30">
          {!isOnline
            ? 'No internet connection detected. Offline Mode is active — you can continue taking pancake orders, billing, and printing KOTs without interruption.'
            : 'Restaurant server response is buffering. Local orders and billing remain fully responsive.'}
        </p>

        <div className="flex items-center justify-between gap-2 pt-1">
          <span className="text-[11px] text-slate-400 font-medium">
            {!isOnline ? 'Auto-reconnection active' : 'Checking connection...'}
          </span>

          <button
            type="button"
            onClick={() => void checkConnectivity()}
            disabled={isChecking}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold rounded-xl bg-gradient-to-r from-pink-500 to-rose-500 hover:from-pink-600 hover:to-rose-600 text-white shadow-md shadow-pink-500/20 transition-all disabled:opacity-60 cursor-pointer"
          >
            <RefreshCw size={12} className={isChecking ? 'animate-spin' : ''} />
            <span>{isChecking ? 'Checking...' : 'Check Connection'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
