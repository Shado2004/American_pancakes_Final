'use client';

import { useState } from 'react';
import { useEffect } from 'react';
import {
  ShoppingCart,
  UtensilsCrossed,
  Package,
  Truck,
  Globe,
  Plus,
  Minus,
  Trash2,
  Pause,
  MapPin,
  SquarePen,
  Tag,
  Users,
  Wallet,
  StickyNote,
  CalendarClock,
  CreditCard,
  Sparkles,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import api from '@/lib/api';
import type { CustomPaymentMethod } from '@/lib/payment-methods';
import { useCartStore, calculateRoadsidePackaging, isParcelBoxItem, type CartOrderType } from '@/store/cart';
import { useHeldOrdersStore } from '@/store/held-orders';
import { useAuthStore } from '@/store/auth';
import { usePosSettingsStore } from '@/store/pos-settings';
import { useTranslations } from 'use-intl';
import toast from 'react-hot-toast';
import type { Table, Order, OrderItem, CartItem, ServingAllocationInput } from '@/lib/types';
import { useFormatCurrency } from '@/hooks/useFormatCurrency';
import { fractionalQuantityStep, roundToQuantityPrecision } from '@/lib/utils';
import { cartLineUnitPrice, cartVariantUnitPrice } from '@/lib/cart-price';
import { tenantCan } from '@/lib/permissions';
import { CartPriceOverrideModal } from '@/components/pos/CartPriceOverrideModal';
import { calculateAppliedCharges } from '@/lib/charges';
import { chargesForOrderType, useChargesStore } from '@/store/charges';
import { getCurrencyFractionDigits } from '@countries';
import { isTerminalItemStatus } from '../../../../shared/order-item-status';
import {
  formatScheduledInstantForDisplay,
  parseScheduledForInput,
  suggestFutureScheduleWallClock,
} from '@/lib/scheduled-time';

interface Props {
  tables: Table[];
  currency: string;
  submitting: boolean;
  onPlaceOrder: () => void;
  onSendToPayment?: () => void;
  onOpenPaymentQueue?: () => void;
  counterRole?: 'ordering' | 'payment' | 'combined' | null;
  multiCounterEnabled?: boolean;
  onEditItem?: (item: CartItem) => void;
  onModalOpenChange?: (open: boolean) => void;
  variant?: 'sidebar' | 'drawer';
  existingOrder?: Order | null;
  storeTimezone?: string;
  onCancelExistingOrderMode?: () => void;
}

const orderTypeIcons = {
  dine_in: UtensilsCrossed,
  takeaway: Package,
  delivery: Truck,
  online: Globe,
};


function ItemQuantityControl({
  item,
  updateQuantity,
}: {
  item: CartItem;
  updateQuantity: (cartItemId: string, quantity: number) => void;
}) {
  const t = useTranslations('pos');
  const step = fractionalQuantityStep(item.product);
  const [draft, setDraft] = useState(() => String(item.quantity));
  const [lastQuantity, setLastQuantity] = useState(item.quantity);
  if (lastQuantity !== item.quantity) {
    setLastQuantity(item.quantity);
    setDraft(String(item.quantity));
  }

  const commitDraft = () => {
    if (step == null) return;
    const parsed = Number(draft);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setDraft(String(item.quantity));
      return;
    }
    const rounded = Math.max(step, roundToQuantityPrecision(parsed, step));
    updateQuantity(item.id, rounded);
    setDraft(String(rounded));
  };

  const stepBy = (sign: 1 | -1) => {
    if (step == null) {
      updateQuantity(item.id, item.quantity + sign);
      return;
    }
    const next = roundToQuantityPrecision(item.quantity + sign * step, step);
    updateQuantity(item.id, next);
    setDraft(String(next));
  };

  if (step == null) {
    return (
      <>
        <button
          onClick={() => stepBy(-1)}
          className="touch-target rounded-full bg-muted transition-colors hover:bg-muted/70 active:bg-muted/70"
          aria-label={t('remove')}
        >
          <Minus size={16} />
        </button>
        <span
          data-testid="cart-item-qty"
          className="w-6 text-center text-base font-semibold tabular-nums"
        >
          {item.quantity}
        </span>
        <button
          onClick={() => stepBy(1)}
          className="touch-target rounded-full bg-muted transition-colors hover:bg-muted/70 active:bg-muted/70"
          aria-label={t('addItems')}
        >
          <Plus size={16} />
        </button>
      </>
    );
  }

  return (
    <>
      <button
        onClick={() => stepBy(-1)}
        className="touch-target rounded-full bg-muted transition-colors hover:bg-muted/70 active:bg-muted/70"
        aria-label={t('remove')}
      >
        <Minus size={16} />
      </button>
      <input
        type="number"
        inputMode="decimal"
        min={step}
        step={step}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commitDraft}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commitDraft();
        }}
        aria-label={t('quantity')}
        className="w-14 text-center text-base font-semibold tabular-nums border border-border bg-card rounded-md px-1 py-0.5 outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
      />
      <button
        onClick={() => stepBy(1)}
        className="touch-target rounded-full bg-muted transition-colors hover:bg-muted/70 active:bg-muted/70"
        aria-label={t('addItems')}
      >
        <Plus size={16} />
      </button>
    </>
  );
}

export default function CartPanel({
  tables,
  submitting,
  onPlaceOrder,
  onSendToPayment,
  onOpenPaymentQueue,
  counterRole,
  multiCounterEnabled = false,
  onEditItem,
  onModalOpenChange,
  variant = 'sidebar',
  existingOrder,
  storeTimezone,
  onCancelExistingOrderMode,
}: Props) {
  const cart = useCartStore();
  const heldOrders = useHeldOrdersStore();
  const { user, currentTenant } = useAuthStore();
  const canOverridePrice = tenantCan(currentTenant, 'orders.item.price_override');
  const [priceOverrideState, setPriceOverrideState] = useState<{
    userId: string | number | undefined;
    itemId: string;
  } | null>(null);
  const priceOverrideItemId =
    canOverridePrice && priceOverrideState && priceOverrideState.userId === user?.id
      ? priceOverrideState.itemId
      : null;
  const setPriceOverrideItemId = (itemId: string | null) =>
    setPriceOverrideState(itemId ? { userId: user?.id, itemId } : null);
  const priceOverrideTarget =
    canOverridePrice && priceOverrideItemId
      ? cart.items.find((i) => i.id === priceOverrideItemId)
      : undefined;
  const priceOverrideOpen = Boolean(priceOverrideTarget);
  useEffect(() => {
    onModalOpenChange?.(priceOverrideOpen);
    return () => onModalOpenChange?.(false);
  }, [priceOverrideOpen, onModalOpenChange]);
  const billingType = usePosSettingsStore((s) => s.billingType);
  const t = useTranslations('pos');
  const bogoCalc = cart.bogoCalculation();
  const pancakeCount = cart.items
    .filter((i) => !isParcelBoxItem(i))
    .reduce((sum, i) => sum + i.quantity, 0);
  const tCommon = useTranslations('common');
  const tOrders = useTranslations('orders');
  const tSettings = useTranslations('settings');
  const isRestaurant = (currentTenant?.business_type ?? 'restaurant') === 'restaurant';
  const fmt = useFormatCurrency();
  const effectiveTimezone = storeTimezone || currentTenant?.timezone || 'UTC';
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const interval = setInterval(() => setNowMs(Date.now()), 15000);
    return () => clearInterval(interval);
  }, []);
  useEffect(() => {
    if (cart.orderType !== 'takeaway') {
      cart.setOrderType('takeaway');
    }
    if (cart.scheduledFor) {
      cart.setScheduledFor('');
    }
  }, [cart]);
  const canScheduleCart = false;
  const scheduleValidation = null;
  const scheduleErrorMessage = null;
  const canHold =
    isRestaurant &&
    cart.orderType === 'dine_in' &&
    cart.tableId &&
    cart.items.length > 0 &&
    billingType === 'postpaid';
  const selectableOrderTypes: CartOrderType[] = existingOrder?.type === 'delivery'
    ? ['dine_in', 'takeaway', 'online', 'delivery']
    : ['dine_in', 'takeaway', 'online'];

  const isDeliveryOrder = cart.orderType === 'delivery';
  const [customPaymentMethods, setCustomPaymentMethods] = useState<CustomPaymentMethod[]>([]);
  useEffect(() => {
    if (!isDeliveryOrder || existingOrder) return;
    api
      .get('/payment-methods')
      .then((res) => setCustomPaymentMethods(res.data.payment_methods || []))
      .catch(() => setCustomPaymentMethods([]));
  }, [isDeliveryOrder, existingOrder]);

  const charges = useChargesStore((s) => s.charges);
  const loadCharges = useChargesStore((s) => s.load);
  useEffect(() => {
    void loadCharges();
  }, [loadCharges]);

  // Preview only: the backend recomputes and persists the authoritative amounts.
  // Serving snapshots own packaging charges. Keep the configurable generic
  // packaging fee out of this preview so the customer sees it exactly once.
  const applicableCharges = chargesForOrderType(charges, cart.orderType)
    .filter((charge) => charge.id !== 'packaging_charge');
  const appliedCharges = calculateAppliedCharges({
    definitions: applicableCharges,
    orderType: cart.orderType,
    subtotal: cart.subtotal(),
    discountAmount: 0,
    waivedIds: cart.waivedChargeIds,
    optedInIds: cart.optedInChargeIds,
    currencyDecimals: getCurrencyFractionDigits(currentTenant?.currency || ''),
  });
  const chargeTotal = appliedCharges.reduce(
    (sum, charge) => sum + (charge.waived ? 0 : charge.amount),
    0,
  );
  const packagingSummary = calculateRoadsidePackaging(cart.items, cart.packagingBoxesCount);
  // A charge the merchant left off by default is never applied until the cashier
  // adds it, so it has to be listed here or there is no way to add it.
  const addableCharges = applicableCharges.filter(
    (charge) => !charge.is_default_active && !cart.optedInChargeIds.has(charge.id),
  );

  const handleHold = async () => {
    if (!cart.tableId) {
      toast.error(t('selectTableFirst'));
      return;
    }
    if (cart.items.length === 0) {
      toast.error(t('cartEmpty'));
      return;
    }
    const tableName = tables.find((t) => t.id === cart.tableId)?.name || cart.tableId;
    try {
      await heldOrders.holdOrder(
        cart.tableId,
        cart.items,
        cart.customerId,
        cart.guestCount,
        cart.orderNotes,
        [...cart.waivedChargeIds],
        [...cart.optedInChargeIds],
      );
      cart.clearCart();
      toast.success(t('orderHeldFor', { table: tableName }));
    } catch {
      toast.error(t('holdOrderFailed'));
    }
  };

  const isDrawer = variant === 'drawer';

  return (
    <div
      data-testid="cart-shell"
      className={
        isDrawer
          ? 'flex flex-col w-full'
          : 'pos-cart-shell w-full h-full bg-card rounded-xl border border-border dark:border-border flex flex-col shadow-sm'
      }
    >
      {/* Order Type */}
      <div className="p-4 border-b border-border dark:border-border space-y-2">
        {existingOrder &&
          existingOrder.release_status &&
          existingOrder.release_status !== 'released' && (
            <div
              data-testid="cart-scheduled-existing-banner"
              className="flex items-center justify-between gap-2 rounded-lg border border-blue-200 bg-blue-50/70 px-2.5 py-2 text-xs text-blue-800 dark:border-blue-900/50 dark:bg-blue-950/30 dark:text-blue-200"
            >
              <span className="inline-flex items-center gap-1.5 min-w-0">
                <CalendarClock size={14} className="shrink-0" />
                <span className="truncate font-medium">
                  {t('scheduledAddingToBanner', {
                    number: existingOrder.order_number,
                    time: existingOrder.scheduled_for
                      ? formatScheduledInstantForDisplay(
                          existingOrder.scheduled_for,
                          effectiveTimezone,
                        )
                      : '',
                  })}
                </span>
              </span>
              {onCancelExistingOrderMode && (
                <button
                  type="button"
                  onClick={onCancelExistingOrderMode}
                  aria-label={t('close')}
                  className="rounded p-0.5 hover:bg-blue-100 dark:hover:bg-blue-900/50 shrink-0"
                >
                  <X size={14} />
                </button>
              )}
            </div>
          )}

        <div className="flex items-center justify-between px-3 py-2 bg-gradient-to-r from-pink-50 via-white to-sky-50 dark:from-zinc-900 dark:to-zinc-800 border border-pink-100 dark:border-zinc-800 rounded-xl shadow-xs">
          <div className="flex items-center gap-2 text-xs font-bold text-foreground flex-wrap">
            <ShoppingCart size={15} className="text-pink-600 dark:text-pink-400" />
            <span>Order Cart</span>
            <span
              data-testid="sale-type-badge"
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold ${
                cart.bogoActive
                  ? 'bg-gradient-to-r from-pink-500 to-rose-500 text-white shadow-xs'
                  : 'bg-white text-pink-700 border border-pink-200'
              }`}
            >
              {cart.bogoActive ? (
                <>
                  <Sparkles size={11} /> BOGO Promo
                </>
              ) : (
                'Standard Sale'
              )}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold text-sky-700 dark:text-sky-300 bg-sky-100/80 dark:bg-sky-950/60 border border-sky-200/80 px-2 py-0.5 rounded-full uppercase tracking-wider">
              Restaurant POS
            </span>
          </div>
        </div>
      </div>

      {/* Cart Items */}
      {/* min-h-0 overrides the content-based automatic minimum size, so a long
          cart scrolls its rows instead of pushing the totals and checkout out. */}
      <div
        data-testid="cart-items-scroll"
        className={
          isDrawer
            ? 'overflow-y-auto p-4 max-h-[40vh]'
            : 'pos-cart-items flex-1 min-h-0 overflow-y-auto p-4'
        }
      >
        {/* Previously ordered items (add-items mode) */}
        {existingOrder &&
          existingOrder.items &&
          existingOrder.items.filter((i: OrderItem) => !isTerminalItemStatus(i.status)).length >
            0 && (
            <div className="mb-3 pb-3 border-b border-dashed border-border">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                {t('alreadyOrdered')}
              </p>
              <div className="space-y-1.5">
                {existingOrder.items
                  .filter((i: OrderItem) => !isTerminalItemStatus(i.status))
                  .map((item: OrderItem) => (
                    <div key={item.id} className="flex justify-between items-center">
                      <span className="text-xs text-muted-foreground">
                        {item.quantity}× {item.product_name}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {fmt(Number(item.total))}
                      </span>
                    </div>
                  ))}
              </div>
            </div>
          )}

        {cart.items.length === 0 ? (
          <div
            className={`flex flex-col items-center justify-center text-muted-foreground ${existingOrder ? 'py-4' : isDrawer ? 'py-8' : 'h-full'}`}
          >
            <ShoppingCart size={existingOrder ? 24 : 40} />
            <p className="mt-2 text-sm">{existingOrder ? t('addNewItemsAbove') : t('cartEmpty')}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {cart.items.map((item) => (
              <div
                key={item.id}
                data-testid="cart-item"
                className="border-b border-border/60 pb-3 last:border-b-0 last:pb-0"
              >
                <div className="flex items-start gap-2">
                  <p className="min-w-0 flex-1 break-words text-sm font-medium leading-snug text-foreground">
                    {item.variant
                      ? `${item.product.name} (${item.variant.name})`
                      : item.product.name}
                  </p>
                  <button
                    onClick={() => cart.removeItem(item.id)}
                    className="touch-target -me-2 -mt-2 shrink-0 rounded-full text-muted-foreground transition-colors hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/40 dark:hover:text-red-400 active:bg-red-50 dark:active:bg-red-950/40"
                    aria-label={t('remove')}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
                {cart.bogoActive && !isParcelBoxItem(item) && bogoCalc.itemBreakdown?.[item.id] && (
                  <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                    {bogoCalc.itemBreakdown[item.id].paidUnits > 0 && bogoCalc.itemBreakdown[item.id].freeUnits > 0 && (
                      <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">
                        <Sparkles size={11} /> {bogoCalc.itemBreakdown[item.id].paidUnits} Paid · {bogoCalc.itemBreakdown[item.id].freeUnits} BOGO Free
                      </span>
                    )}
                    {bogoCalc.itemBreakdown[item.id].paidUnits === 0 && bogoCalc.itemBreakdown[item.id].freeUnits > 0 && (
                      <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">
                        <Sparkles size={11} /> BOGO FREE (-{fmt(bogoCalc.itemBreakdown[item.id].discount)})
                      </span>
                    )}
                    {bogoCalc.itemBreakdown[item.id].paidUnits > 0 && bogoCalc.itemBreakdown[item.id].freeUnits === 0 && (
                      <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-300 dark:border-amber-800">
                        PAID
                      </span>
                    )}
                  </div>
                )}
                <div className="min-w-0">
                  {item.addons.length > 0 && (
                    <div className="mt-0.5">
                      {item.addons.map((a) => (
                        <p key={a.id} className="break-words text-xs text-muted-foreground">
                          + {a.name}
                          {(a.quantity || 1) > 1 ? ` ×${a.quantity}` : ''}{' '}
                          {Number(a.price) > 0 && `(${fmt(Number(a.price) * (a.quantity || 1))})`}
                        </p>
                      ))}
                    </div>
                  )}
                  {item.special_instructions && (
                    <p className="text-xs text-muted-foreground italic mt-0.5 break-words">
                      {item.special_instructions}
                    </p>
                  )}
                </div>
                <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm text-muted-foreground">
                    {fmt(
                      cartLineUnitPrice(
                        item,
                        cart.orderType === 'online' && cart.onlinePlatform.trim().length > 0,
                      ),
                    )}
                    {item.price_override && (
                      <span className="ms-1.5 text-xs text-amber-600 dark:text-amber-400">
                        {tOrders('priceOverriddenMenu', {
                          price: fmt(
                            cartVariantUnitPrice(
                              item,
                              cart.orderType === 'online' && cart.onlinePlatform.trim().length > 0,
                            ),
                          ),
                        })}
                      </span>
                    )}
                  </p>
                  <div className="flex items-center gap-1.5">
                    {canOverridePrice && (
                      <button
                        onClick={() => setPriceOverrideItemId(item.id)}
                        className="touch-target shrink-0 rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:bg-muted"
                        aria-label={tOrders('overridePrice')}
                        title={tOrders('overridePrice')}
                      >
                        <Tag size={14} />
                      </button>
                    )}
                    {onEditItem && (
                      <button
                        onClick={() => onEditItem(item)}
                        className="touch-target shrink-0 gap-1 rounded-full bg-amber-100 px-3 text-xs font-medium text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 dark:hover:bg-amber-950/60 dark:active:bg-amber-950/60 transition-colors hover:bg-amber-200 active:bg-amber-200"
                      >
                        <SquarePen size={12} />
                        {tCommon('edit')}
                      </button>
                    )}
                    <ItemQuantityControl item={item} updateQuantity={cart.updateQuantity} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Cart Footer */}
      <div data-testid="cart-footer" className="p-4 border-t border-border dark:border-border">
        {/* Cashier BOGO Action Controls */}
        {!cart.bogoActive && pancakeCount >= 2 && (
          <div className="mb-3">
            <button
              type="button"
              data-testid="apply-bogo-btn"
              onClick={() => cart.setBogoActive(true, 'launch-bogo')}
              className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-bold bg-amber-500 hover:bg-amber-600 text-white shadow-xs transition-colors cursor-pointer"
            >
              <Sparkles size={14} /> Apply BOGO (Buy 1 Get 1 Free)
            </button>
          </div>
        )}

        {cart.bogoActive && bogoCalc.freeUnitCount === 0 && (
          <div className="mb-3 p-2.5 rounded-lg border border-amber-200 bg-amber-50/50 dark:border-amber-900/40 dark:bg-amber-950/20 flex items-center justify-between gap-2">
            <span className="text-xs text-amber-800 dark:text-amber-300">
              BOGO active (requires 2+ pancakes)
            </span>
            <button
              type="button"
              data-testid="remove-bogo-btn"
              onClick={() => cart.clearBogo()}
              className="px-2 py-1 text-[11px] font-medium rounded border border-amber-300 dark:border-amber-700 bg-white/60 dark:bg-amber-950/40 text-amber-800 dark:text-amber-200 hover:bg-amber-100 transition-colors cursor-pointer"
            >
              Remove BOGO
            </button>
          </div>
        )}

        {cart.bogoActive && bogoCalc.freeUnitCount > 0 && (
          <div
            data-testid="bogo-cart-card"
            className="mb-3 p-3 rounded-xl border transition-colors bg-amber-500/10 border-amber-400 dark:border-amber-600/70"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <Sparkles className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                <div className="min-w-0">
                  <div className="text-xs font-bold text-foreground flex items-center gap-1.5 flex-wrap">
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500 text-white uppercase tracking-wider">
                      BOGO Sale
                    </span>
                    <span className="text-muted-foreground font-normal">
                      ({pancakeCount} Pancakes)
                    </span>
                  </div>
                </div>
              </div>
              <button
                type="button"
                data-testid="remove-bogo-btn"
                onClick={() => cart.clearBogo()}
                className="px-2 py-0.5 text-[11px] font-medium rounded border border-amber-300 dark:border-amber-700 bg-white/70 dark:bg-amber-950/40 hover:bg-amber-100 dark:hover:bg-amber-900/60 text-amber-800 dark:text-amber-200 transition-colors cursor-pointer"
              >
                Remove BOGO (Normal Sale)
              </button>
            </div>

            <div className="mt-2.5 pt-2.5 border-t border-amber-200 dark:border-amber-800/60 text-xs space-y-1">
              <div className="flex justify-between text-muted-foreground">
                <span>Qualifying pancakes</span>
                <span className="font-semibold text-foreground">{bogoCalc.qualifyingPancakes}</span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>Pancake breakdown</span>
                <span className="font-semibold text-foreground">
                  {bogoCalc.paidUnitCount} Paid · {bogoCalc.freeUnitCount} Free
                </span>
              </div>
              <div className="flex justify-between font-medium text-emerald-600 dark:text-emerald-400">
                <span>Total BOGO Discount</span>
                <span className="font-bold">-{fmt(bogoCalc.totalDiscount)}</span>
              </div>
              <div className="flex justify-between font-medium text-foreground pt-1 border-t border-amber-200/50 dark:border-amber-800/40">
                <span>Net Payable</span>
                <span className="font-bold text-brand">{fmt(cart.payableTotal())}</span>
              </div>
            </div>
          </div>
        )}

        <div className="flex justify-between mb-1 text-sm">
          <span className="text-muted-foreground">{t('items')}</span>
          <span className="font-medium">{cart.itemCount()}</span>
        </div>
        <div className="flex justify-between mb-1 text-sm">
          <span className="text-muted-foreground">{t('subtotal')}</span>
          <span className="font-medium">{fmt(cart.subtotal())}</span>
        </div>
        {cart.bogoActive && cart.bogoDiscount() > 0 && (
          <div className="flex justify-between mb-1 text-sm font-bold text-emerald-600 dark:text-emerald-400">
            <span className="flex items-center gap-1">
              <Sparkles size={14} /> BOGO Free Item
            </span>
            <span>-{fmt(cart.bogoDiscount())}</span>
          </div>
        )}
        <div className="flex justify-between mb-4 text-lg">
          <span className="font-semibold text-foreground">Net Payable</span>
          <span className="font-extrabold text-brand">{fmt(cart.payableTotal())}</span>
        </div>
        <div
          className="mb-4 rounded-md bg-muted/40 p-2.5 text-xs space-y-1.5 border border-border/50"
          data-testid="packaging-summary"
        >
          <div className="font-semibold text-muted-foreground uppercase tracking-wider text-[10px]">
            Packaging (Internal Consumption)
          </div>
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">Paper plates (₹0 customer charge)</span>
            <span className="font-medium" data-testid="paper-plates-count">{packagingSummary.plates}</span>
          </div>
          {packagingSummary.boxes > 0 && (
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">
                Parcel boxes (₹5 on bill{packagingSummary.boxesStandalone > 0 ? ` · ${packagingSummary.boxesAllocated} packaging, ${packagingSummary.boxesStandalone} standalone` : ''})
              </span>
              <span className="font-medium" data-testid="parcel-boxes-count">{packagingSummary.boxes}</span>
            </div>
          )}
          {packagingSummary.boxes > 0 && packagingSummary.pancakes > 0 && (
            <div className="flex items-center justify-between pt-1 pb-0.5 border-t border-border/30">
              <span className="text-muted-foreground font-medium">Boxes for Packaging:</span>
              <div className="flex items-center gap-1.5" data-testid="packaging-allocation-stepper">
                <button
                  type="button"
                  data-testid="packaging-alloc-decrease"
                  disabled={packagingSummary.boxesAllocated <= 0}
                  onClick={() => cart.setPackagingBoxesCount(packagingSummary.boxesAllocated - 1)}
                  className="w-6 h-6 rounded bg-muted hover:bg-muted/80 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center font-bold text-foreground text-sm border border-border"
                  title="Decrease packaging boxes"
                  aria-label="Decrease packaging boxes"
                >
                  −
                </button>
                <span
                  className="w-5 text-center font-semibold text-foreground"
                  data-testid="packaging-allocated-count"
                >
                  {packagingSummary.boxesAllocated}
                </span>
                <button
                  type="button"
                  data-testid="packaging-alloc-increase"
                  disabled={packagingSummary.boxesAllocated >= Math.min(packagingSummary.pancakes, packagingSummary.boxes)}
                  onClick={() => cart.setPackagingBoxesCount(packagingSummary.boxesAllocated + 1)}
                  className="w-6 h-6 rounded bg-muted hover:bg-muted/80 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center font-bold text-foreground text-sm border border-border"
                  title="Increase packaging boxes"
                  aria-label="Increase packaging boxes"
                >
                  +
                </button>
              </div>
            </div>
          )}
          <div className="flex justify-between font-medium pt-1 border-t border-border/40 text-foreground">
            <span>Internal Packaging Cost</span>
            <span data-testid="packaging-internal-cost">{fmt(packagingSummary.internalCost)}</span>
          </div>
        </div>        
        {(appliedCharges.length > 0 || addableCharges.length > 0) && (
          <div className="mb-4 space-y-1" data-testid="cart-charges">
            {appliedCharges.map((charge) => {
              const definition = applicableCharges.find((c) => c.id === charge.id);
              const isOptional = definition?.is_optional ?? false;
              return (
                <div key={charge.id} className="flex items-center justify-between gap-2 text-sm">
                  <span
                    className={
                      charge.waived ? 'text-muted-foreground line-through' : 'text-muted-foreground'
                    }
                  >
                    {charge.name}
                  </span>
                  <span className="flex items-center gap-2">
                    <span
                      className={
                        charge.waived ? 'text-muted-foreground line-through' : 'font-medium'
                      }
                    >
                      {fmt(charge.amount)}
                    </span>
                    {isOptional && (
                      <button
                        type="button"
                        onClick={() => cart.toggleWaiveCharge(charge.id)}
                        aria-pressed={charge.waived}
                        className="text-xs px-2 py-0.5 rounded border border-border text-muted-foreground hover:text-foreground"
                      >
                        {charge.waived ? t('applyCharge') : t('waiveCharge')}
                      </button>
                    )}
                    {!definition?.is_default_active && (
                      <button
                        type="button"
                        onClick={() => cart.toggleOptedInCharge(charge.id)}
                        aria-pressed={!cart.optedInChargeIds.has(charge.id)}
                        className="text-xs px-2 py-0.5 rounded border border-border text-muted-foreground hover:text-foreground"
                      >
                        {cart.optedInChargeIds.has(charge.id) ? t('removeCharge') : t('addCharge')}
                      </button>
                    )}
                  </span>
                </div>
              );
            })}
            {addableCharges.map((charge) => (
              <div key={charge.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="text-muted-foreground">{charge.name}</span>
                <button
                  type="button"
                  onClick={() => cart.toggleOptedInCharge(charge.id)}
                  className="text-xs px-2 py-0.5 rounded border border-border text-muted-foreground hover:text-foreground"
                >
                  {t('addCharge')}
                </button>
              </div>
            ))}
            {appliedCharges.length > 0 && (
              <div className="flex justify-between text-sm font-medium">
                <span>{t('chargesTotal')}</span>
                <span>{fmt(chargeTotal)}</span>
              </div>
            )}
          </div>
        )}

        <div className="flex gap-2">
          {canHold && (
            <Button variant="outline" onClick={handleHold} className="flex-1">
              <Pause size={14} className="me-1" /> {t('holdButton')}
              <span
                aria-hidden="true"
                className="hidden sm:inline-flex ms-1 px-1 py-0.2 rounded border border-border text-[10px] font-mono text-muted-foreground"
              >
                F8
              </span>
            </Button>
          )}
          {existingOrder ? (
            <Button
              onClick={onPlaceOrder}
              disabled={submitting || cart.items.length === 0 || Boolean(scheduleErrorMessage)}
              className="flex-1"
              size="lg"
              data-testid="pos-append-existing-order-btn"
            >
              {submitting ? t('placing') : t('placeOrderButton')}
              {!submitting && (
                <span
                  aria-hidden="true"
                  className="hidden sm:inline-flex ms-1.5 px-1.5 py-0.5 rounded bg-white/20 text-[10px] font-mono font-medium"
                >
                  Space
                </span>
              )}
            </Button>
          ) : multiCounterEnabled && counterRole === 'payment' ? (
            cart.items.length === 0 ? (
              <Button
                type="button"
                onClick={onOpenPaymentQueue}
                className="flex-1"
                size="lg"
                data-testid="pos-open-payment-queue-btn"
              >
                <CreditCard className="me-2 h-4 w-4" />
                {t('paymentQueue')}
              </Button>
            ) : (
              <>
                {onOpenPaymentQueue && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={onOpenPaymentQueue}
                    className="flex-1"
                    size="lg"
                    data-testid="pos-open-payment-queue-btn"
                  >
                    <CreditCard className="me-2 h-4 w-4" />
                    {t('paymentQueue')}
                  </Button>
                )}
                <Button
                  onClick={onPlaceOrder}
                  disabled={submitting || Boolean(scheduleErrorMessage)}
                  className="flex-1"
                  size="lg"
                >
                  {submitting ? t('placing') : t('placeOrderButton')}
                  {!submitting && (
                    <span
                      aria-hidden="true"
                      className="hidden sm:inline-flex ms-1.5 px-1.5 py-0.5 rounded bg-white/20 text-[10px] font-mono font-medium"
                    >
                      Space
                    </span>
                  )}
                </Button>
              </>
            )
          ) : multiCounterEnabled &&
            onSendToPayment &&
            counterRole === 'ordering' &&
            (cart.orderType === 'takeaway' || cart.orderType === 'dine_in') ? (
            <Button
              onClick={onSendToPayment}
              disabled={submitting || cart.items.length === 0 || Boolean(scheduleErrorMessage)}
              className="flex-1"
              size="lg"
              data-testid="pos-send-to-payment-btn"
            >
              {submitting ? t('placing') : t('sendToPayment')}
              {!submitting && (
                <span
                  aria-hidden="true"
                  className="hidden sm:inline-flex ms-1.5 px-1.5 py-0.5 rounded bg-white/20 text-[10px] font-mono font-medium"
                >
                  Space
                </span>
              )}
            </Button>
          ) : multiCounterEnabled &&
            onSendToPayment &&
            counterRole === 'combined' &&
            (cart.orderType === 'takeaway' || cart.orderType === 'dine_in') ? (
            <>
              <Button
                variant="outline"
                onClick={onSendToPayment}
                disabled={submitting || cart.items.length === 0 || Boolean(scheduleErrorMessage)}
                className="flex-1"
                size="lg"
                data-testid="pos-send-to-payment-btn"
              >
                {t('sendToPayment')}
              </Button>
              <Button
                onClick={onPlaceOrder}
                disabled={submitting || cart.items.length === 0 || Boolean(scheduleErrorMessage)}
                className="flex-1"
                size="lg"
              >
                {submitting ? t('placing') : t('placeOrderButton')}
                {!submitting && (
                  <span
                    aria-hidden="true"
                    className="hidden sm:inline-flex ms-1.5 px-1.5 py-0.5 rounded bg-white/20 text-[10px] font-mono font-medium"
                  >
                    Space
                  </span>
                )}
              </Button>
            </>
          ) : (
            <Button
              onClick={onPlaceOrder}
              disabled={submitting || cart.items.length === 0 || Boolean(scheduleErrorMessage)}
              className="flex-1"
              size="lg"
            >
              {submitting ? t('placing') : t('placeOrderButton')}
              {!submitting && (
                <span
                  aria-hidden="true"
                  className="hidden sm:inline-flex ms-1.5 px-1.5 py-0.5 rounded bg-white/20 text-[10px] font-mono font-medium"
                >
                  Space
                </span>
              )}
            </Button>
          )}
        </div>
      </div>
      {priceOverrideTarget && (
        <CartPriceOverrideModal
          item={priceOverrideTarget}
          onlinePlatformSelected={
            cart.orderType === 'online' && cart.onlinePlatform.trim().length > 0
          }
          onApply={(override) => cart.setItemPriceOverride(priceOverrideTarget.id, override)}
          onClose={() => setPriceOverrideItemId(null)}
        />
      )}
    </div>
  );
}
