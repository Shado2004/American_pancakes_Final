'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import type { ReactNode } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useAuthStore } from '@/store/auth';
import api from '@/lib/api';
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpDown,
  ArrowUpRight,
  Banknote,
  BarChart3,
  CalendarDays,
  ChefHat,
  ChevronDown,
  ClipboardList,
  CreditCard,
  Download,
  FileSpreadsheet,
  FileText,
  Minus,
  Package,
  ReceiptText,
  RotateCcw,
  Sparkles,
  Tags,
  TrendingUp,
  Utensils,
  Wallet,
  CheckCircle2,
  type LucideIcon,
} from 'lucide-react';
import { useTranslations, useLocale } from 'use-intl';
import { Ltr } from '@/components/layout/Ltr';
import { CashCloseModal } from '@/components/dashboard/CashCloseModal';
import { useCashClose } from '@/hooks/useCashClose';
import toast from 'react-hot-toast';
import { useFormatCurrency } from '@/hooks/useFormatCurrency';
import { useFormatDate } from '@/hooks/useFormatDate';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { tenantCan } from '@/lib/permissions';
import { businessDateForInstant } from '@shared/business-date';
import { downloadBlob } from '@/lib/download';
import { exportReportAsPdf, MenuPopupBlockedError } from '@/lib/export-pdf';
import { SendWhatsAppReportModal } from '@/components/dashboard/SendWhatsAppReportModal';
import { shareDailySalesViaWhatsApp } from '@/lib/whatsapp-share';

interface ProductPerformanceItem {
  productId: string;
  productName: string;
  isParcelBox: boolean;
  paidQuantity: number;
  freeQuantity: number;
  totalPrepared: number;
  refundedQuantity: number;
  netPaidQuantity: number;
  grossRevenue: number;
  discounts: number;
  refunds: number;
  netRevenue: number;
  ingredientCost: number;
  packagingCost: number;
  profit: number;
  orderCount: number;
}

interface RoadsidePackagingSummary {
  parcelBoxesSold: number;
  parcelBoxesAllocated?: number;
  parcelBoxesStandalone?: number;
  parcelBoxRevenue: number;
  parcelBoxUnitCost: number;
  parcelBoxCost: number;
  parcelBoxProfit: number;
  paperPlatesConsumed: number;
  paperPlateUnitCost: number;
  paperPlateCost: number;
  totalPackagingCost: number;
}

interface RoadsideBusinessSummary {
  netSales: number;
  totalPancakesPrepared: number;
  totalOrders: number;
  operatingProfit: number;
}

interface RoadsideCostProfitSummary {
  netSales: number;
  ingredientCost: number;
  packagingCost: number;
  totalDirectCost: number;
  grossContribution: number;
  grossContributionMarginPercent: number | null;
  operatingExpenses: number;
  operatingProfit: number;
}

interface RoadsidePaymentCollection {
  cash: {
    gross: number;
    refunds: number;
    net: number;
  };
  upi: {
    gross: number;
    refunds: number;
    net: number;
  };
  card: {
    gross: number;
    refunds: number;
    net: number;
  };
  other: {
    gross: number;
    refunds: number;
    net: number;
  };
  totalRefunds: number;
}

interface RoadsideBogoSummary {
  totalOrdersWithBogo: number;
  totalFreePancakes: number;
  totalBogoDiscounts: number;
}

interface RoadsideNormalSalesSummary {
  paidQuantity: number;
  revenue: number;
  rawIngredientCost: number;
  paperPlateCost: number;
  totalIngredientCost: number;
  profit: number;
  recoveredQuantity?: number;
  wastageQuantity?: number;
}

interface RoadsideBogoSalesSummary {
  pairsRedeemed: number;
  pancakesPrepared: number;
  paidQuantity: number;
  freeQuantity: number;
  revenue: number;
  discounts?: number;
  totalDiscounts?: number;
  rawIngredientCost: number;
  paperPlateCost: number;
  totalIngredientCost: number;
  profit: number;
  launchPairs?: number;
  launchPairsRedeemed?: number;
  loyaltyPairs?: number;
  loyaltyPairsRedeemed?: number;
  recoveredQuantity?: number;
  wastageQuantity?: number;
}

interface RoadsideReconciliation {
  reconciled?: boolean;
  quantityDifference?: number;
  revenueDifference?: number;
  plateCostDifference?: number;
  ingredientCostDifference?: number;
  profitDifference?: number;
  pancakesPreparedMatches?: boolean;
  revenueMatches?: boolean;
  ingredientCostMatches?: boolean;
  paperPlateCostMatches?: boolean;
  profitMatches?: boolean;
}

interface RoadsideDashboardSummary {
  startDate: string;
  endDate: string;
  businessSummary: RoadsideBusinessSummary;
  productPerformance: ProductPerformanceItem[];
  packagingSummary: RoadsidePackagingSummary;
  costProfitSummary: RoadsideCostProfitSummary;
  paymentCollection: RoadsidePaymentCollection;
  bogoSummary: RoadsideBogoSummary;
  normalSales?: RoadsideNormalSalesSummary;
  normalSalesSummary?: RoadsideNormalSalesSummary;
  bogoSales?: RoadsideBogoSalesSummary;
  bogoSalesSummary?: RoadsideBogoSalesSummary;
  reconciliation?: RoadsideReconciliation;
  billCount: number;
  refundCount: number;
  averageOrderValue: number;
}

interface RecentOrder {
  id: number;
  order_number: string;
  status: string;
  total: number;
  customer_name: string | null;
  table_name: string | null;
  created_at: string;
}

interface PromotionsSummary {
  totalRedemptionsCount: number;
  totalDiscountAmount: number;
  bogoRedemptionsCount: number;
  bogoDiscountAmount: number;
  bogoPaidQuantity: number;
  bogoFreeQuantity: number;
  bogoPreparedQuantity: number;
  launchBogoRedemptionsCount: number;
  launchBogoDiscountAmount: number;
  manualBogoRedemptionsCount: number;
  manualBogoDiscountAmount: number;
  loyaltyRewardRedemptionsCount: number;
  loyaltyRewardDiscountAmount: number;
}

function getMonthRange(month: string): { startDate: string; endDate: string } {
  const [year, monthNumber] = month.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return { startDate: `${month}-01`, endDate: `${month}-${String(lastDay).padStart(2, '0')}` };
}

function shiftDate(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

const orderStatusColor: Record<string, string> = {
  pending: 'text-yellow-600 dark:text-yellow-400',
  preparing: 'text-blue-600 dark:text-blue-400',
  ready: 'text-green-600 dark:text-green-400',
  served: 'text-purple-600 dark:text-purple-400',
  completed: 'text-muted-foreground',
  cancelled: 'text-red-500 dark:text-red-400',
};

export default function DashboardPage() {
  const searchParams = useSearchParams();
  const { currentTenant } = useAuthStore();
  const t = useTranslations('dashboard');
  const tCommon = useTranslations('common');
  const tPos = useTranslations('pos');
  const tOrders = useTranslations('orders');
  const tProducts = useTranslations('products');
  const router = useRouter();

  const [roadsideSummary, setRoadsideSummary] = useState<RoadsideDashboardSummary | null>(null);
  const [recentOrders, setRecentOrders] = useState<RecentOrder[]>([]);
  const [promotionsSummary, setPromotionsSummary] = useState<PromotionsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [dailySalesWhatsAppOpen, setDailySalesWhatsAppOpen] = useState(false);

  // Sorting state for Product Performance Table
  type SortKey = 'totalPrepared' | 'netRevenue' | 'profit' | 'productName' | 'paidQuantity' | 'freeQuantity';
  const [sortField, setSortField] = useState<SortKey>('totalPrepared');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

  const isOwner = tenantCan(currentTenant, 'dashboard.view');
  const canViewFinancials = tenantCan(currentTenant, 'reports.financial.view');
  const canSendDailySalesWhatsApp =
    tenantCan(currentTenant, 'reports.view') &&
    tenantCan(currentTenant, 'reports.daily-sales.export') &&
    tenantCan(currentTenant, 'whatsapp.use');
  const canViewSettings = tenantCan(currentTenant, 'settings.view');

  const fmt = useFormatCurrency();
  const fmtFinancial = (value: number | null | undefined): string => {
    if (value === null || value === undefined) return '—';
    return canViewFinancials ? fmt(value) : '—';
  };

  const { formatDateTime } = useFormatDate();
  const timeZone = currentTenant?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;

  const todayLocal = businessDateForInstant({
    instant: new Date(),
    timezone: timeZone,
    startTime: currentTenant?.business_day_start_time || '00:00',
  });

  const [selectedDate, setSelectedDate] = useState(todayLocal);
  const [selectedMonth, setSelectedMonth] = useState(todayLocal.slice(0, 7));
  const [rangeStartDate, setRangeStartDate] = useState(() => shiftDate(todayLocal, -6));
  const [rangeEndDate, setRangeEndDate] = useState(todayLocal);
  const [periodMode, setPeriodMode] = useState<'day' | 'month' | 'range'>('day');

  const dayInputRef = useRef<HTMLInputElement>(null);
  const monthInputRef = useRef<HTMLInputElement>(null);
  const rangeFromInputRef = useRef<HTMLInputElement>(null);
  const rangeToInputRef = useRef<HTMLInputElement>(null);

  const range =
    periodMode === 'month'
      ? getMonthRange(selectedMonth)
      : periodMode === 'range'
        ? { startDate: rangeStartDate, endDate: rangeEndDate }
        : { startDate: selectedDate, endDate: selectedDate };

  const handleRangeStartChange = (nextFrom: string) => {
    if (!nextFrom) return;
    setRangeStartDate(nextFrom);
    if (nextFrom > rangeEndDate) {
      setRangeEndDate(nextFrom);
    } else {
      const maxEnd = shiftDate(nextFrom, 92);
      if (rangeEndDate > maxEnd) {
        setRangeEndDate(maxEnd > todayLocal ? todayLocal : maxEnd);
      }
    }
  };

  const handleRangeEndChange = (nextTo: string) => {
    if (!nextTo) return;
    setRangeEndDate(nextTo);
    if (nextTo < rangeStartDate) {
      setRangeStartDate(nextTo);
    } else {
      const minStart = shiftDate(nextTo, -92);
      if (rangeStartDate < minStart) {
        setRangeStartDate(minStart);
      }
    }
  };

  const openPicker = (input: HTMLInputElement | null) => {
    if (!input) return;
    try {
      input.showPicker();
    } catch {
      input.focus();
    }
  };

  useEffect(() => {
    if (currentTenant && !isOwner) {
      router.replace('/pos');
    }
  }, [currentTenant, isOwner, router]);

  // Reset loading state when query parameters change
  const syncKey = `${isOwner}:${periodMode}:${range.startDate}:${range.endDate}`;
  const [syncedKey, setSyncedKey] = useState(syncKey);
  if (syncKey !== syncedKey) {
    setSyncedKey(syncKey);
    if (isOwner) setLoading(true);
  }

  useEffect(() => {
    if (!isOwner) return;
    const controller = new AbortController();

    const roadsideRequest = api.get('/reports/roadside-summary', {
      params: { start_date: range.startDate, end_date: range.endDate },
      signal: controller.signal,
    });

    const recentOrdersRequest = api
      .get('/reports/recentOrders', {
        params:
          periodMode !== 'day'
            ? { start_date: range.startDate, end_date: range.endDate, limit: 8 }
            : { date: selectedDate, limit: 8 },
        signal: controller.signal,
      })
      .catch(() => ({ data: { recentOrders: [] } }));

    const promotionsRequest = api
      .get('/promotions/reports/summary', {
        params: { start_date: range.startDate, end_date: range.endDate },
        signal: controller.signal,
      })
      .then((res) => res.data)
      .catch(() => null);

    Promise.all([roadsideRequest, recentOrdersRequest, promotionsRequest])
      .then(([roadsideRes, recentRes, promotionsRes]) => {
        setRoadsideSummary(roadsideRes.data);
        setRecentOrders(recentRes?.data?.recentOrders || []);
        setPromotionsSummary(promotionsRes ?? null);
      })
      .catch((err: unknown) => {
        if (err instanceof Error && (err.name === 'CanceledError' || err.name === 'AbortError')) {
          return;
        }
        toast.error(tCommon('somethingWrong'));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [
    isOwner,
    periodMode,
    selectedDate,
    selectedMonth,
    rangeStartDate,
    rangeEndDate,
    range.startDate,
    range.endDate,
    tCommon,
  ]);

  // Cash close modal handlers
  const cashClose = useCashClose();
  const { openCloseModal } = cashClose;
  const cashCloseAction = searchParams.get('action');
  const requestedCashCloseView = searchParams.get('view');
  const cashCloseView =
    requestedCashCloseView === 'x-report' || requestedCashCloseView === 'z-report'
      ? requestedCashCloseView
      : null;

  useEffect(() => {
    if (cashCloseAction !== 'cash-close') return;
    openCloseModal(cashCloseView);
    router.replace('/dashboard', { scroll: false });
  }, [cashCloseAction, cashCloseView, openCloseModal, router]);

  const exportDailySales = async (format: 'xlsx' | 'csv' | 'pdf') => {
    if (isExporting) return;
    setIsExporting(true);
    try {
      const dateParams =
        periodMode === 'day'
          ? { date: selectedDate }
          : { from: range.startDate, to: range.endDate };
      const span =
        periodMode === 'day' || range.startDate === range.endDate
          ? range.startDate
          : `${range.startDate}_to_${range.endDate}`;

      if (format === 'pdf') {
        await exportReportAsPdf({
          endpoint: '/reports/daily-sales/export',
          params: dateParams,
          filename: `daily-sales-${span}.pdf`,
        });
        return;
      }

      if (format === 'xlsx') {
        const res = await api.get('/reports/daily-sales/export', {
          params: { ...dateParams, format: 'xlsx' },
          responseType: 'blob',
        });
        downloadBlob(res.data as Blob, `daily-sales-${span}.xlsx`);
        return;
      }

      toast(t('exportCsvStarted'));
      for (const part of ['summary', 'daily', 'taxes', 'items', 'payments'] as const) {
        const res = await api.get('/reports/daily-sales/export', {
          params: { ...dateParams, format: 'csv', part },
          responseType: 'blob',
        });
        downloadBlob(res.data as Blob, `daily-sales-${span}-${part}.csv`);
      }
    } catch (error) {
      toast.error(
        error instanceof MenuPopupBlockedError
          ? tProducts('menuPopupBlocked')
          : tCommon('downloadFailed'),
      );
    } finally {
      setIsExporting(false);
    }
  };

  const exportProductSales = async (format: 'csv' | 'xlsx') => {
    if (isExporting) return;
    setIsExporting(true);
    try {
      const dateParams =
        periodMode === 'day'
          ? { start_date: selectedDate, end_date: selectedDate }
          : { start_date: range.startDate, end_date: range.endDate };
      const span =
        periodMode === 'day' || range.startDate === range.endDate
          ? (periodMode === 'day' ? selectedDate : range.startDate)
          : `${range.startDate}_to_${range.endDate}`;

      const res = await api.get('/reports/roadside-summary/export', {
        params: { ...dateParams, format },
        responseType: 'blob',
      });
      downloadBlob(res.data as Blob, `product-wise-pancake-sales-and-profit-${span}.${format}`);
      toast.success(
        format === 'csv'
          ? 'Product-Wise Sales & Profit CSV exported successfully'
          : 'Product-Wise Sales & Profit Excel (.xlsx) exported successfully',
      );
    } catch (error) {
      toast.error(tCommon('downloadFailed'));
    } finally {
      setIsExporting(false);
    }
  };

  const exportDailyInvoices = async () => {
    if (isExporting) return;
    setIsExporting(true);
    try {
      const dateParams =
        periodMode === 'day'
          ? { date: selectedDate }
          : { from: range.startDate, to: range.endDate };
      const span =
        periodMode === 'day' || range.startDate === range.endDate
          ? range.startDate
          : `${range.startDate}_to_${range.endDate}`;

      await exportReportAsPdf({
        endpoint: '/reports/daily-invoices/export',
        params: dateParams,
        filename: `daily-invoices-${span}.pdf`,
      });
    } catch (error) {
      toast.error(
        error instanceof MenuPopupBlockedError
          ? tProducts('menuPopupBlocked')
          : tCommon('downloadFailed'),
      );
    } finally {
      setIsExporting(false);
    }
  };

  const exportNormalSales = async (format: 'xlsx' | 'pdf') => {
    if (isExporting) return;
    setIsExporting(true);
    try {
      const dateParams =
        periodMode === 'day'
          ? { start_date: selectedDate, end_date: selectedDate }
          : { start_date: range.startDate, end_date: range.endDate };
      const span =
        periodMode === 'day' || range.startDate === range.endDate
          ? (periodMode === 'day' ? selectedDate : range.startDate)
          : `${range.startDate}_to_${range.endDate}`;

      if (format === 'pdf') {
        await exportReportAsPdf({
          endpoint: '/reports/sales/normal/export',
          params: dateParams,
          filename: `normal-pancake-sales-${span}.pdf`,
        });
        toast.success('Normal Sales Report (PDF) exported successfully');
        return;
      }

      const res = await api.get('/reports/sales/normal/export', {
        params: { ...dateParams, format: 'xlsx' },
        responseType: 'blob',
      });
      downloadBlob(res.data as Blob, `normal-pancake-sales-${span}.xlsx`);
      toast.success('Normal Sales Report (Excel) exported successfully');
    } catch (error) {
      toast.error(
        error instanceof MenuPopupBlockedError
          ? tProducts('menuPopupBlocked')
          : tCommon('downloadFailed'),
      );
    } finally {
      setIsExporting(false);
    }
  };

  const exportBogoSales = async (format: 'xlsx' | 'pdf') => {
    if (isExporting) return;
    setIsExporting(true);
    try {
      const dateParams =
        periodMode === 'day'
          ? { start_date: selectedDate, end_date: selectedDate }
          : { start_date: range.startDate, end_date: range.endDate };
      const span =
        periodMode === 'day' || range.startDate === range.endDate
          ? (periodMode === 'day' ? selectedDate : range.startDate)
          : `${range.startDate}_to_${range.endDate}`;

      if (format === 'pdf') {
        await exportReportAsPdf({
          endpoint: '/reports/sales/bogo/export',
          params: dateParams,
          filename: `bogo-pancake-sales-${span}.pdf`,
        });
        toast.success('BOGO Sales Report (PDF) exported successfully');
        return;
      }

      const res = await api.get('/reports/sales/bogo/export', {
        params: { ...dateParams, format: 'xlsx' },
        responseType: 'blob',
      });
      downloadBlob(res.data as Blob, `bogo-pancake-sales-${span}.xlsx`);
      toast.success('BOGO Sales Report (Excel) exported successfully');
    } catch (error) {
      toast.error(
        error instanceof MenuPopupBlockedError
          ? tProducts('menuPopupBlocked')
          : tCommon('downloadFailed'),
      );
    } finally {
      setIsExporting(false);
    }
  };

  const handleSendDailySalesWhatsApp = async (phoneE164: string): Promise<boolean> => {
    try {
      const dateParams =
        periodMode === 'day'
          ? { date: selectedDate }
          : { from: range.startDate, to: range.endDate };
      const result = await shareDailySalesViaWhatsApp(dateParams, phoneE164);
      if (result === false) {
        toast.error(tCommon('somethingWrong'));
        return false;
      }
      toast.success(
        t(
          result === 'sent'
            ? 'reportSentSuccess'
            : result === 'submitted'
              ? 'reportSubmittedPending'
              : 'reportOpeningWhatsAppWeb',
        ),
      );
      return true;
    } catch {
      toast.error(tCommon('somethingWrong'));
      return false;
    }
  };

  // Sort products
  const handleSort = (field: SortKey) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  const sortedProducts = useMemo(() => {
    if (!roadsideSummary?.productPerformance) return [];
    return [...roadsideSummary.productPerformance].sort((a, b) => {
      let valA: string | number = a[sortField];
      let valB: string | number = b[sortField];
      if (typeof valA === 'string') {
        valA = valA.toLowerCase();
        valB = String(valB).toLowerCase();
        return sortDirection === 'asc'
          ? valA.localeCompare(valB)
          : valB.localeCompare(valA);
      }
      return sortDirection === 'asc'
        ? Number(valA) - Number(valB)
        : Number(valB) - Number(valA);
    });
  }, [roadsideSummary?.productPerformance, sortField, sortDirection]);

  // Product table totals
  const productTotals = useMemo(() => {
    const list = roadsideSummary?.productPerformance || [];
    return list.reduce(
      (acc, item) => ({
        paidQuantity: acc.paidQuantity + item.paidQuantity,
        freeQuantity: acc.freeQuantity + item.freeQuantity,
        totalPrepared: acc.totalPrepared + item.totalPrepared,
        grossRevenue: acc.grossRevenue + item.grossRevenue,
        discounts: acc.discounts + item.discounts,
        refunds: acc.refunds + item.refunds,
        netRevenue: acc.netRevenue + item.netRevenue,
        ingredientCost: acc.ingredientCost + item.ingredientCost,
        packagingCost: acc.packagingCost + item.packagingCost,
        profit: acc.profit + item.profit,
      }),
      {
        paidQuantity: 0,
        freeQuantity: 0,
        totalPrepared: 0,
        grossRevenue: 0,
        discounts: 0,
        refunds: 0,
        netRevenue: 0,
        ingredientCost: 0,
        packagingCost: 0,
        profit: 0,
      },
    );
  }, [roadsideSummary?.productPerformance]);

  return (
    <div className="min-h-full bg-background p-4 sm:p-6 lg:p-7">
      {/* Top Header & Date Navigation */}
      <div className="mb-7 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            American Pancakes POS
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {periodMode === 'month'
              ? `Monthly Report · ${selectedMonth}`
              : periodMode === 'range'
                ? `Range Report · ${rangeStartDate} to ${rangeEndDate}`
                : `Daily Report · ${selectedDate}`}
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-start gap-2 xl:justify-end">
          {/* Day / Month / Range Mode Selector */}
          <div className="inline-flex rounded-xl border border-border bg-card p-1 shadow-sm">
            <button
              type="button"
              onClick={() => setPeriodMode('day')}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                periodMode === 'day'
                  ? 'bg-brand text-brand-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Day
            </button>
            <button
              type="button"
              onClick={() => setPeriodMode('month')}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                periodMode === 'month'
                  ? 'bg-brand text-brand-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Month
            </button>
            <button
              type="button"
              onClick={() => setPeriodMode('range')}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                periodMode === 'range'
                  ? 'bg-brand text-brand-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Range
            </button>
          </div>

          {/* Date Picker Input */}
          <div className="flex items-center gap-2">
            {periodMode === 'day' && (
              <div className="relative flex items-center">
                <input
                  ref={dayInputRef}
                  type="date"
                  value={selectedDate}
                  max={todayLocal}
                  onChange={(e) => setSelectedDate(e.target.value || todayLocal)}
                  className="rounded-xl border border-border bg-card px-3 py-1.5 text-xs font-semibold shadow-sm text-foreground focus:outline-none focus:ring-2 focus:ring-brand"
                />
                <button
                  type="button"
                  onClick={() => openPicker(dayInputRef.current)}
                  className="ms-1.5 rounded-lg border border-border bg-card p-2 text-muted-foreground hover:text-foreground shadow-sm"
                  title="Open Calendar"
                >
                  <CalendarDays size={15} />
                </button>
              </div>
            )}

            {periodMode === 'month' && (
              <div className="relative flex items-center">
                <input
                  ref={monthInputRef}
                  type="month"
                  value={selectedMonth}
                  max={todayLocal.slice(0, 7)}
                  onChange={(e) => setSelectedMonth(e.target.value || todayLocal.slice(0, 7))}
                  className="rounded-xl border border-border bg-card px-3 py-1.5 text-xs font-semibold shadow-sm text-foreground focus:outline-none focus:ring-2 focus:ring-brand"
                />
                <button
                  type="button"
                  onClick={() => openPicker(monthInputRef.current)}
                  className="ms-1.5 rounded-lg border border-border bg-card p-2 text-muted-foreground hover:text-foreground shadow-sm"
                  title="Open Month Picker"
                >
                  <CalendarDays size={15} />
                </button>
              </div>
            )}

            {periodMode === 'range' && (
              <div className="flex items-center gap-1.5">
                <input
                  ref={rangeFromInputRef}
                  type="date"
                  value={rangeStartDate}
                  max={rangeEndDate}
                  onChange={(e) => handleRangeStartChange(e.target.value)}
                  className="rounded-xl border border-border bg-card px-2.5 py-1.5 text-xs font-semibold shadow-sm text-foreground focus:outline-none focus:ring-2 focus:ring-brand"
                />
                <span className="text-xs text-muted-foreground">to</span>
                <input
                  ref={rangeToInputRef}
                  type="date"
                  value={rangeEndDate}
                  min={rangeStartDate}
                  max={todayLocal}
                  onChange={(e) => handleRangeEndChange(e.target.value)}
                  className="rounded-xl border border-border bg-card px-2.5 py-1.5 text-xs font-semibold shadow-sm text-foreground focus:outline-none focus:ring-2 focus:ring-brand"
                />
              </div>
            )}
          </div>

          {/* Export Dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 rounded-xl border-border bg-card shadow-sm"
                disabled={isExporting}
              >
                <Download size={14} />
                <span>Export</span>
                <ChevronDown size={13} className="text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72">
              <DropdownMenuLabel className="text-xs font-semibold text-brand">
                Product-Wise Sales & Profit
              </DropdownMenuLabel>
              <DropdownMenuItem onClick={() => exportProductSales('xlsx')}>
                <FileSpreadsheet size={14} className="me-2 text-emerald-600" />
                <span>Product-Wise Profit Report (Excel)</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => exportProductSales('csv')}>
                <Download size={14} className="me-2 text-emerald-600" />
                <span>Product-Wise Profit Report (CSV)</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-xs font-semibold text-muted-foreground">
                Store-Wide Financial Audit (5 Sheets)
              </DropdownMenuLabel>
              <DropdownMenuItem onClick={() => exportDailySales('xlsx')}>
                <FileSpreadsheet size={14} className="me-2 text-blue-600" />
                <span>Daily Sales Audit (Excel Workbook)</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => exportDailySales('csv')}>
                <Download size={14} className="me-2 text-blue-600" />
                <span>Daily Sales Audit (CSV Items)</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => exportDailySales('pdf')}>
                <FileText size={14} className="me-2 text-red-600" />
                <span>Daily Sales Summary (PDF)</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={exportDailyInvoices}>
                <ReceiptText size={14} className="me-2 text-purple-600" />
                <span>Invoices Summary (PDF)</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-xs font-semibold text-amber-700 dark:text-amber-400">
                On-Demand Sales Reports
              </DropdownMenuLabel>
              <DropdownMenuItem onClick={() => exportNormalSales('xlsx')}>
                <FileSpreadsheet size={14} className="me-2 text-emerald-600" />
                <span>Normal Sales Report (Excel)</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => exportNormalSales('pdf')}>
                <FileText size={14} className="me-2 text-red-600" />
                <span>Normal Sales Report (PDF)</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => exportBogoSales('xlsx')}>
                <FileSpreadsheet size={14} className="me-2 text-amber-600" />
                <span>BOGO Sales Report (Excel)</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => exportBogoSales('pdf')}>
                <FileText size={14} className="me-2 text-red-600" />
                <span>BOGO Sales Report (PDF)</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {loading ? (
        <div className="flex min-h-[400px] items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <div className="size-8 animate-spin rounded-full border-4 border-brand border-t-transparent" />
            <p className="text-xs font-medium text-muted-foreground">Loading roadside sales & profit data...</p>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {/* SECTION A: BUSINESS SUMMARY */}
          <section aria-label="Business Overview">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {/* 1. Net Sales */}
              <div className="rounded-2xl border border-border bg-card p-5 shadow-sm transition-all hover:shadow-md">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Net Sales
                  </span>
                  <span className="flex size-10 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
                    <Banknote size={20} />
                  </span>
                </div>
                <p className="mt-4 text-3xl font-extrabold tracking-tight text-foreground">
                  {fmtFinancial(roadsideSummary?.businessSummary.netSales ?? 0)}
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  Gross collected minus discounts & refunds
                </p>
              </div>

              {/* 2. Total Pancakes Prepared */}
              <div className="rounded-2xl border border-border bg-card p-5 shadow-sm transition-all hover:shadow-md">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Total Pancakes Prepared
                  </span>
                  <span className="flex size-10 items-center justify-center rounded-xl bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">
                    <ChefHat size={20} />
                  </span>
                </div>
                <p className="mt-4 text-3xl font-extrabold tracking-tight text-foreground">
                  {roadsideSummary?.businessSummary.totalPancakesPrepared ?? 0}
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  {roadsideSummary?.bogoSummary.totalFreePancakes
                    ? `Includes ${roadsideSummary.bogoSummary.totalFreePancakes} free BOGO pancakes cooked`
                    : 'Paid and promotional physical pancakes'}
                </p>
              </div>

              {/* 3. Total Orders */}
              <div className="rounded-2xl border border-border bg-card p-5 shadow-sm transition-all hover:shadow-md">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Total Orders
                  </span>
                  <span className="flex size-10 items-center justify-center rounded-xl bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300">
                    <ClipboardList size={20} />
                  </span>
                </div>
                <p className="mt-4 text-3xl font-extrabold tracking-tight text-foreground">
                  {roadsideSummary?.businessSummary.totalOrders ?? 0}
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  Non-cancelled customer orders settled
                </p>
              </div>

              {/* 4. Operating Profit */}
              <div
                className={`rounded-2xl border p-5 shadow-sm transition-all hover:shadow-md ${
                  (roadsideSummary?.businessSummary.operatingProfit ?? 0) >= 0
                    ? 'border-teal-200 bg-teal-50/50 dark:border-teal-900/40 dark:bg-teal-950/20'
                    : 'border-rose-200 bg-rose-50/50 dark:border-rose-900/40 dark:bg-rose-950/20'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Operating Profit
                  </span>
                  <span
                    className={`flex size-10 items-center justify-center rounded-xl ${
                      (roadsideSummary?.businessSummary.operatingProfit ?? 0) >= 0
                        ? 'bg-teal-100 text-teal-700 dark:bg-teal-900/50 dark:text-teal-300'
                        : 'bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-300'
                    }`}
                  >
                    <TrendingUp size={20} />
                  </span>
                </div>
                <p
                  className={`mt-4 text-3xl font-extrabold tracking-tight ${
                    (roadsideSummary?.businessSummary.operatingProfit ?? 0) >= 0
                      ? 'text-teal-700 dark:text-teal-300'
                      : 'text-rose-600 dark:text-rose-400'
                  }`}
                >
                  {fmtFinancial(roadsideSummary?.businessSummary.operatingProfit ?? 0)}
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  Gross contribution minus operating expenses
                </p>
              </div>
            </div>
          </section>

          {/* SECTION B: PRODUCT-WISE PANCAKE SALES & PROFIT TABLE */}
          <section
            aria-label="Product Performance Table"
            className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm"
          >
            <div className="flex flex-col gap-2 border-b border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <span className="flex size-9 items-center justify-center rounded-xl bg-brand/10 text-brand">
                  <Utensils size={18} />
                </span>
                <div>
                  <h2 className="font-bold text-foreground">Product-Wise Pancake Sales & Profit</h2>
                  <p className="text-xs text-muted-foreground">
                    Complete breakdown of quantities prepared, revenues, recipe costs, and profit
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground mr-1">Click column headers to sort</span>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 text-xs h-8"
                  onClick={() => exportProductSales('csv')}
                  disabled={isExporting}
                >
                  <Download size={13} />
                  <span>Export CSV</span>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 text-xs h-8"
                  onClick={() => exportProductSales('xlsx')}
                  disabled={isExporting}
                >
                  <FileSpreadsheet size={13} />
                  <span>Export Excel</span>
                </Button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-muted/50 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th
                      className="cursor-pointer px-4 py-3 hover:text-foreground"
                      onClick={() => handleSort('productName')}
                    >
                      <div className="flex items-center gap-1">
                        <span>Product</span>
                        <ArrowUpDown size={11} />
                      </div>
                    </th>
                    <th
                      className="cursor-pointer px-3 py-3 text-center hover:text-foreground"
                      onClick={() => handleSort('paidQuantity')}
                    >
                      <div className="flex items-center justify-center gap-1">
                        <span>Paid</span>
                        <ArrowUpDown size={11} />
                      </div>
                    </th>
                    <th
                      className="cursor-pointer px-3 py-3 text-center hover:text-foreground"
                      onClick={() => handleSort('freeQuantity')}
                    >
                      <div className="flex items-center justify-center gap-1">
                        <span>Free BOGO</span>
                        <ArrowUpDown size={11} />
                      </div>
                    </th>
                    <th
                      className="cursor-pointer px-3 py-3 text-center hover:text-foreground"
                      onClick={() => handleSort('totalPrepared')}
                    >
                      <div className="flex items-center justify-center gap-1">
                        <span>Total Prepared</span>
                        <ArrowUpDown size={11} />
                      </div>
                    </th>
                    <th className="px-3 py-3 text-right">Gross Rev</th>
                    <th className="px-3 py-3 text-right">Discounts</th>
                    <th className="px-3 py-3 text-right">Refunds</th>
                    <th
                      className="cursor-pointer px-4 py-3 text-right hover:text-foreground"
                      onClick={() => handleSort('netRevenue')}
                    >
                      <div className="flex items-center justify-end gap-1">
                        <span>Net Revenue</span>
                        <ArrowUpDown size={11} />
                      </div>
                    </th>
                    <th className="px-3 py-3 text-right">Ingredient Cost</th>
                    <th className="px-3 py-3 text-right">Packaging Cost</th>
                    <th
                      className="cursor-pointer px-4 py-3 text-right hover:text-foreground"
                      onClick={() => handleSort('profit')}
                    >
                      <div className="flex items-center justify-end gap-1">
                        <span>Contribution / Profit</span>
                        <ArrowUpDown size={11} />
                      </div>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border font-medium">
                  {sortedProducts.length === 0 ? (
                    <tr>
                      <td colSpan={11} className="py-8 text-center text-muted-foreground">
                        No sales recorded for this period.
                      </td>
                    </tr>
                  ) : (
                    sortedProducts.map((prod) => (
                      <tr key={prod.productId} className="hover:bg-muted/40 transition-colors">
                        <td className="px-4 py-3 font-semibold text-foreground">
                          <div className="flex items-center gap-2">
                            <span>{prod.productName}</span>
                            {prod.isParcelBox && (
                              <span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                                Box
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-3 text-center text-foreground">
                          {prod.paidQuantity}
                          {prod.refundedQuantity > 0 && (
                            <span className="ms-1 text-[10px] text-rose-500">
                              (-{prod.refundedQuantity})
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-3 text-center">
                          {prod.freeQuantity > 0 ? (
                            <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                              {prod.freeQuantity}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">0</span>
                          )}
                        </td>
                        <td className="px-3 py-3 text-center font-bold text-foreground">
                          {prod.totalPrepared}
                        </td>
                        <td className="px-3 py-3 text-right text-muted-foreground">
                          {fmtFinancial(prod.grossRevenue)}
                        </td>
                        <td className="px-3 py-3 text-right text-muted-foreground">
                          {prod.discounts > 0 ? `-${fmtFinancial(prod.discounts)}` : '₹0'}
                        </td>
                        <td className="px-3 py-3 text-right">
                          {prod.refunds > 0 ? (
                            <span className="font-semibold text-rose-600 dark:text-rose-400">
                              -{fmtFinancial(prod.refunds)}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">₹0</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right font-bold text-foreground">
                          {fmtFinancial(prod.netRevenue)}
                        </td>
                        <td className="px-3 py-3 text-right text-muted-foreground">
                          {fmtFinancial(prod.ingredientCost)}
                        </td>
                        <td className="px-3 py-3 text-right text-muted-foreground">
                          {fmtFinancial(prod.packagingCost)}
                        </td>
                        <td
                          className={`px-4 py-3 text-right font-bold ${
                            prod.profit >= 0
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : 'text-rose-600 dark:text-rose-400'
                          }`}
                        >
                          {fmtFinancial(prod.profit)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
                {sortedProducts.length > 0 && (
                  <tfoot className="border-t-2 border-border bg-muted/30 font-bold text-foreground">
                    <tr>
                      <td className="px-4 py-3">Total</td>
                      <td className="px-3 py-3 text-center">{productTotals.paidQuantity}</td>
                      <td className="px-3 py-3 text-center text-emerald-600 dark:text-emerald-400">
                        {productTotals.freeQuantity}
                      </td>
                      <td className="px-3 py-3 text-center">{productTotals.totalPrepared}</td>
                      <td className="px-3 py-3 text-right">{fmtFinancial(productTotals.grossRevenue)}</td>
                      <td className="px-3 py-3 text-right">
                        {productTotals.discounts > 0 ? `-${fmtFinancial(productTotals.discounts)}` : '₹0'}
                      </td>
                      <td className="px-3 py-3 text-right text-rose-600 dark:text-rose-400">
                        {productTotals.refunds > 0 ? `-${fmtFinancial(productTotals.refunds)}` : '₹0'}
                      </td>
                      <td className="px-4 py-3 text-right font-extrabold">
                        {fmtFinancial(productTotals.netRevenue)}
                      </td>
                      <td className="px-3 py-3 text-right">{fmtFinancial(productTotals.ingredientCost)}</td>
                      <td className="px-3 py-3 text-right">{fmtFinancial(productTotals.packagingCost)}</td>
                      <td
                        className={`px-4 py-3 text-right font-extrabold ${
                          productTotals.profit >= 0
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-rose-600 dark:text-rose-400'
                        }`}
                      >
                        {fmtFinancial(productTotals.profit)}
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </section>

          {/* SECTION C: PACKAGING SUMMARY */}
          <section aria-label="Packaging Summary">
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
              {/* Parcel Box Card */}
              <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
                <div className="flex items-center justify-between border-b border-border pb-3">
                  <div className="flex items-center gap-2.5">
                    <span className="flex size-9 items-center justify-center rounded-xl bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300">
                      <Package size={18} />
                    </span>
                    <div>
                      <h3 className="font-bold text-foreground">Parcel Box</h3>
                      <p className="text-[11px] text-muted-foreground">
                        Customer-facing POS product · ₹5.00 selling price
                      </p>
                    </div>
                  </div>
                  <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700 border border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800">
                    Replaces 1 Plate
                  </span>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-4">
                  <div>
                    <span className="text-xs text-muted-foreground">Boxes Sold</span>
                    <p className="mt-1 text-2xl font-bold text-foreground">
                      {roadsideSummary?.packagingSummary.parcelBoxesSold ?? 0}
                    </p>
                    <p className="mt-0.5 text-[10px] text-muted-foreground">
                      {roadsideSummary?.packagingSummary.parcelBoxesAllocated ?? 0} packaging · {roadsideSummary?.packagingSummary.parcelBoxesStandalone ?? 0} standalone
                    </p>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground">Sales Revenue</span>
                    <p className="mt-1 text-2xl font-bold text-foreground">
                      {fmtFinancial(roadsideSummary?.packagingSummary.parcelBoxRevenue ?? 0)}
                    </p>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground">
                      Purchase Cost (@{fmt(roadsideSummary?.packagingSummary.parcelBoxUnitCost ?? 3.5)})
                    </span>
                    <p className="mt-1 text-lg font-semibold text-muted-foreground">
                      {fmtFinancial(roadsideSummary?.packagingSummary.parcelBoxCost ?? 0)}
                    </p>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground">Contribution / Profit</span>
                    <p
                      className={`mt-1 text-lg font-bold ${
                        (roadsideSummary?.packagingSummary.parcelBoxProfit ?? 0) >= 0
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-rose-600 dark:text-rose-400'
                      }`}
                    >
                      {fmtFinancial(roadsideSummary?.packagingSummary.parcelBoxProfit ?? 0)}
                    </p>
                  </div>
                </div>
              </div>

              {/* Paper Plate Card */}
              <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
                <div className="flex items-center justify-between border-b border-border pb-3">
                  <div className="flex items-center gap-2.5">
                    <span className="flex size-9 items-center justify-center rounded-xl bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">
                      <Utensils size={18} />
                    </span>
                    <div>
                      <h3 className="font-bold text-foreground">Paper Plate</h3>
                      <p className="text-[11px] text-muted-foreground">
                        Managed as ingredient supply · ₹2.50 included in Ingredient Cost
                      </p>
                    </div>
                  </div>
                  <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800">
                    ₹0 Charged
                  </span>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-4">
                  <div>
                    <span className="text-xs text-muted-foreground">Plates Consumed</span>
                    <p className="mt-1 text-2xl font-bold text-foreground">
                      {roadsideSummary?.packagingSummary.paperPlatesConsumed ?? 0}
                    </p>
                    <p className="mt-0.5 text-[10px] text-muted-foreground">
                      1 paper plate per pancake served without Parcel Box
                    </p>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground">Total Plate Cost</span>
                    <p className="mt-1 text-2xl font-bold text-foreground">
                      {fmtFinancial(roadsideSummary?.packagingSummary.paperPlateCost ?? 0)}
                    </p>
                    <p className="mt-0.5 text-[10px] text-muted-foreground">
                      Accounted under Ingredient Cost
                    </p>
                  </div>
                  <div className="col-span-2 rounded-xl bg-muted/40 p-3">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-foreground">Dashboard Packaging Cost (Parcel Boxes Only)</span>
                      <span className="text-sm font-bold text-foreground">
                        {fmtFinancial(roadsideSummary?.packagingSummary.totalPackagingCost ?? 0)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* SECTION D: COST AND PROFIT BREAKDOWN */}
          <section
            aria-label="Cost and Profit"
            className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm"
          >
            <div className="border-b border-border px-5 py-4">
              <h2 className="font-bold text-foreground">Cost & Profit Breakdown</h2>
              <p className="text-xs text-muted-foreground">
                Ingredient costs, packaging costs, gross contribution margin, and business operating profit
              </p>
            </div>

            <div className="grid grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-border lg:grid-cols-6">
              {/* Ingredient Cost */}
              <div className="p-4 sm:p-5">
                <span className="text-xs text-muted-foreground">Ingredient Cost</span>
                <p className="mt-2 text-lg font-bold text-foreground">
                  {fmtFinancial(roadsideSummary?.costProfitSummary.ingredientCost ?? 0)}
                </p>
                <p className="mt-1 text-[11px] text-muted-foreground">Ingredients + Paper Plates (₹2.50)</p>
              </div>

              {/* Packaging Cost */}
              <div className="p-4 sm:p-5">
                <span className="text-xs text-muted-foreground">Packaging Cost</span>
                <p className="mt-2 text-lg font-bold text-foreground">
                  {fmtFinancial(roadsideSummary?.costProfitSummary.packagingCost ?? 0)}
                </p>
                <p className="mt-1 text-[11px] text-muted-foreground">Parcel Boxes Only</p>
              </div>

              {/* Total Direct Cost */}
              <div className="p-4 sm:p-5">
                <span className="text-xs text-muted-foreground">Total Direct Cost</span>
                <p className="mt-2 text-lg font-bold text-foreground">
                  {fmtFinancial(roadsideSummary?.costProfitSummary.totalDirectCost ?? 0)}
                </p>
                <p className="mt-1 text-[11px] text-muted-foreground">Ingredients + Packaging</p>
              </div>

              {/* Gross Contribution */}
              <div className="p-4 sm:p-5">
                <span className="text-xs text-muted-foreground">Gross Contribution</span>
                <p className="mt-2 text-lg font-bold text-foreground">
                  {fmtFinancial(roadsideSummary?.costProfitSummary.grossContribution ?? 0)}
                </p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Margin:{' '}
                  {roadsideSummary?.costProfitSummary.grossContributionMarginPercent !== null &&
                  roadsideSummary?.costProfitSummary.grossContributionMarginPercent !== undefined
                    ? `${roadsideSummary.costProfitSummary.grossContributionMarginPercent}%`
                    : '—'}
                </p>
              </div>

              {/* Operating Expenses */}
              <div className="p-4 sm:p-5">
                <span className="text-xs text-muted-foreground">Operating Expenses</span>
                <p className="mt-2 text-lg font-bold text-foreground">
                  {fmtFinancial(roadsideSummary?.costProfitSummary.operatingExpenses ?? 0)}
                </p>
                <p className="mt-1 text-[11px] text-muted-foreground">Business period expenses</p>
              </div>

              {/* Operating Profit */}
              <div className="p-4 sm:p-5">
                <span className="text-xs text-muted-foreground">Operating Profit</span>
                <p
                  className={`mt-2 text-lg font-extrabold ${
                    (roadsideSummary?.costProfitSummary.operatingProfit ?? 0) >= 0
                      ? 'text-teal-600 dark:text-teal-400'
                      : 'text-rose-600 dark:text-rose-400'
                  }`}
                >
                  {fmtFinancial(roadsideSummary?.costProfitSummary.operatingProfit ?? 0)}
                </p>
                <p className="mt-1 text-[11px] text-muted-foreground">Contribution − Expenses</p>
              </div>
            </div>
          </section>

          {/* SECTION E: PAYMENT COLLECTION */}
          <section
            aria-label="Payment Collection"
            className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm"
          >
            <div className="border-b border-border px-5 py-4">
              <h2 className="font-bold text-foreground">Payment Collection</h2>
              <p className="text-xs text-muted-foreground">
                Actual settlement breakdown across Cash and UPI tender methods
              </p>
            </div>

            <div className="grid grid-cols-1 divide-y sm:divide-y-0 sm:divide-x divide-border sm:grid-cols-3">
              {/* Cash Collection */}
              <div className="p-5">
                <div className="flex items-center gap-2">
                  <span className="flex size-7 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                    <Banknote size={15} />
                  </span>
                  <span className="font-bold text-foreground">Cash</span>
                </div>
                <div className="mt-3 space-y-1 text-xs">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Gross Collected:</span>
                    <span className="font-semibold text-foreground">
                      {fmtFinancial(roadsideSummary?.paymentCollection.cash.gross ?? 0)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Cash Refunds:</span>
                    <span className="font-semibold text-rose-600 dark:text-rose-400">
                      -{fmtFinancial(roadsideSummary?.paymentCollection.cash.refunds ?? 0)}
                    </span>
                  </div>
                  <div className="flex justify-between border-t border-border pt-1 font-bold">
                    <span className="text-foreground">Net Cash:</span>
                    <span className="text-foreground">
                      {fmtFinancial(roadsideSummary?.paymentCollection.cash.net ?? 0)}
                    </span>
                  </div>
                </div>
              </div>

              {/* UPI Collection */}
              <div className="p-5">
                <div className="flex items-center gap-2">
                  <span className="flex size-7 items-center justify-center rounded-lg bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300">
                    <Wallet size={15} />
                  </span>
                  <span className="font-bold text-foreground">UPI</span>
                </div>
                <div className="mt-3 space-y-1 text-xs">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Gross Collected:</span>
                    <span className="font-semibold text-foreground">
                      {fmtFinancial(roadsideSummary?.paymentCollection.upi.gross ?? 0)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">UPI Refunds:</span>
                    <span className="font-semibold text-rose-600 dark:text-rose-400">
                      -{fmtFinancial(roadsideSummary?.paymentCollection.upi.refunds ?? 0)}
                    </span>
                  </div>
                  <div className="flex justify-between border-t border-border pt-1 font-bold">
                    <span className="text-foreground">Net UPI:</span>
                    <span className="text-foreground">
                      {fmtFinancial(roadsideSummary?.paymentCollection.upi.net ?? 0)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Refunds Total */}
              <div className="p-5">
                <div className="flex items-center gap-2">
                  <span className="flex size-7 items-center justify-center rounded-lg bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300">
                    <RotateCcw size={15} />
                  </span>
                  <span className="font-bold text-foreground">Refunds Activity</span>
                </div>
                <div className="mt-3 space-y-1 text-xs">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Total Refunded:</span>
                    <span className="font-bold text-rose-600 dark:text-rose-400">
                      {fmtFinancial(roadsideSummary?.paymentCollection.totalRefunds ?? 0)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Refund Count:</span>
                    <span className="font-semibold text-foreground">
                      {roadsideSummary?.refundCount ?? 0}
                    </span>
                  </div>
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    Refunds properly deduct sales without reversing prepared food consumption.
                  </p>
                </div>
              </div>
            </div>
          </section>

          {/* SECTION F: RECENT ORDERS & BOGO SUMMARY */}
          <section aria-label="Recent Orders and Promotions" className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            {/* Recent Orders */}
            <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
              <div className="flex items-center justify-between border-b border-border px-5 py-4">
                <div className="flex items-center gap-2.5">
                  <span className="flex size-8 items-center justify-center rounded-lg bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                    <ClipboardList size={16} />
                  </span>
                  <h3 className="font-bold text-foreground">Recent Orders</h3>
                </div>
                <Link
                  href="/orders"
                  className="flex items-center gap-1 text-xs font-semibold text-brand hover:underline"
                >
                  View All Orders <ArrowRight size={12} />
                </Link>
              </div>

              {recentOrders.length === 0 ? (
                <div className="p-8 text-center text-xs text-muted-foreground">
                  No orders recorded for this period.
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {recentOrders.map((ord) => (
                    <Link
                      key={ord.id}
                      href="/orders"
                      className="flex items-center justify-between px-5 py-3 text-xs hover:bg-muted/40 transition-colors"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-foreground">#{ord.order_number}</span>
                          <span className={`text-[11px] font-medium ${orderStatusColor[ord.status] || ''}`}>
                            {ord.status}
                          </span>
                        </div>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          {formatDateTime(ord.created_at)}
                        </p>
                      </div>
                      <span className="text-sm font-bold text-foreground">
                        {fmt(Number(ord.total))}
                      </span>
                    </Link>
                  ))}
                </div>
              )}
            </div>

            {/* Normal vs BOGO Comparative Breakdown */}
            {(() => {
              const normalSales = roadsideSummary?.normalSales ?? roadsideSummary?.normalSalesSummary;
              const bogoSales = roadsideSummary?.bogoSales ?? roadsideSummary?.bogoSalesSummary;
              const bogoDiscounts = bogoSales?.discounts ?? bogoSales?.totalDiscounts ?? 0;
              const bogoLaunchPairs = bogoSales?.launchPairs ?? bogoSales?.launchPairsRedeemed ?? 0;
              const bogoLoyaltyPairs = bogoSales?.loyaltyPairs ?? bogoSales?.loyaltyPairsRedeemed ?? 0;
              const reconciliation = roadsideSummary?.reconciliation;
              const isReconciled = reconciliation?.reconciled !== false;

              return (
                <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
                  <div className="flex items-center justify-between border-b border-border px-5 py-4 bg-muted/20">
                    <div className="flex items-center gap-2.5">
                      <span className="flex size-8 items-center justify-center rounded-lg bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                        <Tags size={16} />
                      </span>
                      <div>
                        <h3 className="font-bold text-foreground">Normal Sales vs BOGO Sales Breakdown</h3>
                        <p className="text-[11px] text-muted-foreground">Detailed accounting separation & mathematical reconciliation</p>
                      </div>
                    </div>
                    <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-[11px] font-semibold text-amber-800 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800">
                      {bogoSales?.pairsRedeemed ?? 0} BOGO Pairs Redeemed
                    </span>
                  </div>

                  <div className="p-5 space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {/* Normal Sales Card */}
                      <div className="rounded-xl border border-border bg-muted/20 p-4 space-y-2.5">
                        <div className="flex items-center justify-between border-b border-border/60 pb-2">
                          <span className="font-bold text-sm text-foreground">Normal Sales (Full Price)</span>
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-semibold px-2 py-0.5 rounded bg-muted text-foreground">
                              {normalSales?.paidQuantity ?? 0} Pancakes
                            </span>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 px-1.5 text-[11px] gap-1 text-emerald-700 hover:text-emerald-800 hover:bg-emerald-50 dark:hover:bg-emerald-950/40"
                              onClick={() => exportNormalSales('xlsx')}
                              disabled={isExporting}
                              title="Download Normal Sales Excel Report"
                            >
                              <FileSpreadsheet size={12} />
                              <span>Excel</span>
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 px-1.5 text-[11px] gap-1 text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/40"
                              onClick={() => exportNormalSales('pdf')}
                              disabled={isExporting}
                              title="Download Normal Sales PDF Report"
                            >
                              <FileText size={12} />
                              <span>PDF</span>
                            </Button>
                          </div>
                        </div>
                        <div className="space-y-1.5 text-xs">
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Net Pancake Revenue:</span>
                            <span className="font-semibold text-foreground">
                              {fmtFinancial(normalSales?.revenue ?? 0)}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Raw Ingredient Cost:</span>
                            <span className="font-semibold text-foreground">
                              {fmtFinancial(normalSales?.rawIngredientCost ?? 0)}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Paper Plates (@{fmt(2.5)}):</span>
                            <span className="font-semibold text-foreground">
                              {fmtFinancial(normalSales?.paperPlateCost ?? 0)}
                            </span>
                          </div>
                          <div className="flex justify-between pt-1 border-t border-border/40 font-medium">
                            <span>Total Direct Cost:</span>
                            <span>{fmtFinancial(normalSales?.totalIngredientCost ?? 0)}</span>
                          </div>
                          <div className="flex justify-between pt-1 font-bold text-emerald-600 dark:text-emerald-400">
                            <span>Normal Profit:</span>
                            <span>{fmtFinancial(normalSales?.profit ?? 0)}</span>
                          </div>
                        </div>
                      </div>

                      {/* BOGO Sales Card */}
                      <div className="rounded-xl border border-amber-200 dark:border-amber-800/60 bg-amber-50/30 dark:bg-amber-950/20 p-4 space-y-2.5">
                        <div className="flex items-center justify-between border-b border-amber-200 dark:border-amber-800/60 pb-2">
                          <span className="font-bold text-sm text-amber-900 dark:text-amber-200">
                            BOGO Sales (Promotional)
                          </span>
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-bold px-2 py-0.5 rounded bg-amber-100 dark:bg-amber-900 text-amber-800 dark:text-amber-200">
                              {bogoSales?.pancakesPrepared ?? 0} Cooked
                            </span>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 px-1.5 text-[11px] gap-1 text-amber-800 hover:text-amber-900 hover:bg-amber-100 dark:hover:bg-amber-900/40"
                              onClick={() => exportBogoSales('xlsx')}
                              disabled={isExporting}
                              title="Download BOGO Sales Excel Report"
                            >
                              <FileSpreadsheet size={12} />
                              <span>Excel</span>
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 px-1.5 text-[11px] gap-1 text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/40"
                              onClick={() => exportBogoSales('pdf')}
                              disabled={isExporting}
                              title="Download BOGO Sales PDF Report"
                            >
                              <FileText size={12} />
                              <span>PDF</span>
                            </Button>
                          </div>
                        </div>
                        <div className="space-y-1.5 text-xs">
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">BOGO Revenue (Charged):</span>
                            <span className="font-semibold text-foreground">
                              {fmtFinancial(bogoSales?.revenue ?? 0)}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Promotional Discounts:</span>
                            <span className="font-semibold text-brand">
                              -{fmtFinancial(bogoDiscounts)}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Raw Ingredients (Both):</span>
                            <span className="font-semibold text-foreground">
                              {fmtFinancial(bogoSales?.rawIngredientCost ?? 0)}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Paper Plates ({bogoSales?.pancakesPrepared ?? 0} @ {fmt(2.5)}):</span>
                            <span className="font-semibold text-foreground">
                              {fmtFinancial(bogoSales?.paperPlateCost ?? 0)}
                            </span>
                          </div>
                          <div className="flex justify-between pt-1 border-t border-border/40 font-medium">
                            <span>Total Direct Cost:</span>
                            <span>{fmtFinancial(bogoSales?.totalIngredientCost ?? 0)}</span>
                          </div>
                          <div className="flex justify-between pt-1 font-bold text-emerald-600 dark:text-emerald-400">
                            <span>BOGO Profit:</span>
                            <span>{fmtFinancial(bogoSales?.profit ?? 0)}</span>
                          </div>
                          <div className="flex justify-between pt-1 text-[11px] text-muted-foreground border-t border-border/30">
                            <span>Launch Offer / Loyalty:</span>
                            <span>{bogoLaunchPairs} Launch &bull; {bogoLoyaltyPairs} Loyalty</span>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Mathematical Reconciliation Banner */}
                    <div className={`rounded-xl border p-3 flex items-center justify-between text-xs ${
                      isReconciled
                        ? 'border-emerald-200 dark:border-emerald-800/60 bg-emerald-50/50 dark:bg-emerald-950/20 text-emerald-800 dark:text-emerald-300'
                        : 'border-amber-200 dark:border-amber-800/60 bg-amber-50/50 dark:bg-amber-950/20 text-amber-800 dark:text-amber-300'
                    }`}>
                      <div className="flex items-center gap-2">
                        <CheckCircle2 size={16} className={isReconciled ? 'text-emerald-600 shrink-0' : 'text-amber-600 shrink-0'} />
                        <span className="font-semibold">
                          {isReconciled
                            ? 'Reconciled: Normal Sales + BOGO Sales = Total Pancake Sales & Profit'
                            : 'Reconciliation difference detected'}
                        </span>
                      </div>
                      <div className="text-[11px] text-muted-foreground hidden sm:block">
                        Pancakes: {(normalSales?.paidQuantity ?? 0) + (bogoSales?.pancakesPrepared ?? 0)} &bull; Revenue: {fmtFinancial((normalSales?.revenue ?? 0) + (bogoSales?.revenue ?? 0))}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}
          </section>
        </div>
      )}

      {/* Cash Close Modal */}
      <CashCloseModal model={cashClose} />

      {/* Daily Sales WhatsApp Modal */}
      {canSendDailySalesWhatsApp && (
        <SendWhatsAppReportModal
          open={dailySalesWhatsAppOpen}
          country={currentTenant?.country ?? ''}
          canViewSettings={canViewSettings}
          onOpenChange={setDailySalesWhatsAppOpen}
          onSend={handleSendDailySalesWhatsApp}
        />
      )}
    </div>
  );
}
