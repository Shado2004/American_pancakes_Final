'use client';

import { useState, useEffect, useMemo } from 'react';
import { X, ArrowLeftRight, CheckCircle2, AlertCircle, Banknote, QrCode } from 'lucide-react';
import { Button } from '@/components/ui/button';
import api from '@/lib/api';
import type { Order, OrderItem, Product } from '@/lib/types';
import { useFormatCurrency } from '@/hooks/useFormatCurrency';
import { isParcelBoxProduct } from '@/store/cart';
import toast from 'react-hot-toast';

interface Props {
  order: Order;
  onClose: () => void;
  onSuccess: () => void;
}

export default function OrderSwapModal({ order, onClose, onSuccess }: Props) {
  const currencyFmt = useFormatCurrency();
  const [products, setProducts] = useState<Product[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [selectedOldItemId, setSelectedOldItemId] = useState<number | string | null>(null);
  const [selectedNewProductId, setSelectedNewProductId] = useState<string>('');
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'upi'>('cash');
  const [reason, setReason] = useState('Customer requested pancake swap');
  const [submitting, setSubmitting] = useState(false);

  // Load active products
  useEffect(() => {
    let active = true;
    api
      .get('/products?is_active=true')
      .then((res) => {
        if (!active) return;
        const list: Product[] = res.data?.products || [];
        // Only sellable pancakes (exclude parcel boxes)
        const pancakeProducts = list.filter((p) => !isParcelBoxProduct(p));
        setProducts(pancakeProducts);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoadingProducts(false);
      });
    return () => {
      active = false;
    };
  }, []);

  // Filter swappable items in current order
  const swappableItems = useMemo(() => {
    return (order.items || []).filter((item) => {
      if (['cancelled', 'voided', 'swapped'].includes(item.status as any)) return false;
      if (isParcelBoxProduct({ id: item.product_id, name: item.product_name })) return false;
      return true;
    });
  }, [order.items]);

  // Set default selected item
  useEffect(() => {
    if (swappableItems.length > 0 && selectedOldItemId === null) {
      setSelectedOldItemId(swappableItems[0].id);
    }
  }, [swappableItems, selectedOldItemId]);

  const selectedOldItem = useMemo(() => {
    return swappableItems.find((i) => String(i.id) === String(selectedOldItemId)) || null;
  }, [swappableItems, selectedOldItemId]);

  const selectedNewProduct = useMemo(() => {
    return products.find((p) => String(p.id) === String(selectedNewProductId)) || null;
  }, [products, selectedNewProductId]);

  // Determine BOGO attributes of old item
  const oldItemBogoInfo = useMemo(() => {
    if (!selectedOldItem) return { isBogo: false, isFree: false, isPaid: false };
    let isFree = false;
    let isPaid = false;
    if (selectedOldItem.product_name?.includes('(BOGO Free)') || selectedOldItem.special_instructions?.includes('BOGO Free')) {
      isFree = true;
    }
    if (selectedOldItem.modifier_selection) {
      try {
        const mod =
          typeof selectedOldItem.modifier_selection === 'string'
            ? JSON.parse(selectedOldItem.modifier_selection)
            : selectedOldItem.modifier_selection;
        if (mod?.is_bogo_free) isFree = true;
        if (mod?.is_bogo_paid) isPaid = true;
      } catch {}
    }
    return { isBogo: isFree || isPaid, isFree, isPaid };
  }, [selectedOldItem]);

  // Calculate price difference
  const financialDifference = useMemo(() => {
    if (!selectedOldItem || !selectedNewProduct) return 0;
    const oldQty = Number(selectedOldItem.quantity || 1);
    const newUnitPrice = Number(selectedNewProduct.price || 0);

    if (oldItemBogoInfo.isFree) {
      // Find sibling paid item
      const sibling = (order.items || []).find(
        (i) => String(i.id) !== String(selectedOldItem.id) && !['cancelled', 'voided', 'swapped'].includes(i.status),
      );
      const paidPrice = sibling ? Number(sibling.unit_price || 0) : Number(selectedOldItem.unit_price || 0);
      if (newUnitPrice <= paidPrice) {
        return 0; // Even swap
      }
      return Number(((newUnitPrice - paidPrice) * oldQty).toFixed(2));
    }

    if (oldItemBogoInfo.isPaid) {
      const sibling = (order.items || []).find(
        (i) => String(i.id) !== String(selectedOldItem.id) && !['cancelled', 'voided', 'swapped'].includes(i.status),
      );
      const siblingPrice = sibling ? Number(sibling.unit_price || 0) : 0;
      const newHigh = Math.max(newUnitPrice, siblingPrice);
      const oldCharged = Number(selectedOldItem.unit_price || 0);
      return Number(((newHigh - oldCharged) * oldQty).toFixed(2));
    }

    // Normal non-BOGO swap
    const oldPaid = Number(selectedOldItem.subtotal || 0) - Number(selectedOldItem.discount_amount || 0);
    const newCost = Number((newUnitPrice * oldQty).toFixed(2));
    return Number((newCost - oldPaid).toFixed(2));
  }, [selectedOldItem, selectedNewProduct, oldItemBogoInfo, order.items]);

  const handleConfirmSwap = async () => {
    if (!selectedOldItemId || !selectedNewProductId) {
      toast.error('Please select both an item to swap and a replacement pancake');
      return;
    }

    setSubmitting(true);
    try {
      await api.post(`/orders/${order.id}/swap`, {
        old_item_id: selectedOldItemId,
        new_product_id: selectedNewProductId,
        payment_method: paymentMethod,
        reason: reason.trim() || 'Item swap requested by customer',
      });

      toast.success('Pancake swapped successfully!');
      onSuccess();
      onClose();
    } catch (err: unknown) {
      const error = err as { response?: { data?: { error?: string } } };
      toast.error(error.response?.data?.error || 'Failed to swap pancake');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
      <div className="w-full max-w-lg rounded-2xl bg-card border border-border shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="p-4 border-b border-border flex items-center justify-between bg-muted/30">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-brand/10 text-brand flex items-center justify-center">
              <ArrowLeftRight size={18} />
            </div>
            <div>
              <h2 className="font-bold text-base text-foreground">Swap Pancake Item</h2>
              <p className="text-xs text-muted-foreground">Order #{order.order_number}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-muted-foreground hover:bg-muted transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 overflow-y-auto space-y-4 flex-1">
          {/* 1. Select Item to Replace */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              1. Select Pancake to Replace
            </label>
            {swappableItems.length === 0 ? (
              <div className="p-3 rounded-xl border border-destructive/30 bg-destructive/10 text-xs text-destructive">
                No swappable pancake items found in this order.
              </div>
            ) : (
              <div className="space-y-1.5">
                {swappableItems.map((item) => {
                  const isSelected = String(item.id) === String(selectedOldItemId);
                  const isFree =
                    item.product_name?.includes('(BOGO Free)') ||
                    item.special_instructions?.includes('BOGO Free');
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setSelectedOldItemId(item.id)}
                      className={`w-full p-3 rounded-xl border text-start transition-all flex items-center justify-between ${
                        isSelected
                          ? 'border-brand bg-brand/5 ring-2 ring-brand font-bold'
                          : 'border-border bg-card hover:border-brand/40'
                      }`}
                    >
                      <div>
                        <div className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                          {item.product_name}
                          {isFree && (
                            <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                              BOGO Free
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          Qty: {item.quantity} &bull; Unit Price: {currencyFmt(item.unit_price)}
                        </div>
                      </div>
                      <div className="text-sm font-extrabold text-foreground">
                        {isFree ? currencyFmt(0) : currencyFmt(item.total)}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* 2. Select Replacement Pancake */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              2. Select Replacement Pancake
            </label>
            {loadingProducts ? (
              <div className="text-xs text-muted-foreground p-3">Loading pancakes...</div>
            ) : (
              <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto p-1 border border-border rounded-xl">
                {products.map((prod) => {
                  const isSelected = String(prod.id) === String(selectedNewProductId);
                  return (
                    <button
                      key={prod.id}
                      type="button"
                      onClick={() => setSelectedNewProductId(prod.id)}
                      className={`p-2 rounded-lg border text-start transition-all ${
                        isSelected
                          ? 'border-brand bg-brand/10 ring-2 ring-brand font-bold'
                          : 'border-border/60 bg-card hover:border-brand/40'
                      }`}
                    >
                      <div className="text-xs font-semibold text-foreground truncate">{prod.name}</div>
                      <div className="text-xs font-bold text-brand mt-0.5">
                        {currencyFmt(Number(prod.price))}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* 3. Financial Difference Summary */}
          {selectedOldItem && selectedNewProduct && (
            <div className="p-3.5 rounded-xl border border-border bg-muted/40 space-y-2">
              <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Swap Price Difference
              </div>
              <div className="flex items-center justify-between text-sm">
                <span>Original Item:</span>
                <span className="font-medium text-foreground">
                  {selectedOldItem.product_name} ({currencyFmt(selectedOldItem.unit_price)})
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span>Replacement:</span>
                <span className="font-medium text-foreground">
                  {selectedNewProduct.name} ({currencyFmt(Number(selectedNewProduct.price))})
                </span>
              </div>
              <div className="pt-2 border-t border-border flex items-center justify-between">
                <span className="font-bold text-sm">Financial Adjustment:</span>
                {financialDifference > 0 ? (
                  <span className="text-sm font-extrabold text-amber-600 dark:text-amber-400">
                    Customer Pays +{currencyFmt(financialDifference)}
                  </span>
                ) : financialDifference < 0 ? (
                  <span className="text-sm font-extrabold text-emerald-600 dark:text-emerald-400">
                    Refund Customer {currencyFmt(Math.abs(financialDifference))}
                  </span>
                ) : (
                  <span className="text-sm font-extrabold text-muted-foreground">
                    Even Swap ({currencyFmt(0)})
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Payment Method for difference */}
          {financialDifference !== 0 && (
            <div className="space-y-1.5">
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                {financialDifference > 0 ? 'Collect Payment Via' : 'Issue Refund Via'}
              </label>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant={paymentMethod === 'cash' ? 'default' : 'outline'}
                  onClick={() => setPaymentMethod('cash')}
                  className="h-10 text-xs font-bold"
                >
                  <Banknote size={16} className="me-1.5" /> Cash
                </Button>
                <Button
                  type="button"
                  variant={paymentMethod === 'upi' ? 'default' : 'outline'}
                  onClick={() => setPaymentMethod('upi')}
                  className="h-10 text-xs font-bold"
                >
                  <QrCode size={16} className="me-1.5" /> UPI
                </Button>
              </div>
            </div>
          )}

          {/* Reason */}
          <div className="space-y-1">
            <label className="text-xs font-semibold text-muted-foreground">Reason for Swap</label>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full px-3 py-1.5 text-xs rounded-lg border border-border bg-card focus:outline-none focus:border-brand"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-border bg-muted/20 flex items-center justify-between">
          <Button variant="outline" size="sm" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleConfirmSwap}
            disabled={submitting || !selectedOldItemId || !selectedNewProductId}
            className="bg-brand text-white hover:bg-brand/90"
          >
            {submitting ? 'Swapping...' : <><CheckCircle2 size={14} className="me-1.5" /> Confirm Swap</>}
          </Button>
        </div>
      </div>
    </div>
  );
}
