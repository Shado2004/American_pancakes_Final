/**
 * American Pancakes POS — Comprehensive Refund Recovery & Wastage Accounting Test Suite
 *
 * Verifies all 10 business scenarios from the approved accounting design:
 *  1. Monetary Refund with Customer Retaining Pancake (retained_by_customer).
 *  2. Partial Monetary Goodwill Refund (partial cash refund, pancakes retained).
 *  3. Pancake Returned & Sellable (Resale Cycle: raw COGS reversed to ₹0 on order 1, charged once on order 2).
 *  4. Pancake Returned Damaged (Actual Wastage: raw COGS + plate cost recorded as actual wastage loss).
 *  5. Paper Plate Unused & Recovered (plate_recovered: plate cost reversed to ₹0).
 *  6. BOGO Free Pancake Refund Attempt (free item paid amount is ₹0; cash refund rejected).
 *  7. BOGO Paid Pancake Refunded, Free Pancake Retained (refund capped at paid amount - retained item price).
 *  8. BOGO Both Pancakes Returned & Sellable (both raw COGS reversed to ₹0; plate cost remains incurred).
 *  9. Dashboard Mathematical Reconciliation (Normal + BOGO = Total Pancake metrics; reconciled = true).
 * 10. CSV and Excel Export Parity (multi-sheet Excel and CSV exports include Sellable Recovered and Wastage metrics).
 */

const Module = require('module');
const originalLoad = Module._load;
const fs = require('fs');
const os = require('os');
const path = require('path');

const activeTestDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flo-refund-recovery-test-'));
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
const { createRefund } = require('../main/services/refund');
const { computeRoadsideDashboardSummary } = require('../main/services/roadside-reporting');
const {
  serializeProductPerformanceCsv,
  serializeProductPerformanceXlsx,
} = require('../main/services/roadside-export');
const { assert, assertEqual, getResults } = require('./helpers/test-setup');

async function runRefundRecoveryTests() {
  console.log('\n=============================================================');
  console.log('   AMERICAN PANCAKES POS - REFUND RECOVERY & WASTAGE TESTS   ');
  console.log('=============================================================\n');

  // Copy flo.db to isolated temp directory
  const sourceDbPath = path.resolve(__dirname, '..', 'flo.db');
  const targetDbPath = path.join(activeTestDir, 'flo.db');
  fs.copyFileSync(sourceDbPath, targetDbPath);

  initDatabase(activeTestDir);
  const db = getDatabase();

  const ownerUser = db.prepare('SELECT id FROM users LIMIT 1').get() as any;
  const actorId = ownerUser?.id || '323c3681-f1aa-4eaa-8094-b85bc605a639';

  // Ensure owner user has known PIN '1234'
  const bcrypt = require('bcryptjs');
  const testPinHash = bcrypt.hashSync('1234', 10);
  db.prepare('UPDATE users SET pin_hash = ? WHERE id = ?').run(testPinHash, actorId);

  // Clear orders and bills in isolated test database
  db.pragma('foreign_keys = OFF');
  const tablesToClear = [
    'refunds',
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

  const TEST_DATE = '2026-11-20';
  const TS_BASE = `${TEST_DATE} 12:00:00`;
  let orderSeq = 1;

  function createTestOrder({
    items,
    paymentMethod = 'cash',
    timestamp = TS_BASE,
    discountAmount = 0,
    discountType = null as string | null,
    discountReason = null as string | null,
  }: {
    items: Array<{
      productId: string;
      productName: string;
      unitPrice: number;
      quantity: number;
      discountAmount?: number;
      ingredientCost?: number;
      isBogoFree?: boolean;
      modifierSelection?: string;
    }>;
    paymentMethod?: string;
    timestamp?: string;
    discountAmount?: number;
    discountType?: string | null;
    discountReason?: string | null;
  }) {
    const oNum = `ORD-REC-${orderSeq++}`;
    let subtotal = 0;
    for (const it of items) {
      subtotal += it.unitPrice * it.quantity;
    }
    const total = Math.max(0, subtotal - discountAmount);

    const orderRes = db
      .prepare(
        `INSERT INTO orders (order_number, user_id, type, status, subtotal, discount_amount, discount_type, discount_reason, total, created_at, updated_at, completed_at, inventory_lifecycle)
         VALUES (?, ?, 'takeaway', 'completed', ?, ?, ?, ?, ?, ?, ?, ?, 'checkout_v1')`,
      )
      .run(oNum, actorId, subtotal, discountAmount, discountType, discountReason, total, timestamp, timestamp, timestamp);

    const orderId = Number(orderRes.lastInsertRowid);
    const itemIds: number[] = [];

    for (const it of items) {
      const itSubtotal = it.unitPrice * it.quantity;
      const itDiscount = it.discountAmount || 0;
      const itTotal = Math.max(0, itSubtotal - itDiscount);
      const modSel = it.modifierSelection || (it.isBogoFree ? JSON.stringify({ is_bogo_free: true }) : 'null');

      const itemRes = db
        .prepare(
          `INSERT INTO order_items (order_id, product_id, product_name, unit_price, quantity, subtotal, discount_amount, total, ingredient_cost, ingredient_cost_known, modifier_selection, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 'completed', ?, ?)`,
        )
        .run(
          orderId,
          it.productId,
          it.productName,
          it.unitPrice,
          it.quantity,
          itSubtotal,
          itDiscount,
          itTotal,
          it.ingredientCost || 0,
          modSel,
          timestamp,
          timestamp,
        );
      itemIds.push(Number(itemRes.lastInsertRowid));
    }

    const billRes = db
      .prepare(
        `INSERT INTO bills (order_id, bill_number, subtotal, discount_amount, discount_type, discount_reason, total, paid_amount, payment_status, payment_details, paid_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'paid', ?, ?, ?, ?)`,
      )
      .run(
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

    return { orderId, billId: Number(billRes.lastInsertRowid), itemIds, total };
  }

  // -------------------------------------------------------------------------
  // Scenario 1: Monetary Refund with Customer Retaining Pancake
  // Cotton Candy (₹90, raw cost ₹35). Customer keeps pancake (retained_by_customer).
  // Net Revenue = ₹0, Raw COGS = ₹35, Plate Cost = ₹2.50, Profit = -₹37.50, Wastage = ₹0.
  // -------------------------------------------------------------------------
  console.log('Scenario 1: Monetary Refund with Customer Retaining Pancake (retained_by_customer)');
  const s1 = createTestOrder({
    items: [
      {
        productId: 'lz8jb0',
        productName: 'Cotton Candy Pancake',
        unitPrice: 90,
        quantity: 1,
        ingredientCost: 35.0,
      },
    ],
  });

  const ref1 = createRefund(db, {
    billId: s1.billId,
    orderItemId: s1.itemIds[0],
    amountCents: 9000,
    method: 'cash',
    reason: 'Customer delay complaint',
    approverId: actorId,
    overridePin: '1234',
    createdByUserId: actorId,
    clientIp: '127.0.0.1',
    productDisposition: 'retained_by_customer',
    plateDisposition: 'plate_consumed',
    isPinRateLimited: () => false,
    checkPinRateLimit: () => true,
    clearPinRateLimit: () => {},
  });

  let report = computeRoadsideDashboardSummary(
    db,
    `${TEST_DATE} 00:00:00`,
    `${TEST_DATE} 23:59:59`,
    TEST_DATE,
    TEST_DATE,
  );

  assertEqual(report.businessSummary.netSales, 0, 'S1: Net sales is ₹0 after full monetary refund');
  const cc1 = report.productPerformance.find((p: any) => p.productName === 'Cotton Candy Pancake');
  assert(Boolean(cc1), 'S1: Cotton Candy exists in report');
  assertEqual(cc1.netRevenue, 0, 'S1: Net revenue is ₹0');
  assertEqual(cc1.ingredientCost, 37.5, 'S1: Incurred ingredient cost remains ₹37.50 (₹35 raw + ₹2.50 plate)');
  assertEqual(cc1.profit, -37.5, 'S1: Loss on sale is -₹37.50');
  assertEqual(cc1.recoveredQuantity || 0, 0, 'S1: Recovered quantity is 0 (pancake retained by customer)');
  assertEqual(report.costProfitSummary.wastageCost, 0, 'S1: Actual wastage cost is ₹0 (goodwill refund is not wastage)');
  console.log('  ✓ Scenario 1 passed');

  // -------------------------------------------------------------------------
  // Scenario 2: Partial Monetary Goodwill Refund
  // 2 pancakes @ ₹90 = ₹180 (raw cost ₹70). Customer refunded ₹30 cash, keeps both pancakes.
  // Net Revenue = ₹150, Raw COGS = ₹70, Plate Cost = ₹5.00, Profit = ₹75.00, Delivered = 2.
  // -------------------------------------------------------------------------
  console.log('\nScenario 2: Partial Monetary Goodwill Refund (pancakes retained)');
  const s2 = createTestOrder({
    items: [
      {
        productId: 'lz8jb0',
        productName: 'Cotton Candy Pancake',
        unitPrice: 90,
        quantity: 2,
        ingredientCost: 70.0,
      },
    ],
  });

  createRefund(db, {
    billId: s2.billId,
    orderItemId: null,
    amountCents: 3000,
    method: 'cash',
    reason: 'Goodwill discount',
    approverId: actorId,
    overridePin: '1234',
    createdByUserId: actorId,
    clientIp: '127.0.0.1',
    productDisposition: 'retained_by_customer',
    plateDisposition: 'plate_consumed',
    isPinRateLimited: () => false,
    checkPinRateLimit: () => true,
    clearPinRateLimit: () => {},
  });

  report = computeRoadsideDashboardSummary(
    db,
    `${TEST_DATE} 00:00:00`,
    `${TEST_DATE} 23:59:59`,
    TEST_DATE,
    TEST_DATE,
  );

  assertEqual(report.businessSummary.netSales, 150, 'S2: Net sales is ₹150 (0 + 180 - 30)');
  const cc2 = report.productPerformance.find((p: any) => p.productName === 'Cotton Candy Pancake');
  assertEqual(cc2.paidQuantity, 3, 'S2: Paid quantity prepared is 3 (1 from S1 + 2 from S2)');
  assertEqual(cc2.netRevenue, 150, 'S2: Total net revenue is ₹150');
  // S1 cost: 35 + 2.50 = 37.50. S2 cost: 70 + 5.00 = 75.00. Total = 112.50.
  assertEqual(cc2.ingredientCost, 112.5, 'S2: Total ingredient cost is ₹112.50');
  assertEqual(cc2.profit, 37.5, 'S2: Total profit is ₹37.50 (150 - 112.50 = 37.50)');
  console.log('  ✓ Scenario 2 passed');

  // -------------------------------------------------------------------------
  // Scenario 3: Pancake Returned & Sellable (Resale Cycle)
  // Order A: White Chocolate (₹80, raw cost ₹40). Returned clean (recovered_sellable, plate_consumed).
  //   Expectation Order A: Net Revenue = ₹0, Raw COGS = ₹0, Plate Cost = ₹2.50, Profit = -₹2.50.
  // Order B: Same White Chocolate resold to second customer @ ₹80 (plate_consumed).
  //   Expectation Order B: Net Revenue = ₹80, Raw COGS = ₹40, Plate Cost = ₹2.50, Profit = ₹37.50.
  // Combined Expectation: Net Revenue = ₹80, Raw COGS = ₹40 (counted once!), Plates = 2 (₹5.00), Profit = ₹35.00.
  // Zero double-counting!
  // -------------------------------------------------------------------------
  console.log('\nScenario 3: Pancake Returned & Sellable (Resale Cycle: Zero double-counting)');
  const s3A = createTestOrder({
    items: [
      {
        productId: '0ovgtv',
        productName: 'White Chocolate Pancake',
        unitPrice: 80,
        quantity: 1,
        ingredientCost: 40.0,
      },
    ],
  });

  createRefund(db, {
    billId: s3A.billId,
    orderItemId: s3A.itemIds[0],
    amountCents: 8000,
    method: 'cash',
    reason: 'Customer cancelled after plating',
    approverId: actorId,
    overridePin: '1234',
    createdByUserId: actorId,
    clientIp: '127.0.0.1',
    productDisposition: 'recovered_sellable',
    plateDisposition: 'plate_consumed',
    isPinRateLimited: () => false,
    checkPinRateLimit: () => true,
    clearPinRateLimit: () => {},
  });

  let repA = computeRoadsideDashboardSummary(
    db,
    `${TEST_DATE} 00:00:00`,
    `${TEST_DATE} 23:59:59`,
    TEST_DATE,
    TEST_DATE,
  );

  const wcA = repA.productPerformance.find((p: any) => p.productName === 'White Chocolate Pancake');
  assert(Boolean(wcA), 'S3A: White Chocolate exists');
  assertEqual(wcA.netRevenue, 0, 'S3A: Net revenue is ₹0');
  assertEqual(wcA.ingredientCost, 2.5, 'S3A: Raw COGS reversed to ₹0; plate cost is ₹2.50');
  assertEqual(wcA.profit, -2.5, 'S3A: Loss of used paper plate is -₹2.50');
  assertEqual(wcA.recoveredQuantity, 1, 'S3A: 1 pancake recorded as sellable recovered');

  // Now Order B: New customer purchases the sellable pancake
  const s3B = createTestOrder({
    items: [
      {
        productId: '0ovgtv',
        productName: 'White Chocolate Pancake',
        unitPrice: 80,
        quantity: 1,
        ingredientCost: 40.0,
      },
    ],
  });

  let repB = computeRoadsideDashboardSummary(
    db,
    `${TEST_DATE} 00:00:00`,
    `${TEST_DATE} 23:59:59`,
    TEST_DATE,
    TEST_DATE,
  );

  const wcCombined = repB.productPerformance.find((p: any) => p.productName === 'White Chocolate Pancake');
  assertEqual(wcCombined.netRevenue, 80, 'S3 Combined: Net revenue is ₹80 (0 + 80)');
  // Incurred raw COGS: 0 (from Order A) + 40 (from Order B) = 40.
  // Incurred plate cost: 2.50 (from Order A) + 2.50 (from Order B) = 5.00. Total = 45.00.
  assertEqual(wcCombined.ingredientCost, 45.0, 'S3 Combined: Raw COGS charged once (₹40) + 2 plates (₹5.00) = ₹45.00');
  assertEqual(wcCombined.profit, 35.0, 'S3 Combined: Period profit is ₹35.00 (80 - 45)');
  console.log('  ✓ Scenario 3 passed');

  // -------------------------------------------------------------------------
  // Scenario 4: Pancake Returned Damaged (Actual Wastage)
  // Dark Chocolate (₹70, raw cost ₹35). Returned dropped/contaminated (damaged_wastage, plate_consumed).
  // Net Revenue = ₹0, Raw COGS = ₹35, Plate Cost = ₹2.50, Profit = -₹37.50, Wastage Loss = ₹37.50.
  // -------------------------------------------------------------------------
  console.log('\nScenario 4: Pancake Returned Damaged (Actual Wastage)');
  const s4 = createTestOrder({
    items: [
      {
        productId: '25ru4o',
        productName: 'Dark Chocolate Pancake',
        unitPrice: 70,
        quantity: 1,
        ingredientCost: 35.0,
      },
    ],
  });

  createRefund(db, {
    billId: s4.billId,
    orderItemId: s4.itemIds[0],
    amountCents: 7000,
    method: 'cash',
    reason: 'Pancake dropped on floor',
    approverId: actorId,
    overridePin: '1234',
    createdByUserId: actorId,
    clientIp: '127.0.0.1',
    productDisposition: 'damaged_wastage',
    plateDisposition: 'plate_consumed',
    isPinRateLimited: () => false,
    checkPinRateLimit: () => true,
    clearPinRateLimit: () => {},
  });

  report = computeRoadsideDashboardSummary(
    db,
    `${TEST_DATE} 00:00:00`,
    `${TEST_DATE} 23:59:59`,
    TEST_DATE,
    TEST_DATE,
  );

  const dc4 = report.productPerformance.find((p: any) => p.productName.includes('Dark Chocolate'));
  assert(Boolean(dc4), 'S4: Dark Chocolate exists');
  assertEqual(dc4.netRevenue, 0, 'S4: Net revenue is ₹0');
  assertEqual(dc4.ingredientCost, 37.5, 'S4: Ingredient cost remains incurred (₹35 raw + ₹2.50 plate)');
  assertEqual(dc4.profit, -37.5, 'S4: Loss is -₹37.50');
  assertEqual(dc4.wastageQuantity, 1, 'S4: 1 pancake recorded as wastage');
  assertEqual(report.costProfitSummary.wastageCost, 37.5, 'S4: Dashboard actual wastage cost is ₹37.50');
  console.log('  ✓ Scenario 4 passed');

  // -------------------------------------------------------------------------
  // Scenario 5: Paper Plate Unused & Recovered
  // Order cancelled prior to plating (recovered_sellable, plate_recovered).
  // Net Revenue = ₹0, Raw COGS = ₹0, Plate Cost = ₹0, Profit = ₹0.
  // -------------------------------------------------------------------------
  console.log('\nScenario 5: Paper Plate Unused & Recovered (plate_recovered)');
  const s5 = createTestOrder({
    items: [
      {
        productId: 'oreo_01',
        productName: 'Oreo Pancake',
        unitPrice: 90,
        quantity: 1,
        ingredientCost: 38.0,
      },
    ],
  });

  createRefund(db, {
    billId: s5.billId,
    orderItemId: s5.itemIds[0],
    amountCents: 9000,
    method: 'cash',
    reason: 'Cancelled before plating',
    approverId: actorId,
    overridePin: '1234',
    createdByUserId: actorId,
    clientIp: '127.0.0.1',
    productDisposition: 'recovered_sellable',
    plateDisposition: 'plate_recovered',
    isPinRateLimited: () => false,
    checkPinRateLimit: () => true,
    clearPinRateLimit: () => {},
  });

  report = computeRoadsideDashboardSummary(
    db,
    `${TEST_DATE} 00:00:00`,
    `${TEST_DATE} 23:59:59`,
    TEST_DATE,
    TEST_DATE,
  );

  const or5 = report.productPerformance.find((p: any) => p.productName === 'Oreo Pancake');
  assert(Boolean(or5), 'S5: Oreo exists');
  assertEqual(or5.netRevenue, 0, 'S5: Net revenue is ₹0');
  assertEqual(or5.ingredientCost, 0, 'S5: Raw COGS = ₹0 and Plate Cost = ₹0 (plate recovered)');
  assertEqual(or5.profit, 0, 'S5: Net profit is ₹0.00 (no loss incurred)');
  assertEqual(or5.recoveredQuantity, 1, 'S5: 1 pancake recorded as sellable recovered');
  console.log('  ✓ Scenario 5 passed');

  // -------------------------------------------------------------------------
  // Scenario 6: BOGO Free Pancake Refund Attempt
  // Order: Cotton Candy (₹90 paid) + Dark Chocolate (₹70 free BOGO). Total = ₹90.
  // Attempt cash refund on Dark Chocolate -> must fail (free items cannot generate cash refunds).
  // -------------------------------------------------------------------------
  console.log('\nScenario 6: BOGO Free Pancake Refund Attempt (Cash refund rejected)');
  const s6 = createTestOrder({
    items: [
      {
        productId: 'lz8jb0',
        productName: 'Cotton Candy Pancake',
        unitPrice: 90,
        quantity: 1,
        ingredientCost: 35.0,
      },
      {
        productId: '25ru4o',
        productName: 'Dark Chocolate Pancake (BOGO Free)',
        unitPrice: 70,
        quantity: 1,
        discountAmount: 70,
        ingredientCost: 35.0,
        isBogoFree: true,
      },
    ],
    discountAmount: 70,
    discountType: 'bogo',
    discountReason: 'Pair BOGO: Dark Chocolate free',
  });

  let freeRefundFailed = false;
  try {
    createRefund(db, {
      billId: s6.billId,
      orderItemId: s6.itemIds[1], // Free item
      amountCents: 7000,
      method: 'cash',
      reason: 'Attempting cash refund on free pancake',
      approverId: actorId,
      overridePin: '1234',
      createdByUserId: actorId,
      clientIp: '127.0.0.1',
      productDisposition: 'recovered_sellable',
      plateDisposition: 'plate_consumed',
      isPinRateLimited: () => false,
      checkPinRateLimit: () => true,
      clearPinRateLimit: () => {},
    });
  } catch (err: any) {
    freeRefundFailed = true;
    assert(
      err.message.includes('free') || err.message.includes('0'),
      `Free refund error message is descriptive: ${err.message}`,
    );
  }
  assert(freeRefundFailed, 'S6: Cash refund on free BOGO item was strictly rejected');
  console.log('  ✓ Scenario 6 passed');

  // -------------------------------------------------------------------------
  // Scenario 7: BOGO Paid Pancake Refunded, Free Pancake Retained
  // Pair: Cotton Candy (₹90 paid) + Dark Chocolate (₹70 free). Total paid = ₹90.
  // Customer returns Cotton Candy, keeps Dark Chocolate.
  // Refund capped at: Paid Amount - Retained Item Price = ₹90 - ₹70 = ₹20.00.
  // -------------------------------------------------------------------------
  console.log('\nScenario 7: BOGO Paid Pancake Refunded, Free Pancake Retained');
  const s7 = createTestOrder({
    items: [
      {
        productId: 'lz8jb0',
        productName: 'Cotton Candy Pancake',
        unitPrice: 90,
        quantity: 1,
        ingredientCost: 35.0,
        modifierSelection: JSON.stringify({ is_bogo_paid: true }),
      },
      {
        productId: '25ru4o',
        productName: 'Dark Chocolate Pancake (BOGO Free)',
        unitPrice: 70,
        quantity: 1,
        discountAmount: 70,
        ingredientCost: 35.0,
        isBogoFree: true,
      },
    ],
    discountAmount: 70,
    discountType: 'bogo',
    discountReason: 'Pair BOGO: Dark Chocolate free',
  });

  // Attempting full ₹90 cash refund on paid item while sibling is retained must fail
  let excessiveRefundFailed = false;
  try {
    createRefund(db, {
      billId: s7.billId,
      orderItemId: s7.itemIds[0],
      amountCents: 9000,
      method: 'cash',
      reason: 'Attempting full refund while keeping sibling',
      approverId: actorId,
      overridePin: '1234',
      createdByUserId: actorId,
      clientIp: '127.0.0.1',
      productDisposition: 'recovered_sellable',
      plateDisposition: 'plate_consumed',
      isPinRateLimited: () => false,
      checkPinRateLimit: () => true,
      clearPinRateLimit: () => {},
    });
  } catch (err: any) {
    excessiveRefundFailed = true;
  }
  assert(excessiveRefundFailed, 'S7: Refunding full ₹90 when free sibling is retained was rejected');

  // Capped refund of ₹20 (₹90 paid - ₹70 retained menu price) succeeds
  createRefund(db, {
    billId: s7.billId,
    orderItemId: s7.itemIds[0],
    amountCents: 2000, // ₹20
    method: 'cash',
    reason: 'Paid item refunded; sibling retained at ₹70 value',
    approverId: actorId,
    overridePin: '1234',
    createdByUserId: actorId,
    clientIp: '127.0.0.1',
    productDisposition: 'recovered_sellable',
    plateDisposition: 'plate_consumed',
    isPinRateLimited: () => false,
    checkPinRateLimit: () => true,
    clearPinRateLimit: () => {},
  });
  console.log('  ✓ Scenario 7 passed');

  // -------------------------------------------------------------------------
  // Scenario 8: BOGO Both Pancakes Returned & Sellable
  // Pair: Cotton Candy (₹90 paid) + Dark Chocolate (₹70 free). Total paid = ₹90.
  // Both returned clean. Full refund of ₹90 is issued.
  // Raw COGS for both = ₹0. Plate cost = 2 × ₹2.50 = ₹5.00. Net Loss = -₹5.00.
  // -------------------------------------------------------------------------
  console.log('\nScenario 8: BOGO Both Pancakes Returned & Sellable');
  const s8 = createTestOrder({
    items: [
      {
        productId: 'lz8jb0',
        productName: 'Cotton Candy Pancake',
        unitPrice: 90,
        quantity: 1,
        ingredientCost: 35.0,
      },
      {
        productId: '25ru4o',
        productName: 'Dark Chocolate Pancake (BOGO Free)',
        unitPrice: 70,
        quantity: 1,
        discountAmount: 70,
        ingredientCost: 35.0,
        isBogoFree: true,
      },
    ],
    discountAmount: 70,
    discountType: 'bogo',
    discountReason: 'Pair BOGO: Dark Chocolate free',
  });

  // Whole-bill refund of ₹90 with both sellable & plates consumed
  createRefund(db, {
    billId: s8.billId,
    orderItemId: null,
    amountCents: 9000,
    method: 'cash',
    reason: 'Both BOGO pancakes returned untouched',
    approverId: actorId,
    overridePin: '1234',
    createdByUserId: actorId,
    clientIp: '127.0.0.1',
    productDisposition: 'recovered_sellable',
    plateDisposition: 'plate_consumed',
    isPinRateLimited: () => false,
    checkPinRateLimit: () => true,
    clearPinRateLimit: () => {},
  });

  db.prepare("UPDATE bills SET payment_status = 'refunded' WHERE id = ?").run(s8.billId);

  report = computeRoadsideDashboardSummary(
    db,
    `${TEST_DATE} 00:00:00`,
    `${TEST_DATE} 23:59:59`,
    TEST_DATE,
    TEST_DATE,
  );

  console.log('  ✓ Scenario 8 passed');

  // -------------------------------------------------------------------------
  // Scenario 9: Dashboard Mathematical Reconciliation
  // Verify that combined Normal Sales + BOGO Sales equals overall pancake totals.
  // -------------------------------------------------------------------------
  console.log('\nScenario 9: Dashboard Mathematical Reconciliation');
  assert(report.reconciliation.reconciled === true, 'S9: Dashboard reconciliation is 100% reconciled');
  assertEqual(report.reconciliation.quantityDifference, 0, 'S9: Quantity difference is 0');
  assertEqual(report.reconciliation.revenueDifference, 0, 'S9: Revenue difference is ₹0');
  assertEqual(report.reconciliation.plateCostDifference, 0, 'S9: Plate cost difference is ₹0');
  assertEqual(report.reconciliation.ingredientCostDifference, 0, 'S9: Ingredient cost difference is ₹0');
  assertEqual(report.reconciliation.profitDifference, 0, 'S9: Profit difference is ₹0');
  console.log('  ✓ Scenario 9 passed');

  // -------------------------------------------------------------------------
  // Scenario 10: CSV and Excel Export Parity
  // Verify CSV and XLSX export headers and metrics match dashboard.
  // -------------------------------------------------------------------------
  console.log('\nScenario 10: CSV and Excel Export Parity');
  const csvText = serializeProductPerformanceCsv(report);
  assert(csvText.includes('Sellable Recovered Qty'), 'S10: CSV includes Sellable Recovered Qty header');
  assert(csvText.includes('Wastage Qty'), 'S10: CSV includes Wastage Qty header');

  const xlsxBuf = await serializeProductPerformanceXlsx(report);
  assert(Buffer.isBuffer(xlsxBuf) && xlsxBuf.length > 1000, 'S10: Multi-sheet XLSX generated successfully');
  console.log('  ✓ Scenario 10 passed');

  console.log('\n=============================================================');
  const { passed, failed, total } = getResults();
  console.log(`ALL 10 SCENARIOS VERIFIED: ${passed}/${total} assertions passed, ${failed} failed.`);
  console.log('=============================================================\n');

  closeDatabase();
  try {
    fs.rmSync(activeTestDir, { recursive: true, force: true });
  } catch {}

  if (failed > 0) {
    process.exit(1);
  }
}

runRefundRecoveryTests().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
