import type { Database } from 'better-sqlite3';
import { getTenantCurrency } from './refund';
import { getCurrencyMinorUnitFactor, getCurrencyFractionDigits } from '../countries';
import { summarizeExpenses } from './expenses';
import { roundCurrencyCost } from './supplies';
import { deliverySandboxExclusionSql } from './sandbox-exclusion';
import Decimal from 'decimal.js';

export interface ProductPerformanceItem {
  productId: string;
  productName: string;
  isParcelBox: boolean;
  paidQuantity: number;
  freeQuantity: number;
  totalPrepared: number;
  refundedQuantity: number;
  netPaidQuantity: number;
  recoveredQuantity?: number;
  wastageQuantity?: number;
  grossRevenue: number;
  discounts: number;
  refunds: number;
  netRevenue: number;
  ingredientCost: number;
  packagingCost: number;
  profit: number;
  orderCount: number;
}

export interface RoadsidePackagingSummary {
  parcelBoxesSold: number;
  parcelBoxesAllocated: number;
  parcelBoxesStandalone: number;
  parcelBoxRevenue: number;
  parcelBoxUnitCost: number;
  parcelBoxCost: number;
  parcelBoxProfit: number;
  paperPlatesConsumed: number;
  paperPlateUnitCost: number;
  paperPlateCost: number;
  totalPackagingCost: number;
}

export interface RoadsideBusinessSummary {
  netSales: number;
  totalPancakesPrepared: number;
  totalOrders: number;
  operatingProfit: number;
}

export interface RoadsideCostProfitSummary {
  netSales: number;
  ingredientCost: number;
  packagingCost: number;
  totalDirectCost: number;
  grossContribution: number;
  grossContributionMarginPercent: number | null;
  operatingExpenses: number;
  operatingProfit: number;
  wastageCost?: number;
  recoveredSellableCount?: number;
}

export interface RoadsidePaymentCollection {
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

export interface RoadsideBogoSummary {
  totalOrdersWithBogo: number;
  totalFreePancakes: number;
  totalBogoDiscounts: number;
}

export interface RoadsideNormalSalesSummary {
  paidQuantity: number;
  revenue: number;
  rawIngredientCost: number;
  paperPlateCost: number;
  totalIngredientCost: number;
  profit: number;
  recoveredQuantity?: number;
  wastageQuantity?: number;
}

export interface RoadsideBogoSalesSummary {
  pairsRedeemed: number;
  launchPairsRedeemed: number;
  launchPairs?: number;
  loyaltyPairsRedeemed: number;
  loyaltyPairs?: number;
  pancakesPrepared: number;
  paidQuantity: number;
  freeQuantity: number;
  revenue: number;
  rawIngredientCost: number;
  paperPlateCost: number;
  totalIngredientCost: number;
  profit: number;
  totalDiscounts: number;
  discounts?: number;
  recoveredQuantity?: number;
  wastageQuantity?: number;
}

export interface RoadsideReconciliation {
  reconciled: boolean;
  quantityDifference: number;
  revenueDifference: number;
  plateCostDifference: number;
  ingredientCostDifference: number;
  profitDifference: number;
}

export interface RoadsideDashboardSummary {
  startDate: string;
  endDate: string;
  businessSummary: RoadsideBusinessSummary;
  productPerformance: ProductPerformanceItem[];
  packagingSummary: RoadsidePackagingSummary;
  costProfitSummary: RoadsideCostProfitSummary;
  paymentCollection: RoadsidePaymentCollection;
  bogoSummary: RoadsideBogoSummary;
  normalSalesSummary: RoadsideNormalSalesSummary;
  normalSales: RoadsideNormalSalesSummary;
  bogoSalesSummary: RoadsideBogoSalesSummary;
  bogoSales: RoadsideBogoSalesSummary;
  reconciliation: RoadsideReconciliation;
  billCount: number;
  refundCount: number;
  averageOrderValue: number;
}

export function isParcelBoxProduct(item: {
  product_id?: string | null;
  product_name?: string | null;
  no_packaging?: number | null;
}): boolean {
  if (!item) return false;
  const name = String(item.product_name || '').toLowerCase();
  return (
    item.product_id === 'pr_parcel_box_5' ||
    name.includes('parcel box')
  );
}

export function isBogoFreeItem(item: {
  product_name?: string | null;
  modifier_selection?: string | null;
  subtotal?: number | null;
  discount_amount?: number | null;
  total?: number | null;
}): boolean {
  if (!item) return false;
  const name = String(item.product_name || '');
  if (name.includes('(BOGO Free)')) return true;

  if (item.modifier_selection) {
    try {
      const parsed = typeof item.modifier_selection === 'string'
        ? JSON.parse(item.modifier_selection)
        : item.modifier_selection;
      if (parsed && (parsed.is_bogo_free === true || parsed.is_bogo_free === 1)) {
        return true;
      }
    } catch {
      // ignore JSON parse error
    }
  }

  const sub = Number(item.subtotal || 0);
  const disc = Number(item.discount_amount || 0);
  const tot = Number(item.total || 0);
  if (sub > 0 && disc >= sub && tot === 0) {
    return true;
  }

  return false;
}

/**
 * Computes unified roadside stall sales, packaging consumption, costs, and profit.
 * Strictly adheres to:
 * 1. Roadside packaging formula: plates = max(0, total pancakes prepared - parcel boxes sold).
 * 2. Parcel Box: Sellable product at ₹5; inventory cost dynamically retrieved from supplies.
 * 3. Paper Plate: Internal consumption at ₹2.50 per plate; ₹0 on customer bill.
 * 4. Refund handling: Full and partial refunds reduce net sales and product revenue without
 *    reversing consumed ingredients and packaging for already-prepared items.
 * 5. Complete mathematical consistency across all cards and tables.
 */
export function computeRoadsideDashboardSummary(
  db: Database,
  windowStart: string,
  windowEnd: string,
  startDate: string,
  endDate: string,
): RoadsideDashboardSummary {
  const currency = getTenantCurrency(db);
  const minorFactor = getCurrencyMinorUnitFactor(currency);
  const fractionDigits = getCurrencyFractionDigits(currency);

  // 1. Fetch Packaging Unit Costs from supplies table
  let paperPlateUnitCost = 2.5;
  let parcelBoxUnitCost = 3.5;

  try {
    const plateSupply = db
      .prepare(
        `SELECT unit_cost FROM supplies
         WHERE (name LIKE '%Paper Plate%' OR name LIKE '%Plate%') AND deleted_at IS NULL
         ORDER BY id ASC LIMIT 1`,
      )
      .get() as { unit_cost?: number } | undefined;
    if (plateSupply && typeof plateSupply.unit_cost === 'number' && plateSupply.unit_cost > 0) {
      paperPlateUnitCost = plateSupply.unit_cost;
    }

    const boxSupply = db
      .prepare(
        `SELECT unit_cost FROM supplies
         WHERE (name LIKE '%Parcel Box%' OR name LIKE '%Box%') AND deleted_at IS NULL
         ORDER BY id ASC LIMIT 1`,
      )
      .get() as { unit_cost?: number } | undefined;
    if (boxSupply && typeof boxSupply.unit_cost === 'number' && boxSupply.unit_cost > 0) {
      parcelBoxUnitCost = boxSupply.unit_cost;
    }
  } catch {
    // safe fallback to ₹2.50 plate and ₹3.50 box
  }

  // 2. Fetch Settled Bills in Period
  const bills = db
    .prepare(
      `SELECT
        b.id AS bill_id,
        b.order_id,
        b.bill_number,
        b.subtotal,
        b.discount_amount,
        b.discount_type,
        b.total,
        b.paid_amount,
        b.payment_status,
        b.payment_details,
        b.paid_at,
        o.order_number,
        o.status AS order_status
      FROM bills b
      JOIN orders o ON o.id = b.order_id
      WHERE b.paid_at >= ? AND b.paid_at < ?
        AND o.status != 'cancelled'
        AND ${deliverySandboxExclusionSql('o.id')}
      ORDER BY b.paid_at ASC, b.id ASC`,
    )
    .all(windowStart, windowEnd) as any[];

  // 3. Fetch Refunds for Bills in Period (or refunds created in period)
  interface RefundDispositionInfo {
    productDisposition: 'retained_by_customer' | 'recovered_sellable' | 'damaged_wastage';
    plateDisposition: 'plate_consumed' | 'plate_recovered';
    amount: number;
    recoveredIngredientCost: number;
    recoveredPlateCost: number;
  }

  const itemRefundDispositions = new Map<number, RefundDispositionInfo>();
  const billRefundDispositions = new Map<number, RefundDispositionInfo>();

  const refundTableCols = new Set(
    (db.prepare("PRAGMA table_info(refunds)").all() as Array<{ name: string }>).map((c) => c.name),
  );
  const selProdDisp = refundTableCols.has('product_disposition')
    ? 'r.product_disposition'
    : "'retained_by_customer' AS product_disposition";
  const selPlateDisp = refundTableCols.has('plate_disposition')
    ? 'r.plate_disposition'
    : "'plate_consumed' AS plate_disposition";
  const selRecIng = refundTableCols.has('recovered_ingredient_cost')
    ? 'r.recovered_ingredient_cost'
    : '0.0 AS recovered_ingredient_cost';
  const selRecPlate = refundTableCols.has('recovered_plate_cost')
    ? 'r.recovered_plate_cost'
    : '0.0 AS recovered_plate_cost';

  const refunds = db
    .prepare(
      `SELECT
        r.id,
        r.bill_id,
        r.order_item_id,
        CAST(r.amount_cents AS REAL) / ? AS amount,
        r.method,
        r.reason,
        r.created_at,
        ${selProdDisp},
        ${selPlateDisp},
        ${selRecIng},
        ${selRecPlate},
        b.paid_at
      FROM refunds r
      JOIN bills b ON b.id = r.bill_id
      JOIN orders o ON o.id = b.order_id
      WHERE (
        (b.paid_at >= ? AND b.paid_at < ?)
        OR (r.created_at >= ? AND r.created_at < ?)
      )
      AND o.status != 'cancelled'
      AND ${deliverySandboxExclusionSql('o.id')}
      ORDER BY r.created_at ASC`,
    )
    .all(minorFactor, windowStart, windowEnd, windowStart, windowEnd) as any[];

  // Map refunds by bill_id and order_item_id
  const billRefundTotals = new Map<number, number>();
  const itemRefundTotals = new Map<number, number>();
  let totalRefundsAmount = 0;

  const paymentCollection: RoadsidePaymentCollection = {
    cash: { gross: 0, refunds: 0, net: 0 },
    upi: { gross: 0, refunds: 0, net: 0 },
    card: { gross: 0, refunds: 0, net: 0 },
    other: { gross: 0, refunds: 0, net: 0 },
    totalRefunds: 0,
  };

  for (const r of refunds) {
    const amt = Number(r.amount || 0);
    totalRefundsAmount += amt;

    const bId = Number(r.bill_id);
    billRefundTotals.set(bId, (billRefundTotals.get(bId) || 0) + amt);

    const dispInfo: RefundDispositionInfo = {
      productDisposition: (r.product_disposition as any) || 'retained_by_customer',
      plateDisposition: (r.plate_disposition as any) || 'plate_consumed',
      amount: amt,
      recoveredIngredientCost: Number(r.recovered_ingredient_cost || 0),
      recoveredPlateCost: Number(r.recovered_plate_cost || 0),
    };

    if (r.order_item_id) {
      const oiId = Number(r.order_item_id);
      itemRefundTotals.set(oiId, (itemRefundTotals.get(oiId) || 0) + amt);
      itemRefundDispositions.set(oiId, dispInfo);
    }
    billRefundDispositions.set(bId, dispInfo);

    const method = String(r.method || '').toLowerCase();
    if (method === 'cash') {
      paymentCollection.cash.refunds += amt;
    } else if (method === 'upi') {
      paymentCollection.upi.refunds += amt;
    } else if (method === 'card') {
      paymentCollection.card.refunds += amt;
    } else {
      paymentCollection.other.refunds += amt;
    }
  }
  paymentCollection.totalRefunds = totalRefundsAmount;

  // Process Bills payment details
  let grossCollected = 0;
  const orderIdsSet = new Set<number>();
  let totalOrdersWithBogo = 0;
  let totalBogoDiscounts = 0;

  for (const b of bills) {
    const paid = Number(b.paid_amount || 0);
    grossCollected += paid;
    orderIdsSet.add(Number(b.order_id));

    if (b.discount_type === 'bogo' || (b.discount_amount && b.discount_amount > 0 && b.subtotal > b.total)) {
      totalOrdersWithBogo += 1;
      totalBogoDiscounts += Number(b.discount_amount || 0);
    }

    // Parse payment details for cash vs upi
    let parsedPayments = false;
    try {
      if (b.payment_details) {
        const details = typeof b.payment_details === 'string' ? JSON.parse(b.payment_details) : b.payment_details;
        if (Array.isArray(details) && details.length > 0) {
          parsedPayments = true;
          for (const p of details) {
            const m = String(p.method || '').toLowerCase();
            const a = Number(p.amount || 0);
            if (m === 'cash') paymentCollection.cash.gross += a;
            else if (m === 'upi') paymentCollection.upi.gross += a;
            else if (m === 'card') paymentCollection.card.gross += a;
            else paymentCollection.other.gross += a;
          }
        }
      }
    } catch {
      parsedPayments = false;
    }
    if (!parsedPayments && paid > 0) {
      paymentCollection.cash.gross += paid;
    }
  }

  paymentCollection.cash.net = roundCurrencyCost(
    paymentCollection.cash.gross - paymentCollection.cash.refunds,
    fractionDigits,
  );
  paymentCollection.upi.net = roundCurrencyCost(
    paymentCollection.upi.gross - paymentCollection.upi.refunds,
    fractionDigits,
  );
  paymentCollection.card.net = roundCurrencyCost(
    paymentCollection.card.gross - paymentCollection.card.refunds,
    fractionDigits,
  );
  paymentCollection.other.net = roundCurrencyCost(
    paymentCollection.other.gross - paymentCollection.other.refunds,
    fractionDigits,
  );

  // 4. Fetch Order Items for Settled Bills
  const orderItems = db
    .prepare(
      `SELECT
        oi.id AS order_item_id,
        oi.order_id,
        oi.product_id,
        oi.product_name,
        oi.unit_price,
        oi.quantity,
        oi.subtotal,
        oi.discount_amount,
        oi.total,
        oi.ingredient_cost,
        oi.ingredient_cost_known,
        oi.modifier_selection,
        oi.recipe_snapshot,
        oi.status AS item_status,
        p.name AS catalog_name,
        p.no_packaging,
        b.id AS bill_id,
        b.paid_amount AS bill_paid_amount,
        b.payment_status AS bill_payment_status,
        o.order_number,
        o.promotion_id AS order_promotion_id,
        o.discount_type AS order_discount_type,
        o.discount_amount AS order_discount_amount,
        o.discount_reason AS order_discount_reason
      FROM bills b
      JOIN orders o ON o.id = b.order_id
      JOIN order_items oi ON oi.order_id = o.id
      LEFT JOIN products p ON p.id = oi.product_id
      WHERE b.paid_at >= ? AND b.paid_at < ?
        AND o.status != 'cancelled'
        AND (oi.status IS NULL OR oi.status NOT IN ('cancelled', 'voided', 'void_adjustment', 'swapped'))
        AND ${deliverySandboxExclusionSql('o.id')}
      ORDER BY oi.id ASC`,
    )
    .all(windowStart, windowEnd) as any[];

  // 5. Aggregate Product Performance & Distribute Refunds
  const productMap = new Map<string, ProductPerformanceItem>();
  let totalPancakesPrepared = 0;
  let parcelBoxesSold = 0;
  let totalFreePancakes = 0;
  let totalIngredientCost = 0;
  let totalSellableRecoveredCount = 0;
  let totalWastagePancakesCount = 0;
  let totalWastageCost = 0;
  let totalPlatesConsumedCount = 0;

  // Group items by bill to proportionally distribute bill-level refunds
  const itemsByBill = new Map<number, any[]>();
  for (const item of orderItems) {
    const bId = Number(item.bill_id);
    if (!itemsByBill.has(bId)) itemsByBill.set(bId, []);
    itemsByBill.get(bId)!.push(item);
  }

  // Pre-calculate allocated refunds per item
  const allocatedRefundPerItem = new Map<number, number>();
  for (const [bId, bItems] of itemsByBill.entries()) {
    const billRefundTotal = billRefundTotals.get(bId) || 0;
    if (billRefundTotal <= 0) continue;

    // Check direct item refunds first
    let remainingBillRefund = billRefundTotal;
    for (const it of bItems) {
      const itRefund = itemRefundTotals.get(Number(it.order_item_id)) || 0;
      if (itRefund > 0) {
        allocatedRefundPerItem.set(Number(it.order_item_id), itRefund);
        remainingBillRefund = Math.max(0, remainingBillRefund - itRefund);
      }
    }

    // Distribute remaining bill-level refund across paid items by net subtotal
    if (remainingBillRefund > 0) {
      const billNetBase = bItems.reduce((acc, it) => {
        const net = Math.max(0, Number(it.subtotal || 0) - Number(it.discount_amount || 0));
        return acc + net;
      }, 0);

      for (const it of bItems) {
        const itNet = Math.max(0, Number(it.subtotal || 0) - Number(it.discount_amount || 0));
        if (billNetBase > 0 && itNet > 0) {
          const share = (itNet / billNetBase) * remainingBillRefund;
          const prior = allocatedRefundPerItem.get(Number(it.order_item_id)) || 0;
          allocatedRefundPerItem.set(Number(it.order_item_id), prior + share);
        }
      }
    }
  }

  function getItemDispositions(item: any, itemRefund: number) {
    const directDisp = itemRefundDispositions.get(Number(item.order_item_id));
    const billDisp = billRefundDispositions.get(Number(item.bill_id));
    const disp = directDisp || (itemRefund > 0 ? billDisp : undefined);
    const productDisp: 'retained_by_customer' | 'recovered_sellable' | 'damaged_wastage' =
      disp?.productDisposition || 'retained_by_customer';
    const plateDisp: 'plate_consumed' | 'plate_recovered' =
      disp?.plateDisposition || 'plate_consumed';
    return { productDisp, plateDisp };
  }

  // Pre-calculate pancake and parcel box quantities per order to implement the
  // FINAL PAPER PLATE AND PARCEL BOX RULE:
  // Paper Plates Consumed = max(0, Pancakes - Boxes Allocated for Packaging)
  // Each Parcel Box explicitly allocated to a pancake replaces that pancake's Paper Plate.
  // Standalone Parcel Boxes do not replace plates.
  const orderPancakesMap = new Map<number, number>();
  const orderBoxesMap = new Map<number, number>();
  const orderRecoveredPlatesMap = new Map<number, number>();

  // Fetch explicit serving allocations if present
  const itemIds = orderItems.map((oi) => oi.order_item_id);
  const allocationsByItem = new Map<number, { serving_type: string; quantity: number }[]>();
  if (itemIds.length > 0) {
    const placeholders = itemIds.map(() => '?').join(',');
    const allocRows = db
      .prepare(
        `SELECT order_item_id, serving_type, quantity
         FROM order_item_serving_allocations
         WHERE order_item_id IN (${placeholders})
         ORDER BY id ASC`,
      )
      .all(...itemIds) as { order_item_id: number; serving_type: string; quantity: number }[];
    for (const row of allocRows) {
      if (!allocationsByItem.has(row.order_item_id)) {
        allocationsByItem.set(row.order_item_id, []);
      }
      allocationsByItem.get(row.order_item_id)!.push({
        serving_type: row.serving_type,
        quantity: Number(row.quantity || 0),
      });
    }
  }

  const orderExplicitPlatesMap = new Map<number, number>();
  const orderExplicitBoxesAllocatedMap = new Map<number, number>();
  const orderHasExplicitAllocMap = new Map<number, boolean>();

  for (const item of orderItems) {
    const oId = Number(item.order_id);
    const oiId = Number(item.order_item_id);
    const qty = Number(item.quantity || 1);
    const isBox = isParcelBoxProduct(item);
    if (isBox) {
      orderBoxesMap.set(oId, (orderBoxesMap.get(oId) || 0) + qty);
    } else {
      orderPancakesMap.set(oId, (orderPancakesMap.get(oId) || 0) + qty);
      const itemRefund = allocatedRefundPerItem.get(Number(item.order_item_id)) || 0;
      const { plateDisp } = getItemDispositions(item, itemRefund);
      if (plateDisp === 'plate_recovered') {
        orderRecoveredPlatesMap.set(oId, (orderRecoveredPlatesMap.get(oId) || 0) + qty);
      }

      const itemAllocs = allocationsByItem.get(oiId);
      if (itemAllocs && itemAllocs.length > 0) {
        orderHasExplicitAllocMap.set(oId, true);
        for (const a of itemAllocs) {
          if (a.serving_type === 'parcel') {
            orderExplicitBoxesAllocatedMap.set(
              oId,
              (orderExplicitBoxesAllocatedMap.get(oId) || 0) + a.quantity,
            );
          } else {
            orderExplicitPlatesMap.set(
              oId,
              (orderExplicitPlatesMap.get(oId) || 0) + a.quantity,
            );
          }
        }
      }
    }
  }

  function getOrderPlateRatio(orderId: number) {
    const pancakes = orderPancakesMap.get(orderId) || 0;
    const boxes = orderBoxesMap.get(orderId) || 0;
    const recoveredPlates = orderRecoveredPlatesMap.get(orderId) || 0;
    if (pancakes <= 0) return 0;
    const consumedPlates = orderHasExplicitAllocMap.get(orderId)
      ? (orderExplicitPlatesMap.get(orderId) || 0)
      : Math.max(0, pancakes - boxes);
    const netConsumedPlates = Math.max(0, consumedPlates - recoveredPlates);
    return netConsumedPlates / pancakes;
  }

  // Aggregate items into products
  for (const item of orderItems) {
    const isBox = isParcelBoxProduct(item);
    const isFree = isBogoFreeItem(item);

    const rawName = String(item.catalog_name || item.product_name || '').replace(' (BOGO Free)', '').trim();
    const prodId = String(item.product_id || rawName);

    if (!productMap.has(prodId)) {
      productMap.set(prodId, {
        productId: prodId,
        productName: rawName,
        isParcelBox: isBox,
        paidQuantity: 0,
        freeQuantity: 0,
        totalPrepared: 0,
        refundedQuantity: 0,
        netPaidQuantity: 0,
        recoveredQuantity: 0,
        wastageQuantity: 0,
        grossRevenue: 0,
        discounts: 0,
        refunds: 0,
        netRevenue: 0,
        ingredientCost: 0,
        packagingCost: 0,
        profit: 0,
        orderCount: 0,
      });
    }

    const prod = productMap.get(prodId)!;
    const qty = Number(item.quantity || 1);
    const subtotal = Number(item.subtotal || 0);
    const discount = Number(item.discount_amount || 0);
    const ingCost = Number(item.ingredient_cost || 0);
    const itemRefund = allocatedRefundPerItem.get(Number(item.order_item_id)) || 0;
    const itemNet = Math.max(0, subtotal - discount);

    const { productDisp, plateDisp } = getItemDispositions(item, itemRefund);

    let itemRawIngCost = ingCost;
    let hasPlateInSnapshot = false;
    if (!isBox) {
      if (item.recipe_snapshot) {
        try {
          const parsed =
            typeof item.recipe_snapshot === 'string'
              ? JSON.parse(item.recipe_snapshot)
              : item.recipe_snapshot;
          hasPlateInSnapshot = (parsed?.components || []).some(
            (c: any) =>
              c.supply_id === 'sup_ffdfa4ad3785608b17b4d5a7' ||
              (c.supply_name || '').toLowerCase().includes('plate'),
          );
        } catch {
          hasPlateInSnapshot = false;
        }
      }
      if (hasPlateInSnapshot) {
        itemRawIngCost = Math.max(0, ingCost - qty * paperPlateUnitCost);
      } else {
        itemRawIngCost = ingCost;
      }

      // Accounting rule: Sellable recovery reverses raw pancake ingredient cost to 0 (incurred once on resale).
      // Retained by customer or damaged wastage keeps raw ingredient cost incurred on this order.
      const effectiveRawIngCost = productDisp === 'recovered_sellable' ? 0 : itemRawIngCost;

      const oId = Number(item.order_id);
      const plateRatio = getOrderPlateRatio(oId);

      // FINAL PAPER PLATE AND PARCEL BOX RULE:
      // A pancake packed in a parcel box consumes zero paper plates.
      // Unboxed pancakes consume 1 paper plate (₹2.50) unless recovered.
      const effectivePlatesConsumed = qty * plateRatio;
      const effectivePlateCost = effectivePlatesConsumed * paperPlateUnitCost;

      const itemTotalIngCost = effectiveRawIngCost + effectivePlateCost;
      prod.ingredientCost += itemTotalIngCost;
      totalIngredientCost += itemTotalIngCost;
      totalPlatesConsumedCount += effectivePlatesConsumed;

      if (productDisp === 'recovered_sellable') {
        prod.recoveredQuantity = (prod.recoveredQuantity || 0) + qty;
        totalSellableRecoveredCount += qty;
      } else if (productDisp === 'damaged_wastage') {
        prod.wastageQuantity = (prod.wastageQuantity || 0) + qty;
        totalWastagePancakesCount += qty;
        totalWastageCost += itemTotalIngCost;
      }
    }

    prod.grossRevenue += subtotal;
    prod.discounts += discount;
    prod.refunds += itemRefund;

    if (isFree) {
      prod.freeQuantity += qty;
      prod.totalPrepared += qty;
      if (!isBox) {
        totalFreePancakes += qty;
        totalPancakesPrepared += qty;
      }
    } else {
      prod.paidQuantity += qty;
      prod.totalPrepared += qty;
      if (isBox) {
        parcelBoxesSold += qty;
      } else {
        totalPancakesPrepared += qty;
      }

      if (itemRefund > 0) {
        if (itemNet > 0) {
          const ratio = Math.min(1, itemRefund / itemNet);
          prod.refundedQuantity += Math.round(qty * ratio);
        } else {
          prod.refundedQuantity += qty;
        }
      }
    }
    prod.netPaidQuantity = Math.max(0, prod.paidQuantity - prod.refundedQuantity);
  }

  // 6. Calculate Normal Sales vs BOGO Sales Breakdown
  const pancakeItemsByOrder = new Map<number, any[]>();
  for (const item of orderItems) {
    if (isParcelBoxProduct(item)) continue;
    const oId = Number(item.order_id);
    const list = pancakeItemsByOrder.get(oId) || [];
    list.push(item);
    pancakeItemsByOrder.set(oId, list);
  }

  interface ItemUnitSplit {
    bogoPaidUnits: number;
    bogoFreeUnits: number;
    normalPaidUnits: number;
    bogoSource: 'launch' | 'loyalty' | 'other';
  }
  const itemSplits = new Map<number, ItemUnitSplit>();

  for (const [, itemsInOrder] of pancakeItemsByOrder.entries()) {
    const sampleItem = itemsInOrder[0];
    const orderPromoId = String(sampleItem.order_promotion_id || '').toLowerCase();
    const orderDiscType = String(sampleItem.order_discount_type || '').toLowerCase();
    const orderDiscReason = String(sampleItem.order_discount_reason || '').toLowerCase();

    let orderHasBogo =
      orderPromoId.includes('bogo') ||
      orderDiscType === 'bogo' ||
      orderDiscReason.includes('bogo');

    let defaultBogoSource: 'launch' | 'loyalty' | 'other' = 'launch';
    if (orderPromoId.includes('loyalty') || orderDiscReason.includes('loyalty')) {
      defaultBogoSource = 'loyalty';
    }

    interface PancakeUnit {
      orderItemId: number;
      unitPrice: number;
      isExplicitFree: boolean;
      isExplicitPaid: boolean;
      promoSource: 'launch' | 'loyalty' | 'other';
    }

    const units: PancakeUnit[] = [];
    for (const item of itemsInOrder) {
      const oiId = Number(item.order_item_id);
      const isFree = isBogoFreeItem(item);
      let isExplicitPaid = false;
      let unitSource = defaultBogoSource;

      if (item.modifier_selection) {
        try {
          const mod =
            typeof item.modifier_selection === 'string'
              ? JSON.parse(item.modifier_selection)
              : item.modifier_selection;
          if (mod?.is_bogo_paid) {
            isExplicitPaid = true;
          }
          if (mod?.promotion_id?.includes('loyalty') || mod?.bogo_source === 'loyalty') {
            unitSource = 'loyalty';
          }
        } catch {}
      }

      if (isFree || isExplicitPaid) {
        orderHasBogo = true;
      }

      const qty = Number(item.quantity || 1);
      const unitPrice = Number(item.unit_price || 0);
      for (let u = 0; u < qty; u++) {
        units.push({
          orderItemId: oiId,
          unitPrice,
          isExplicitFree: isFree,
          isExplicitPaid,
          promoSource: unitSource,
        });
      }
    }

    if (!orderHasBogo) {
      for (const item of itemsInOrder) {
        const oiId = Number(item.order_item_id);
        const qty = Number(item.quantity || 1);
        itemSplits.set(oiId, {
          bogoPaidUnits: 0,
          bogoFreeUnits: 0,
          normalPaidUnits: qty,
          bogoSource: defaultBogoSource,
        });
      }
      continue;
    }

    const freeUnits = units.filter((u) => u.isExplicitFree);
    const freeCount = freeUnits.length;
    const paidUnits = units.filter((u) => !u.isExplicitFree);

    paidUnits.sort((a, b) => {
      if (a.isExplicitPaid !== b.isExplicitPaid) {
        return a.isExplicitPaid ? -1 : 1;
      }
      return b.unitPrice - a.unitPrice;
    });

    const bogoPaidSet = new Set<PancakeUnit>();
    for (let i = 0; i < Math.min(freeCount, paidUnits.length); i++) {
      bogoPaidSet.add(paidUnits[i]);
    }

    for (const item of itemsInOrder) {
      const oiId = Number(item.order_item_id);
      const itemUnits = units.filter((u) => u.orderItemId === oiId);
      let bogoPaid = 0;
      let bogoFree = 0;
      let normalPaid = 0;
      let src = defaultBogoSource;

      for (const u of itemUnits) {
        if (u.promoSource === 'loyalty') src = 'loyalty';
        if (u.isExplicitFree) {
          bogoFree++;
        } else if (bogoPaidSet.has(u)) {
          bogoPaid++;
        } else {
          normalPaid++;
        }
      }

      itemSplits.set(oiId, {
        bogoPaidUnits: bogoPaid,
        bogoFreeUnits: bogoFree,
        normalPaidUnits: normalPaid,
        bogoSource: src,
      });
    }
  }

  let normalPaidQuantityCount = 0;
  let normalRevenueTotal = 0;
  let normalRawIngredientCostTotal = 0;
  let normalPaperPlateCostTotal = 0;
  let normalRecoveredQuantityCount = 0;
  let normalWastageQuantityCount = 0;

  let bogoPancakesPreparedCount = 0;
  let bogoPaidQuantityCount = 0;
  let bogoFreeQuantityCount = 0;
  let bogoRevenueTotal = 0;
  let bogoRawIngredientCostTotal = 0;
  let bogoPaperPlateCostTotal = 0;
  let bogoDiscountsTotal = 0;
  let bogoLaunchPairsCount = 0;
  let bogoLoyaltyPairsCount = 0;
  let bogoRecoveredQuantityCount = 0;
  let bogoWastageQuantityCount = 0;

  for (const item of orderItems) {
    const isBox = isParcelBoxProduct(item);
    if (isBox) continue;

    const oiId = Number(item.order_item_id);
    const qty = Number(item.quantity || 1);
    const subtotal = Number(item.subtotal || 0);
    const discount = Number(item.discount_amount || 0);
    const itemRefund = allocatedRefundPerItem.get(oiId) || 0;
    const { productDisp, plateDisp } = getItemDispositions(item, itemRefund);

    let itemRawIngCost = Number(item.ingredient_cost || 0);
    let hasPlateInSnapshot = false;
    if (item.recipe_snapshot) {
      try {
        const parsed =
          typeof item.recipe_snapshot === 'string'
            ? JSON.parse(item.recipe_snapshot)
            : item.recipe_snapshot;
        hasPlateInSnapshot = (parsed?.components || []).some(
          (c: any) =>
            c.supply_id === 'sup_ffdfa4ad3785608b17b4d5a7' ||
            (c.supply_name || '').toLowerCase().includes('plate'),
        );
      } catch {
        hasPlateInSnapshot = false;
      }
    }
    if (hasPlateInSnapshot) {
      itemRawIngCost = Math.max(0, itemRawIngCost - qty * paperPlateUnitCost);
    }

    const oId = Number(item.order_id);
    const plateRatio = getOrderPlateRatio(oId);
    const effectiveRawIngCost = productDisp === 'recovered_sellable' ? 0 : itemRawIngCost;
    const effectiveUnitPlateCost = plateRatio * paperPlateUnitCost;
    const netRevenueEarned = Math.max(0, subtotal - discount - itemRefund);

    const split = itemSplits.get(oiId) || {
      bogoPaidUnits: 0,
      bogoFreeUnits: 0,
      normalPaidUnits: qty,
      bogoSource: 'launch',
    };

    if (split.bogoFreeUnits > 0) {
      bogoPancakesPreparedCount += split.bogoFreeUnits;
      bogoFreeQuantityCount += split.bogoFreeUnits;
      bogoDiscountsTotal += discount;
      bogoRawIngredientCostTotal += (split.bogoFreeUnits / qty) * effectiveRawIngCost;
      bogoPaperPlateCostTotal += split.bogoFreeUnits * effectiveUnitPlateCost;
      if (split.bogoSource === 'loyalty') {
        bogoLoyaltyPairsCount += split.bogoFreeUnits;
      } else {
        bogoLaunchPairsCount += split.bogoFreeUnits;
      }
      if (productDisp === 'recovered_sellable') {
        bogoRecoveredQuantityCount += split.bogoFreeUnits;
      } else if (productDisp === 'damaged_wastage') {
        bogoWastageQuantityCount += split.bogoFreeUnits;
      }
    }

    if (split.bogoPaidUnits > 0) {
      bogoPancakesPreparedCount += split.bogoPaidUnits;
      bogoPaidQuantityCount += split.bogoPaidUnits;
      bogoRevenueTotal += (split.bogoPaidUnits / qty) * netRevenueEarned;
      bogoRawIngredientCostTotal += (split.bogoPaidUnits / qty) * effectiveRawIngCost;
      bogoPaperPlateCostTotal += split.bogoPaidUnits * effectiveUnitPlateCost;
      if (productDisp === 'recovered_sellable') {
        bogoRecoveredQuantityCount += split.bogoPaidUnits;
      } else if (productDisp === 'damaged_wastage') {
        bogoWastageQuantityCount += split.bogoPaidUnits;
      }
    }

    if (split.normalPaidUnits > 0) {
      normalPaidQuantityCount += split.normalPaidUnits;
      normalRevenueTotal += (split.normalPaidUnits / qty) * netRevenueEarned;
      normalRawIngredientCostTotal += (split.normalPaidUnits / qty) * effectiveRawIngCost;
      normalPaperPlateCostTotal += split.normalPaidUnits * effectiveUnitPlateCost;
      if (productDisp === 'recovered_sellable') {
        normalRecoveredQuantityCount += split.normalPaidUnits;
      } else if (productDisp === 'damaged_wastage') {
        normalWastageQuantityCount += split.normalPaidUnits;
      }
    }
  }

  const normalTotalIngredientCost = roundCurrencyCost(
    normalRawIngredientCostTotal + normalPaperPlateCostTotal,
    fractionDigits,
  );
  const normalProfit = roundCurrencyCost(
    normalRevenueTotal - normalTotalIngredientCost,
    fractionDigits,
  );

  const bogoTotalIngredientCost = roundCurrencyCost(
    bogoRawIngredientCostTotal + bogoPaperPlateCostTotal,
    fractionDigits,
  );
  const bogoProfit = roundCurrencyCost(
    bogoRevenueTotal - bogoTotalIngredientCost,
    fractionDigits,
  );
  const bogoPairsRedeemed = Math.round(bogoFreeQuantityCount);

  const normalSalesSummary: RoadsideNormalSalesSummary = {
    paidQuantity: Math.round(normalPaidQuantityCount),
    revenue: roundCurrencyCost(normalRevenueTotal, fractionDigits),
    rawIngredientCost: roundCurrencyCost(normalRawIngredientCostTotal, fractionDigits),
    paperPlateCost: roundCurrencyCost(normalPaperPlateCostTotal, fractionDigits),
    totalIngredientCost: normalTotalIngredientCost,
    profit: normalProfit,
    recoveredQuantity: normalRecoveredQuantityCount,
    wastageQuantity: normalWastageQuantityCount,
  };

  const bogoSalesSummary: RoadsideBogoSalesSummary = {
    pairsRedeemed: bogoPairsRedeemed,
    launchPairsRedeemed: Math.round(bogoLaunchPairsCount),
    launchPairs: Math.round(bogoLaunchPairsCount),
    loyaltyPairsRedeemed: Math.round(bogoLoyaltyPairsCount),
    loyaltyPairs: Math.round(bogoLoyaltyPairsCount),
    pancakesPrepared: Math.round(bogoPancakesPreparedCount),
    paidQuantity: Math.round(bogoPaidQuantityCount),
    freeQuantity: Math.round(bogoFreeQuantityCount),
    revenue: roundCurrencyCost(bogoRevenueTotal, fractionDigits),
    rawIngredientCost: roundCurrencyCost(bogoRawIngredientCostTotal, fractionDigits),
    paperPlateCost: roundCurrencyCost(bogoPaperPlateCostTotal, fractionDigits),
    totalIngredientCost: bogoTotalIngredientCost,
    profit: bogoProfit,
    totalDiscounts: roundCurrencyCost(bogoDiscountsTotal, fractionDigits),
    discounts: roundCurrencyCost(bogoDiscountsTotal, fractionDigits),
    recoveredQuantity: bogoRecoveredQuantityCount,
    wastageQuantity: bogoWastageQuantityCount,
  };

  // 7. Calculate Roadside Packaging Consumption and Costs
  const paperPlatesConsumed = Math.round(totalPlatesConsumedCount);
  const paperPlateCost = roundCurrencyCost(totalPlatesConsumedCount * paperPlateUnitCost, fractionDigits);
  const parcelBoxCost = roundCurrencyCost(parcelBoxesSold * parcelBoxUnitCost, fractionDigits);
  const totalPackagingCost = parcelBoxCost;

  let parcelBoxRevenue = 0;
  for (const prod of productMap.values()) {
    if (prod.isParcelBox) {
      parcelBoxRevenue += Math.max(0, prod.grossRevenue - prod.discounts - prod.refunds);
    }
  }

  // Pre-calculate allocated vs standalone parcel boxes across all orders
  let totalBoxesAllocated = 0;
  let totalBoxesStandalone = 0;
  for (const [oId, bQty] of orderBoxesMap.entries()) {
    const pQty = orderPancakesMap.get(oId) || 0;
    const alloc = orderHasExplicitAllocMap.get(oId)
      ? Math.min(bQty, orderExplicitBoxesAllocatedMap.get(oId) || 0)
      : Math.min(pQty, bQty);
    const standalone = Math.max(0, bQty - alloc);
    totalBoxesAllocated += alloc;
    totalBoxesStandalone += standalone;
  }

  const packagingSummary: RoadsidePackagingSummary = {
    parcelBoxesSold: parcelBoxesSold,
    parcelBoxesAllocated: Math.round(totalBoxesAllocated),
    parcelBoxesStandalone: Math.round(totalBoxesStandalone),
    parcelBoxRevenue: roundCurrencyCost(parcelBoxRevenue, fractionDigits),
    parcelBoxUnitCost: parcelBoxUnitCost,
    parcelBoxCost: parcelBoxCost,
    parcelBoxProfit: roundCurrencyCost(parcelBoxRevenue - parcelBoxCost, fractionDigits),
    paperPlatesConsumed,
    paperPlateUnitCost,
    paperPlateCost,
    totalPackagingCost,
  };

  // 8. Allocate Packaging Cost to Products and Compute Product Profit
  for (const prod of productMap.values()) {
    prod.grossRevenue = roundCurrencyCost(prod.grossRevenue, fractionDigits);
    prod.discounts = roundCurrencyCost(prod.discounts, fractionDigits);
    prod.refunds = roundCurrencyCost(prod.refunds, fractionDigits);
    prod.netRevenue = roundCurrencyCost(
      Math.max(0, prod.grossRevenue - prod.discounts - prod.refunds),
      fractionDigits,
    );
    prod.ingredientCost = roundCurrencyCost(prod.ingredientCost, fractionDigits);

    if (prod.isParcelBox) {
      prod.packagingCost = roundCurrencyCost(prod.paidQuantity * parcelBoxUnitCost, fractionDigits);
    } else {
      prod.packagingCost = 0;
    }

    prod.profit = roundCurrencyCost(
      prod.netRevenue - (prod.ingredientCost + prod.packagingCost),
      fractionDigits,
    );
  }

  // 9. Cost & Profit Summary
  const netSales = roundCurrencyCost(grossCollected - totalRefundsAmount, fractionDigits);
  const totalDirectCost = roundCurrencyCost(totalIngredientCost + totalPackagingCost, fractionDigits);
  const grossContribution = roundCurrencyCost(netSales - totalDirectCost, fractionDigits);
  const grossContributionMarginPercent =
    netSales > 0
      ? new Decimal(grossContribution)
          .div(netSales)
          .mul(100)
          .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
          .toNumber()
      : null;

  let operatingExpenses = 0;
  try {
    const expenseSummary = summarizeExpenses(db as any, {
      from: startDate,
      to: endDate,
      status: 'active',
    });
    for (const total of expenseSummary.totals) {
      operatingExpenses += Number(total.incurred_minor || 0) / minorFactor;
    }
  } catch {
    // safe fallback if expenses are unavailable
  }
  operatingExpenses = roundCurrencyCost(operatingExpenses, fractionDigits);
  const operatingProfit = roundCurrencyCost(grossContribution - operatingExpenses, fractionDigits);

  const costProfitSummary: RoadsideCostProfitSummary = {
    netSales,
    ingredientCost: roundCurrencyCost(totalIngredientCost, fractionDigits),
    packagingCost: totalPackagingCost,
    totalDirectCost,
    grossContribution,
    grossContributionMarginPercent,
    operatingExpenses,
    operatingProfit,
    wastageCost: roundCurrencyCost(totalWastageCost, fractionDigits),
    recoveredSellableCount: totalSellableRecoveredCount,
  };

  const pancakeOrderIdsSet = new Set<number>();
  for (const item of orderItems) {
    if (!isParcelBoxProduct(item)) {
      pancakeOrderIdsSet.add(Number(item.order_id));
    }
  }

  const businessSummary: RoadsideBusinessSummary = {
    netSales,
    totalPancakesPrepared,
    totalOrders: pancakeOrderIdsSet.size,
    operatingProfit,
  };

  const bogoSummary: RoadsideBogoSummary = {
    totalOrdersWithBogo,
    totalFreePancakes,
    totalBogoDiscounts: roundCurrencyCost(totalBogoDiscounts, fractionDigits),
  };

  const pancakeProds = Array.from(productMap.values()).filter((p) => !p.isParcelBox);
  const totalPancakeRevenue = roundCurrencyCost(
    pancakeProds.reduce((sum, p) => sum + p.netRevenue, 0),
    fractionDigits,
  );
  const totalPancakePlateCost = roundCurrencyCost(
    totalPlatesConsumedCount * paperPlateUnitCost,
    fractionDigits,
  );
  const totalPancakeIngredientCost = roundCurrencyCost(
    pancakeProds.reduce((sum, p) => sum + p.ingredientCost, 0),
    fractionDigits,
  );
  const totalPancakeProfit = roundCurrencyCost(
    pancakeProds.reduce((sum, p) => sum + p.profit, 0),
    fractionDigits,
  );

  const combinedQuantity = normalSalesSummary.paidQuantity + bogoSalesSummary.pancakesPrepared;
  const combinedRevenue = roundCurrencyCost(
    normalSalesSummary.revenue + bogoSalesSummary.revenue,
    fractionDigits,
  );
  const combinedPlateCost = roundCurrencyCost(
    normalSalesSummary.paperPlateCost + bogoSalesSummary.paperPlateCost,
    fractionDigits,
  );
  const combinedIngredientCost = roundCurrencyCost(
    normalSalesSummary.totalIngredientCost + bogoSalesSummary.totalIngredientCost,
    fractionDigits,
  );
  const combinedProfit = roundCurrencyCost(
    normalSalesSummary.profit + bogoSalesSummary.profit,
    fractionDigits,
  );

  const reconciliation: RoadsideReconciliation = {
    reconciled:
      combinedQuantity === totalPancakesPrepared &&
      Math.abs(combinedRevenue - totalPancakeRevenue) < 0.05 &&
      Math.abs(combinedPlateCost - totalPancakePlateCost) < 0.05 &&
      Math.abs(combinedIngredientCost - totalPancakeIngredientCost) < 0.05 &&
      Math.abs(combinedProfit - totalPancakeProfit) < 0.05,
    quantityDifference: combinedQuantity - totalPancakesPrepared,
    revenueDifference: roundCurrencyCost(combinedRevenue - totalPancakeRevenue, fractionDigits),
    plateCostDifference: roundCurrencyCost(combinedPlateCost - totalPancakePlateCost, fractionDigits),
    ingredientCostDifference: roundCurrencyCost(combinedIngredientCost - totalPancakeIngredientCost, fractionDigits),
    profitDifference: roundCurrencyCost(combinedProfit - totalPancakeProfit, fractionDigits),
  };

  const billCount = bills.length;
  const refundCount = refunds.length;
  const averageOrderValue =
    billCount > 0 ? roundCurrencyCost(netSales / billCount, fractionDigits) : 0;

  return {
    startDate,
    endDate,
    businessSummary,
    productPerformance: Array.from(productMap.values()).sort(
      (a, b) => b.totalPrepared - a.totalPrepared || b.netRevenue - a.netRevenue,
    ),
    packagingSummary,
    costProfitSummary,
    paymentCollection,
    bogoSummary,
    normalSalesSummary,
    normalSales: normalSalesSummary,
    bogoSalesSummary,
    bogoSales: bogoSalesSummary,
    reconciliation,
    billCount,
    refundCount,
    averageOrderValue,
  };
}
