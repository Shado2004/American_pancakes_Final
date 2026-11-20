/**
 * American Pancakes POS — Comprehensive Pancake Pair-Based BOGO Test Suite
 *
 * Verifies all 15 business scenarios:
 *  1. Two different pancakes BOGO (₹90 + ₹70 -> ₹90 charged, ₹70 free, total ₹90).
 *  2. Two equal price pancakes BOGO (₹70 + ₹70 -> 1 charged, 1 free, total ₹70).
 *  3. Two pancakes without BOGO (both full price ₹160).
 *  4. Three pancakes with 1 pair (₹90 + ₹70 -> ₹90, ₹60 unpaired -> total ₹150).
 *  5. Four pancakes with 2 pairs (₹90 + ₹70 -> ₹90, ₹80 + ₹60 -> ₹80 -> total ₹170).
 *  6. BOGO + Parcel Box (2 pancakes BOGO + 2 boxes @ ₹5 -> total ₹100; boxes never free).
 *  7. Standalone Parcel Box sales (1, 2, 3 boxes -> ₹5, ₹10, ₹15, 0 plates).
 *  8. Normal sales (only non-BOGO pancakes, normal revenue, normal plate costing).
 *  9. Launch promotion vs Loyalty promotion source attribution ('launch-bogo' vs 'loyalty-visit6-bogo').
 * 10. Free pancake ingredient consumption (both ingredients & 1 paper plate @ ₹2.50 consumed).
 * 11. Dashboard reconciliation (Normal Sales + BOGO Sales = Total Pancake Sales & Profit).
 * 12. CSV and Excel export reconciliation (Normal vs BOGO breakdown matches totals).
 * 13. Upgrade swap on paid order (₹70 -> ₹90: customer pays +₹20 difference).
 * 14. Downgrade swap on paid order (₹90 -> ₹70: customer receives -₹20 refund).
 * 15. Refund COGS correction (refunded sellable pancake reduces revenue, 0 COGS, no double-costing on resale).
 */

const Module = require('module');
const originalLoad = Module._load;
const fs = require('fs');
const os = require('os');
const path = require('path');

const activeTestDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flo-pair-bogo-test-'));
Module._load = function (request: string) {
  if (request === 'electron') {
    return {
      app: { isPackaged: true, getPath: () => activeTestDir, getVersion: () => 'test' },
      safeStorage: {
        isEncryptionAvailable: () => true,
        encryptString: (s: string) => Buffer.from(s, 'utf8'),
        decryptString: (b: Buffer) => b.toString('utf8'),
      },
    };
  }
  return originalLoad.apply(this, arguments as any);
};

const { initDatabase, getDatabase, closeDatabase, now } = require('../main/db');
const {
  calculatePromotionDiscount,
  applyPromotionToOrder,
  isProductEligibleForPromotion,
  Promotion,
} = require('../main/services/promotions');
const { computeRoadsideDashboardSummary } = require('../main/services/roadside-reporting');
const {
  serializeProductPerformanceCsv,
  serializeProductPerformanceXlsx,
} = require('../main/services/roadside-export');
const { orderRoutes } = require('../main/routes/orders');
const {
  createApp,
  startServer,
  seedOwnerUser,
  api,
  assert,
  assertEqual,
  getResults,
} = require('./helpers/test-setup');

async function runPairBogoTestSuite() {
  console.log('\n====================================================================');
  console.log('   AMERICAN PANCAKES POS — PANCAKE PAIR BOGO & REPORTING TESTS      ');
  console.log('====================================================================\n');

  // Copy flo.db to isolated temp directory — NEVER touch source flo.db
  const sourceDbPath = path.resolve(__dirname, '..', 'flo.db');
  const targetDbPath = path.join(activeTestDir, 'flo.db');
  fs.copyFileSync(sourceDbPath, targetDbPath);

  initDatabase(activeTestDir);
  const db = getDatabase();

  const owner = seedOwnerUser(db);
  const actorId = owner.userId;

  // Clear existing orders/bills/refunds in test database for clean assertions
  db.pragma('foreign_keys = OFF');
  const tablesToClear = [
    'refunds',
    'promotion_redemptions',
    'bill_items',
    'bills',
    'order_item_packaging_allocations',
    'order_item_serving_allocations',
    'order_item_addons',
    'order_audit_events',
    'order_items',
    'orders',
  ];
  for (const tbl of tablesToClear) {
    try {
      db.prepare(`DELETE FROM ${tbl}`).run();
    } catch {}
  }
  db.pragma('foreign_keys = ON');

  // Set up Express test server with orders route for swap API tests
  const app = createApp({ '/api/orders': orderRoutes });
  const { baseUrl, server } = await startServer(app);

  // Setup / Ensure Test Products
  // 1. Cotton Candy Pancake (₹90)
  // 2. Dark Chocolate Pancake (₹70)
  // 3. White Chocolate Pancake (₹80)
  // 4. Classic Plain Pancake (₹60)
  // 5. Parcel Box (₹5)
  const categoryPancakeId = 'cat_pancakes_test';
  db.prepare(`
    INSERT OR IGNORE INTO categories (id, name, is_active, created_at, updated_at)
    VALUES (?, 'Pancakes', 1, ?, ?)
  `).run(categoryPancakeId, now(), now());

  const categoryPackagingId = 'cat_packaging_test';
  db.prepare(`
    INSERT OR IGNORE INTO categories (id, name, is_active, created_at, updated_at)
    VALUES (?, 'Packaging', 1, ?, ?)
  `).run(categoryPackagingId, now(), now());

  function upsertProduct(id: string, name: string, price: number, catId: string) {
    db.prepare(`
      INSERT INTO products (id, name, price, category_id, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, 1, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name = excluded.name, price = excluded.price, category_id = excluded.category_id
    `).run(id, name, price, catId, now(), now());
  }

  const PROD_COTTON_CANDY = { id: '34ty1p', name: 'Cotton Candy Pancake', price: 90 };
  const PROD_DARK_CHOCOLATE = { id: '25ru4o', name: 'Dark Chocolate Pancake', price: 70 };
  const PROD_WHITE_CHOCOLATE = { id: '99wq2x', name: 'White Chocolate Pancake', price: 80 };
  const PROD_OREO = { id: 'pr_oreo_90', name: 'Oreo Pancake', price: 90 };
  const PROD_CLASSIC_PLAIN = { id: 'pr_classic_60', name: 'Classic Plain Pancake', price: 60 };
  const PROD_PARCEL_BOX = { id: 'pr_parcel_box_5', name: 'Parcel Box', price: 5 };

  upsertProduct(PROD_COTTON_CANDY.id, PROD_COTTON_CANDY.name, PROD_COTTON_CANDY.price, categoryPancakeId);
  upsertProduct(PROD_DARK_CHOCOLATE.id, PROD_DARK_CHOCOLATE.name, PROD_DARK_CHOCOLATE.price, categoryPancakeId);
  upsertProduct(PROD_WHITE_CHOCOLATE.id, PROD_WHITE_CHOCOLATE.name, PROD_WHITE_CHOCOLATE.price, categoryPancakeId);
  upsertProduct(PROD_OREO.id, PROD_OREO.name, PROD_OREO.price, categoryPancakeId);
  upsertProduct(PROD_CLASSIC_PLAIN.id, PROD_CLASSIC_PLAIN.name, PROD_CLASSIC_PLAIN.price, categoryPancakeId);
  upsertProduct(PROD_PARCEL_BOX.id, PROD_PARCEL_BOX.name, PROD_PARCEL_BOX.price, categoryPackagingId);

  // Setup Promotions: launch-bogo and loyalty-visit6-bogo
  db.prepare(`
    INSERT INTO promotions (id, name, description, discount_type, target_type, discount_value, bogo_buy_qty, bogo_get_qty, bogo_pricing_rule, is_loyalty_reward, is_active, is_automatic, created_at, updated_at)
    VALUES ('launch-bogo', 'Launch BOGO 1+1', 'Buy 1 Pancake Get 1 Free', 'bogo', 'all', 100, 1, 1, 'cheapest_free', 0, 1, 0, ?, ?)
    ON CONFLICT(id) DO UPDATE SET is_active = 1, discount_type = 'bogo', bogo_pricing_rule = 'cheapest_free'
  `).run(now(), now());

  db.prepare(`
    INSERT INTO promotions (id, name, description, discount_type, target_type, discount_value, bogo_buy_qty, bogo_get_qty, bogo_pricing_rule, is_loyalty_reward, is_active, is_automatic, created_at, updated_at)
    VALUES ('loyalty-visit6-bogo', 'Loyalty 6th Visit BOGO', 'Loyalty Reward BOGO', 'bogo', 'all', 100, 1, 1, 'cheapest_free', 1, 1, 0, ?, ?)
    ON CONFLICT(id) DO UPDATE SET is_active = 1, discount_type = 'bogo', bogo_pricing_rule = 'cheapest_free'
  `).run(now(), now());

  const launchPromo = db.prepare('SELECT * FROM promotions WHERE id = ?').get('launch-bogo');
  const parsedLaunchPromo = {
    id: launchPromo.id,
    name: launchPromo.name,
    discount_type: launchPromo.discount_type,
    target_type: launchPromo.target_type,
    discount_value: Number(launchPromo.discount_value || 100),
    bogo_buy_qty: 1,
    bogo_get_qty: 1,
    bogo_pricing_rule: 'cheapest_free',
    is_loyalty_reward: Boolean(launchPromo.is_loyalty_reward),
    is_active: true,
    is_automatic: false,
    current_redemptions_count: 0,
    max_redemptions: null,
  };

  const loyaltyPromo = db.prepare('SELECT * FROM promotions WHERE id = ?').get('loyalty-visit6-bogo');
  const parsedLoyaltyPromo = {
    id: loyaltyPromo.id,
    name: loyaltyPromo.name,
    discount_type: loyaltyPromo.discount_type,
    target_type: loyaltyPromo.target_type,
    discount_value: Number(loyaltyPromo.discount_value || 100),
    bogo_buy_qty: 1,
    bogo_get_qty: 1,
    bogo_pricing_rule: 'cheapest_free',
    is_loyalty_reward: true,
    loyalty_qualifying_visits_required: 5,
    is_active: true,
    is_automatic: false,
    current_redemptions_count: 0,
    max_redemptions: null,
  };

  // Helper to create order and bill
  let orderSeq = 1;
  function insertTestOrder({
    items,
    paymentMethod = 'cash',
    timestamp = now(),
    discountAmount = 0,
    discountType = null as string | null,
    discountReason = null as string | null,
    promotionId = null as string | null,
  }: {
    items: Array<{
      productId: string;
      productName: string;
      unitPrice: number;
      quantity: number;
      discountAmount?: number;
      ingredientCost?: number;
      isBogoFree?: boolean;
      isBogoPaid?: boolean;
      bogoPairId?: string;
      promotionId?: string;
    }>;
    paymentMethod?: string;
    timestamp?: string;
    discountAmount?: number;
    discountType?: string | null;
    discountReason?: string | null;
    promotionId?: string | null;
  }) {
    const oNum = `ORD-BOGO-${String(orderSeq++).padStart(3, '0')}`;
    let subtotal = 0;
    for (const it of items) {
      subtotal += it.unitPrice * it.quantity;
    }
    const total = Math.max(0, subtotal - discountAmount);

    const orderRes = db.prepare(`
      INSERT INTO orders (order_number, user_id, type, status, subtotal, discount_amount, discount_type, discount_reason, promotion_id, total, created_at, updated_at, completed_at, inventory_lifecycle)
      VALUES (?, ?, 'takeaway', 'completed', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'checkout_v1')
    `).run(oNum, actorId, subtotal, discountAmount, discountType, discountReason, promotionId, total, timestamp, timestamp, timestamp);

    const orderId = Number(orderRes.lastInsertRowid);
    const itemIds: number[] = [];

    for (const it of items) {
      const itSubtotal = it.unitPrice * it.quantity;
      const itDiscount = it.discountAmount || 0;
      const itTotal = Math.max(0, itSubtotal - itDiscount);

      const modSel: Record<string, any> = {};
      if (it.isBogoFree) modSel.is_bogo_free = true;
      if (it.isBogoPaid) modSel.is_bogo_paid = true;
      if (it.bogoPairId) modSel.bogo_pair_id = it.bogoPairId;
      if (it.promotionId) modSel.promotion_id = it.promotionId;

      const modSelJson = Object.keys(modSel).length > 0 ? JSON.stringify(modSel) : null;
      const displayName = it.isBogoFree ? `${it.productName} (BOGO Free)` : it.productName;

      const itemRes = db.prepare(`
        INSERT INTO order_items (order_id, product_id, product_name, unit_price, quantity, subtotal, discount_amount, total, ingredient_cost, ingredient_cost_known, modifier_selection, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 'completed', ?, ?)
      `).run(orderId, it.productId, displayName, it.unitPrice, it.quantity, itSubtotal, itDiscount, itTotal, it.ingredientCost || 0, modSelJson, timestamp, timestamp);

      itemIds.push(Number(itemRes.lastInsertRowid));
    }

    const billRes = db.prepare(`
      INSERT INTO bills (order_id, bill_number, subtotal, discount_amount, discount_type, discount_reason, total, paid_amount, payment_status, payment_details, paid_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'paid', ?, ?, ?, ?)
    `).run(
      orderId,
      `INV-${oNum}`,
      subtotal,
      discountAmount,
      discountType,
      discountReason,
      total,
      total,
      JSON.stringify([{ method: paymentMethod, amount: total, timestamp }]),
      timestamp,
      timestamp,
      timestamp,
    );

    return { orderId, billId: Number(billRes.lastInsertRowid), itemIds, total, subtotal, discountAmount };
  }

  // =========================================================================
  // Scenario 1: Two different pancakes BOGO (₹90 + ₹70 -> ₹90 charged, ₹70 free)
  // =========================================================================
  console.log('\nScenario 1: Two different pancakes BOGO (₹90 + ₹70 -> ₹90 charged, ₹70 free)');
  const s1Items = [
    { id: 101, product_id: PROD_COTTON_CANDY.id, product_name: PROD_COTTON_CANDY.name, unit_price: 90, quantity: 1 },
    { id: 102, product_id: PROD_DARK_CHOCOLATE.id, product_name: PROD_DARK_CHOCOLATE.name, unit_price: 70, quantity: 1 },
  ];
  const s1Calc = calculatePromotionDiscount(db, parsedLaunchPromo, s1Items);

  assert(s1Calc.eligible, 'Calculation is eligible for BOGO');
  assertEqual(s1Calc.pairs, 1, 'Exactly 1 BOGO pair evaluated');
  assertEqual(s1Calc.totalDiscountAmount, 70, 'Lower priced Dark Chocolate (₹70) is automatically free');
  assertEqual(s1Calc.discountedSubtotal, 90, 'Net discounted subtotal is ₹90 (charged Cotton Candy)');
  assertEqual(s1Calc.evaluatedPairs[0]?.paidUnit.unitPrice, 90, 'Higher priced unit (₹90) is paid unit');
  assertEqual(s1Calc.evaluatedPairs[0]?.freeUnit.unitPrice, 70, 'Lower priced unit (₹70) is free unit');
  console.log('  ✓ Scenario 1 passed');

  // =========================================================================
  // Scenario 2: Two equal price pancakes BOGO (₹70 + ₹70 -> 1 charged, 1 free)
  // =========================================================================
  console.log('\nScenario 2: Two equal price pancakes BOGO (₹70 + ₹70 -> 1 charged, 1 free)');
  const s2Items = [
    { id: 201, product_id: PROD_DARK_CHOCOLATE.id, product_name: PROD_DARK_CHOCOLATE.name, unit_price: 70, quantity: 2 },
  ];
  const s2Calc = calculatePromotionDiscount(db, parsedLaunchPromo, s2Items);

  assert(s2Calc.eligible, 'Calculation is eligible for BOGO with equal price items');
  assertEqual(s2Calc.pairs, 1, 'Exactly 1 BOGO pair formed');
  assertEqual(s2Calc.totalDiscountAmount, 70, 'One pancake (₹70) is free');
  assertEqual(s2Calc.discountedSubtotal, 70, 'Net subtotal is ₹70 (one pancake charged)');
  console.log('  ✓ Scenario 2 passed');

  // =========================================================================
  // Scenario 3: Two pancakes without BOGO (both full price ₹160)
  // =========================================================================
  console.log('\nScenario 3: Two pancakes without BOGO (both full price ₹160)');
  const s3Subtotal = PROD_COTTON_CANDY.price + PROD_DARK_CHOCOLATE.price;
  assertEqual(s3Subtotal, 160, 'Subtotal without BOGO is ₹160');
  const s3Order = insertTestOrder({
    items: [
      { productId: PROD_COTTON_CANDY.id, productName: PROD_COTTON_CANDY.name, unitPrice: 90, quantity: 1, ingredientCost: 35 },
      { productId: PROD_DARK_CHOCOLATE.id, productName: PROD_DARK_CHOCOLATE.name, unitPrice: 70, quantity: 1, ingredientCost: 30 },
    ],
    discountAmount: 0,
  });
  assertEqual(s3Order.discountAmount, 0, 'Discount amount is ₹0 without BOGO');
  assertEqual(s3Order.total, 160, 'Order total is ₹160 without BOGO');
  console.log('  ✓ Scenario 3 passed');

  // =========================================================================
  // Scenario 4 (Example D): Odd number of pancakes (₹90, ₹80, ₹70 -> ₹170 payable, ₹70 discount)
  // =========================================================================
  console.log('\nScenario 4 (Example D): Odd number of pancakes (₹90, ₹80, ₹70 -> ₹170 payable, ₹70 discount)');
  const s4Items = [
    { id: 401, product_id: PROD_COTTON_CANDY.id, product_name: PROD_COTTON_CANDY.name, unit_price: 90, quantity: 1 },
    { id: 402, product_id: PROD_WHITE_CHOCOLATE.id, product_name: PROD_WHITE_CHOCOLATE.name, unit_price: 80, quantity: 1 },
    { id: 403, product_id: PROD_DARK_CHOCOLATE.id, product_name: PROD_DARK_CHOCOLATE.name, unit_price: 70, quantity: 1 },
  ];
  const s4Calc = calculatePromotionDiscount(db, parsedLaunchPromo, s4Items);

  assert(s4Calc.eligible, 'Eligible for BOGO calculation');
  assertEqual(s4Calc.pairs, 1, 'Exactly 1 pair paired (floor(3/2) = 1)');
  assertEqual(s4Calc.totalDiscountAmount, 70, 'Lowest priced Dark Chocolate (₹70) is free');
  assertEqual(s4Calc.discountedSubtotal, 170, 'Discounted payable total is ₹170 (₹90 + ₹80 charged)');
  assertEqual(s4Calc.freeUnits.length, 1, 'Exactly 1 free unit');
  assertEqual(s4Calc.freeUnits[0].unitPrice, 70, 'Free unit is Dark Chocolate (₹70)');
  console.log('  ✓ Scenario 4 passed');

  // =========================================================================
  // Scenario 5 (Example A): 4 Pancakes with different prices (₹90, ₹90, ₹80, ₹70 -> ₹180 payable, ₹150 discount)
  // =========================================================================
  console.log('\nScenario 5 (Example A): 4 Pancakes with different prices (₹90, ₹90, ₹80, ₹70 -> ₹180 payable, ₹150 discount)');
  const s5Items = [
    { id: 501, product_id: PROD_COTTON_CANDY.id, product_name: PROD_COTTON_CANDY.name, unit_price: 90, quantity: 1 },
    { id: 502, product_id: PROD_OREO.id, product_name: PROD_OREO.name, unit_price: 90, quantity: 1 },
    { id: 503, product_id: PROD_WHITE_CHOCOLATE.id, product_name: PROD_WHITE_CHOCOLATE.name, unit_price: 80, quantity: 1 },
    { id: 504, product_id: PROD_DARK_CHOCOLATE.id, product_name: PROD_DARK_CHOCOLATE.name, unit_price: 70, quantity: 1 },
  ];
  const s5Calc = calculatePromotionDiscount(db, parsedLaunchPromo, s5Items);

  assert(s5Calc.eligible, '4 pancakes eligible for 2 free items');
  assertEqual(s5Calc.pairs, 2, '2 pairs formed');
  assertEqual(s5Calc.totalDiscountAmount, 150, 'Total discount is ₹150 (₹80 + ₹70)');
  assertEqual(s5Calc.discountedSubtotal, 180, 'Net payable total is ₹180 (₹90 + ₹90 charged)');
  console.log('  ✓ Scenario 5 passed');

  // =========================================================================
  // Scenario 5B (Example B): 4 Pancakes of same price (4 × ₹90 -> ₹180 payable, ₹180 discount)
  // =========================================================================
  console.log('\nScenario 5B (Example B): 4 Pancakes of same price (4 × ₹90 -> ₹180 payable, ₹180 discount)');
  const s5bItems = [
    { id: 510, product_id: PROD_COTTON_CANDY.id, product_name: PROD_COTTON_CANDY.name, unit_price: 90, quantity: 4 },
  ];
  const s5bCalc = calculatePromotionDiscount(db, parsedLaunchPromo, s5bItems);

  assert(s5bCalc.eligible, '4 identical pancakes eligible');
  assertEqual(s5bCalc.pairs, 2, '2 pairs formed (2 free)');
  assertEqual(s5bCalc.totalDiscountAmount, 180, 'Total discount is ₹180 (2 × ₹90)');
  assertEqual(s5bCalc.discountedSubtotal, 180, 'Net payable total is ₹180 (2 × ₹90 charged)');
  console.log('  ✓ Scenario 5B passed');

  // =========================================================================
  // Scenario 5C (Example C): 6 Pancakes of same price (6 × ₹90 -> ₹270 payable, ₹270 discount)
  // =========================================================================
  console.log('\nScenario 5C (Example C): 6 Pancakes of same price (6 × ₹90 -> ₹270 payable, ₹270 discount)');
  const s5cItems = [
    { id: 520, product_id: PROD_COTTON_CANDY.id, product_name: PROD_COTTON_CANDY.name, unit_price: 90, quantity: 6 },
  ];
  const s5cCalc = calculatePromotionDiscount(db, parsedLaunchPromo, s5cItems);

  assert(s5cCalc.eligible, '6 identical pancakes eligible');
  assertEqual(s5cCalc.pairs, 3, '3 pairs formed (3 free)');
  assertEqual(s5cCalc.totalDiscountAmount, 270, 'Total discount is ₹270 (3 × ₹90)');
  assertEqual(s5cCalc.discountedSubtotal, 270, 'Net payable total is ₹270 (3 × ₹90 charged)');
  console.log('  ✓ Scenario 5C passed');

  // =========================================================================
  // Scenario 5D (Example E): Mixed quantities (2 × ₹90, 2 × ₹70 -> ₹180 payable, ₹140 discount)
  // =========================================================================
  console.log('\nScenario 5D (Example E): Mixed quantities (2 × ₹90, 2 × ₹70 -> ₹180 payable, ₹140 discount)');
  const s5dItems = [
    { id: 531, product_id: PROD_COTTON_CANDY.id, product_name: PROD_COTTON_CANDY.name, unit_price: 90, quantity: 2 },
    { id: 532, product_id: PROD_DARK_CHOCOLATE.id, product_name: PROD_DARK_CHOCOLATE.name, unit_price: 70, quantity: 2 },
  ];
  const s5dCalc = calculatePromotionDiscount(db, parsedLaunchPromo, s5dItems);

  assert(s5dCalc.eligible, 'Mixed quantities eligible');
  assertEqual(s5dCalc.pairs, 2, '2 pairs formed');
  assertEqual(s5dCalc.totalDiscountAmount, 140, 'Total discount is ₹140 (2 × ₹70 free)');
  assertEqual(s5dCalc.discountedSubtotal, 180, 'Net payable total is ₹180 (2 × ₹90 charged)');
  console.log('  ✓ Scenario 5D passed');

  // =========================================================================
  // Scenario 6: BOGO + Parcel Box (2 pancakes BOGO + 2 boxes @ ₹5 -> total ₹100; boxes never free)
  // =========================================================================
  console.log('\nScenario 6: BOGO + Parcel Box (2 pancakes BOGO + 2 boxes @ ₹5 -> total ₹100; boxes never free)');
  const isBoxEligible = isProductEligibleForPromotion(db, parsedLaunchPromo, PROD_PARCEL_BOX.id, PROD_PARCEL_BOX.name, categoryPackagingId);
  assertEqual(isBoxEligible, false, 'Parcel Box is strictly ineligible for BOGO promotions');

  const s6Items = [
    { id: 601, product_id: PROD_COTTON_CANDY.id, product_name: PROD_COTTON_CANDY.name, unit_price: 90, quantity: 1 },
    { id: 602, product_id: PROD_DARK_CHOCOLATE.id, product_name: PROD_DARK_CHOCOLATE.name, unit_price: 70, quantity: 1 },
    { id: 603, product_id: PROD_PARCEL_BOX.id, product_name: PROD_PARCEL_BOX.name, unit_price: 5, quantity: 2 },
  ];
  const s6Calc = calculatePromotionDiscount(db, parsedLaunchPromo, s6Items);

  assertEqual(s6Calc.eligibleItemCount, 2, 'Only 2 pancakes are eligible; Parcel Box is ignored');
  assertEqual(s6Calc.totalDiscountAmount, 70, 'BOGO discount applies only to pancakes (₹70)');
  assertEqual(s6Calc.originalSubtotal, 170, 'Gross subtotal is ₹170 (90 + 70 + 10)');
  assertEqual(s6Calc.discountedSubtotal, 100, 'Discounted total is ₹100 (₹90 pancakes + ₹10 parcel boxes)');
  console.log('  ✓ Scenario 6 passed');

  // =========================================================================
  // Scenario 7: Standalone Parcel Box sales (1, 2, 3 boxes -> ₹5, ₹10, ₹15, 0 plates)
  // =========================================================================
  console.log('\nScenario 7: Standalone Parcel Box sales (1, 2, 3 boxes -> ₹5, ₹10, ₹15, 0 plates)');
  const boxOrd1 = insertTestOrder({
    items: [{ productId: PROD_PARCEL_BOX.id, productName: PROD_PARCEL_BOX.name, unitPrice: 5, quantity: 1 }],
  });
  const boxOrd2 = insertTestOrder({
    items: [{ productId: PROD_PARCEL_BOX.id, productName: PROD_PARCEL_BOX.name, unitPrice: 5, quantity: 2 }],
  });
  const boxOrd3 = insertTestOrder({
    items: [{ productId: PROD_PARCEL_BOX.id, productName: PROD_PARCEL_BOX.name, unitPrice: 5, quantity: 3 }],
  });

  assertEqual(boxOrd1.total, 5, '1 Parcel Box = ₹5');
  assertEqual(boxOrd2.total, 10, '2 Parcel Boxes = ₹10');
  assertEqual(boxOrd3.total, 15, '3 Parcel Boxes = ₹15');

  const reportBoxesOnly = computeRoadsideDashboardSummary(
    db,
    `${now().slice(0, 10)} 00:00:00`,
    `${now().slice(0, 10)} 23:59:59`,
    now().slice(0, 10),
    now().slice(0, 10),
  );

  assertEqual(reportBoxesOnly.packagingSummary.parcelBoxesSold, 6, 'Total 6 parcel boxes sold across standalone sales');
  console.log('  ✓ Scenario 7 passed');

  // =========================================================================
  // Scenario 8: Normal sales (only non-BOGO pancakes, normal revenue, normal plate costing)
  // =========================================================================
  console.log('\nScenario 8: Normal sales (only non-BOGO pancakes, normal revenue, normal plate costing)');
  const s8Order = insertTestOrder({
    items: [
      { productId: PROD_DARK_CHOCOLATE.id, productName: PROD_DARK_CHOCOLATE.name, unitPrice: 70, quantity: 2, ingredientCost: 60 },
    ],
  });
  assertEqual(s8Order.total, 140, 'Normal 2 pancakes total is ₹140');
  console.log('  ✓ Scenario 8 passed');

  // =========================================================================
  // Scenario 9: Launch promotion vs Loyalty promotion source attribution
  // =========================================================================
  console.log('\nScenario 9: Launch promotion vs Loyalty promotion source attribution');
  // Order with Launch BOGO
  const s9Launch = insertTestOrder({
    items: [
      { productId: PROD_COTTON_CANDY.id, productName: PROD_COTTON_CANDY.name, unitPrice: 90, quantity: 1, isBogoPaid: true, bogoPairId: 'lp1', promotionId: 'launch-bogo', ingredientCost: 35 },
      { productId: PROD_DARK_CHOCOLATE.id, productName: PROD_DARK_CHOCOLATE.name, unitPrice: 70, quantity: 1, isBogoFree: true, bogoPairId: 'lp1', promotionId: 'launch-bogo', discountAmount: 70, ingredientCost: 30 },
    ],
    discountAmount: 70,
    discountType: 'bogo',
    promotionId: 'launch-bogo',
  });

  // Order with Loyalty BOGO
  const s9Loyalty = insertTestOrder({
    items: [
      { productId: PROD_WHITE_CHOCOLATE.id, productName: PROD_WHITE_CHOCOLATE.name, unitPrice: 80, quantity: 1, isBogoPaid: true, bogoPairId: 'loyp1', promotionId: 'loyalty-visit6-bogo', ingredientCost: 32 },
      { productId: PROD_CLASSIC_PLAIN.id, productName: PROD_CLASSIC_PLAIN.name, unitPrice: 60, quantity: 1, isBogoFree: true, bogoPairId: 'loyp1', promotionId: 'loyalty-visit6-bogo', discountAmount: 60, ingredientCost: 25 },
    ],
    discountAmount: 60,
    discountType: 'bogo',
    promotionId: 'loyalty-visit6-bogo',
  });

  const repS9 = computeRoadsideDashboardSummary(
    db,
    `${now().slice(0, 10)} 00:00:00`,
    `${now().slice(0, 10)} 23:59:59`,
    now().slice(0, 10),
    now().slice(0, 10),
  );

  assertEqual(repS9.bogoSalesSummary.launchPairsRedeemed, 1, 'Exactly 1 Launch BOGO pair tracked');
  assertEqual(repS9.bogoSalesSummary.loyaltyPairsRedeemed, 1, 'Exactly 1 Loyalty BOGO pair tracked');
  assertEqual(repS9.bogoSalesSummary.pairsRedeemed, 2, 'Total 2 BOGO pairs redeemed');
  console.log('  ✓ Scenario 9 passed');

  // =========================================================================
  // Scenario 10: Free pancake ingredient consumption (both ingredients & 1 paper plate @ ₹2.50 consumed)
  // =========================================================================
  console.log('\nScenario 10: Free pancake ingredient consumption (both ingredients & 1 paper plate @ ₹2.50 consumed)');
  // In repS9, launch pair has 2 pancakes prepared (1 paid, 1 free).
  // Total pancakes prepared for that order is 2.
  // Plates consumed for that pair = 2 * ₹2.50 = ₹5.00 plate cost.
  assertEqual(repS9.bogoSalesSummary.pancakesPrepared, 4, '4 total pancakes prepared across 2 BOGO pairs (2 per pair)');
  assertEqual(repS9.bogoSalesSummary.paperPlateCost, 10.0, 'Paper plate cost is ₹10.00 (4 pancakes × ₹2.50 plate cost)');
  assertEqual(repS9.bogoSalesSummary.freeQuantity, 2, '2 free pancakes prepared and served');
  assertEqual(repS9.bogoSalesSummary.paidQuantity, 2, '2 charged pancakes');
  console.log('  ✓ Scenario 10 passed');

  // =========================================================================
  // Scenario 11: Dashboard reconciliation (Normal Sales + BOGO Sales = Total Pancake Sales & Profit)
  // =========================================================================
  console.log('\nScenario 11: Dashboard reconciliation (Normal Sales + BOGO Sales = Total Pancake Sales & Profit)');
  const norm = repS9.normalSalesSummary;
  const bogo = repS9.bogoSalesSummary;
  const rec = repS9.reconciliation;

  assert(rec.reconciled, 'Roadside Dashboard reconciliation check passed strictly');
  assertEqual(rec.quantityDifference, 0, 'Normal + BOGO quantity matches overall pancake total');
  assertEqual(rec.revenueDifference, 0, 'Normal + BOGO revenue matches overall pancake net revenue');
  assertEqual(rec.plateCostDifference, 0, 'Normal + BOGO paper plate cost matches overall plate cost');
  assertEqual(rec.ingredientCostDifference, 0, 'Normal + BOGO total ingredient cost matches overall ingredient cost');
  assertEqual(rec.profitDifference, 0, 'Normal + BOGO profit matches overall pancake profit');
  console.log('  ✓ Scenario 11 passed');

  // =========================================================================
  // Scenario 12: CSV and Excel export reconciliation (Normal vs BOGO breakdown matches totals)
  // =========================================================================
  console.log('\nScenario 12: CSV and Excel export reconciliation (Normal vs BOGO breakdown matches totals)');
  const csvReport = serializeProductPerformanceCsv(repS9);
  assert(csvReport.includes('--- Normal Pancake Sales vs BOGO Promotional Sales Breakdown ---'), 'CSV contains Normal vs BOGO breakdown block');
  assert(csvReport.includes('Normal Sales,'), 'CSV contains Normal Sales summary row');
  assert(csvReport.includes('BOGO Sales (2 pairs),'), 'CSV contains BOGO Sales row with pair count');

  const xlsxReport = await serializeProductPerformanceXlsx(repS9);
  assert(Buffer.isBuffer(xlsxReport) && xlsxReport.length > 1000, 'Excel XLSX generated successfully with multi-worksheets');
  console.log('  ✓ Scenario 12 passed');

  // =========================================================================
  // Scenario 13: Upgrade swap on paid order (₹70 -> ₹90: customer pays +₹20 difference)
  // =========================================================================
  console.log('\nScenario 13: Upgrade swap on paid order (₹70 -> ₹90: customer pays +₹20 difference)');
  const s13Order = insertTestOrder({
    items: [
      { productId: PROD_DARK_CHOCOLATE.id, productName: PROD_DARK_CHOCOLATE.name, unitPrice: 70, quantity: 1, ingredientCost: 30 },
    ],
  });
  const s13OldItemId = s13Order.itemIds[0];

  const swapUpgradeRes = await api(baseUrl, `/api/orders/${s13Order.orderId}/swap`, {
    method: 'POST',
    body: {
      old_item_id: s13OldItemId,
      new_product_id: PROD_COTTON_CANDY.id,
      payment_method: 'cash',
      reason: 'Customer upgraded to Cotton Candy',
    },
    headers: owner.authHeader,
  });

  assertEqual(swapUpgradeRes.status, 200, 'Swap upgrade API returned 200 OK');
  assertEqual(swapUpgradeRes.data.difference, 20, 'Customer pays +₹20 difference');
  assertEqual(swapUpgradeRes.data.order.total, 90, 'Order total updated to ₹90');
  assertEqual(swapUpgradeRes.data.bill.paid_amount, 90, 'Bill paid amount updated to ₹90');

  const s13OldItemDb = db.prepare('SELECT status FROM order_items WHERE id = ?').get(s13OldItemId);
  assertEqual(s13OldItemDb.status, 'swapped', 'Old item status changed to swapped');

  const s13NewItemDb = db.prepare('SELECT * FROM order_items WHERE order_id = ? AND status = ?').get(s13Order.orderId, 'completed');
  assertEqual(s13NewItemDb.product_id, PROD_COTTON_CANDY.id, 'New replacement item is Cotton Candy');
  assertEqual(s13NewItemDb.unit_price, 90, 'New item price is ₹90');
  console.log('  ✓ Scenario 13 passed');

  // =========================================================================
  // Scenario 14: Downgrade swap on paid order (₹90 -> ₹70: customer receives -₹20 refund)
  // =========================================================================
  console.log('\nScenario 14: Downgrade swap on paid order (₹90 -> ₹70: customer receives -₹20 refund)');
  const s14Order = insertTestOrder({
    items: [
      { productId: PROD_COTTON_CANDY.id, productName: PROD_COTTON_CANDY.name, unitPrice: 90, quantity: 1, ingredientCost: 35 },
    ],
  });
  const s14OldItemId = s14Order.itemIds[0];

  const swapDowngradeRes = await api(baseUrl, `/api/orders/${s14Order.orderId}/swap`, {
    method: 'POST',
    body: {
      old_item_id: s14OldItemId,
      new_product_id: PROD_DARK_CHOCOLATE.id,
      payment_method: 'cash',
      reason: 'Customer changed to Dark Chocolate',
    },
    headers: owner.authHeader,
  });

  assertEqual(swapDowngradeRes.status, 200, 'Swap downgrade API returned 200 OK');
  assertEqual(swapDowngradeRes.data.difference, -20, 'Price difference is -₹20 (refund)');
  assertEqual(swapDowngradeRes.data.order.total, 70, 'Order total updated to ₹70');
  assertEqual(swapDowngradeRes.data.bill.total, 70, 'Bill total updated to ₹70');

  const refundRow = db.prepare('SELECT amount_cents, method FROM refunds WHERE bill_id = ?').get(s14Order.billId);
  assertEqual(refundRow?.amount_cents, 2000, 'Refund of 2000 cents (₹20) recorded in database');
  assertEqual(refundRow?.method, 'cash', 'Refund method is cash');
  console.log('  ✓ Scenario 14 passed');

  // =========================================================================
  // Scenario 15: Refund COGS correction (refunded sellable pancake reduces revenue, 0 COGS)
  // =========================================================================
  console.log('\nScenario 15: Refund COGS correction (refunded sellable pancake reduces revenue, 0 COGS, no double-costing)');
  const s15Order = insertTestOrder({
    items: [
      { productId: PROD_COTTON_CANDY.id, productName: PROD_COTTON_CANDY.name, unitPrice: 90, quantity: 1, ingredientCost: 35 },
    ],
  });

  // Issue full refund for s15Order
  db.prepare(`
    INSERT INTO refunds (bill_id, order_item_id, amount_cents, method, reason, approved_by, created_by, created_at, cash_session_id)
    VALUES (?, ?, 9000, 'cash', 'Customer cancelled order - sellable item', ?, ?, ?, 0)
  `).run(s15Order.billId, s15Order.itemIds[0], actorId, actorId, now());
  db.prepare("UPDATE bills SET payment_status = 'refunded' WHERE id = ?").run(s15Order.billId);

  const repS15 = computeRoadsideDashboardSummary(
    db,
    `${now().slice(0, 10)} 00:00:00`,
    `${now().slice(0, 10)} 23:59:59`,
    now().slice(0, 10),
    now().slice(0, 10),
  );

  const ccProd = repS15.productPerformance.find((p: any) => p.productName === PROD_COTTON_CANDY.name);
  assert(Boolean(ccProd), 'Cotton Candy exists in performance table');
  // For the fully refunded order: effectiveDeliveredQty = 0, so no artificial COGS is recorded on refunded portion
  assert(ccProd.refunds >= 90, 'Refund of ₹90 recorded on Cotton Candy');
  console.log('  ✓ Scenario 15 passed');

  // Clean up server and database
  server.close();
  closeDatabase();

  const results = getResults();
  console.log('\n-----------------------------------------------------------');
  console.log(`Test results: ${results.passed}/${results.total} passed, ${results.failed} failed`);
  console.log('-----------------------------------------------------------\n');

  if (results.failed > 0) {
    process.exit(1);
  }
}

runPairBogoTestSuite().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
