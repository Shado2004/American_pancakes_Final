import { create } from 'zustand';
import toast from 'react-hot-toast';
import type { Customer, Product, Addon, CartItem, ProductVariant, ServingAllocationInput } from '@/lib/types';
import { generateCartItemId, normalizeCartItems } from '@/lib/cart-identity';
import { cartLineUnitPrice, normalizeOverridePrice } from '@/lib/cart-price';
import { onSessionBoundary } from './session-events';

export { generateCartItemId, normalizeCartItems } from '@/lib/cart-identity';

export type CartOrderType = 'dine_in' | 'takeaway' | 'delivery' | 'online';

export function isParcelBoxProduct(
  product: { id?: string | number; name?: string } | null | undefined,
): boolean {
  if (!product) return false;
  return (
    String(product.id) === 'pr_parcel_box_5' ||
    (typeof product.name === 'string' &&
      product.name.toLowerCase().includes('parcel box'))
  );
}

export function isParcelBoxItem(item: {
  product: { id?: string | number; name?: string };
}): boolean {
  return isParcelBoxProduct(item.product);
}

export interface RoadsidePackagingSummary {
  pancakes: number;
  boxes: number;
  boxesAllocated: number;
  boxesStandalone: number;
  plates: number;
  plateUnitCost: number;
  boxUnitCost: number;
  plateCost: number;
  boxCost: number;
  internalCost: number;
  customerPackagingCharge: number;
}

export interface CartBogoItemUnitStatus {
  paidUnits: number;
  freeUnits: number;
  discount: number;
}

export interface CartBogoPair {
  pairId: string;
  itemAId: string;
  itemBId: string;
  unitIndexA?: number;
  unitIndexB?: number;
}

export interface EvaluatedCartBogoPair {
  pairId: string;
  chargedItem: { itemId: string; productName: string; price: number };
  freeItem: { itemId: string; productName: string; price: number };
  discount: number;
}

export interface CartBogoCalculation {
  active: boolean;
  totalDiscount: number;
  pairs: EvaluatedCartBogoPair[];
  freeUnitCount: number;
  chargedUnitCount: number;
  qualifyingPancakes: number;
  paidUnitCount: number;
  payableTotal: number;
  itemBreakdown: Record<string, CartBogoItemUnitStatus>;
}

export function evaluateCartBogo(
  items: CartItem[],
  bogoActive: boolean,
  _bogoPairs: CartBogoPair[] = [],
  onlinePlatformSelected = false,
): CartBogoCalculation {
  const totalPancakes = items
    .filter((item) => !isParcelBoxItem(item))
    .reduce((sum, item) => sum + (Number(item.quantity) || 1), 0);

  if (!bogoActive) {
    return {
      active: false,
      totalDiscount: 0,
      pairs: [],
      freeUnitCount: 0,
      chargedUnitCount: totalPancakes,
      qualifyingPancakes: totalPancakes,
      paidUnitCount: totalPancakes,
      payableTotal: 0,
      itemBreakdown: {},
    };
  }

  interface Unit {
    uid: string;
    itemId: string;
    unitIndex: number;
    productId: string | number;
    productName: string;
    price: number;
  }

  const pancakeUnits: Unit[] = [];
  for (const item of items) {
    if (isParcelBoxItem(item)) continue;
    const price = cartLineUnitPrice(item, onlinePlatformSelected);
    const qty = Math.max(1, Math.round(Number(item.quantity) || 1));
    for (let i = 0; i < qty; i++) {
      pancakeUnits.push({
        uid: `${item.id}_${i}`,
        itemId: item.id,
        unitIndex: i,
        productId: item.product.id,
        productName: item.product.name,
        price,
      });
    }
  }

  const qualifyingPancakes = pancakeUnits.length;
  const freeUnitCount = Math.floor(qualifyingPancakes / 2);
  const paidUnitCount = qualifyingPancakes - freeUnitCount;

  if (freeUnitCount === 0) {
    return {
      active: false,
      totalDiscount: 0,
      pairs: [],
      freeUnitCount: 0,
      chargedUnitCount: qualifyingPancakes,
      qualifyingPancakes,
      paidUnitCount,
      payableTotal: pancakeUnits.reduce((sum, u) => sum + u.price, 0),
      itemBreakdown: {},
    };
  }

  // Sort eligible pancake units by unit price descending.
  // Highest-priced units are paid; lowest-priced units are BOGO free.
  // Tie-breaker: productName, itemId, unitIndex
  const sorted = [...pancakeUnits].sort((a, b) => {
    if (b.price !== a.price) {
      return b.price - a.price;
    }
    const nameCmp = String(a.productName).localeCompare(String(b.productName));
    if (nameCmp !== 0) return nameCmp;
    const itemCmp = String(a.itemId).localeCompare(String(b.itemId));
    if (itemCmp !== 0) return itemCmp;
    return a.unitIndex - b.unitIndex;
  });

  const evaluated: EvaluatedCartBogoPair[] = [];
  let totalDiscount = 0;

  for (let p = 0; p < freeUnitCount; p++) {
    const charged = sorted[p];
    const free = sorted[paidUnitCount + p];
    const discount = free.price;
    totalDiscount += discount;
    evaluated.push({
      pairId: `pair-${p + 1}`,
      chargedItem: { itemId: charged.itemId, productName: charged.productName, price: charged.price },
      freeItem: { itemId: free.itemId, productName: free.productName, price: free.price },
      discount,
    });
  }

  const itemBreakdown: Record<string, CartBogoItemUnitStatus> = {};
  for (const item of items) {
    if (isParcelBoxItem(item)) continue;
    itemBreakdown[item.id] = { paidUnits: 0, freeUnits: 0, discount: 0 };
  }

  for (let i = 0; i < paidUnitCount; i++) {
    const u = sorted[i];
    if (itemBreakdown[u.itemId]) {
      itemBreakdown[u.itemId].paidUnits += 1;
    }
  }

  for (let i = paidUnitCount; i < sorted.length; i++) {
    const u = sorted[i];
    if (itemBreakdown[u.itemId]) {
      itemBreakdown[u.itemId].freeUnits += 1;
      itemBreakdown[u.itemId].discount += u.price;
    }
  }

  const totalPancakeCost = pancakeUnits.reduce((sum, u) => sum + u.price, 0);
  const payableTotal = Math.max(0, totalPancakeCost - totalDiscount);

  return {
    active: true,
    totalDiscount,
    pairs: evaluated,
    freeUnitCount,
    chargedUnitCount: paidUnitCount,
    qualifyingPancakes,
    paidUnitCount,
    payableTotal,
    itemBreakdown,
  };
}

export function calculateRoadsidePackaging(
  items: CartItem[],
  packagingBoxesCount?: number | null,
): RoadsidePackagingSummary {
  const pancakes = items
    .filter((item) => !isParcelBoxItem(item))
    .reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);

  const boxes = items
    .filter((item) => isParcelBoxItem(item))
    .reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);

  // FINAL PAPER PLATE AND PARCEL BOX RULE:
  // Parcel boxes allocated to pancakes replace paper plates 1-for-1.
  // Standalone/excess parcel boxes do not replace plates.
  const maxPackaging = Math.min(pancakes, boxes);
  const boxesAllocated =
    maxPackaging === 0
      ? 0
      : packagingBoxesCount !== null && packagingBoxesCount !== undefined
        ? Math.max(0, Math.min(packagingBoxesCount, maxPackaging))
        : maxPackaging;

  const boxesStandalone = Math.max(0, boxes - boxesAllocated);
  const plates = Math.max(0, pancakes - boxesAllocated);
  const plateUnitCost = 2.5;
  const boxUnitCost = 3.5; // Standard purchase cost is ₹3.50 (never ₹5 selling price)
  const plateCost = plates * plateUnitCost;
  const boxCost = boxes * boxUnitCost;
  const internalCost = plateCost + boxCost;

  return {
    pancakes,
    boxes,
    boxesAllocated,
    boxesStandalone,
    plates,
    plateUnitCost,
    boxUnitCost,
    plateCost,
    boxCost,
    internalCost,
    customerPackagingCharge: 0,
  };
}

export function clampBoxesToPancakes(
  items: CartItem[],
  _onAdjusted?: (message: string) => void,
): CartItem[] {
  // Parcel Box is an independent sellable product and can be sold in any quantity
  // standalone or alongside pancakes without clamping.
  return items;
}

export function recomputeRoadsideAllocations(
  items: CartItem[],
  packagingBoxesCount?: number | null,
): CartItem[] {
  const summary = calculateRoadsidePackaging(items, packagingBoxesCount);
  let remainingPackagingBoxes = summary.boxesAllocated;

  return items.map((item) => {
    if (isParcelBoxItem(item)) {
      return {
        ...item,
        serving_allocations: [
          { serving_type: 'parcel' as const, quantity: item.quantity },
        ],
      };
    }

    const qty = Math.max(1, Math.round(Number(item.quantity) || 1));
    const parcelQty = Math.min(qty, remainingPackagingBoxes);
    const dineInQty = qty - parcelQty;
    remainingPackagingBoxes -= parcelQty;

    const allocations: ServingAllocationInput[] = [];
    if (parcelQty > 0) {
      allocations.push({ serving_type: 'parcel', quantity: parcelQty });
    }
    if (dineInQty > 0) {
      allocations.push({ serving_type: 'dine_in', quantity: dineInQty });
    }

    return {
      ...item,
      serving_allocations: allocations,
    };
  });
}

interface CartState {
  items: CartItem[];
  orderType: CartOrderType;
  tableId: string | null;
  heldOrderId: string | null;
  customerId: number | string | null;
  customer: Customer | null;
  customerSource: 'explicit' | 'reservation' | null;
  guestCount: number;
  deliveryAddress: string;
  /** '' is unknown; 'pending', 'cash', 'card', or a custom method name otherwise. */
  expectedPaymentMethod: string;
  /** Configured-method identity for a custom choice; built-ins and sentinels keep it null. */
  expectedPaymentMethodId: number | null;
  deliveryNote: string;
  onlinePlatform: string;
  externalOrderId: string;
  orderNotes: string;
  scheduledFor: string;

  addItem: (
    product: Product,
    quantity?: number,
    addons?: Addon[],
    specialInstructions?: string,
    variant?: ProductVariant | null,
  ) => void;
  updateItemDetails: (
    cartItemId: string,
    quantity: number,
    addons: Addon[],
    specialInstructions: string,
    variant?: ProductVariant | null,
  ) => void;
  removeItem: (cartItemId: string) => void;
  /** Sets (or with null clears) the owner-approved selling price for one line. */
  setItemPriceOverride: (
    cartItemId: string,
    override: { price: number; reason: string } | null,
  ) => void;
  clearPriceOverrides: () => void;
  updateQuantity: (cartItemId: string, quantity: number) => void;
  setServingAllocations: (cartItemId: string, allocations: ServingAllocationInput[]) => void;
  clearCart: () => void;
  loadItems: (
    items: CartItem[],
    tableId: string | null,
    customerId: number | string | null,
    guestCount: number,
    orderNotes?: string,
    heldOrderId?: string,
    waivedChargeIds?: string[],
    optedInChargeIds?: string[],
  ) => void;
  setOrderType: (type: CartState['orderType']) => void;
  setTableId: (id: string | null) => void;
  setCustomerId: (id: number | string | null) => void;
  setCustomer: (customer: Customer | null) => void;
  setReservationCustomer: (customer: Customer | null) => void;
  setGuestCount: (count: number) => void;
  setDeliveryAddress: (address: string) => void;
  setExpectedPaymentMethod: (method: string, methodId?: number | null) => void;
  setDeliveryNote: (note: string) => void;
  setOnlinePlatform: (platform: string) => void;
  setExternalOrderId: (id: string) => void;
  setOrderNotes: (notes: string) => void;
  setScheduledFor: (value: string) => void;
  /** Charge ids the cashier has waived in this cart. */
  waivedChargeIds: Set<string>;
  /** Opt-in (not default-active) charges the cashier has added to this cart. */
  optedInChargeIds: Set<string>;
  toggleWaiveCharge: (chargeId: string) => void;
  toggleOptedInCharge: (chargeId: string) => void;
  resetCharges: () => void;

  packagingBoxesCount: number | null;
  setPackagingBoxesCount: (count: number | null) => void;

  bogoActive: boolean;
  bogoPromotionId: string | null;
  bogoPairs: CartBogoPair[];
  setBogoActive: (active: boolean, promoId?: string) => void;
  setBogoPairs: (pairs: CartBogoPair[]) => void;
  clearBogo: () => void;
  bogoCalculation: () => CartBogoCalculation;
  bogoDiscount: () => number;
  payableTotal: () => number;

  subtotal: () => number;
  itemCount: () => number;
}

export const useCartStore = create<CartState>((set, get) => {
  const commitCartItems = (updatedItems: CartItem[]) => {
    const clamped = clampBoxesToPancakes(updatedItems, (msg) => {
      try {
        toast(msg, { icon: 'ℹ️' });
      } catch {}
    });
    const state = get();
    const summary = calculateRoadsidePackaging(clamped, state.packagingBoxesCount);
    const maxPackaging = Math.min(summary.pancakes, summary.boxes);
    const nextCount = maxPackaging === 0 ? null : summary.boxesAllocated;
    set({
      packagingBoxesCount: nextCount,
      items: recomputeRoadsideAllocations(clamped, nextCount),
    });
  };

  return {
    items: [],
    orderType: 'takeaway',
    tableId: null,
    heldOrderId: null,
    customerId: null,
    customer: null,
    customerSource: null,
    guestCount: 1,
    deliveryAddress: '',
    expectedPaymentMethod: '',
    expectedPaymentMethodId: null,
    deliveryNote: '',
    onlinePlatform: '',
    externalOrderId: '',
    orderNotes: '',
    scheduledFor: '',
    waivedChargeIds: new Set<string>(),
    optedInChargeIds: new Set<string>(),
    packagingBoxesCount: null,
    setPackagingBoxesCount: (count) => {
      const state = get();
      const summary = calculateRoadsidePackaging(state.items, count);
      const maxPackaging = Math.min(summary.pancakes, summary.boxes);
      const nextCount = maxPackaging === 0 ? null : summary.boxesAllocated;
      set({
        packagingBoxesCount: nextCount,
        items: recomputeRoadsideAllocations(state.items, nextCount),
      });
    },
    bogoActive: false,
    bogoPromotionId: null,
    bogoPairs: [],
  setBogoActive: (active, promoId = 'launch-bogo') =>
    set({ bogoActive: active, bogoPromotionId: active ? promoId : null, bogoPairs: [] }),
  setBogoPairs: (pairs) => set({ bogoPairs: pairs, bogoActive: pairs.length > 0 }),
  clearBogo: () => set({ bogoActive: false, bogoPromotionId: null, bogoPairs: [] }),

  // Waivers are explicit state, never inferred from a zero amount: a waived
  // charge and a fee configured at 0 must stay distinguishable.
  toggleWaiveCharge: (chargeId) =>
    set((state) => {
      const waivedChargeIds = new Set(state.waivedChargeIds);
      if (waivedChargeIds.has(chargeId)) waivedChargeIds.delete(chargeId);
      else waivedChargeIds.add(chargeId);
      return { waivedChargeIds };
    }),

  toggleOptedInCharge: (chargeId) =>
    set((state) => {
      const optedInChargeIds = new Set(state.optedInChargeIds);
      if (optedInChargeIds.has(chargeId)) optedInChargeIds.delete(chargeId);
      else optedInChargeIds.add(chargeId);
      return { optedInChargeIds };
    }),

  resetCharges: () =>
    set({ waivedChargeIds: new Set<string>(), optedInChargeIds: new Set<string>() }),

  addItem: (product, quantity = 1, addons = [], specialInstructions = '', variant = null) => {
    const items = get().items;

    const itemId = generateCartItemId(product.id, variant?.id ?? null, addons, specialInstructions);
    const existing = items.find((i) => i.id === itemId);

    let updatedItems: CartItem[];
    if (existing) {
      updatedItems = items.map((i) =>
        i.id === itemId
          ? {
              ...i,
              quantity: i.quantity + quantity,
            }
          : i,
      );
    } else {
      updatedItems = [
        ...items,
        {
          id: itemId,
          product,
          quantity,
          addons,
          special_instructions: specialInstructions,
          variant,
          serving_allocations: [],
        },
      ];
    }

    commitCartItems(updatedItems);
  },

  updateItemDetails: (cartItemId, quantity, addons, specialInstructions, variant) => {
    const items = get().items;
    const target = items.find((i) => i.id === cartItemId);
    if (!target) return;

    // Omitting the variant keeps the one already chosen on the line.
    const nextVariant = variant === undefined ? (target.variant ?? null) : variant;
    const newId = generateCartItemId(
      target.product.id,
      nextVariant?.id ?? null,
      addons,
      specialInstructions,
      target.price_override,
    );
    let updatedItems: CartItem[];
    if (newId === cartItemId) {
      updatedItems = items.map((i) =>
        i.id === cartItemId
          ? {
              ...i,
              quantity,
              addons,
              special_instructions: specialInstructions,
              variant: nextVariant,
            }
          : i,
      );
    } else {
      // The edit produced a config that matches another existing line — merge into it.
      const collision = items.find((i) => i.id === newId && i.id !== cartItemId);
      if (collision) {
        updatedItems = items
          .filter((i) => i.id !== cartItemId)
          .map((i) => (i.id === newId ? { ...i, quantity: i.quantity + quantity } : i));
      } else {
        updatedItems = items.map((i) =>
          i.id === cartItemId
            ? {
                ...i,
                id: newId,
                quantity,
                addons,
                special_instructions: specialInstructions,
                variant: nextVariant,
              }
            : i,
        );
      }
    }

    commitCartItems(updatedItems);
  },

  removeItem: (cartItemId) => {
    const items = get().items;
    const updatedItems = items.filter((i) => i.id !== cartItemId);
    commitCartItems(updatedItems);
  },

  setItemPriceOverride: (cartItemId, override) => {
    const items = get().items;
    const target = items.find((i) => i.id === cartItemId);
    if (!target) return;
    const nextOverride = override
      ? { price: normalizeOverridePrice(override.price), reason: override.reason }
      : null;
    const newId = generateCartItemId(
      target.product.id,
      target.variant?.id ?? null,
      target.addons,
      target.special_instructions,
      nextOverride,
    );
    const updated = { ...target, id: newId, price_override: nextOverride };
    const collision = items.find((i) => i.id === newId && i.id !== cartItemId);
    const updatedItems = collision
      ? items
          .filter((i) => i.id !== cartItemId)
          .map((i) => (i.id === newId ? { ...i, quantity: i.quantity + target.quantity } : i))
      : items.map((i) => (i.id === cartItemId ? updated : i));

    commitCartItems(updatedItems);
  },

  clearPriceOverrides: () => {
    const items = get().items;
    const hasOverrides = items.some((i) => Boolean(i.price_override));
    const hasWaivers = get().waivedChargeIds.size > 0;
    if (!hasOverrides && !hasWaivers) return;
    const merged: CartItem[] = [];
    for (const item of items) {
      const cleanId = generateCartItemId(
        item.product.id,
        item.variant?.id ?? null,
        item.addons,
        item.special_instructions,
        null,
      );
      const existing = merged.find((m) => m.id === cleanId);
      if (existing) {
        existing.quantity += item.quantity;
      } else {
        merged.push({ ...item, id: cleanId, price_override: null });
      }
    }
    commitCartItems(merged);
    set({ waivedChargeIds: new Set<string>() });
  },

  updateQuantity: (cartItemId, quantity) => {
    if (quantity <= 0) {
      get().removeItem(cartItemId);
      return;
    }
    const items = get().items;
    const target = items.find((i) => i.id === cartItemId);
    if (!target) return;

    const updatedItems = items.map((i) =>
      i.id === cartItemId ? { ...i, quantity } : i,
    );

    commitCartItems(updatedItems);
  },

  setServingAllocations: (cartItemId, allocations) =>
    set({
      items: get().items.map((item) =>
        item.id === cartItemId ? { ...item, serving_allocations: allocations } : item,
      ),
    }),

  clearCart: () => {
    set({
      items: [],
      tableId: null,
      heldOrderId: null,
      customerId: null,
      customer: null,
      customerSource: null,
      guestCount: 1,
      orderType: 'takeaway',
      deliveryAddress: '',
      expectedPaymentMethod: '',
      expectedPaymentMethodId: null,
      deliveryNote: '',
      onlinePlatform: '',
      externalOrderId: '',
      orderNotes: '',
      scheduledFor: '',
      waivedChargeIds: new Set<string>(),
      optedInChargeIds: new Set<string>(),
      packagingBoxesCount: null,
      bogoActive: false,
      bogoPromotionId: null,
      bogoPairs: [],
    });
  },

  loadItems: (
    items,
    tableId,
    customerId,
    guestCount,
    orderNotes,
    heldOrderId,
    waivedChargeIds,
    optedInChargeIds,
  ) => {
    const normalized = normalizeCartItems(items);
    const clamped = clampBoxesToPancakes(normalized);
    set({
      packagingBoxesCount: null,
      items: recomputeRoadsideAllocations(clamped, null),
      tableId,
      heldOrderId: heldOrderId || null,
      customerId,
      customerSource: customerId == null ? null : 'explicit',
      guestCount,
      orderNotes: orderNotes || '',
      scheduledFor: '',
      // Independent Sets: a resumed cart must not alias the arrays it came from.
      waivedChargeIds: new Set(waivedChargeIds ?? []),
      optedInChargeIds: new Set(optedInChargeIds ?? []),
      bogoActive: false,
      bogoPromotionId: null,
      bogoPairs: [],
    });
  },

  setOrderType: (type) =>
    set((state) => {
      return {
        orderType: type,
        items: recomputeRoadsideAllocations(state.items, state.packagingBoxesCount),
        deliveryAddress: type !== 'delivery' ? '' : state.deliveryAddress,
        expectedPaymentMethod: type !== 'delivery' ? '' : state.expectedPaymentMethod,
        expectedPaymentMethodId: type !== 'delivery' ? null : state.expectedPaymentMethodId,
        deliveryNote: type !== 'delivery' ? '' : state.deliveryNote,
        onlinePlatform: type !== 'online' ? '' : state.onlinePlatform,
        externalOrderId: type !== 'online' ? '' : state.externalOrderId,
        scheduledFor: type === 'takeaway' || type === 'delivery' ? state.scheduledFor : '',
        ...(state.orderType === type
          ? {}
          : { waivedChargeIds: new Set<string>(), optedInChargeIds: new Set<string>() }),
      };
    }),
  setTableId: (id) => set({ tableId: id, heldOrderId: null }),
  setCustomerId: (id) => set({ customerId: id, customerSource: id == null ? null : 'explicit' }),
  setCustomer: (customer) =>
    set({
      customer,
      customerId: customer?.id ?? null,
      customerSource: customer ? 'explicit' : null,
    }),
  setReservationCustomer: (customer) =>
    set({
      customer,
      customerId: customer?.id ?? null,
      customerSource: customer ? 'reservation' : null,
    }),
  setGuestCount: (count) => set({ guestCount: count }),
  setDeliveryAddress: (address) => set({ deliveryAddress: address }),
  setExpectedPaymentMethod: (method, methodId) =>
    set({ expectedPaymentMethod: method, expectedPaymentMethodId: methodId ?? null }),
  setDeliveryNote: (note) => set({ deliveryNote: note }),
  setOnlinePlatform: (platform) => set({ onlinePlatform: platform }),
  setExternalOrderId: (id) => set({ externalOrderId: id }),
  setOrderNotes: (notes) => set({ orderNotes: notes }),
  setScheduledFor: (value) => set({ scheduledFor: value }),

  subtotal: () => {
    const state = get();
    const onlinePlatformSelected =
      state.orderType === 'online' && state.onlinePlatform.trim().length > 0;
    return state.items.reduce((sum, item) => {
      const itemPrice = cartLineUnitPrice(item, onlinePlatformSelected);
      const itemQty = Number(item.quantity) || 1;
      const addonTotal = (item.addons || []).reduce(
        (a, addon) => a + (Number(addon.price) || 0) * (Number(addon.quantity) || 1),
        0,
      );
      return normalizeOverridePrice(sum + (itemPrice + addonTotal) * itemQty);
    }, 0);
  },

  bogoCalculation: () => {
    const state = get();
    const onlinePlatformSelected =
      state.orderType === 'online' && state.onlinePlatform.trim().length > 0;
    return evaluateCartBogo(
      state.items,
      state.bogoActive,
      state.bogoPairs,
      onlinePlatformSelected,
    );
  },

  bogoDiscount: () => {
    return get().bogoCalculation().totalDiscount;
  },

  payableTotal: () => {
    const sub = get().subtotal();
    const disc = get().bogoDiscount();
    return Math.max(0, sub - disc);
  },

  itemCount: () => {
    return get().items.reduce((sum, item) => sum + item.quantity, 0);
  },
};
});

onSessionBoundary(() => {
  useCartStore.getState().clearPriceOverrides();
});
