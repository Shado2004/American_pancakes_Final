import { getDatabase, now, recordOrderAudit } from '../db';
import { getTenantCurrency } from '../routes/bills';
import { getCurrencyFractionDigits } from '../countries';
import { calculateOrderTotals, recomputeOrderTotals } from './orders';
import { resolveEngineCharges } from '../routes/orders';
import { getActiveCountryPack, type Customer } from './tax';
import { applyPayableRounding } from './tax-engine';
import { buildRecipeSnapshot, extractOrderItemCostFromSnapshot } from './recipes';
import { resolveInventoryDeduction, type InventoryProductLike } from './inventory';
import { persistItemServingAndPackaging } from './packaging';
import { notifyKdsUpdate } from './kds';

export type PromotionDiscountType = 'bogo' | 'percentage' | 'fixed_amount';
export type PromotionTargetType = 'all_pancakes' | 'category' | 'products' | 'all';
export type BogoPricingRule = 'cheapest_free' | 'same_item';

export interface Promotion {
  id: string;
  name: string;
  description: string | null;
  discount_type: PromotionDiscountType;
  target_type: PromotionTargetType;
  target_category_id: string | null;
  discount_value: number;
  bogo_buy_qty: number;
  bogo_get_qty: number;
  bogo_pricing_rule: BogoPricingRule;
  is_loyalty_reward: boolean;
  loyalty_qualifying_visits_required: number;
  start_at: string | null;
  end_at: string | null;
  is_active: boolean;
  is_automatic: boolean;
  max_redemptions: number | null;
  current_redemptions_count: number;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface PromotionDbRow {
  id: string;
  name: string;
  description: string | null;
  discount_type: string;
  target_type: string;
  target_category_id: string | null;
  discount_value: number;
  bogo_buy_qty: number;
  bogo_get_qty: number;
  bogo_pricing_rule: string;
  is_loyalty_reward: number;
  loyalty_qualifying_visits_required: number;
  start_at: string | null;
  end_at: string | null;
  is_active: number;
  is_automatic: number;
  max_redemptions: number | null;
  current_redemptions_count: number;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

interface OrderItemRow {
  id: number;
  product_id: string;
  product_name: string;
  product_sku?: string | null;
  category_id: string | null;
  category_name: string | null;
  variant_id: string | null;
  quantity: number;
  unit_price: number;
  subtotal: number;
  tax_type?: string | null;
  variant_selection?: string | null;
  modifier_selection?: string | null;
  special_instructions?: string | null;
  status: string;
}

interface OrderRecord {
  id: number | string;
  customer_id: string | null;
  status: string;
  subtotal: number;
  discount_amount: number;
  promotion_id: string | null;
  service_charge: number;
  packaging_charge: number;
  charges_breakdown: string | null;
  delivery_charge?: number;
}

interface BillRecord {
  id: number;
  order_id: number;
  customer_id: string | null;
  bill_number: string;
  payment_status: string;
  paid_amount: number;
}

export function parsePromotionRow(row: PromotionDbRow): Promotion {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    discount_type: row.discount_type as PromotionDiscountType,
    target_type: row.target_type as PromotionTargetType,
    target_category_id: row.target_category_id,
    discount_value: Number(row.discount_value || 0),
    bogo_buy_qty: Number(row.bogo_buy_qty || 1),
    bogo_get_qty: Number(row.bogo_get_qty || 1),
    bogo_pricing_rule: row.bogo_pricing_rule as BogoPricingRule,
    is_loyalty_reward: Boolean(row.is_loyalty_reward),
    loyalty_qualifying_visits_required: Number(row.loyalty_qualifying_visits_required || 5),
    start_at: row.start_at,
    end_at: row.end_at,
    is_active: Boolean(row.is_active),
    is_automatic: Boolean(row.is_automatic),
    max_redemptions: row.max_redemptions !== null ? Number(row.max_redemptions) : null,
    current_redemptions_count: Number(row.current_redemptions_count || 0),
    created_by: row.created_by,
    updated_by: row.updated_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export interface OrderItemForDiscount {
  id?: number | string;
  product_id: string;
  product_name?: string;
  variant_id?: string | null;
  variant_selection?: string | null;
  quantity: number;
  unit_price: number;
  subtotal?: number;
  category_id?: string | null;
  category_name?: string | null;
}

export interface FreeUnitAllocation {
  orderItemId?: number | string;
  productId: string;
  variantId?: string | null;
  productName: string;
  unitPrice: number;
}

export interface BogoPairInput {
  pairId?: string;
  itemAId?: string | number;
  itemBId?: string | number;
}

export interface BogoEvaluatedPair {
  pairId: string;
  paidUnit: {
    orderItemId?: number | string;
    productId: string;
    productName: string;
    unitPrice: number;
    variantId?: string | null;
  };
  freeUnit: {
    orderItemId?: number | string;
    productId: string;
    productName: string;
    unitPrice: number;
    variantId?: string | null;
  };
  discountAmount: number;
}

export interface PromotionCalculationResult {
  eligible: boolean;
  ineligibleReason?: string;
  promotion: Promotion;
  pairs: number;
  eligibleItemCount: number;
  freeUnits: FreeUnitAllocation[];
  evaluatedPairs?: BogoEvaluatedPair[];
  itemDiscountMap: Record<string, number>;
  totalDiscountAmount: number;
  originalSubtotal: number;
  discountedSubtotal: number;
}

export interface LoyaltyEligibilityResult {
  eligible: boolean;
  reason?: string;
  qualifyingPaidVisits: number;
  visitsRequired: number;
  visitsNeeded: number;
  isSixthVisitReward: boolean;
}

type Database = ReturnType<typeof getDatabase>;

/** Check if product qualifies for promotion */
export function isProductEligibleForPromotion(
  db: Database,
  promotion: Promotion,
  productId: string,
  productName?: string,
  categoryId?: string | null,
): boolean {
  if (
    productId === 'pr_parcel_box_5' ||
    (productName && /parcel\s*box/i.test(productName))
  ) {
    return false;
  }
  if (promotion.target_type === 'all') return true;

  if (promotion.target_type === 'all_pancakes') {
    let catName = '';
    if (categoryId) {
      const cat = db.prepare('SELECT name FROM categories WHERE id = ?').get(categoryId) as
        | { name: string }
        | undefined;
      catName = cat?.name || '';
    } else {
      const prod = db
        .prepare('SELECT p.name, c.name as category_name FROM products p LEFT JOIN categories c ON c.id = p.category_id WHERE p.id = ?')
        .get(productId) as { name: string; category_name: string | null } | undefined;
      if (prod) {
        catName = prod.category_name || '';
        productName = productName || prod.name;
      }
    }

    const isCategoryPancake = /pancake/i.test(catName);
    const isNamePancake = productName ? /pancake/i.test(productName) : false;
    return isCategoryPancake || isNamePancake;
  }

  if (promotion.target_type === 'category') {
    if (!promotion.target_category_id) return false;
    if (categoryId) return categoryId === promotion.target_category_id;
    const prod = db.prepare('SELECT category_id FROM products WHERE id = ?').get(productId) as
      | { category_id: string }
      | undefined;
    return prod?.category_id === promotion.target_category_id;
  }

  if (promotion.target_type === 'products') {
    const exists = db
      .prepare('SELECT 1 FROM promotion_products WHERE promotion_id = ? AND product_id = ?')
      .get(promotion.id, productId);
    return Boolean(exists);
  }

  return false;
}

/** Check if promotion is active and within valid date window */
export function isPromotionActiveAndValid(
  promotion: Promotion,
  refDate: Date = new Date(),
): { valid: boolean; reason?: string } {
  if (!promotion.is_active) {
    return { valid: false, reason: 'Promotion is inactive' };
  }

  const nowTime = refDate.getTime();

  if (promotion.start_at) {
    const startTime = new Date(promotion.start_at).getTime();
    if (nowTime < startTime) {
      return { valid: false, reason: 'Promotion has not started yet' };
    }
  }

  if (promotion.end_at) {
    const endTime = new Date(promotion.end_at).getTime();
    if (nowTime > endTime) {
      return { valid: false, reason: 'Promotion has expired' };
    }
  }

  if (
    promotion.max_redemptions !== null &&
    promotion.current_redemptions_count >= promotion.max_redemptions
  ) {
    return { valid: false, reason: 'Promotion maximum redemptions reached' };
  }

  return { valid: true };
}

/**
 * Validates loyalty eligibility for 6th-visit BOGO reward.
 * Requires 5 qualifying paid visits since the last loyalty reward redemption.
 * A redeemed reward visit does NOT count as a qualifying paid visit.
 */
export function checkCustomerLoyaltyRewardEligibility(
  db: Database,
  customerId: string,
  targetOrderId?: number | string | null,
): LoyaltyEligibilityResult {
  if (!customerId) {
    return {
      eligible: false,
      reason: 'Customer required for loyalty reward',
      qualifyingPaidVisits: 0,
      visitsRequired: 5,
      visitsNeeded: 5,
      isSixthVisitReward: false,
    };
  }

  const lastRedemption = db
    .prepare(
      `SELECT MAX(created_at) as last_redeemed_at
       FROM promotion_redemptions
       WHERE customer_id = ? AND is_loyalty_reward = 1`,
    )
    .get(customerId) as { last_redeemed_at: string | null } | undefined;

  const lastRedeemedAt = lastRedemption?.last_redeemed_at || null;

  let query = `
    SELECT COUNT(DISTINCT b.order_id) AS visit_count
    FROM bills b
    JOIN orders o ON o.id = b.order_id
    WHERE COALESCE(b.customer_id, o.customer_id) = ?
      AND b.payment_status = 'paid'
      AND o.id NOT IN (
        SELECT order_id FROM promotion_redemptions
        WHERE is_loyalty_reward = 1 AND order_id IS NOT NULL
      )
  `;
  const params: unknown[] = [customerId];

  if (lastRedeemedAt) {
    query += ` AND b.created_at > ?`;
    params.push(lastRedeemedAt);
  }

  if (targetOrderId) {
    query += ` AND o.id != ?`;
    params.push(targetOrderId);
  }

  const result = db.prepare(query).get(...params) as { visit_count: number } | undefined;
  const qualifyingVisits = Number(result?.visit_count || 0);

  const visitsRequired = 5;
  const eligible = qualifyingVisits >= visitsRequired;
  const visitsNeeded = Math.max(0, visitsRequired - qualifyingVisits);

  return {
    eligible,
    reason: eligible
      ? undefined
      : `Requires 5 qualifying paid visits (currently ${qualifyingVisits}/${visitsRequired})`,
    qualifyingPaidVisits: qualifyingVisits,
    visitsRequired,
    visitsNeeded,
    isSixthVisitReward: eligible,
  };
}

/**
 * Calculates discount for an order or cart items based on promotion configuration.
 */
export function calculatePromotionDiscount(
  db: Database,
  promotion: Promotion,
  items: OrderItemForDiscount[],
  customerId?: string | null,
  currency = 'INR',
  bogoPairs?: BogoPairInput[],
): PromotionCalculationResult {
  const decimals = getCurrencyFractionDigits(currency);

  const validity = isPromotionActiveAndValid(promotion);
  if (!validity.valid) {
    return {
      eligible: false,
      ineligibleReason: validity.reason,
      promotion,
      pairs: 0,
      eligibleItemCount: 0,
      freeUnits: [],
      evaluatedPairs: [],
      itemDiscountMap: {},
      totalDiscountAmount: 0,
      originalSubtotal: 0,
      discountedSubtotal: 0,
    };
  }

  if (promotion.is_loyalty_reward) {
    if (!customerId) {
      return {
        eligible: false,
        ineligibleReason: 'Customer must be selected to redeem loyalty reward',
        promotion,
        pairs: 0,
        eligibleItemCount: 0,
        freeUnits: [],
        evaluatedPairs: [],
        itemDiscountMap: {},
        totalDiscountAmount: 0,
        originalSubtotal: 0,
        discountedSubtotal: 0,
      };
    }
    const loyaltyStatus = checkCustomerLoyaltyRewardEligibility(db, customerId);
    if (!loyaltyStatus.eligible) {
      return {
        eligible: false,
        ineligibleReason: loyaltyStatus.reason,
        promotion,
        pairs: 0,
        eligibleItemCount: 0,
        freeUnits: [],
        evaluatedPairs: [],
        itemDiscountMap: {},
        totalDiscountAmount: 0,
        originalSubtotal: 0,
        discountedSubtotal: 0,
      };
    }
  }

  interface ExpandedUnit {
    uid: string;
    orderItemId?: number | string;
    productId: string;
    variantId?: string | null;
    productName: string;
    unitPrice: number;
    subtotal: number;
  }

  const eligibleUnits: ExpandedUnit[] = [];
  let totalOrderSubtotal = 0;
  let eligibleSubtotal = 0;

  for (const item of items) {
    if (item.product_name && item.product_name.includes('(BOGO Free)')) {
      continue;
    }
    const qty = Math.max(1, Math.round(Number(item.quantity) || 1));
    const price = Number(item.unit_price) || 0;
    const lineSubtotal = Number((price * qty).toFixed(decimals));
    totalOrderSubtotal += lineSubtotal;

    const isEligible = isProductEligibleForPromotion(
      db,
      promotion,
      item.product_id,
      item.product_name,
      item.category_id,
    );

    if (isEligible) {
      eligibleSubtotal += lineSubtotal;
      for (let i = 0; i < qty; i++) {
        eligibleUnits.push({
          uid: `${item.id || item.product_id}_${i}`,
          orderItemId: item.id,
          productId: item.product_id,
          variantId: item.variant_id,
          productName: item.product_name || 'Pancake',
          unitPrice: price,
          subtotal: price,
        });
      }
    }
  }

  if (eligibleUnits.length === 0) {
    return {
      eligible: false,
      ineligibleReason: 'No eligible items in order for this promotion',
      promotion,
      pairs: 0,
      eligibleItemCount: 0,
      freeUnits: [],
      evaluatedPairs: [],
      itemDiscountMap: {},
      totalDiscountAmount: 0,
      originalSubtotal: totalOrderSubtotal,
      discountedSubtotal: totalOrderSubtotal,
    };
  }

  let totalDiscountAmount = 0;
  const freeUnits: FreeUnitAllocation[] = [];
  const evaluatedPairs: BogoEvaluatedPair[] = [];
  const itemDiscountMap: Record<string, number> = {};
  let pairs = 0;

  if (promotion.discount_type === 'bogo') {
    const freeCount = Math.floor(eligibleUnits.length / 2);
    const paidCount = eligibleUnits.length - freeCount;

    if (freeCount === 0) {
      return {
        eligible: false,
        ineligibleReason: `At least 2 eligible pancakes required for BOGO (found ${eligibleUnits.length})`,
        promotion,
        pairs: 0,
        eligibleItemCount: eligibleUnits.length,
        freeUnits: [],
        evaluatedPairs: [],
        itemDiscountMap: {},
        totalDiscountAmount: 0,
        originalSubtotal: totalOrderSubtotal,
        discountedSubtotal: totalOrderSubtotal,
      };
    }

    // Sort eligible pancake units by unit price descending.
    // The highest-priced units remain payable (first paidCount units).
    // The lowest-priced units receive the BOGO discount (last freeCount units).
    // Deterministic tie-breaker: productName, productId, uid
    const sortedUnits = [...eligibleUnits].sort((a, b) => {
      if (b.unitPrice !== a.unitPrice) {
        return b.unitPrice - a.unitPrice;
      }
      const nameCmp = String(a.productName).localeCompare(String(b.productName));
      if (nameCmp !== 0) return nameCmp;
      const prodCmp = String(a.productId).localeCompare(String(b.productId));
      if (prodCmp !== 0) return prodCmp;
      return String(a.uid).localeCompare(String(b.uid));
    });

    for (let p = 0; p < freeCount; p++) {
      const paidUnit = sortedUnits[p];
      const freeUnit = sortedUnits[paidCount + p];
      const discount = freeUnit.unitPrice;
      const pairId = `bogo-pair-${p + 1}`;

      evaluatedPairs.push({
        pairId,
        paidUnit: {
          orderItemId: paidUnit.orderItemId,
          productId: paidUnit.productId,
          productName: paidUnit.productName,
          unitPrice: paidUnit.unitPrice,
          variantId: paidUnit.variantId,
        },
        freeUnit: {
          orderItemId: freeUnit.orderItemId,
          productId: freeUnit.productId,
          productName: freeUnit.productName,
          unitPrice: freeUnit.unitPrice,
          variantId: freeUnit.variantId,
        },
        discountAmount: discount,
      });

      freeUnits.push({
        orderItemId: freeUnit.orderItemId,
        productId: freeUnit.productId,
        variantId: freeUnit.variantId,
        productName: freeUnit.productName,
        unitPrice: freeUnit.unitPrice,
      });

      totalDiscountAmount += discount;
      if (freeUnit.orderItemId) {
        const key = String(freeUnit.orderItemId);
        itemDiscountMap[key] = Number(
          ((itemDiscountMap[key] || 0) + discount).toFixed(decimals),
        );
      }
    }
    pairs = evaluatedPairs.length;
  } else if (promotion.discount_type === 'percentage') {
    const pct = Math.min(100, Math.max(0, promotion.discount_value));
    totalDiscountAmount = (eligibleSubtotal * pct) / 100;
  } else if (promotion.discount_type === 'fixed_amount') {
    totalDiscountAmount = Math.min(promotion.discount_value, eligibleSubtotal);
  }

  totalDiscountAmount = Number(
    Math.min(totalDiscountAmount, totalOrderSubtotal).toFixed(decimals),
  );
  const discountedSubtotal = Number(
    Math.max(0, totalOrderSubtotal - totalDiscountAmount).toFixed(decimals),
  );

  return {
    eligible: true,
    promotion,
    pairs,
    eligibleItemCount: eligibleUnits.length,
    freeUnits,
    evaluatedPairs,
    itemDiscountMap,
    totalDiscountAmount,
    originalSubtotal: totalOrderSubtotal,
    discountedSubtotal,
  };
}

/**
 * Applies a promotion to an active order.
 */
export function applyPromotionToOrder(
  db: Database,
  orderId: number | string,
  promotionId: string,
  actorUserId: string,
  clientIp = '127.0.0.1',
  bogoPairs?: BogoPairInput[],
): { order: unknown; bill?: unknown; calculation: PromotionCalculationResult } {
  const promoRow = db.prepare('SELECT * FROM promotions WHERE id = ?').get(promotionId) as
    | PromotionDbRow
    | undefined;
  if (!promoRow) {
    throw Object.assign(new Error(`Promotion with ID ${promotionId} not found`), { statusCode: 404 });
  }
  const promotion = parsePromotionRow(promoRow);

  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId) as OrderRecord | undefined;
  if (!order) {
    throw Object.assign(new Error(`Order with ID ${orderId} not found`), { statusCode: 404 });
  }

  if (['completed', 'cancelled'].includes(order.status)) {
    throw Object.assign(new Error('Cannot apply promotion to a completed or cancelled order'), {
      statusCode: 400,
      diagnosticCode: 'order_not_discountable',
    });
  }

  const splitBill = db
    .prepare('SELECT 1 FROM bills WHERE order_id = ? AND split_group_id IS NOT NULL LIMIT 1')
    .get(orderId);
  if (splitBill) {
    throw Object.assign(new Error('Promotions cannot be applied after a check has been split'), {
      statusCode: 409,
      diagnosticCode: 'split_check',
    });
  }

  const refundedBill = db
    .prepare("SELECT 1 FROM bills WHERE order_id = ? AND payment_status IN ('refunded', 'partially_refunded') LIMIT 1")
    .get(orderId);
  if (refundedBill) {
    throw Object.assign(new Error('Cannot apply promotion to a refunded bill'), {
      statusCode: 409,
      diagnosticCode: 'refunded',
    });
  }

  const existingPaidBill = db
    .prepare("SELECT 1 FROM bills WHERE order_id = ? AND payment_status = 'paid' LIMIT 1")
    .get(orderId);
  if (existingPaidBill) {
    throw Object.assign(new Error('Cannot apply promotion to an already paid order'), {
      statusCode: 409,
      diagnosticCode: 'paid',
    });
  }

  // 1. Clean up any previously split BOGO free items
  const splitFreeItems = db
    .prepare(
      `SELECT id, quantity, json_extract(modifier_selection, '$.source_order_item_id') as source_id
       FROM order_items
       WHERE order_id = ? AND json_extract(modifier_selection, '$.source_order_item_id') IS NOT NULL`,
    )
    .all(orderId) as Array<{ id: number; quantity: number; source_id: number }>;

  for (const s of splitFreeItems) {
    if (s.source_id) {
      const freeAllocs = db
        .prepare('SELECT serving_type, quantity FROM order_item_serving_allocations WHERE order_item_id = ?')
        .all(s.id) as Array<{ serving_type: string; quantity: number }>;

      db.prepare(`
        UPDATE order_items
        SET quantity = quantity + ?,
            subtotal = unit_price * (quantity + ?),
            total = unit_price * (quantity + ?),
            updated_at = ?
        WHERE id = ?
      `).run(s.quantity, s.quantity, s.quantity, now(), s.source_id);

      const restoredRow = db.prepare('SELECT product_id, quantity FROM order_items WHERE id = ?').get(s.source_id) as any;
      if (restoredRow) {
        const restoredRecipeSnapshot = buildRecipeSnapshot(db, restoredRow.product_id, restoredRow.quantity, 1);
        const restoredCost = extractOrderItemCostFromSnapshot(restoredRecipeSnapshot);
        const restoredProdRow = db
          .prepare('SELECT id, track_inventory, inventory_product_id, inventory_deduction_quantity FROM products WHERE id = ?')
          .get(restoredRow.product_id) as InventoryProductLike | undefined;
        const restoredDeduction = restoredProdRow ? resolveInventoryDeduction(restoredProdRow, restoredRow.quantity, null) : null;
        db.prepare(`
          UPDATE order_items
          SET inventory_deducted_quantity = ?,
              recipe_snapshot = ?,
              ingredient_cost = ?,
              ingredient_cost_known = ?
          WHERE id = ?
        `).run(
          restoredDeduction ? restoredDeduction.deductedQuantity : 0,
          restoredRecipeSnapshot ? JSON.stringify(restoredRecipeSnapshot) : null,
          restoredCost.ingredientCost,
          restoredCost.ingredientCostKnown,
          s.source_id,
        );
      }

      for (const fa of freeAllocs) {
        const existingSourceAlloc = db
          .prepare(
            'SELECT id FROM order_item_serving_allocations WHERE order_item_id = ? AND serving_type = ? LIMIT 1',
          )
          .get(s.source_id, fa.serving_type) as { id: number } | undefined;
        if (existingSourceAlloc) {
          db.prepare(
            'UPDATE order_item_serving_allocations SET quantity = quantity + ?, updated_at = ? WHERE id = ?',
          ).run(fa.quantity, now(), existingSourceAlloc.id);
        } else {
          db.prepare(
            'INSERT INTO order_item_serving_allocations (order_item_id, serving_type, quantity, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
          ).run(s.source_id, fa.serving_type, fa.quantity, now(), now());
        }
      }
    }
    db.prepare('DELETE FROM order_item_packaging_allocations WHERE serving_allocation_id IN (SELECT id FROM order_item_serving_allocations WHERE order_item_id = ?)').run(s.id);
    db.prepare('DELETE FROM order_item_serving_allocations WHERE order_item_id = ?').run(s.id);
    db.prepare('DELETE FROM order_item_addons WHERE order_item_id = ?').run(s.id);
    db.prepare('DELETE FROM order_items WHERE id = ?').run(s.id);
  }

  // Restore existing items to clean pricing
  db.prepare(`
    UPDATE order_items
    SET discount_amount = 0,
        total = subtotal,
        product_name = REPLACE(product_name, ' (BOGO Free)', ''),
        special_instructions = CASE WHEN special_instructions = 'BOGO Free' THEN NULL ELSE special_instructions END,
        modifier_selection = json_remove(
          CASE WHEN modifier_selection IS NULL OR modifier_selection = 'null' OR modifier_selection = '' THEN '{}' ELSE modifier_selection END,
          '$.is_bogo_free', '$.is_bogo_paid', '$.bogo_pair_id', '$.promotion_id'
        ),
        updated_at = ?
    WHERE order_id = ?
  `).run(now(), orderId);

  const items = db
    .prepare(
      `SELECT oi.id, oi.product_id, p.name as product_name, p.sku as product_sku,
              p.category_id, c.name as category_name,
              oi.variant_id, oi.quantity, oi.unit_price, oi.subtotal, oi.status,
              oi.variant_selection, oi.tax_type
       FROM order_items oi
       JOIN products p ON p.id = oi.product_id
       LEFT JOIN categories c ON c.id = p.category_id
       WHERE oi.order_id = ? AND oi.status NOT IN ('cancelled', 'voided', 'void_adjustment', 'refunded', 'swapped')`,
    )
    .all(orderId) as OrderItemRow[];

  if (items.length === 0) {
    throw Object.assign(new Error('Order contains no active items to discount'), { statusCode: 400 });
  }

  const currency = getTenantCurrency();
  const decimals = getCurrencyFractionDigits(currency);
  const calculation = calculatePromotionDiscount(
    db,
    promotion,
    items.map((i) => ({
      id: i.id,
      product_id: i.product_id,
      product_name: i.product_name,
      variant_id: i.variant_id,
      quantity: i.quantity,
      unit_price: i.unit_price,
      subtotal: i.subtotal,
      category_id: i.category_id,
      category_name: i.category_name,
    })),
    order.customer_id,
    currency,
    bogoPairs,
  );

  if (!calculation.eligible) {
    throw Object.assign(
      new Error(calculation.ineligibleReason || 'Order does not meet promotion conditions'),
      { statusCode: 400 },
    );
  }

  let bogoTotalDiscount = 0;
  if (promotion.discount_type === 'bogo') {
    for (const pair of calculation.evaluatedPairs || []) {
      const { pairId, paidUnit, freeUnit, discountAmount } = pair;
      bogoTotalDiscount += discountAmount;

      const freeRow = db.prepare('SELECT * FROM order_items WHERE id = ?').get(freeUnit.orderItemId) as any;
      if (freeRow && freeRow.quantity > 1) {
        const newQty = freeRow.quantity - 1;
        const newSubtotal = Number((freeRow.unit_price * newQty).toFixed(decimals));

        // Decrement 1 serving allocation from freeRow before updating order_items.quantity
        const freeRowAllocs = db
          .prepare(
            `SELECT id, serving_type, quantity
             FROM order_item_serving_allocations
             WHERE order_item_id = ?
             ORDER BY CASE WHEN serving_type = 'dine_in' THEN 1 ELSE 0 END, id DESC`,
          )
          .all(freeRow.id) as Array<{ id: number; serving_type: string; quantity: number }>;

        let freeServingType: 'dine_in' | 'parcel' = 'dine_in';
        if (freeRowAllocs.length > 0) {
          const targetAlloc = freeRowAllocs.find((a) => a.quantity >= 1) || freeRowAllocs[0];
          freeServingType = targetAlloc.serving_type as 'dine_in' | 'parcel';
          if (targetAlloc.quantity > 1) {
            db.prepare('UPDATE order_item_serving_allocations SET quantity = quantity - 1, updated_at = ? WHERE id = ?').run(
              now(),
              targetAlloc.id,
            );
          } else {
            db.prepare('DELETE FROM order_item_packaging_allocations WHERE serving_allocation_id = ?').run(
              targetAlloc.id,
            );
            db.prepare('DELETE FROM order_item_serving_allocations WHERE id = ?').run(targetAlloc.id);
          }
        }

        const freeRowRecipeSnapshot = buildRecipeSnapshot(db, freeRow.product_id, newQty, 1);
        const freeRowCost = extractOrderItemCostFromSnapshot(freeRowRecipeSnapshot);
        const freeRowProdRow = db
          .prepare('SELECT id, track_inventory, inventory_product_id, inventory_deduction_quantity FROM products WHERE id = ?')
          .get(freeRow.product_id) as InventoryProductLike | undefined;
        const freeRowDeduction = freeRowProdRow ? resolveInventoryDeduction(freeRowProdRow, newQty, null) : null;

        db.prepare(`
          UPDATE order_items
          SET quantity = ?,
              subtotal = ?,
              total = ?,
              inventory_deducted_quantity = ?,
              recipe_snapshot = ?,
              ingredient_cost = ?,
              ingredient_cost_known = ?,
              updated_at = ?
          WHERE id = ?
        `).run(
          newQty,
          newSubtotal,
          newSubtotal,
          freeRowDeduction ? freeRowDeduction.deductedQuantity : 0,
          freeRowRecipeSnapshot ? JSON.stringify(freeRowRecipeSnapshot) : null,
          freeRowCost.ingredientCost,
          freeRowCost.ingredientCostKnown,
          now(),
          freeRow.id,
        );

        const recipeSnapshot = buildRecipeSnapshot(db, freeRow.product_id, 1, 1);
        const { ingredientCost, ingredientCostKnown } = extractOrderItemCostFromSnapshot(recipeSnapshot);
        const prodRow = db
          .prepare('SELECT id, track_inventory, inventory_product_id, inventory_deduction_quantity FROM products WHERE id = ?')
          .get(freeRow.product_id) as InventoryProductLike | undefined;
        const deduction = prodRow ? resolveInventoryDeduction(prodRow, 1, null) : null;

        const invDeductedQty = deduction ? deduction.deductedQuantity : 0;
        const invProdId = deduction ? deduction.productId : null;
        const invVarId = deduction?.variantId ?? null;

        const freeSubtotal = freeRow.unit_price;
        const insertStmt = db.prepare(`
          INSERT INTO order_items (
            order_id, product_id, variant_id, product_name, product_sku, unit_price, quantity,
            inventory_deducted_quantity, inventory_product_id, inventory_variant_id,
            subtotal, tax_amount, tax_breakdown, tax_snapshot, tax_type, discount_amount, total,
            variant_selection, modifier_selection, special_instructions,
            recipe_snapshot, ingredient_cost, ingredient_cost_known, status, created_at, updated_at
          ) VALUES (
            ?, ?, ?, ?, ?, ?, 1,
            ?, ?, ?,
            ?, 0, '[]', null, ?, ?, 0,
            ?, ?, 'BOGO Free',
            ?, ?, ?, 'pending', ?, ?
          )
        `);

        const freeName = `${freeRow.product_name} (BOGO Free)`;
        const freeInsertResult = insertStmt.run(
          orderId,
          freeRow.product_id,
          freeRow.variant_id || null,
          freeName,
          freeRow.product_sku || null,
          freeRow.unit_price,
          invDeductedQty,
          invProdId,
          invVarId,
          freeSubtotal,
          freeRow.tax_type || 'exclusive',
          freeSubtotal,
          freeRow.variant_selection || null,
          JSON.stringify({
            is_bogo_free: true,
            is_bogo_paid: false,
            bogo_pair_id: pairId,
            promotion_id: promotion.id,
            source_order_item_id: freeRow.id,
          }),
          recipeSnapshot ? JSON.stringify(recipeSnapshot) : null,
          ingredientCost,
          ingredientCostKnown,
          now(),
          now(),
        );

        persistItemServingAndPackaging({
          db,
          orderItemId: freeInsertResult.lastInsertRowid,
          itemQuantity: 1,
          allocations: [{ serving_type: freeServingType, quantity: 1 }],
          actorUserId,
          productId: freeRow.product_id,
          variantId: freeRow.variant_id || null,
        });
      } else if (freeRow && freeRow.quantity === 1) {
        db.prepare(`
          UPDATE order_items
          SET discount_amount = ?,
              total = 0,
              special_instructions = CASE
                WHEN special_instructions IS NULL OR special_instructions = '' THEN 'BOGO Free'
                ELSE special_instructions
              END,
              product_name = CASE
                WHEN product_name NOT LIKE '%(BOGO Free)%' THEN product_name || ' (BOGO Free)'
                ELSE product_name
              END,
              modifier_selection = json_set(
                CASE WHEN modifier_selection IS NULL OR modifier_selection = 'null' OR modifier_selection = '' THEN '{}' ELSE modifier_selection END,
                '$.is_bogo_free', true,
                '$.is_bogo_paid', false,
                '$.bogo_pair_id', ?,
                '$.promotion_id', ?
              ),
              updated_at = ?
          WHERE id = ?
        `).run(discountAmount, pairId, promotion.id, now(), freeRow.id);
      }

      if (paidUnit.orderItemId) {
        db.prepare(`
          UPDATE order_items
          SET modifier_selection = json_set(
                CASE WHEN modifier_selection IS NULL OR modifier_selection = 'null' OR modifier_selection = '' THEN '{}' ELSE modifier_selection END,
                '$.is_bogo_paid', true,
                '$.is_bogo_free', false,
                '$.bogo_pair_id', ?,
                '$.promotion_id', ?
              ),
              updated_at = ?
          WHERE id = ?
        `).run(pairId, promotion.id, now(), paidUnit.orderItemId);
      }
    }
  } else {
    for (const item of items) {
      const itemDiscount = calculation.itemDiscountMap[String(item.id)] || 0;
      db.prepare(
        `UPDATE order_items
         SET discount_amount = ?, updated_at = ?
         WHERE id = ?`,
      ).run(itemDiscount, now(), item.id);
    }
  }

  const countrySetting = db.prepare("SELECT value FROM settings WHERE key = 'country'").get() as
    | { value: string }
    | undefined;
  const taxesSetting = db.prepare("SELECT value FROM settings WHERE key = 'taxes_enabled'").get() as
    | { value: string }
    | undefined;

  const tenantInfo = {
    country: countrySetting?.value || '',
    business_type: 'restaurant',
    state_code: '',
    currency,
    taxes_enabled: taxesSetting?.value === 'true',
  };

  const customer = order.customer_id
    ? ((db.prepare('SELECT * FROM customers WHERE id = ?').get(order.customer_id) as Customer | undefined) ?? null)
    : null;

  const totals = calculateOrderTotals(db, orderId);
  const discountAmount =
    promotion.discount_type === 'bogo'
      ? bogoTotalDiscount
      : calculation.totalDiscountAmount;
  const engineCharges = resolveEngineCharges(order, totals.subtotal, discountAmount);

  const {
    taxRollup,
    total: newTotal,
    roundOff,
  } = recomputeOrderTotals({
    tenantInfo,
    chargeContext: order,
    customer,
    totals,
    discountAmount,
    taxScaling: 'when-discounted',
    appliedCharges: engineCharges ? engineCharges.appliedCharges : null,
    chargeColumnOverrides: engineCharges?.chargeColumnOverrides,
  });

  const syncedServiceCharge = engineCharges
    ? engineCharges.columns.service_charge
    : order.service_charge || 0;
  const syncedPackagingCharge = engineCharges
    ? engineCharges.columns.packaging_charge
    : order.packaging_charge || 0;
  const syncedChargesJson = engineCharges
    ? engineCharges.chargesJson
    : order.charges_breakdown ?? null;

  db.prepare(`
    UPDATE orders
    SET promotion_id = ?,
        subtotal = ?,
        discount_amount = ?,
        discount_type = ?,
        discount_value = ?,
        discount_reason = ?,
        tax_amount = ?,
        tax_breakdown = ?,
        tax_snapshot = ?,
        total = ?,
        service_charge = ?,
        packaging_charge = ?,
        charges_breakdown = ?,
        round_off = ?,
        updated_at = ?
    WHERE id = ?
  `).run(
    promotion.id,
    totals.subtotal,
    discountAmount,
    promotion.discount_type,
    promotion.discount_value,
    promotion.name,
    taxRollup.taxAmount,
    JSON.stringify(taxRollup.breakdowns),
    taxRollup.snapshotJson,
    newTotal,
    syncedServiceCharge,
    syncedPackagingCharge,
    syncedChargesJson,
    roundOff,
    now(),
    orderId,
  );

  let updatedBill: unknown = undefined;
  const existingBill = db
    .prepare("SELECT * FROM bills WHERE order_id = ? AND payment_status != 'paid'")
    .get(orderId) as BillRecord | undefined;

  if (existingBill) {
    const pack = getActiveCountryPack(tenantInfo.country);
    const { total: billTotal, adjustment: billRoundOff } = applyPayableRounding(
      newTotal,
      pack,
      currency,
    );
    const billPaidAmount = Number(existingBill.paid_amount || 0);
    const newBillBalance = Math.max(0, billTotal - billPaidAmount);

    db.prepare(`
      UPDATE bills
      SET promotion_id = ?,
          subtotal = ?,
          discount_amount = ?,
          discount_type = ?,
          discount_value = ?,
          discount_reason = ?,
          tax_amount = ?,
          tax_breakdown = ?,
          tax_snapshot = ?,
          total = ?,
          balance = ?,
          service_charge = ?,
          packaging_charge = ?,
          charges_breakdown = ?,
          round_off = ?,
          updated_at = ?
      WHERE id = ?
    `).run(
      promotion.id,
      totals.subtotal,
      discountAmount,
      promotion.discount_type,
      promotion.discount_value,
      promotion.name,
      taxRollup.taxAmount,
      JSON.stringify(taxRollup.breakdowns),
      taxRollup.snapshotJson,
      billTotal,
      newBillBalance,
      syncedServiceCharge,
      syncedPackagingCharge,
      syncedChargesJson,
      billRoundOff,
      now(),
      existingBill.id,
    );

    updatedBill = db.prepare('SELECT * FROM bills WHERE id = ?').get(existingBill.id);
  }

  recordOrderAudit(db, {
    orderId: String(orderId),
    actorUserId,
    action: 'promotion_applied',
    details: {
      client_ip: clientIp,
      promotion_id: promotion.id,
      promotion_name: promotion.name,
      discount_type: promotion.discount_type,
      discount_amount: discountAmount,
      free_units_count: calculation.freeUnits.length,
      pairs: calculation.pairs,
    },
  });

  notifyKdsUpdate();

  const updatedOrder = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  return { order: updatedOrder, bill: updatedBill, calculation };
}

/**
 * Removes active promotion from order and restores standard pricing.
 */
export function removePromotionFromOrder(
  db: Database,
  orderId: number | string,
  actorUserId: string,
): { order: unknown; bill?: unknown } {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId) as OrderRecord | undefined;
  if (!order) {
    throw Object.assign(new Error(`Order with ID ${orderId} not found`), { statusCode: 404 });
  }

  if (['completed', 'cancelled'].includes(order.status)) {
    throw Object.assign(new Error('Cannot modify promotions on completed or cancelled order'), {
      statusCode: 400,
    });
  }

  // 1. Clean up split-off BOGO free items and merge quantity back
  const splitFreeItems = db
    .prepare(
      `SELECT id, quantity, json_extract(modifier_selection, '$.source_order_item_id') as source_id
       FROM order_items
       WHERE order_id = ? AND json_extract(modifier_selection, '$.source_order_item_id') IS NOT NULL`,
    )
    .all(orderId) as Array<{ id: number; quantity: number; source_id: number }>;

  for (const s of splitFreeItems) {
    if (s.source_id) {
      const freeAllocs = db
        .prepare('SELECT serving_type, quantity FROM order_item_serving_allocations WHERE order_item_id = ?')
        .all(s.id) as Array<{ serving_type: string; quantity: number }>;

      db.prepare(`
        UPDATE order_items
        SET quantity = quantity + ?,
            subtotal = unit_price * (quantity + ?),
            total = unit_price * (quantity + ?),
            updated_at = ?
        WHERE id = ?
      `).run(s.quantity, s.quantity, s.quantity, now(), s.source_id);

      const restoredRow = db.prepare('SELECT product_id, quantity FROM order_items WHERE id = ?').get(s.source_id) as any;
      if (restoredRow) {
        const restoredRecipeSnapshot = buildRecipeSnapshot(db, restoredRow.product_id, restoredRow.quantity, 1);
        const restoredCost = extractOrderItemCostFromSnapshot(restoredRecipeSnapshot);
        const restoredProdRow = db
          .prepare('SELECT id, track_inventory, inventory_product_id, inventory_deduction_quantity FROM products WHERE id = ?')
          .get(restoredRow.product_id) as InventoryProductLike | undefined;
        const restoredDeduction = restoredProdRow ? resolveInventoryDeduction(restoredProdRow, restoredRow.quantity, null) : null;
        db.prepare(`
          UPDATE order_items
          SET inventory_deducted_quantity = ?,
              recipe_snapshot = ?,
              ingredient_cost = ?,
              ingredient_cost_known = ?
          WHERE id = ?
        `).run(
          restoredDeduction ? restoredDeduction.deductedQuantity : 0,
          restoredRecipeSnapshot ? JSON.stringify(restoredRecipeSnapshot) : null,
          restoredCost.ingredientCost,
          restoredCost.ingredientCostKnown,
          s.source_id,
        );
      }

      for (const fa of freeAllocs) {
        const existingSourceAlloc = db
          .prepare(
            'SELECT id FROM order_item_serving_allocations WHERE order_item_id = ? AND serving_type = ? LIMIT 1',
          )
          .get(s.source_id, fa.serving_type) as { id: number } | undefined;
        if (existingSourceAlloc) {
          db.prepare(
            'UPDATE order_item_serving_allocations SET quantity = quantity + ?, updated_at = ? WHERE id = ?',
          ).run(fa.quantity, now(), existingSourceAlloc.id);
        } else {
          db.prepare(
            'INSERT INTO order_item_serving_allocations (order_item_id, serving_type, quantity, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
          ).run(s.source_id, fa.serving_type, fa.quantity, now(), now());
        }
      }
    }
    db.prepare('DELETE FROM order_item_packaging_allocations WHERE serving_allocation_id IN (SELECT id FROM order_item_serving_allocations WHERE order_item_id = ?)').run(s.id);
    db.prepare('DELETE FROM order_item_serving_allocations WHERE order_item_id = ?').run(s.id);
    db.prepare('DELETE FROM order_item_addons WHERE order_item_id = ?').run(s.id);
    db.prepare('DELETE FROM order_items WHERE id = ?').run(s.id);
  }

  // 2. Restore any items tagged with BOGO or discounts
  db.prepare(`
    UPDATE order_items
    SET discount_amount = 0,
        total = subtotal,
        product_name = REPLACE(product_name, ' (BOGO Free)', ''),
        special_instructions = CASE WHEN special_instructions = 'BOGO Free' THEN NULL ELSE special_instructions END,
        modifier_selection = json_remove(
          CASE WHEN modifier_selection IS NULL OR modifier_selection = 'null' OR modifier_selection = '' THEN '{}' ELSE modifier_selection END,
          '$.is_bogo_free', '$.is_bogo_paid', '$.bogo_pair_id', '$.promotion_id'
        ),
        updated_at = ?
    WHERE order_id = ?
  `).run(now(), orderId);

  const currency = getTenantCurrency();
  const countrySetting = db.prepare("SELECT value FROM settings WHERE key = 'country'").get() as
    | { value: string }
    | undefined;
  const taxesSetting = db.prepare("SELECT value FROM settings WHERE key = 'taxes_enabled'").get() as
    | { value: string }
    | undefined;

  const tenantInfo = {
    country: countrySetting?.value || '',
    business_type: 'restaurant',
    state_code: '',
    currency,
    taxes_enabled: taxesSetting?.value === 'true',
  };

  const customer = order.customer_id
    ? ((db.prepare('SELECT * FROM customers WHERE id = ?').get(order.customer_id) as Customer | undefined) ?? null)
    : null;

  const totals = calculateOrderTotals(db, orderId);
  const engineCharges = resolveEngineCharges(order, totals.subtotal, 0);

  const {
    taxRollup,
    total: newTotal,
    roundOff,
  } = recomputeOrderTotals({
    tenantInfo,
    chargeContext: order,
    customer,
    totals,
    discountAmount: 0,
    taxScaling: 'when-discounted',
    appliedCharges: engineCharges ? engineCharges.appliedCharges : null,
    chargeColumnOverrides: engineCharges?.chargeColumnOverrides,
  });

  const syncedServiceCharge = engineCharges
    ? engineCharges.columns.service_charge
    : order.service_charge || 0;
  const syncedPackagingCharge = engineCharges
    ? engineCharges.columns.packaging_charge
    : order.packaging_charge || 0;
  const syncedChargesJson = engineCharges
    ? engineCharges.chargesJson
    : order.charges_breakdown ?? null;

  db.prepare(`
    UPDATE orders
    SET promotion_id = NULL,
        subtotal = ?,
        discount_amount = 0,
        discount_type = NULL,
        discount_value = NULL,
        discount_reason = NULL,
        tax_amount = ?,
        tax_breakdown = ?,
        tax_snapshot = ?,
        total = ?,
        service_charge = ?,
        packaging_charge = ?,
        charges_breakdown = ?,
        round_off = ?,
        updated_at = ?
    WHERE id = ?
  `).run(
    totals.subtotal,
    taxRollup.taxAmount,
    JSON.stringify(taxRollup.breakdowns),
    taxRollup.snapshotJson,
    newTotal,
    syncedServiceCharge,
    syncedPackagingCharge,
    syncedChargesJson,
    roundOff,
    now(),
    orderId,
  );

  let updatedBill: unknown = undefined;
  const existingBill = db
    .prepare("SELECT * FROM bills WHERE order_id = ? AND payment_status != 'paid'")
    .get(orderId) as BillRecord | undefined;

  if (existingBill) {
    const pack = getActiveCountryPack(tenantInfo.country);
    const { total: billTotal, adjustment: billRoundOff } = applyPayableRounding(
      newTotal,
      pack,
      currency,
    );
    const billPaidAmount = Number(existingBill.paid_amount || 0);
    const newBillBalance = Math.max(0, billTotal - billPaidAmount);

    db.prepare(`
      UPDATE bills
      SET promotion_id = NULL,
          subtotal = ?,
          discount_amount = 0,
          discount_type = NULL,
          discount_value = NULL,
          discount_reason = NULL,
          tax_amount = ?,
          tax_breakdown = ?,
          tax_snapshot = ?,
          total = ?,
          balance = ?,
          service_charge = ?,
          packaging_charge = ?,
          charges_breakdown = ?,
          round_off = ?,
          updated_at = ?
      WHERE id = ?
    `).run(
      totals.subtotal,
      taxRollup.taxAmount,
      JSON.stringify(taxRollup.breakdowns),
      taxRollup.snapshotJson,
      billTotal,
      newBillBalance,
      syncedServiceCharge,
      syncedPackagingCharge,
      syncedChargesJson,
      billRoundOff,
      now(),
      existingBill.id,
    );

    updatedBill = db.prepare('SELECT * FROM bills WHERE id = ?').get(existingBill.id);
  }

  recordOrderAudit(db, {
    orderId: String(orderId),
    actorUserId,
    action: 'promotion_removed',
    details: { previous_promotion_id: order.promotion_id },
  });

  notifyKdsUpdate();

  return {
    order: db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId),
    bill: updatedBill,
  };
}

/**
 * Authoritative settlement-time promotion redemption recorder.
 */
export function recordPromotionRedemptionOnCheckout(
  db: Database,
  orderId: number | string,
  billId?: number | string | null,
  actorUserId?: string | null,
): void {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId) as OrderRecord | undefined;
  if (!order || !order.promotion_id) return;

  const promoRow = db.prepare('SELECT * FROM promotions WHERE id = ?').get(order.promotion_id) as
    | PromotionDbRow
    | undefined;
  if (!promoRow) return;

  const promotion = parsePromotionRow(promoRow);

  const existingRedemption = db
    .prepare('SELECT id FROM promotion_redemptions WHERE order_id = ? AND promotion_id = ?')
    .get(orderId, promotion.id);
  if (existingRedemption) return;

  const discountAmount = Number(order.discount_amount || 0);
  const isLoyaltyReward = promotion.is_loyalty_reward ? 1 : 0;

  db.prepare(`
    INSERT INTO promotion_redemptions (
      promotion_id, order_id, bill_id, customer_id, cashier_user_id,
      discount_amount, is_loyalty_reward, details_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    promotion.id,
    orderId,
    billId || null,
    order.customer_id || null,
    actorUserId || null,
    discountAmount,
    isLoyaltyReward,
    JSON.stringify({
      promotion_name: promotion.name,
      discount_type: promotion.discount_type,
      bogo_pricing_rule: promotion.bogo_pricing_rule,
      discount_amount: discountAmount,
      total_before_discount: Number(order.subtotal || 0),
    }),
    now(),
  );

  db.prepare(
    `UPDATE promotions
     SET current_redemptions_count = current_redemptions_count + 1,
         updated_at = ?
     WHERE id = ?`,
  ).run(now(), promotion.id);
}

export interface PromotionReportsSummary {
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
  redemptionsByCashier: Array<{
    cashierUserId: string | null;
    cashierName: string;
    redemptionCount: number;
    totalDiscount: number;
  }>;
  redemptionsByDate: Array<{
    date: string;
    redemptionCount: number;
    totalDiscount: number;
  }>;
}

interface OverallStatsDbRow {
  total_count: number;
  total_discount: number;
  bogo_count: number;
  bogo_discount: number;
  launch_count: number;
  launch_discount: number;
  loyalty_count: number;
  loyalty_discount: number;
}

interface CashierStatDbRow {
  cashier_user_id: string | null;
  cashier_name: string;
  redemption_count: number;
  total_discount: number;
}

interface DateStatDbRow {
  date_day: string;
  redemption_count: number;
  total_discount: number;
}

/**
 * Reporting query for promotions & discounts.
 */
export function getPromotionReportsSummary(
  db: Database,
  startDate?: string | null,
  endDate?: string | null,
): PromotionReportsSummary {
  let dateFilter = '';
  const params: unknown[] = [];

  if (startDate) {
    dateFilter += ' AND pr.created_at >= ?';
    params.push(startDate);
  }
  if (endDate) {
    dateFilter += ' AND pr.created_at <= ?';
    params.push(endDate);
  }

  const baseWhere = `
    WHERE (
      pr.order_id IS NULL OR pr.order_id NOT IN (
        SELECT internal_order_id FROM delivery_order_tracking WHERE is_simulated = 1
      )
    )
    ${dateFilter}
  `;

  const overallStats = db
    .prepare(
      `SELECT
         COUNT(*) as total_count,
         COALESCE(SUM(pr.discount_amount), 0) as total_discount,
         COALESCE(SUM(CASE WHEN p.discount_type = 'bogo' THEN 1 ELSE 0 END), 0) as bogo_count,
         COALESCE(SUM(CASE WHEN p.discount_type = 'bogo' THEN pr.discount_amount ELSE 0 END), 0) as bogo_discount,
         COALESCE(SUM(CASE WHEN pr.promotion_id = 'launch-bogo' THEN 1 ELSE 0 END), 0) as launch_count,
         COALESCE(SUM(CASE WHEN pr.promotion_id = 'launch-bogo' THEN pr.discount_amount ELSE 0 END), 0) as launch_discount,
         COALESCE(SUM(CASE WHEN pr.promotion_id = 'manual-bogo' THEN 1 ELSE 0 END), 0) as manual_count,
         COALESCE(SUM(CASE WHEN pr.promotion_id = 'manual-bogo' THEN pr.discount_amount ELSE 0 END), 0) as manual_discount,
         COALESCE(SUM(CASE WHEN pr.is_loyalty_reward = 1 THEN 1 ELSE 0 END), 0) as loyalty_count,
         COALESCE(SUM(CASE WHEN pr.is_loyalty_reward = 1 THEN pr.discount_amount ELSE 0 END), 0) as loyalty_discount
       FROM promotion_redemptions pr
       JOIN promotions p ON p.id = pr.promotion_id
       ${baseWhere}`,
    )
    .get(...params) as OverallStatsDbRow | undefined;

  const byCashier = db
    .prepare(
      `SELECT
         pr.cashier_user_id,
         COALESCE(u.name, 'System') as cashier_name,
         COUNT(*) as redemption_count,
         COALESCE(SUM(pr.discount_amount), 0) as total_discount
       FROM promotion_redemptions pr
       JOIN promotions p ON p.id = pr.promotion_id
       LEFT JOIN users u ON u.id = pr.cashier_user_id
       ${baseWhere}
       GROUP BY pr.cashier_user_id, cashier_name
       ORDER BY total_discount DESC`,
    )
    .all(...params) as CashierStatDbRow[];

  const byDate = db
    .prepare(
      `SELECT
         DATE(pr.created_at) as date_day,
         COUNT(*) as redemption_count,
         COALESCE(SUM(pr.discount_amount), 0) as total_discount
       FROM promotion_redemptions pr
       JOIN promotions p ON p.id = pr.promotion_id
       ${baseWhere}
       GROUP BY date_day
       ORDER BY date_day ASC`,
    )
    .all(...params) as DateStatDbRow[];

  let bogoDateFilter = '';
  const bogoParams: unknown[] = [];
  if (startDate) {
    bogoDateFilter += ' AND o.created_at >= ?';
    bogoParams.push(startDate);
  }
  if (endDate) {
    bogoDateFilter += ' AND o.created_at <= ?';
    bogoParams.push(endDate);
  }

  const bogoQtyStats = db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN json_extract(oi.modifier_selection, '$.is_bogo_free') = 1 OR json_extract(oi.modifier_selection, '$.is_bogo_free') = true OR oi.product_name LIKE '%(BOGO Free)%' OR (oi.discount_amount >= oi.subtotal AND oi.subtotal > 0) THEN oi.quantity ELSE 0 END), 0) as free_quantity
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       WHERE (oi.status IS NULL OR oi.status NOT IN ('cancelled', 'voided', 'void_adjustment'))
         AND o.status != 'cancelled'
         AND (
           o.id IS NULL OR o.id NOT IN (
             SELECT internal_order_id FROM delivery_order_tracking WHERE is_simulated = 1
           )
         )
         ${bogoDateFilter}`,
    )
    .get(...bogoParams) as { free_quantity: number } | undefined;

  const bogoFreeQuantity = Number(bogoQtyStats?.free_quantity || 0);
  const bogoPaidQuantity = bogoFreeQuantity;
  const bogoPreparedQuantity = bogoFreeQuantity + bogoPaidQuantity;

  return {
    totalRedemptionsCount: Number(overallStats?.total_count || 0),
    totalDiscountAmount: Number(overallStats?.total_discount || 0),
    bogoRedemptionsCount: Number(overallStats?.bogo_count || 0),
    bogoDiscountAmount: Number(overallStats?.bogo_discount || 0),
    bogoPaidQuantity,
    bogoFreeQuantity,
    bogoPreparedQuantity,
    launchBogoRedemptionsCount: Number(overallStats?.launch_count || 0),
    launchBogoDiscountAmount: Number(overallStats?.launch_discount || 0),
    manualBogoRedemptionsCount: Number((overallStats as any)?.manual_count || 0),
    manualBogoDiscountAmount: Number((overallStats as any)?.manual_discount || 0),
    loyaltyRewardRedemptionsCount: Number(overallStats?.loyalty_count || 0),
    loyaltyRewardDiscountAmount: Number(overallStats?.loyalty_discount || 0),
    redemptionsByCashier: byCashier.map((c) => ({
      cashierUserId: c.cashier_user_id,
      cashierName: c.cashier_name,
      redemptionCount: Number(c.redemption_count || 0),
      totalDiscount: Number(c.total_discount || 0),
    })),
    redemptionsByDate: byDate.map((d) => ({
      date: d.date_day,
      redemptionCount: Number(d.redemption_count || 0),
      totalDiscount: Number(d.total_discount || 0),
    })),
  };
}
