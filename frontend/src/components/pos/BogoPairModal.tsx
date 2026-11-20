'use client';

import { useState, useMemo } from 'react';
import { X, Sparkles, Plus, Trash2, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useCartStore, isParcelBoxItem, type CartBogoPair } from '@/store/cart';
import { useFormatCurrency } from '@/hooks/useFormatCurrency';
import toast from 'react-hot-toast';

interface Props {
  onClose: () => void;
}

interface Unit {
  uid: string;
  itemId: string;
  productName: string;
  price: number;
}

export default function BogoPairModal({ onClose }: Props) {
  const cart = useCartStore();
  const currencyFmt = useFormatCurrency();

  // Expand all pancake units in cart
  const allUnits: Unit[] = useMemo(() => {
    const units: Unit[] = [];
    for (const item of cart.items) {
      if (isParcelBoxItem(item)) continue;
      const price = Number(item.product.price) || 0;
      const qty = Math.max(1, Math.round(Number(item.quantity) || 1));
      for (let i = 0; i < qty; i++) {
        units.push({
          uid: `${item.id}_${i}`,
          itemId: item.id,
          productName: item.product.name,
          price,
        });
      }
    }
    return units;
  }, [cart.items]);

  // Current draft pairs
  const [draftPairs, setDraftPairs] = useState<CartBogoPair[]>(() => {
    if (cart.bogoPairs && cart.bogoPairs.length > 0) {
      return [...cart.bogoPairs];
    }
    // Auto initialize pairs from available units
    const maxPairs = Math.floor(allUnits.length / 2);
    const sorted = [...allUnits].sort((a, b) => b.price - a.price);
    const initial: CartBogoPair[] = [];
    for (let p = 0; p < maxPairs; p++) {
      initial.push({
        pairId: `bogo-pair-${p + 1}`,
        itemAId: sorted[p * 2].itemId,
        itemBId: sorted[p * 2 + 1].itemId,
      });
    }
    return initial;
  });

  const [selectedUnitForPairing, setSelectedUnitForPairing] = useState<string | null>(null);

  // Determine which units are currently used in draftPairs
  const { usedUids, evaluatedPairs, unpairedUnits } = useMemo(() => {
    const used = new Set<string>();
    const evalList: Array<{
      pairId: string;
      unitA: Unit;
      unitB: Unit;
      chargedUnit: Unit;
      freeUnit: Unit;
      discount: number;
    }> = [];

    let pIdx = 1;
    for (const p of draftPairs) {
      const uA = allUnits.find((u) => !used.has(u.uid) && (u.itemId === p.itemAId || u.uid === p.itemAId));
      if (uA) used.add(uA.uid);

      const uB = allUnits.find((u) => !used.has(u.uid) && (u.itemId === p.itemBId || u.uid === p.itemBId));
      if (uB) used.add(uB.uid);

      if (uA && uB) {
        let charged = uA;
        let free = uB;
        if (uB.price > uA.price) {
          charged = uB;
          free = uA;
        }
        evalList.push({
          pairId: p.pairId || `pair-${pIdx++}`,
          unitA: uA,
          unitB: uB,
          chargedUnit: charged,
          freeUnit: free,
          discount: free.price,
        });
      }
    }

    const unp = allUnits.filter((u) => !used.has(u.uid));
    return { usedUids: used, evaluatedPairs: evalList, unpairedUnits: unp };
  }, [allUnits, draftPairs]);

  const totalDiscount = useMemo(
    () => evaluatedPairs.reduce((sum, p) => sum + p.discount, 0),
    [evaluatedPairs],
  );

  const handleUnitClick = (unit: Unit) => {
    if (!selectedUnitForPairing) {
      setSelectedUnitForPairing(unit.uid);
      return;
    }

    if (selectedUnitForPairing === unit.uid) {
      setSelectedUnitForPairing(null);
      return;
    }

    // Pair selectedUnitForPairing and unit
    const unitA = allUnits.find((u) => u.uid === selectedUnitForPairing);
    if (!unitA) {
      setSelectedUnitForPairing(null);
      return;
    }

    const newPair: CartBogoPair = {
      pairId: `bogo-pair-${draftPairs.length + 1}`,
      itemAId: unitA.itemId,
      itemBId: unit.itemId,
    };

    setDraftPairs([...draftPairs, newPair]);
    setSelectedUnitForPairing(null);
  };

  const handleRemovePair = (index: number) => {
    setDraftPairs(draftPairs.filter((_, i) => i !== index));
  };

  const handleAutoPairOptimal = () => {
    const maxPairs = Math.floor(allUnits.length / 2);
    const sorted = [...allUnits].sort((a, b) => b.price - a.price);
    const autoPairs: CartBogoPair[] = [];
    for (let p = 0; p < maxPairs; p++) {
      autoPairs.push({
        pairId: `bogo-pair-${p + 1}`,
        itemAId: sorted[p * 2].itemId,
        itemBId: sorted[p * 2 + 1].itemId,
      });
    }
    setDraftPairs(autoPairs);
    setSelectedUnitForPairing(null);
    toast.success(`Configured ${autoPairs.length} optimal BOGO pair(s)`);
  };

  const handleSave = () => {
    cart.setBogoPairs(draftPairs);
    cart.setBogoActive(draftPairs.length > 0);
    toast.success(`BOGO applied with ${draftPairs.length} pair(s) saving ${currencyFmt(totalDiscount)}`);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
      <div className="w-full max-w-xl rounded-2xl bg-card border border-border shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="p-4 border-b border-border flex items-center justify-between bg-muted/30">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center">
              <Sparkles size={18} />
            </div>
            <div>
              <h2 className="font-bold text-base text-foreground">Configure BOGO Pairs</h2>
              <p className="text-xs text-muted-foreground">
                Higher-priced pancake is charged; lower-priced pancake is free.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-muted-foreground hover:bg-muted transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 overflow-y-auto space-y-4 flex-1">
          {/* Action Bar */}
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground">
              {allUnits.length} Pancakes in Cart &bull; {evaluatedPairs.length} Active Pair(s)
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={handleAutoPairOptimal}
              className="text-xs h-7 border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-300"
            >
              <Sparkles size={12} className="me-1" /> Auto-Pair Optimal
            </Button>
          </div>

          {/* Configured Pairs */}
          <div className="space-y-2">
            <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              BOGO Pairs ({evaluatedPairs.length})
            </h3>
            {evaluatedPairs.length === 0 ? (
              <div className="p-4 rounded-xl border border-dashed border-border text-center text-xs text-muted-foreground">
                No pairs configured. Tap pancakes below to form a pair or click Auto-Pair.
              </div>
            ) : (
              evaluatedPairs.map((p, idx) => (
                <div
                  key={idx}
                  className="p-3 rounded-xl border border-amber-200 dark:border-amber-800/40 bg-amber-50/40 dark:bg-amber-950/20 flex items-center justify-between gap-2"
                >
                  <div className="flex-1 space-y-1">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-amber-700 dark:text-amber-400">
                      <span>Pair #{idx + 1}</span>
                      <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-amber-100 dark:bg-amber-900 text-amber-800 dark:text-amber-200">
                        Saves {currencyFmt(p.discount)}
                      </span>
                    </div>
                    <div className="text-xs text-foreground flex items-center gap-2">
                      <span className="font-medium text-emerald-700 dark:text-emerald-400">
                        Paid: {p.chargedUnit.productName} ({currencyFmt(p.chargedUnit.price)})
                      </span>
                      <span className="text-muted-foreground">&bull;</span>
                      <span className="font-semibold text-amber-600 dark:text-amber-400">
                        Free: {p.freeUnit.productName} ({currencyFmt(0)})
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => handleRemovePair(idx)}
                    className="p-1.5 rounded-lg text-muted-foreground hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                    title="Remove pair"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))
            )}
          </div>

          {/* Unpaired Pancakes */}
          {unpairedUnits.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Unpaired Pancakes ({unpairedUnits.length}) &mdash; Full Menu Price
              </h3>
              <p className="text-[11px] text-muted-foreground">
                Tap two pancakes to pair them together.
              </p>
              <div className="grid grid-cols-2 gap-2">
                {unpairedUnits.map((u) => {
                  const isSelected = selectedUnitForPairing === u.uid;
                  return (
                    <button
                      key={u.uid}
                      type="button"
                      onClick={() => handleUnitClick(u)}
                      className={`p-2.5 rounded-xl border text-start transition-all ${
                        isSelected
                          ? 'border-amber-500 bg-amber-100/60 dark:bg-amber-900/40 ring-2 ring-amber-500 font-bold'
                          : 'border-border bg-card hover:border-amber-300'
                      }`}
                    >
                      <div className="text-xs font-medium text-foreground truncate">
                        {u.productName}
                      </div>
                      <div className="text-xs text-brand font-bold mt-0.5">
                        {currencyFmt(u.price)}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-border bg-muted/20 flex items-center justify-between gap-3">
          <div>
            <div className="text-xs text-muted-foreground">Total BOGO Discount</div>
            <div className="text-base font-extrabold text-emerald-600 dark:text-emerald-400">
              -{currencyFmt(totalDiscount)}
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              className="bg-brand text-white hover:bg-brand/90"
            >
              <CheckCircle2 size={14} className="me-1.5" /> Apply Pairs
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
