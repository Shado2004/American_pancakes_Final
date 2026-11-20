'use client';

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  X,
  Sparkles,
  Percent,
  ChevronDown,
  Banknote,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import api from '@/lib/api';
import { useCartStore } from '@/store/cart';
import { chargesForOrderType, useChargesStore } from '@/store/charges';
import { useAuthStore } from '@/store/auth';
import { useTaxPreview } from '@/hooks/use-tax-preview';
import { useTranslations, type AppConfig } from 'use-intl';
import TaxBreakdown from '@/components/pos/TaxBreakdown';
import toast from 'react-hot-toast';
import { PAYMENT_METHODS, type CustomPaymentMethod } from '@/lib/payment-methods';
import { useFormatCurrency } from '@/hooks/useFormatCurrency';
import { useFormatNumber } from '@/hooks/useFormatNumber';
import { useCurrencyUnitAdapter } from '@/hooks/useCurrencyUnitAdapter';
import { getCountryByCode, getCurrencyMinorUnitFactor } from '@/lib/countries';
import { getDiscountInputStep, normalizeFixedDiscountValue } from '@/lib/currency-input';
import { CurrencyTouchNumberPad } from '@/components/pos/TouchNumberPad';
import {
  defaultDiscountTypeForMode,
  isDiscountTypeAllowed,
  normalizeDiscountMode,
  type DiscountMode,
  type DiscountType,
} from '@/lib/discount-settings';
import { ApproverSelect } from '@/components/ApproverSelect';
import { useManagerApprovers } from '@/hooks/useManagerApprovers';

interface LoyaltySettings {
  loyalty_enabled: boolean;
}

export interface PrepaidPayment {
  method: string;
  payment_method_id?: number;
  amount: number;
  transaction_id?: string;
}

export interface PrepaidDiscount {
  type: DiscountType;
  value: number;
  reason?: string;
  override_pin?: string;
  approver_id?: string;
  promotion_id?: string;
  bogo_pairs?: unknown[];
}

interface Props {
  currency: string;
  initialCardTransactionIdRequired?: boolean;
  initialDiscount?: PrepaidDiscount | null;
  discountCommitted?: boolean;
  onClose: () => void;
  onConfirm: (
    payments: PrepaidPayment[],
    walletAmount: number,
    discount: PrepaidDiscount | null,
  ) => void;
}

// Loyalty points are 1:1 with currency units. Must match LOYALTY_REDEMPTION_RATE in main/routes/bills.ts.
const LOYALTY_REDEMPTION_RATE = 1;

type PosKey = keyof AppConfig['Messages']['pos'];

type OrderType = 'dine_in' | 'takeaway' | 'delivery' | 'online';

// Exhaustively typed lookup for the order-type suffix (no template-literal keys).
const ORDER_TYPE_SUFFIX_KEYS = {
  dine_in: 'orderTypeSuffix_dine_in',
  takeaway: 'orderTypeSuffix_takeaway',
  delivery: 'orderTypeSuffix_delivery',
  online: 'orderTypeSuffix_online',
} as const satisfies Record<OrderType, PosKey>;

// Built-in payment method label keys mapped to typed `pos` leaf keys.
const BUILT_IN_PAYMENT_KEYS = {
  cash: 'methodCash',
  upi: 'methodUpi',
  card: 'methodCard',
} as const satisfies Record<'cash' | 'upi' | 'card', PosKey>;

interface Payment {
  method: string;
  payment_method_id?: number;
  amount: string;
  transaction_id?: string;
}

type AmountTarget =
  | { kind: 'payment'; index: number }
  | { kind: 'wallet' }
  | { kind: 'discount' }
  | null;

export default function PrepaidCheckoutModal({
  initialCardTransactionIdRequired,
  initialDiscount = null,
  discountCommitted = false,
  onClose,
  onConfirm,
}: Props) {
  const cart = useCartStore();
  const customer = cart.customer;
  const t = useTranslations('pos');
  const tCommon = useTranslations('common');
  const currencyFmt = useFormatCurrency();
  const fmtNum = useFormatNumber();
  const unitAdapter = useCurrencyUnitAdapter();
  const {
    toDisplay: toDisplayUnit,
    toStored: toStoredUnit,
    label: inputCurrencyLabel,
    step: inputCurrencyStep,
    formatInput,
  } = unitAdapter;
  const { currentTenant } = useAuthStore();
  const charges = useChargesStore((s) => s.charges);
  const loadCharges = useChargesStore((s) => s.load);
  const currencyCode =
    currentTenant?.currency ||
    (currentTenant?.country ? getCountryByCode(currentTenant.country)?.currency : undefined) ||
    'INR';
  const minorFactor = getCurrencyMinorUnitFactor(currencyCode);
  const toMinorUnits = (amount: number) => Math.round(amount * minorFactor);

  const [loyaltySettings, setLoyaltySettings] = useState<LoyaltySettings | null>(null);
  const [walletBalance, setWalletBalance] = useState<number | null>(null);
  const [walletLoadFailed, setWalletLoadFailed] = useState(false);
  const [walletAmount, setWalletAmount] = useState('');
  const [processing, setProcessing] = useState(false);
  const [customMethods, setCustomMethods] = useState<CustomPaymentMethod[]>([]);
  const [cardTransactionIdRequired, setCardTransactionIdRequired] = useState(
    Boolean(initialCardTransactionIdRequired),
  );

  // Discount state (applied to the order once checkout is confirmed)
  const hasInitialDiscount = Boolean(initialDiscount && initialDiscount.value > 0);
  const [discountOpen, setDiscountOpen] = useState(hasInitialDiscount);
  const [discountType, setDiscountType] = useState<DiscountType>(
    hasInitialDiscount && initialDiscount ? initialDiscount.type : 'percentage',
  );
  const [discountValue, setDiscountValue] = useState(() => {
    if (!hasInitialDiscount || !initialDiscount) return '';
    return initialDiscount.type === 'amount'
      ? formatInput(toDisplayUnit(initialDiscount.value))
      : String(initialDiscount.value);
  });
  const [discountReason, setDiscountReason] = useState(
    hasInitialDiscount && initialDiscount?.reason ? initialDiscount.reason : '',
  );
  const [discountMode, setDiscountMode] = useState<DiscountMode>('percentage');
  const [discountModeLoaded, setDiscountModeLoaded] = useState(false);
  const managerApprovers = useManagerApprovers();
  const [discountRequiresApproval, setDiscountRequiresApproval] = useState(false);
  const [discountPin, setDiscountPin] = useState('');
  const [discountApproverId, setDiscountApproverId] = useState<string | null>(null);
  const [selectedPromotionId, setSelectedPromotionId] = useState<string>(
    initialDiscount?.promotion_id ?? '',
  );
  const initialBogoStateRef = useRef<{ active: boolean; promoId: string | null }>({
    active: cart.bogoActive,
    promoId: cart.bogoPromotionId,
  });

  const handleModalClose = useCallback(() => {
    // If checkout was cancelled without confirming, revert bogo state to what it was before opening checkout modal
    if (!initialBogoStateRef.current.active && cart.bogoActive) {
      cart.clearBogo();
    } else if (initialBogoStateRef.current.active && !cart.bogoActive) {
      cart.setBogoActive(true, initialBogoStateRef.current.promoId || 'launch-bogo');
    }
    onClose();
  }, [cart, onClose]);
  const [availablePromotions, setAvailablePromotions] = useState<
    Array<{
      id: string;
      name: string;
      discount_type: string;
      is_loyalty_reward: boolean;
      description: string | null;
    }>
  >([]);

  const bogoPromotions = useMemo(
    () => availablePromotions.filter((p) => p.discount_type === 'bogo'),
    [availablePromotions],
  );
  const standardPromotions = useMemo(
    () => availablePromotions.filter((p) => p.discount_type !== 'bogo'),
    [availablePromotions],
  );

  useEffect(() => {
    let active = true;
    api
      .get('/promotions?active_only=true')
      .then((res) => {
        if (active && Array.isArray(res.data?.promotions)) {
          setAvailablePromotions(res.data.promotions);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const handleSelectPromotion = async (promoId: string) => {
    try {
      if (selectedPromotionId === promoId) {
        setSelectedPromotionId('');
        setDiscountValue('');
        setDiscountReason('');
        cart.setBogoActive(false);
        return;
      }

      const promo = availablePromotions.find((p) => p.id === promoId);
      if (!promo) return;

      const { data } = await api.post('/promotions/preview', {
        promotion_id: promoId,
        items: cart.items.map((item) => ({
          id: item.id,
          product_id: item.product.id,
          variant_id: item.variant?.id ?? null,
          product_name: item.product.name,
          quantity: item.quantity,
          unit_price: item.variant ? item.variant.price : Number(item.product.price) || 0,
        })),
        customer_id: customer?.id ?? null,
        bogo_pairs: cart.bogoPairs && cart.bogoPairs.length > 0 ? cart.bogoPairs : undefined,
      });

      if (!data.eligible) {
        toast.error(data.ineligibleReason || 'Cart does not qualify for this promotion');
        return;
      }

      setSelectedPromotionId(promoId);
      if (promo.discount_type === 'bogo') {
        cart.setBogoActive(true, promoId);
      } else {
        cart.setBogoActive(false);
      }
      setDiscountType('amount');
      setDiscountValue(formatInput(toDisplayUnit(data.totalDiscountAmount)));
      setDiscountReason(promo.name);
      toast.success(
        promo.discount_type === 'bogo'
          ? `${promo.name}: +${data.freeUnits?.length || 1} Free Pancake (-${currencyFmt(data.totalDiscountAmount)})`
          : `${promo.name}: -${currencyFmt(data.totalDiscountAmount)}`,
      );
    } catch (err: unknown) {
      const error = err as { response?: { data?: { error?: string } } };
      toast.error(error.response?.data?.error || 'Failed to calculate promotion');
    }
  };

  useEffect(() => {
    if (availablePromotions.length === 0) return;
    if (initialDiscount?.promotion_id) {
      void handleSelectPromotion(initialDiscount.promotion_id);
    } else if (cart.bogoActive && !selectedPromotionId) {
      const bogoPromo =
        availablePromotions.find((p) => p.id === (cart.bogoPromotionId || 'launch-bogo')) ||
        availablePromotions.find((p) => p.discount_type === 'bogo');
      if (bogoPromo) {
        void handleSelectPromotion(bogoPromo.id);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availablePromotions, cart.bogoActive, cart.bogoPromotionId]);

  const [amountTarget, setAmountTarget] = useState<AmountTarget>(null);

  const previewDiscount = useMemo(() => {
    const rawValue = Number.parseFloat(discountValue);
    if (!Number.isFinite(rawValue) || rawValue <= 0) return null;
    const normalizedValue =
      discountType === 'amount'
        ? normalizeFixedDiscountValue(rawValue, unitAdapter.maxDecimals)
        : Math.min(100, Math.max(0, rawValue));
    if (discountType === 'amount' && normalizedValue <= 0) return null;
    return {
      type: discountType,
      value: discountType === 'percentage' ? normalizedValue : toStoredUnit(normalizedValue),
    };
  }, [discountType, discountValue, toStoredUnit, unitAdapter.maxDecimals]);
  const committedInitialDiscountUnchanged = Boolean(
    discountCommitted &&
    initialDiscount &&
    (initialDiscount.value > 0 || Boolean(initialDiscount.promotion_id)) &&
    previewDiscount &&
    previewDiscount.type === initialDiscount.type &&
    previewDiscount.value === initialDiscount.value &&
    (discountReason || undefined) === (initialDiscount.reason || undefined) &&
    (selectedPromotionId || undefined) === (initialDiscount.promotion_id || undefined),
  );
  const discountNeedsApprovalPin =
    !selectedPromotionId && discountRequiresApproval && !committedInitialDiscountUnchanged;
  const chargeContext = useMemo(
    () => ({
      orderType: cart.orderType,
      onlinePlatform: cart.onlinePlatform,
      waivedChargeIds: Array.from(cart.waivedChargeIds),
      optedInChargeIds: Array.from(cart.optedInChargeIds),
    }),
    [cart.orderType, cart.onlinePlatform, cart.waivedChargeIds, cart.optedInChargeIds],
  );
  const applicableCharges = chargesForOrderType(charges, cart.orderType);
  const addableCharges = applicableCharges.filter(
    (charge) => !charge.is_default_active && !cart.optedInChargeIds.has(charge.id),
  );
  const rawDiscountValue = Number.parseFloat(discountValue);
  const normalizedFixedDiscountValue =
    discountType === 'amount' && Number.isFinite(rawDiscountValue) && rawDiscountValue > 0
      ? normalizeFixedDiscountValue(rawDiscountValue, unitAdapter.maxDecimals)
      : null;
  const hasInvalidFixedDiscount = normalizedFixedDiscountValue === 0;

  const bogoCalc = useMemo(() => cart.bogoCalculation(), [cart]);

  const totalEffectiveQuantity = useMemo(
    () => cart.items.reduce((sum, item) => sum + item.quantity, 0),
    [cart.items],
  );

  const { tax, loading: taxLoading } = useTaxPreview(
    cart.items,
    cart.customerId,
    undefined,
    previewDiscount,
    chargeContext,
  );

  useEffect(() => {
    void loadCharges();
  }, [loadCharges]);

  const [payments, setPayments] = useState<Payment[]>(
    PAYMENT_METHODS.map((method) => ({ method: method.key, amount: '' })),
  );
  // Tracks whether the cashier has manually typed a split amount — once true, we stop
  // auto-rescaling payment splits (e.g. on discount edits) so we don't clobber their entry.
  const [paymentsTouched, setPaymentsTouched] = useState(false);

  // Same one-shot reconciliation as PaymentModal: `none` forbids every type, so
  // its cleanup runs once on entry instead of rescheduling every render.
  const [reconciledDiscountMode, setReconciledDiscountMode] = useState(discountMode);
  if (discountMode !== reconciledDiscountMode) {
    setReconciledDiscountMode(discountMode);
    if (discountMode === 'none' && !committedInitialDiscountUnchanged && !selectedPromotionId) {
      setDiscountType(defaultDiscountTypeForMode(discountMode));
      setDiscountValue('');
      setDiscountReason('');
      setDiscountPin('');
      setPaymentsTouched(false);
      setAmountTarget((target) => (target?.kind === 'discount' ? null : target));
    }
  }

  if (
    discountModeLoaded &&
    !committedInitialDiscountUnchanged &&
    !selectedPromotionId &&
    discountMode !== 'none' &&
    !isDiscountTypeAllowed(discountMode, discountType)
  ) {
    setDiscountType(defaultDiscountTypeForMode(discountMode));
    setDiscountValue('');
    setDiscountReason('');
    setDiscountPin('');
    setPaymentsTouched(false);
    setAmountTarget((target) => (target?.kind === 'discount' ? null : target));
  }

  useEffect(() => {
    api
      .get('/settings/loyalty')
      .then((res) => setLoyaltySettings(res.data))
      .catch(() => {});
    api
      .get('/settings/discount')
      .then((res) => {
        setDiscountMode(normalizeDiscountMode(res.data.discount_mode));
        setDiscountRequiresApproval(!!res.data.discount_requires_approval);
      })
      .catch(() => {})
      .finally(() => setDiscountModeLoaded(true));
    api
      .get('/settings/card_transaction_id_required')
      .then((res) => setCardTransactionIdRequired(res.data?.setting?.value === 'true'))
      .catch(() => {});
    api
      .get('/payment-methods')
      .then((res) => {
        const methods: CustomPaymentMethod[] = res.data.payment_methods || [];
        setCustomMethods(methods);
        setPayments((current) => [
          ...PAYMENT_METHODS.map(
            (method) =>
              current.find(
                (row) => row.method === method.key && row.payment_method_id === undefined,
              ) || { method: method.key, amount: '' },
          ),
          ...methods.map(
            (method) =>
              current.find((row) => row.payment_method_id === method.id) || {
                method: 'custom',
                payment_method_id: method.id,
                amount: '',
              },
          ),
        ]);
      })
      .catch(() => setCustomMethods([]));
  }, []);

  // Reset stale wallet balance during render when customer changes
  // to avoid flashing previous customer balance.
  const [syncedCustomerId, setSyncedCustomerId] = useState(customer?.id ?? null);
  if ((customer?.id ?? null) !== syncedCustomerId) {
    setSyncedCustomerId(customer?.id ?? null);
    setWalletLoadFailed(false);
    setWalletBalance(null);
    setWalletAmount('');
    setAmountTarget(null);
  }

  useEffect(() => {
    if (customer?.id) {
      api
        .get(`/customers/${customer.id}/wallet`)
        .then((res) => {
          setWalletBalance(Number(res.data.balance) || 0);
        })
        .catch(() => setWalletLoadFailed(true));
    }
  }, [customer?.id]);

  // The backend preview is the settlement source of truth: it applies the same
  // discount/tax rules and active-pack payable rounding used by bill generation.
  const preview = useMemo(() => {
    if (!tax) return null;
    return {
      subtotal: tax.subtotal,
      discountAmount: tax.discount_amount,
      discountedSubtotal: tax.discounted_subtotal,
      taxAmount: tax.tax_amount,
      taxBreakdown: tax.tax_breakdown,
      packagingCharge: tax.packaging_charge,
      charges: tax.charges_breakdown || [],
      roundOff: tax.round_off,
      total: tax.total,
    };
  }, [tax]);

  const remaining = preview?.total ?? 0;

  const [selectedMethod, setSelectedMethod] = useState<string>(
    () => cart.expectedPaymentMethod || 'cash',
  );

  const selectPaymentMethod = (method: string) => {
    setSelectedMethod(method);
    const displayRemaining = toDisplayUnit(remaining);
    const amountStr = displayRemaining > 0 ? formatInput(displayRemaining) : '';
    setPayments((curr) =>
      curr.map((p) => ({
        ...p,
        amount: p.method === method ? amountStr : '',
      })),
    );
  };

  useEffect(() => {
    if (remaining > 0) {
      const displayRemaining = toDisplayUnit(remaining);
      const amountStr = formatInput(displayRemaining);
      setPayments((curr) =>
        curr.map((p) => ({
          ...p,
          amount: p.method === selectedMethod ? amountStr : '',
        })),
      );
    }
  }, [remaining, selectedMethod, toDisplayUnit, formatInput]);

  // Auto-fill splits to match net total during render when total changes,
  // unless cashier has already edited inputs manually.
  const [syncedRemaining, setSyncedRemaining] = useState(remaining);
  if (preview && remaining !== syncedRemaining) {
    setSyncedRemaining(remaining);
    if (remaining <= 0) {
      // Zero-payable order: clear all payment splits so no stale cash produces invalid change
      setPayments((current) => current.map((p) => ({ ...p, amount: '' })));
      setWalletAmount('');
      setPaymentsTouched(false);
    } else if (!paymentsTouched) {
      const walletUsed = toStoredUnit(parseFloat(walletAmount) || 0);
      const cashRemaining = Math.max(0, remaining - walletUsed);
      const totalAllocated = payments.reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0);
      if (totalAllocated > 0) {
        const displayRemaining = toDisplayUnit(cashRemaining);
        setPayments(
          payments.map((p) => {
            const ratio = (parseFloat(p.amount) || 0) / totalAllocated;
            return { ...p, amount: formatInput(displayRemaining * ratio) };
          }),
        );
      } else if (cart.expectedPaymentMethod) {
        const targetMethod = cart.expectedPaymentMethod.toLowerCase();
        const displayRemaining = toDisplayUnit(cashRemaining);
        setPayments(
          payments.map((p) =>
            p.method === targetMethod
              ? { ...p, amount: formatInput(displayRemaining) }
              : { ...p, amount: '' },
          ),
        );
      }
    } else {
      // If cashier had a single payment allocated matching previous remaining, update it
      const allocatedPayments = payments.filter((p) => (parseFloat(p.amount) || 0) > 0);
      if (allocatedPayments.length === 1 && !walletAmount) {
        const single = allocatedPayments[0];
        const displayRemaining = toDisplayUnit(remaining);
        setPayments(
          payments.map((p) =>
            p === single
              ? { ...p, amount: displayRemaining > 0 ? formatInput(displayRemaining) : '' }
              : p,
          ),
        );
      }
    }
  }

  const walletAmt = toStoredUnit(parseFloat(walletAmount) || 0);
  const totalPaymentMinor =
    payments.reduce((s, p) => s + toMinorUnits(toStoredUnit(parseFloat(p.amount) || 0)), 0) +
    toMinorUnits(walletAmt);
  const remainingMinor = toMinorUnits(remaining);

  const updatePaymentTransactionId = (idx: number, value: string) => {
    setPayments((current) =>
      current.map((payment, index) =>
        index === idx ? { ...payment, transaction_id: value } : payment,
      ),
    );
  };

  const needsTransactionId = (payment: Payment) =>
    cardTransactionIdRequired &&
    payment.method === 'card' &&
    payment.payment_method_id === undefined;

  const updatePaymentAmount = (idx: number, value: string) => {
    setPaymentsTouched(true);
    setPayments((current) =>
      current.map((payment, index) => (index === idx ? { ...payment, amount: value } : payment)),
    );
  };

  const allocateRemainingTo = (idx: number) => {
    const allocatedElsewhere = payments.reduce(
      (sum, payment, index) =>
        index === idx ? sum : sum + toStoredUnit(parseFloat(payment.amount) || 0),
      walletAmt,
    );
    const dueStored = Math.max(0, remaining - allocatedElsewhere);
    const dueDisplay = toDisplayUnit(dueStored);
    setPaymentsTouched(true);
    setPayments(
      payments.map((payment, index) =>
        index === idx ? { ...payment, amount: dueDisplay > 0 ? String(dueDisplay) : '' } : payment,
      ),
    );
  };

  const hasCash = payments.some(
    (p) => p.method === 'cash' && p.payment_method_id === undefined && (parseFloat(p.amount) || 0) > 0,
  );
  const change =
    remaining > 0 && hasCash && totalPaymentMinor > remainingMinor
      ? (totalPaymentMinor - remainingMinor) / minorFactor
      : 0;

  const activeAmountValue =
    amountTarget?.kind === 'payment'
      ? payments[amountTarget.index]?.amount || ''
      : amountTarget?.kind === 'wallet'
        ? walletAmount
        : amountTarget?.kind === 'discount'
          ? discountValue
          : '';

  const updateActiveAmount = (value: string) => {
    if (!amountTarget) return;
    if (amountTarget.kind === 'payment') {
      updatePaymentAmount(amountTarget.index, value);
      return;
    }
    if (amountTarget.kind === 'wallet') {
      const maxWalletCurrencyStored = Math.floor((walletBalance || 0) / LOYALTY_REDEMPTION_RATE);
      const maxDisplay = toDisplayUnit(Math.min(maxWalletCurrencyStored, remaining));
      const clamped = parseFloat(value) > maxDisplay ? String(maxDisplay) : value;
      setWalletAmount(clamped);
      setPaymentsTouched(true);
      return;
    }
    setDiscountValue(value);
  };

  const activeAmountMax =
    amountTarget?.kind === 'discount'
      ? discountType === 'percentage'
        ? 100
        : preview
          ? toDisplayUnit(preview.subtotal)
          : undefined
      : amountTarget?.kind === 'wallet'
        ? toDisplayUnit(
            Math.min(Math.floor((walletBalance || 0) / LOYALTY_REDEMPTION_RATE), remaining),
          )
        : undefined;

  const activeAmountQuickValues = (() => {
    if (amountTarget?.kind === 'payment') {
      const allocatedElsewhere = payments.reduce(
        (sum, payment, index) =>
          index === amountTarget.index ? sum : sum + toStoredUnit(parseFloat(payment.amount) || 0),
        walletAmt,
      );
      const dueDisplay = toDisplayUnit(Math.max(0, remaining - allocatedElsewhere));
      return dueDisplay > 0 ? [{ label: t('exactAmount'), value: String(dueDisplay) }] : [];
    }
    if (amountTarget?.kind === 'wallet') {
      const allocatedElsewhere = payments.reduce(
        (sum, payment) => sum + toStoredUnit(parseFloat(payment.amount) || 0),
        0,
      );
      const maxWalletStored = Math.floor((walletBalance || 0) / LOYALTY_REDEMPTION_RATE);
      const dueDisplay = toDisplayUnit(
        Math.min(maxWalletStored, Math.max(0, remaining - allocatedElsewhere)),
      );
      return dueDisplay > 0 ? [{ label: t('exactAmount'), value: String(dueDisplay) }] : [];
    }
    return [];
  })();

  const handleConfirm = (paymentRows = payments) => {
    if (hasInvalidFixedDiscount) {
      toast.error(unitAdapter.maxDecimals === 0 ? t('fixedDiscountMinimum') : t('discountInvalid'));
      return;
    }
    if (!preview) return;

    const effectiveDiscountApproverId = discountApproverId ?? managerApprovers.selectedApproverId;

    if (remaining <= 0) {
      setProcessing(true);
      const finalDiscount: PrepaidDiscount | null =
        preview.discountAmount > 0 || selectedPromotionId
          ? {
              type: discountType,
              value:
                previewDiscount?.value ??
                (preview.discountAmount > 0 ? preview.discountAmount : 0),
              reason: discountReason || undefined,
              override_pin: discountNeedsApprovalPin && discountPin ? discountPin : undefined,
              approver_id:
                discountNeedsApprovalPin && discountPin
                  ? effectiveDiscountApproverId || undefined
                  : undefined,
              promotion_id: selectedPromotionId || undefined,
            }
          : null;
      onConfirm([], 0, finalDiscount);
      return;
    }

    const decimalPart =
      unitAdapter.maxDecimals > 0 ? `(?:\\.\\d{1,${unitAdapter.maxDecimals}})?` : '';
    const amountPattern = new RegExp(`^\\d+${decimalPart}$`);
    const amountIsValid = (value: string) =>
      value.trim() === '' || amountPattern.test(value.trim());
    if (
      paymentRows.some(
        (p) =>
          (!PAYMENT_METHODS.some((allowed) => allowed.key === p.method) &&
            !customMethods.some((method) => method.id === p.payment_method_id)) ||
          !amountIsValid(p.amount),
      )
    ) {
      toast.error(t('paymentFailed'));
      return;
    }
    if (walletAmount.trim() && !amountPattern.test(walletAmount.trim())) {
      toast.error(t('paymentFailed'));
      return;
    }
    if (
      paymentRows.some(
        (p) =>
          needsTransactionId(p) && (parseFloat(p.amount) || 0) > 0 && !p.transaction_id?.trim(),
      )
    ) {
      toast.error(t('cardTransactionIdMissing'));
      return;
    }
    const paymentTotalMinor =
      paymentRows.reduce(
        (sum, payment) => sum + toMinorUnits(toStoredUnit(Number(payment.amount) || 0)),
        0,
      ) + toMinorUnits(walletAmt);
    const nonCashTotalMinor =
      paymentRows
        .filter((p) => p.method !== 'cash')
        .reduce((sum, p) => sum + toMinorUnits(toStoredUnit(Number(p.amount) || 0)), 0) +
      toMinorUnits(walletAmt);
    if (nonCashTotalMinor > remainingMinor) {
      toast.error(t('paymentAboveBalance'));
      return;
    }
    if (paymentTotalMinor < remainingMinor) {
      toast.error(t('paymentBelowBalance'));
      return;
    }
    if (walletAmt > 0 && walletBalance === null) {
      toast.error(t('paymentFailed'));
      return;
    }
    if (walletAmt > 0 && walletBalance !== null) {
      const walletPointsRequired = walletAmt * LOYALTY_REDEMPTION_RATE;
      if (walletPointsRequired > walletBalance) {
        const maxCurrency = Math.floor(walletBalance / LOYALTY_REDEMPTION_RATE);
        toast.error(t('walletMaxAmount', { max: currencyFmt(maxCurrency) }));
        return;
      }
    }
    if (preview.discountAmount > 0 && discountNeedsApprovalPin) {
      if (
        !discountPin ||
        managerApprovers.loading ||
        managerApprovers.loadFailed ||
        managerApprovers.approvers.length === 0 ||
        !effectiveDiscountApproverId
      ) {
        toast.error(t('managerPinRequired'));
        return;
      }
    }
    if (
      !selectedPromotionId &&
      preview.discountAmount > 0 &&
      !committedInitialDiscountUnchanged &&
      !isDiscountTypeAllowed(discountMode, discountType)
    ) {
      toast.error(t('discountInvalid'));
      return;
    }

    setProcessing(true);
    const splitLines: PrepaidPayment[] = paymentRows
      .map((p) => ({
        method: p.payment_method_id === undefined ? p.method : 'custom',
        ...(p.payment_method_id !== undefined ? { payment_method_id: p.payment_method_id } : {}),
        amount: toStoredUnit(parseFloat(p.amount) || 0),
        ...(needsTransactionId(p) && p.transaction_id?.trim()
          ? { transaction_id: p.transaction_id.trim() }
          : {}),
      }))
      .filter((p) => p.amount > 0 && !isNaN(p.amount));

    const finalDiscount: PrepaidDiscount | null =
      preview.discountAmount > 0 || selectedPromotionId
        ? {
            type: discountType,
            value:
              previewDiscount?.value ??
              (preview.discountAmount > 0 ? preview.discountAmount : 0),
            reason: discountReason || undefined,
            override_pin: discountNeedsApprovalPin && discountPin ? discountPin : undefined,
            approver_id:
              discountNeedsApprovalPin && discountPin
                ? effectiveDiscountApproverId || undefined
                : undefined,
            promotion_id: selectedPromotionId || undefined,
            bogo_pairs: cart.bogoPairs && cart.bogoPairs.length > 0 ? cart.bogoPairs : undefined,
          }
        : null;

    onConfirm(splitLines, walletAmt, finalDiscount);
  };

  const modalRef = useRef<HTMLDivElement>(null);
  const handleConfirmRef = useRef(handleConfirm);
  useEffect(() => {
    handleConfirmRef.current = handleConfirm;
  });

  useEffect(() => {
    if (
      typeof document !== 'undefined' &&
      modalRef.current &&
      document.activeElement &&
      !modalRef.current.contains(document.activeElement) &&
      typeof (document.activeElement as HTMLElement).blur === 'function'
    ) {
      (document.activeElement as HTMLElement).blur();
    }
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      const isInput =
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        Boolean(target?.isContentEditable);
      const isInsideModal =
        !modalRef.current ||
        !target ||
        (typeof Node !== 'undefined' && !(target instanceof Node)) ||
        modalRef.current.contains(target as Node);
      const isInteractive =
        isInput ||
        (isInsideModal &&
          (tag === 'BUTTON' ||
            tag === 'A' ||
            target?.getAttribute?.('role') === 'button' ||
            Boolean(target?.closest?.('button, a, [role="button"]'))));

      if (e.key === 'Escape') {
        e.preventDefault();
        handleModalClose();
        return;
      }

      if (isInput) return;

      if (e.key === ' ' || e.code === 'Space' || e.key === 'Enter') {
        if (e.repeat) {
          e.preventDefault();
          return;
        }
        if (isInteractive) return;
        e.preventDefault();
        if (processing || taxLoading || !preview || hasInvalidFixedDiscount) return;

        if (totalPaymentMinor < remainingMinor) {
          const cashIdx = payments.findIndex((p) => p.method === 'cash');
          if (cashIdx !== -1) {
            const allocatedElsewhere = payments.reduce(
              (sum, payment, index) =>
                index === cashIdx ? sum : sum + toStoredUnit(parseFloat(payment.amount) || 0),
              walletAmt,
            );
            const dueStored = Math.max(0, remaining - allocatedElsewhere);
            const dueDisplay = toDisplayUnit(dueStored);
            const updated = payments.map((p, i) =>
              i === cashIdx ? { ...p, amount: String(dueDisplay) } : p,
            );
            setPayments(updated);
            handleConfirmRef.current(updated);
            return;
          }
        }

        handleConfirmRef.current();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    handleModalClose,
    processing,
    taxLoading,
    preview,
    hasInvalidFixedDiscount,
    totalPaymentMinor,
    remainingMinor,
    payments,
    walletAmt,
    remaining,
    toDisplayUnit,
    toStoredUnit,
  ]);

  return (
    <div
      ref={modalRef}
      data-testid="prepaid-checkout-modal"
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center z-50 p-0 sm:p-4"
    >
      <div className="bg-card flex max-h-[95vh] w-full flex-col overflow-hidden rounded-t-3xl shadow-2xl sm:max-w-md sm:rounded-2xl">
        {/* Compact header and bill summary share one block to preserve vertical space. */}
        <div className="shrink-0 border-b border-border px-5 pb-3 pt-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-lg font-bold text-foreground">{t('checkout')}</h2>
              <p className="mt-0.5 truncate text-xs capitalize text-muted-foreground">
                {t(ORDER_TYPE_SUFFIX_KEYS[cart.orderType])}
                {customer ? ` · ${customer.name}` : ''}
              </p>
            </div>
            <button
              onClick={handleModalClose}
              className="touch-target rounded-full bg-muted text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:bg-muted"
              aria-label={t('close')}
            >
              <X size={16} />
            </button>
          </div>

          {taxLoading || !preview ? (
            <div className="mt-3 h-24 animate-pulse rounded-xl bg-muted" />
          ) : (
            <div
              className="mt-3 space-y-1 text-sm tabular-nums"
              data-testid="prepaid-checkout-summary"
            >
              <div className="flex justify-between text-foreground">
                <span>{t('itemCount', { count: totalEffectiveQuantity })}</span>
                <span>{currencyFmt(preview.subtotal)}</span>
              </div>
              {preview.discountAmount > 0 && (
                <div className="flex justify-between font-medium text-emerald-600">
                  <span>{discountReason ? `${t('discount')} (${discountReason})` : t('discount')}</span>
                  <span>− {currencyFmt(preview.discountAmount)}</span>
                </div>
              )}
              {preview.discountAmount > 0 && (
                <div className="flex justify-between text-muted-foreground">
                  <span>Net Subtotal</span>
                  <span>{currencyFmt(preview.discountedSubtotal)}</span>
                </div>
              )}
              <TaxBreakdown
                taxAmount={preview.taxAmount}
                taxBreakdown={preview.taxBreakdown}
                theme="light"
              />
              {preview.charges.map((charge) => {
                const definition = applicableCharges.find(
                  (candidate) => candidate.id === charge.id,
                );
                const optedIn = cart.optedInChargeIds.has(charge.id);
                return (
                  <div
                    key={charge.id}
                    data-testid={`prepaid-charge-${charge.id}`}
                    className="flex justify-between items-center gap-2 text-muted-foreground"
                  >
                    <span className={charge.waived ? 'line-through' : undefined}>
                      {charge.name}
                    </span>
                    <span className="flex items-center gap-2">
                      <span className={charge.waived ? 'line-through' : undefined}>
                        {currencyFmt(charge.amount)}
                      </span>
                      {definition?.is_optional && (
                        <button
                          type="button"
                          onClick={() => cart.toggleWaiveCharge(charge.id)}
                          aria-pressed={charge.waived}
                          className="text-xs px-2 py-0.5 rounded border border-border hover:text-foreground"
                        >
                          {charge.waived ? t('applyCharge') : t('waiveCharge')}
                        </button>
                      )}
                      {definition && !definition.is_default_active && optedIn && (
                        <button
                          type="button"
                          onClick={() => cart.toggleOptedInCharge(charge.id)}
                          aria-pressed={optedIn}
                          className="text-xs px-2 py-0.5 rounded border border-border hover:text-foreground"
                        >
                          {t('removeCharge')}
                        </button>
                      )}
                    </span>
                  </div>
                );
              })}
              {addableCharges.map((charge) => (
                <div
                  key={charge.id}
                  data-testid={`prepaid-charge-${charge.id}`}
                  className="flex justify-between items-center gap-2 text-muted-foreground"
                >
                  <span>{charge.name}</span>
                  <button
                    type="button"
                    onClick={() => cart.toggleOptedInCharge(charge.id)}
                    className="text-xs px-2 py-0.5 rounded border border-border hover:text-foreground"
                  >
                    {t('addCharge')}
                  </button>
                </div>
              ))}
              {preview.packagingCharge > 0 &&
                !preview.charges.some((charge) => charge.id === 'packaging_charge') && (
                  <div className="flex justify-between text-muted-foreground">
                    <span>{t('packaging')}</span>
                    <span>{currencyFmt(preview.packagingCharge)}</span>
                  </div>
                )}
              {preview.roundOff !== 0 && (
                <div className="flex justify-between text-muted-foreground">
                  <span>{t('roundOff')}</span>
                  <span>
                    {preview.roundOff > 0 ? '+' : ''}
                    {currencyFmt(preview.roundOff)}
                  </span>
                </div>
              )}
              <div className="mt-2 flex items-end justify-between border-t border-border pt-2 font-bold text-foreground">
                <span className="text-xs uppercase tracking-wide text-muted-foreground">
                  {t('totalDue')}
                </span>
                <span className="text-xl leading-none">{currencyFmt(remaining)}</span>
              </div>
            </div>
          )}

          {discountModeLoaded && discountMode !== 'none' && (
            <button
              type="button"
              onClick={() => setDiscountOpen((open) => !open)}
              className="mt-2 inline-flex h-7 items-center gap-1 rounded-md border border-border bg-muted px-2 text-xs font-medium text-foreground transition-colors hover:border-brand hover:text-brand"
              aria-expanded={discountOpen}
            >
              {preview?.discountAmount
                ? `${t('discount')}: -${currencyFmt(preview.discountAmount)}`
                : t('discounts')}
              <ChevronDown
                size={12}
                className={`transition-transform ${discountOpen ? 'rotate-180' : ''}`}
              />
            </button>
          )}
        </div>

        <div className="min-h-0 space-y-3 overflow-y-auto px-5 py-3">
          {/* Dedicated BOGO Promotions Action Section */}
          {bogoPromotions.length > 0 && (
            <div
              className="rounded-xl border border-purple-200 dark:border-purple-800/40 bg-purple-50/70 dark:bg-purple-950/30 p-3 space-y-2"
              data-testid="bogo-promotions-section"
            >
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-xs font-bold text-purple-700 dark:text-purple-300">
                  <Sparkles size={14} />
                  BOGO Promotions
                </span>
                <span className="text-[11px] text-purple-600 dark:text-purple-400">
                  Buy 1 Pancake, Get 1 Matching Pancake Free
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {bogoPromotions.map((promo) => {
                  const isSelected = selectedPromotionId === promo.id;
                  return (
                    <button
                      key={promo.id}
                      type="button"
                      onClick={() => void handleSelectPromotion(promo.id)}
                      data-testid={`promo-button-${promo.id}`}
                      className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-semibold transition-all ${
                        isSelected
                          ? 'bg-purple-600 text-white border-purple-600 shadow-sm'
                          : 'bg-card text-foreground border-purple-200 dark:border-purple-800/60 hover:bg-purple-100 dark:hover:bg-purple-900/40'
                      }`}
                    >
                      <span>{promo.name}</span>
                      {isSelected ? (
                        <span className="text-[10px] bg-purple-700 text-white px-1.5 py-0.5 rounded-full font-bold">
                          ✓ Applied
                        </span>
                      ) : (
                        <span className="text-[10px] bg-purple-100 dark:bg-purple-900/60 text-purple-700 dark:text-purple-300 px-1.5 py-0.5 rounded-full">
                          Apply BOGO
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Order Items Breakdown showing both paid and free pancakes */}
          <div
            className="rounded-xl border border-border bg-muted/40 p-3 space-y-2"
            data-testid="prepaid-items-breakdown"
          >
            <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-muted-foreground pb-1 border-b border-border">
              <span>{t('items')} ({totalEffectiveQuantity})</span>
              <span>{t('subtotal')}</span>
            </div>
            <div className="max-h-32 overflow-y-auto space-y-1.5 pe-1">
              {cart.items.map((item) => {
                const productName =
                  item.product?.name ||
                  (item as unknown as { name?: string; product_name?: string }).name ||
                  (item as unknown as { name?: string; product_name?: string }).product_name ||
                  'Item';
                const itemUnitPrice = item.variant
                  ? item.variant.price
                  : Number(item.product?.price ?? (item as unknown as { price?: number }).price) ||
                    0;
                const lineTotal = itemUnitPrice * item.quantity;
                const bogoStatus = bogoCalc.itemBreakdown?.[item.id];
                const hasBogoDiscount = cart.bogoActive && Boolean(bogoStatus && bogoStatus.freeUnits > 0);
                const isAllFree = Boolean(hasBogoDiscount && bogoStatus!.paidUnits === 0);
                const isPartialFree = Boolean(hasBogoDiscount && bogoStatus!.paidUnits > 0);

                return (
                  <div
                    key={item.id}
                    className="flex items-center justify-between text-xs py-0.5"
                    data-testid={`checkout-item-${item.id}`}
                  >
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="font-medium text-foreground truncate">
                        {productName}
                      </span>
                      {item.variant && (
                        <span className="text-[11px] text-muted-foreground shrink-0">
                          ({item.variant.name})
                        </span>
                      )}
                      <span className="text-muted-foreground shrink-0">
                        × {item.quantity}
                      </span>
                      {isAllFree && (
                        <span className="rounded bg-emerald-100 dark:bg-emerald-950/60 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-300 shrink-0">
                          FREE
                        </span>
                      )}
                      {isPartialFree && (
                        <span className="rounded bg-emerald-100 dark:bg-emerald-950/60 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-300 shrink-0">
                          {bogoStatus!.paidUnits} Paid · {bogoStatus!.freeUnits} Free
                        </span>
                      )}
                    </div>
                    <div className="tabular-nums font-medium text-foreground shrink-0 ms-2">
                      {isAllFree ? (
                        <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                          {currencyFmt(0)}{' '}
                          <span className="line-through text-muted-foreground text-[10px] font-normal">
                            {currencyFmt(lineTotal)}
                          </span>
                        </span>
                      ) : isPartialFree ? (
                        <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                          {currencyFmt(Math.max(0, lineTotal - (bogoStatus?.discount || 0)))}{' '}
                          <span className="line-through text-muted-foreground text-[10px] font-normal">
                            {currencyFmt(lineTotal)}
                          </span>
                        </span>
                      ) : (
                        currencyFmt(lineTotal)
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Cart-level discount editor. */}
          {discountOpen && discountModeLoaded && discountMode !== 'none' && (
            <div className="overflow-hidden rounded-xl border border-purple-200 dark:border-purple-800/40 bg-purple-50 dark:bg-purple-950/40 p-3 space-y-2">
              {standardPromotions.length > 0 && (
                <div className="space-y-1.5 pb-2 border-b border-purple-200 dark:border-purple-800/40">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-purple-700 dark:text-purple-300">
                    Active Promotions & Offers
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {standardPromotions.map((p) => {
                      const isSelected = selectedPromotionId === p.id;
                      return (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => void handleSelectPromotion(p.id)}
                          className={`text-xs px-2.5 py-1 rounded-lg border font-medium transition-colors ${
                            isSelected
                              ? 'bg-purple-600 text-white border-purple-600 shadow-sm'
                              : 'bg-card text-foreground border-purple-200 dark:border-purple-800/60 hover:bg-purple-100 dark:hover:bg-purple-900/40'
                          }`}
                        >
                          {p.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              <div className="flex rounded-lg overflow-hidden border border-purple-200 dark:border-purple-800/40">
                {isDiscountTypeAllowed(discountMode, 'percentage') && (
                  <button
                    onClick={() => {
                      setSelectedPromotionId('');
                      setDiscountType('percentage');
                      setDiscountValue('');
                    }}
                    className={`touch-target flex-1 gap-1.5 text-sm font-medium transition-colors ${discountType === 'percentage' ? 'bg-purple-600 text-white' : 'bg-card text-muted-foreground hover:bg-muted'}`}
                  >
                    <Percent size={14} />
                    {t('percentage')}
                  </button>
                )}
                {isDiscountTypeAllowed(discountMode, 'amount') && (
                  <button
                    onClick={() => {
                      setSelectedPromotionId('');
                      setDiscountType('amount');
                      setDiscountValue('');
                    }}
                    className={`touch-target flex-1 gap-1.5 text-sm font-medium transition-colors ${discountType === 'amount' ? 'bg-purple-600 text-white' : 'bg-card text-muted-foreground hover:bg-muted'}`}
                  >
                    {t('flatAmount')}
                  </button>
                )}
              </div>
              <div className="relative">
                <span className="absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                  {discountType === 'percentage' ? '%' : inputCurrencyLabel}
                </span>
                <input
                  type="number"
                  value={discountValue}
                  onFocus={() => setAmountTarget({ kind: 'discount' })}
                  onChange={(e) => {
                    setSelectedPromotionId('');
                    setDiscountValue(e.target.value);
                  }}
                  placeholder={discountType === 'percentage' ? '0' : '0.00'}
                  min="0"
                  max={
                    discountType === 'percentage'
                      ? 100
                      : preview
                        ? toDisplayUnit(preview.subtotal)
                        : undefined
                  }
                  step={getDiscountInputStep(unitAdapter.maxDecimals, discountType)}
                  inputMode={discountType === 'percentage' ? 'numeric' : 'decimal'}
                  className="w-full min-h-11 ps-8 pe-3 py-2 text-sm border border-purple-200 dark:border-purple-800/40 rounded-lg outline-none focus:ring-2 focus:ring-purple-400 bg-card"
                />
              </div>
              <input
                type="text"
                value={discountReason}
                onChange={(e) => setDiscountReason(e.target.value)}
                placeholder={t('discountReasonPlaceholder')}
                className="w-full min-h-11 px-3 py-2 text-sm border border-purple-200 dark:border-purple-800/40 rounded-lg outline-none focus:ring-2 focus:ring-purple-400 bg-card"
              />
              {discountNeedsApprovalPin && parseFloat(discountValue) > 0 && (
                <div className="space-y-2">
                  <ApproverSelect
                    id="prepaidDiscountApprover"
                    approvers={managerApprovers.approvers}
                    selectedApproverId={discountApproverId ?? managerApprovers.selectedApproverId}
                    onSelectApprover={(id) => {
                      setDiscountApproverId(id);
                      setDiscountPin('');
                    }}
                    loading={managerApprovers.loading}
                    loadFailed={managerApprovers.loadFailed}
                    disabled={processing}
                  />
                  <input
                    type="password"
                    value={discountPin}
                    onChange={(e) => setDiscountPin(e.target.value)}
                    placeholder={t('managerPin')}
                    maxLength={6}
                    className="w-full min-h-11 px-3 py-2 text-sm border border-purple-200 dark:border-purple-800/40 rounded-lg outline-none focus:ring-2 focus:ring-purple-400 bg-card"
                  />
                </div>
              )}
              {discountValue && (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() => {
                    setSelectedPromotionId('');
                    setDiscountValue('');
                    setDiscountReason('');
                    setDiscountPin('');
                    setDiscountApproverId(null);
                    setPaymentsTouched(false);
                  }}
                >
                  {t('remove')}
                </Button>
              )}
            </div>
          )}

          {/* Payment Method Selector */}
          <div className="space-y-3 my-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Payment Method
            </p>
            <div className="grid grid-cols-2 gap-3">
              {PAYMENT_METHODS.map((method) => {
                const isCard = (method.key as string) === 'card';
                const label = isCard
                  ? t('methodCard')
                  : t(BUILT_IN_PAYMENT_KEYS[method.key as 'cash' | 'upi'] || 'methodCash');
                const Icon = method.icon || Banknote;
                const isSelected = selectedMethod === method.key;
                return (
                  <button
                    key={method.key}
                    type="button"
                    title={isCard ? 'methodCard' : label}
                    data-testid={`pay-method-${method.key}`}
                    onClick={() => selectPaymentMethod(method.key)}
                    className={`touch-target flex flex-col items-center justify-center p-4 rounded-xl border-2 transition-all ${
                      isSelected
                        ? 'border-brand bg-brand/10 text-brand font-bold shadow-sm ring-1 ring-brand'
                        : 'border-border bg-card text-foreground hover:bg-muted'
                    }`}
                  >
                    <Icon size={32} className="mb-2 text-brand" />
                    <span className="text-base font-bold">{label}</span>
                    <span className="text-xs font-semibold mt-1 tabular-nums">
                      {currencyFmt(remaining)}
                    </span>
                  </button>
                );
              })}
            </div>
            {selectedMethod === 'card' && (
              <input
                type="text"
                placeholder={t('cardTransactionIdLabel')}
                aria-label="cardTransactionIdLabel"
                value={payments.find((p) => p.method === 'card')?.transaction_id ?? ''}
                onChange={(e) => {
                  const val = e.target.value;
                  setPayments((curr) =>
                    curr.map((p) => (p.method === 'card' ? { ...p, transaction_id: val } : p)),
                  );
                }}
                maxLength={256}
                className="w-full min-h-11 rounded-xl border border-border bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand"
              />
            )}
          </div>
          {amountTarget?.kind === 'discount' && (
            <CurrencyTouchNumberPad
              value={activeAmountValue}
              onChange={updateActiveAmount}
              ariaLabel={t('numericKeypad')}
              clearLabel={t('clearAmount')}
              backspaceLabel={t('backspaceAmount')}
              currencyMaxDecimals={unitAdapter.maxDecimals}
              amountTarget={amountTarget.kind}
              discountType={discountType}
              max={activeAmountMax}
              quickValues={activeAmountQuickValues}
            />
          )}

          {hasCash && change > 0 && (
            <div className="rounded-xl px-4 py-2.5 flex items-center justify-between border bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800/40">
              <span className="text-sm font-semibold text-emerald-800 dark:text-emerald-300">
                {t('changeReturned')}
              </span>
              <span className="text-lg font-bold tabular-nums text-emerald-600">
                {currencyFmt(change)}
              </span>
            </div>
          )}
        </div>

        {/* Pay Button */}
        <div className="shrink-0 border-t border-border px-5 pb-6 pt-3">
          <Button
            onClick={() => handleConfirm()}
            disabled={
              processing ||
              taxLoading ||
              !preview ||
              hasInvalidFixedDiscount ||
              totalPaymentMinor < remainingMinor ||
              Boolean(
                preview.discountAmount > 0 &&
                discountNeedsApprovalPin &&
                (!discountPin ||
                  managerApprovers.loading ||
                  managerApprovers.loadFailed ||
                  managerApprovers.approvers.length === 0 ||
                  !(discountApproverId ?? managerApprovers.selectedApproverId)),
              )
            }
            className="w-full h-12 text-base font-semibold rounded-xl"
            size="lg"
          >
            {taxLoading
              ? t('calculatingTax')
              : processing
                ? t('processingPayment')
                : remaining <= 0
                  ? 'Confirm Order (Free)'
                  : t('confirmPaymentAmount', { amount: currencyFmt(remaining) })}
          </Button>
        </div>
      </div>
    </div>
  );
}
