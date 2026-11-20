/**
 * American Pancakes POS - Dashboard Simplification & Calculation Fixes Verification
 *
 * Verifies all 18 required scenarios:
 *  1. Normal paid pancake order.
 *  2. Multiple pancakes in one order.
 *  3. BOGO order with one paid and one free pancake.
 *  4. Parcel Box added manually to an order.
 *  5. Order without a Parcel Box.
 *  6. Paper Plate consumption at ₹2.50 each.
 *  7. Parcel Box selling price and actual inventory cost treated separately.
 *  8. Fully refunded order.
 *  9. Partially refunded order.
 * 10. Refund after ingredients have already been consumed.
 * 11. Cancelled order before preparation.
 * 12. Cash payment.
 * 13. UPI payment.
 * 14. Daily and monthly Dashboard totals.
 * 15. Product-wise quantities, revenue and contribution.
 * 16. Correct separation of pancake sales, parcel box sales and paper plate costs.
 * 17. No duplicate direct cost calculations.
 * 18. BOGO discount and free pancake quantities reported correctly.
 */

const Module = require('module');
const originalLoad = Module._load;
const fs = require('fs');
const os = require('os');
const path = require('path');

let activeTestDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flo-dashboard-roadside-test-'));
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
const { computeRoadsideDashboardSummary } = require('../main/services/roadside-reporting');
const {
  serializeProductPerformanceCsv,
  serializeProductPerformanceXlsx,
} = require('../main/services/roadside-export');
const { assert, assertEqual, getResults } = require('./helpers/test-setup');

async function runDashboardTests() {
  console.log('\n=============================================================');
  console.log('   AMERICAN PANCAKES POS - DASHBOARD & CALCULATION TESTS     ');
  console.log('=============================================================\n');

  // Copy flo.db to isolated temp directory - DO NOT touch source flo.db
  const sourceDbPath = path.resolve(__dirname, '..', 'flo.db');
  const targetDbPath = path.join(activeTestDir, 'flo.db');
  fs.copyFileSync(sourceDbPath, targetDbPath);

  initDatabase(activeTestDir);
  const db = getDatabase();

  const ownerUser = db.prepare('SELECT id FROM users LIMIT 1').get() as any;
  const actorId = ownerUser?.id || '323c3681-f1aa-4eaa-8094-b85bc605a639';

  // Clear existing orders in this isolated test database to start fresh for test assertions
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

  const TEST_DATE_DAY1 = '2026-11-20';
  const TEST_DATE_DAY2 = '2026-11-21';
  const TS_DAY1_10AM = `${TEST_DATE_DAY1} 10:00:00`;
  const TS_DAY1_11AM = `${TEST_DATE_DAY1} 11:00:00`;
  const TS_DAY1_12PM = `${TEST_DATE_DAY1} 12:00:00`;
  const TS_DAY1_01PM = `${TEST_DATE_DAY1} 13:00:00`;
  const TS_DAY1_02PM = `${TEST_DATE_DAY1} 14:00:00`;
  const TS_DAY1_03PM = `${TEST_DATE_DAY1} 15:00:00`;
  const TS_DAY2_10AM = `${TEST_DATE_DAY2} 10:00:00`;

  // Helper to insert test order + bill + items
  let orderSeq = 1;
  function createOrderWithBill({
    orderNumber,
    items,
    paymentMethod = 'cash',
    timestamp = TS_DAY1_10AM,
    status = 'completed',
    discountAmount = 0,
    discountType = null as string | null,
    discountReason = null as string | null,
  }: {
    orderNumber?: string;
    items: Array<{
      productId: string;
      productName: string;
      unitPrice: number;
      quantity: number;
      discountAmount?: number;
      ingredientCost?: number;
      isBogoFree?: boolean;
      noPackaging?: number;
    }>;
    paymentMethod?: string;
    timestamp?: string;
    status?: string;
    discountAmount?: number;
    discountType?: string | null;
    discountReason?: string | null;
  }) {
    const oNum = orderNumber || `ORD-TEST-${orderSeq++}`;
    let subtotal = 0;
    for (const it of items) {
      subtotal += it.unitPrice * it.quantity;
    }
    const total = Math.max(0, subtotal - discountAmount);

    const orderRes = db
      .prepare(
        `INSERT INTO orders (order_number, user_id, type, status, subtotal, discount_amount, discount_type, discount_reason, total, created_at, updated_at, completed_at, inventory_lifecycle)
         VALUES (?, ?, 'takeaway', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'checkout_v1')`,
      )
      .run(oNum, actorId, status, subtotal, discountAmount, discountType, discountReason, total, timestamp, timestamp, timestamp);

    const orderId = orderRes.lastInsertRowid;

    const insertedItemIds: number[] = [];
    for (const it of items) {
      const itSubtotal = it.unitPrice * it.quantity;
      const itDiscount = it.discountAmount || 0;
      const itTotal = Math.max(0, itSubtotal - itDiscount);
      const modSel = it.isBogoFree ? JSON.stringify({ is_bogo_free: true }) : 'null';

      const itemRes = db
        .prepare(
          `INSERT INTO order_items (order_id, product_id, product_name, unit_price, quantity, subtotal, discount_amount, total, ingredient_cost, ingredient_cost_known, modifier_selection, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 'active', ?, ?)`,
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
      insertedItemIds.push(Number(itemRes.lastInsertRowid));
    }

    if (status !== 'cancelled') {
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
      return { orderId: Number(orderId), billId: Number(billRes.lastInsertRowid), itemIds: insertedItemIds, total };
    }

    return { orderId: Number(orderId), billId: null, itemIds: insertedItemIds, total };
  }

  // -------------------------------------------------------------------------
  // Scenario 1: Normal paid pancake order (1 Dark Chocolate Pancake @ ₹70)
  // -------------------------------------------------------------------------
  console.log('Scenario 1: Normal paid pancake order (1 pancake @ ₹70)');
  const ord1 = createOrderWithBill({
    items: [
      {
        productId: '25ru4o',
        productName: 'Dark Chocolate Pancake',
        unitPrice: 70,
        quantity: 1,
        ingredientCost: 35.0,
      },
    ],
    paymentMethod: 'cash',
    timestamp: TS_DAY1_10AM,
  });

  let report = computeRoadsideDashboardSummary(
    db,
    `${TEST_DATE_DAY1} 00:00:00`,
    `${TEST_DATE_DAY1} 23:59:59`,
    TEST_DATE_DAY1,
    TEST_DATE_DAY1,
  );

  assertEqual(report.businessSummary.netSales, 70, 'Net sales is ₹70');
  assertEqual(report.businessSummary.totalPancakesPrepared, 1, 'Total pancakes prepared is 1');
  assertEqual(report.businessSummary.totalOrders, 1, 'Total orders is 1');
  assertEqual(report.packagingSummary.paperPlatesConsumed, 1, 'Paper plates consumed is 1');
  assertEqual(report.packagingSummary.paperPlateCost, 2.5, 'Paper plate cost is ₹2.50');
  assertEqual(report.costProfitSummary.ingredientCost, 37.5, 'Ingredient cost is ₹37.50 (includes ₹2.50 paper plate)');
  assertEqual(report.costProfitSummary.packagingCost, 0, 'Packaging cost is ₹0 (Parcel Box only)');
  assertEqual(report.costProfitSummary.totalDirectCost, 37.5, 'Total direct cost is ₹37.50 (35 + 2.50)');
  assertEqual(report.costProfitSummary.grossContribution, 32.5, 'Gross contribution is ₹32.50 (70 - 37.50)');
  console.log('  ✓ Scenario 1 passed');

  // -------------------------------------------------------------------------
  // Scenario 2: Multiple pancakes in one order (3 Oreo Pancakes @ ₹90 each)
  // -------------------------------------------------------------------------
  console.log('\nScenario 2: Multiple pancakes in one order (3 Oreo Pancakes @ ₹90 each = ₹270)');
  const ord2 = createOrderWithBill({
    items: [
      {
        productId: 'xdk0db',
        productName: 'Oreo Pancake',
        unitPrice: 90,
        quantity: 3,
        ingredientCost: 144.09,
      },
    ],
    paymentMethod: 'cash',
    timestamp: TS_DAY1_11AM,
  });

  report = computeRoadsideDashboardSummary(
    db,
    `${TEST_DATE_DAY1} 00:00:00`,
    `${TEST_DATE_DAY1} 23:59:59`,
    TEST_DATE_DAY1,
    TEST_DATE_DAY1,
  );

  assertEqual(report.businessSummary.netSales, 340, 'Net sales is ₹340 (70 + 270)');
  assertEqual(report.businessSummary.totalPancakesPrepared, 4, 'Total pancakes prepared is 4 (1 + 3)');
  assertEqual(report.packagingSummary.paperPlatesConsumed, 4, '4 paper plates consumed');
  assertEqual(report.packagingSummary.paperPlateCost, 10.0, 'Paper plate cost is ₹10.00 (4 × 2.50)');
  console.log('  ✓ Scenario 2 passed');

  // -------------------------------------------------------------------------
  // Scenario 3: BOGO order with one paid and one free pancake
  // (1 paid Oreo @ ₹90 + 1 free Oreo @ ₹90 with ₹90 discount, total ₹90)
  // -------------------------------------------------------------------------
  console.log('\nScenario 3: BOGO order with 1 paid and 1 free pancake');
  const ord3 = createOrderWithBill({
    discountAmount: 90,
    discountType: 'bogo',
    discountReason: 'Launch BOGO',
    items: [
      {
        productId: 'xdk0db',
        productName: 'Oreo Pancake',
        unitPrice: 90,
        quantity: 1,
        discountAmount: 0,
        ingredientCost: 48.03,
      },
      {
        productId: 'xdk0db',
        productName: 'Oreo Pancake (BOGO Free)',
        unitPrice: 90,
        quantity: 1,
        discountAmount: 90,
        ingredientCost: 48.03,
        isBogoFree: true,
      },
    ],
    paymentMethod: 'cash',
    timestamp: TS_DAY1_12PM,
  });

  report = computeRoadsideDashboardSummary(
    db,
    `${TEST_DATE_DAY1} 00:00:00`,
    `${TEST_DATE_DAY1} 23:59:59`,
    TEST_DATE_DAY1,
    TEST_DATE_DAY1,
  );

  assertEqual(report.businessSummary.netSales, 430, 'Net sales increased by ₹90 (340 + 90 = 430)');
  assertEqual(report.businessSummary.totalPancakesPrepared, 6, 'Total pancakes prepared is 6 (4 + 2 physical pancakes)');
  assertEqual(report.bogoSummary.totalFreePancakes, 1, 'Total free BOGO pancakes is 1');
  assertEqual(report.bogoSummary.totalBogoDiscounts, 90, 'Total BOGO discount is ₹90');
  console.log('  ✓ Scenario 3 passed');

  // -------------------------------------------------------------------------
  // Scenario 4: Parcel Box added manually to an order
  // (1 White Chocolate Pancake @ ₹80 + 1 Parcel Box @ ₹5, total ₹85)
  // -------------------------------------------------------------------------
  console.log('\nScenario 4: Parcel Box added manually to an order (1 pancake + 1 parcel box)');
  const ord4 = createOrderWithBill({
    items: [
      {
        productId: '0ovgtv',
        productName: 'White Chocolate Pancake',
        unitPrice: 80,
        quantity: 1,
        ingredientCost: 40.0,
      },
      {
        productId: 'pr_parcel_box_5',
        productName: 'Parcel Box',
        unitPrice: 5,
        quantity: 1,
        ingredientCost: 0,
        noPackaging: 1,
      },
    ],
    paymentMethod: 'cash',
    timestamp: TS_DAY1_01PM,
  });

  report = computeRoadsideDashboardSummary(
    db,
    `${TEST_DATE_DAY1} 00:00:00`,
    `${TEST_DATE_DAY1} 23:59:59`,
    TEST_DATE_DAY1,
    TEST_DATE_DAY1,
  );

  assertEqual(report.businessSummary.netSales, 515, 'Net sales is ₹515 (430 + 85)');
  assertEqual(report.businessSummary.totalPancakesPrepared, 7, 'Total pancakes prepared is 7 (Parcel Box is not a pancake)');
  assertEqual(report.packagingSummary.parcelBoxesSold, 1, 'Parcel boxes sold is 1');
  assertEqual(report.packagingSummary.parcelBoxRevenue, 5, 'Parcel box revenue is ₹5.00');
  assertEqual(report.packagingSummary.paperPlatesConsumed, 6, 'Paper plates consumed is 6 (Ord4 pancake boxed, consumes 0 plates)');
  assertEqual(report.packagingSummary.paperPlateCost, 15.0, 'Paper plate cost is ₹15.00 (6 × 2.50)');
  assertEqual(report.packagingSummary.parcelBoxCost, 3.5, 'Parcel box cost is ₹3.50 (1 × 3.50)');
  assertEqual(report.packagingSummary.totalPackagingCost, 3.5, 'Total packaging cost is ₹3.50 (Parcel Box only)');
  console.log('  ✓ Scenario 4 passed');

  // -------------------------------------------------------------------------
  // Scenario 5: Order without a Parcel Box
  // (1 Cotton Candy Pancake @ ₹90, 0 parcel boxes -> 1 paper plate consumed)
  // -------------------------------------------------------------------------
  console.log('\nScenario 5: Order without a Parcel Box (1 pancake -> 1 paper plate consumed)');
  const ord5 = createOrderWithBill({
    items: [
      {
        productId: 'lz8jb0',
        productName: 'Cotton Candy Pancake',
        unitPrice: 90,
        quantity: 1,
        ingredientCost: 38.03,
      },
    ],
    paymentMethod: 'upi',
    timestamp: TS_DAY1_02PM,
  });

  report = computeRoadsideDashboardSummary(
    db,
    `${TEST_DATE_DAY1} 00:00:00`,
    `${TEST_DATE_DAY1} 23:59:59`,
    TEST_DATE_DAY1,
    TEST_DATE_DAY1,
  );

  assertEqual(report.businessSummary.totalPancakesPrepared, 8, 'Total pancakes prepared is 8');
  assertEqual(report.packagingSummary.parcelBoxesSold, 1, 'Parcel boxes sold remains 1');
  assertEqual(report.packagingSummary.paperPlatesConsumed, 7, 'Paper plates consumed is 7 (6 + 1)');
  assertEqual(report.packagingSummary.paperPlateCost, 17.5, 'Paper plate cost is ₹17.50 (7 × 2.50)');
  assertEqual(report.packagingSummary.totalPackagingCost, 3.5, 'Total packaging cost is ₹3.50 (Parcel Box only)');
  console.log('  ✓ Scenario 5 passed');

  // -------------------------------------------------------------------------
  // Scenario 6: Paper Plate consumption at ₹2.50 each
  // -------------------------------------------------------------------------
  console.log('\nScenario 6: Paper Plate consumption at ₹2.50 each (internal cost only, never billed)');
  assertEqual(report.packagingSummary.paperPlateUnitCost, 2.5, 'Plate unit cost is ₹2.50');
  assertEqual(report.packagingSummary.paperPlateCost, 7 * 2.5, 'Plate total cost equals platesConsumed × ₹2.50');
  console.log('  ✓ Scenario 6 passed');

  // -------------------------------------------------------------------------
  // Scenario 7: Parcel Box selling price and actual inventory cost treated separately
  // -------------------------------------------------------------------------
  console.log('\nScenario 7: Parcel Box selling price (₹5) and inventory cost separated');
  assertEqual(report.packagingSummary.parcelBoxRevenue, 5, 'Parcel box revenue is ₹5.00');
  assertEqual(report.packagingSummary.parcelBoxCost, 3.5, 'Parcel box inventory cost is ₹3.50');
  assertEqual(report.packagingSummary.parcelBoxProfit, 1.5, 'Parcel box contribution profit is ₹1.50 (5 - 3.50)');
  console.log('  ✓ Scenario 7 passed');

  // -------------------------------------------------------------------------
  // Scenario 8: Fully refunded order
  // (Refund ord1 completely for ₹70 cash)
  // -------------------------------------------------------------------------
  console.log('\nScenario 8: Fully refunded order (Refund Order 1 of ₹70)');
  db.prepare(
    `INSERT INTO refunds (bill_id, order_item_id, amount_cents, method, reason, approved_by, created_by, created_at, cash_session_id, product_disposition, plate_disposition)
     VALUES (?, NULL, 7000, 'cash', 'Customer dissatisfaction', ?, ?, ?, 0, 'recovered_sellable', 'plate_consumed')`,
  ).run(ord1.billId, actorId, actorId, TS_DAY1_03PM);

  db.prepare("UPDATE bills SET payment_status = 'refunded' WHERE id = ?").run(ord1.billId);

  report = computeRoadsideDashboardSummary(
    db,
    `${TEST_DATE_DAY1} 00:00:00`,
    `${TEST_DATE_DAY1} 23:59:59`,
    TEST_DATE_DAY1,
    TEST_DATE_DAY1,
  );

  assertEqual(report.businessSummary.netSales, 535, 'Net sales decreased by ₹70 refund (605 - 70 = 535)');
  assertEqual(report.paymentCollection.totalRefunds, 70, 'Total refunds is ₹70');
  assertEqual(report.paymentCollection.cash.refunds, 70, 'Cash refund is ₹70');
  assertEqual(report.refundCount, 1, 'Refund count is 1');

  // Find Dark Chocolate Pancake in product performance
  const darkChoc = report.productPerformance.find((p: any) => p.productName.includes('Dark Chocolate'));
  assert(darkChoc !== undefined, 'Dark Chocolate Pancake exists in performance table');
  assertEqual(darkChoc.grossRevenue, 70, 'Dark Chocolate gross revenue is ₹70');
  assertEqual(darkChoc.refunds, 70, 'Dark Chocolate refund is ₹70');
  assertEqual(darkChoc.netRevenue, 0, 'Dark Chocolate net revenue is ₹0 after full refund');
  assertEqual(darkChoc.refundedQuantity, 1, 'Dark Chocolate refunded quantity is 1');
  assertEqual(darkChoc.netPaidQuantity, 0, 'Dark Chocolate net paid quantity is 0');
  console.log('  ✓ Scenario 8 passed');

  // -------------------------------------------------------------------------
  // Scenario 9: Partially refunded order
  // (Partial refund of ₹90 on Order 2 which had ₹270 total)
  // -------------------------------------------------------------------------
  console.log('\nScenario 9: Partially refunded order (Partial refund of ₹90 on ₹270 order)');
  db.prepare(
    `INSERT INTO refunds (bill_id, order_item_id, amount_cents, method, reason, approved_by, created_by, created_at, cash_session_id)
     VALUES (?, NULL, 9000, 'cash', 'One pancake cancelled', ?, ?, ?, 0)`,
  ).run(ord2.billId, actorId, actorId, TS_DAY1_03PM);

  db.prepare("UPDATE bills SET payment_status = 'partially_refunded' WHERE id = ?").run(ord2.billId);

  report = computeRoadsideDashboardSummary(
    db,
    `${TEST_DATE_DAY1} 00:00:00`,
    `${TEST_DATE_DAY1} 23:59:59`,
    TEST_DATE_DAY1,
    TEST_DATE_DAY1,
  );

  assertEqual(report.businessSummary.netSales, 445, 'Net sales decreased by additional ₹90 (535 - 90 = 445)');
  assertEqual(report.paymentCollection.totalRefunds, 160, 'Total refunds is ₹160 (70 + 90)');
  assertEqual(report.refundCount, 2, 'Refund count is 2');

  const oreoProd = report.productPerformance.find((p: any) => p.productName === 'Oreo Pancake');
  assert(oreoProd !== undefined, 'Oreo Pancake exists in performance table');
  assertEqual(oreoProd.refunds, 90, 'Oreo Pancake refund is ₹90');
  assertEqual(oreoProd.netRevenue, 270, 'Oreo Pancake net revenue adjusted correctly (360 gross - 90 bogo discount - 90 refund = 180 + 90 = 270)');
  console.log('  ✓ Scenario 9 passed');

  // -------------------------------------------------------------------------
  // Scenario 10: Refund Accounting Correction (Refund is NOT automatically product loss)
  // Per business rule: A refunded pancake is sellable; refunds reduce revenue but do NOT
  // classify items as wastage or add extra ingredient cost as loss. Prorated COGS is ₹0.
  // -------------------------------------------------------------------------
  console.log('\nScenario 10: Refund Accounting Correction (Sellable refund: 0 raw COGS, plate consumed)');
  assertEqual(darkChoc.ingredientCost, 2.5, 'Dark Chocolate ingredient cost is ₹2.50 (raw COGS reversed to ₹0; plate consumed)');
  assertEqual(darkChoc.totalPrepared, 1, 'Dark Chocolate prepared quantity remains 1');
  assertEqual(darkChoc.profit, -2.5, 'Dark Chocolate reflects -₹2.50 profit (loss of paper plate only)');
  console.log('  ✓ Scenario 10 passed');

  // -------------------------------------------------------------------------
  // Scenario 11: Cancelled order before preparation
  // (Order with status = 'cancelled' is completely excluded from sales & costs)
  // -------------------------------------------------------------------------
  console.log('\nScenario 11: Cancelled order before preparation (Excluded from sales and preparation counts)');
  const ordCancelled = createOrderWithBill({
    orderNumber: 'ORD-CANCELLED-001',
    status: 'cancelled',
    items: [
      {
        productId: '25ru4o',
        productName: 'Dark Chocolate Pancake',
        unitPrice: 70,
        quantity: 5,
        ingredientCost: 175.0,
      },
    ],
    timestamp: TS_DAY1_11AM,
  });

  const reportAfterCancelled = computeRoadsideDashboardSummary(
    db,
    `${TEST_DATE_DAY1} 00:00:00`,
    `${TEST_DATE_DAY1} 23:59:59`,
    TEST_DATE_DAY1,
    TEST_DATE_DAY1,
  );

  assertEqual(reportAfterCancelled.businessSummary.netSales, 445, 'Net sales unchanged by cancelled order');
  assertEqual(reportAfterCancelled.businessSummary.totalPancakesPrepared, 8, 'Pancakes prepared unchanged (cancelled 5 pancakes ignored)');
  console.log('  ✓ Scenario 11 passed');

  // -------------------------------------------------------------------------
  // Scenario 12: Cash payment
  // -------------------------------------------------------------------------
  console.log('\nScenario 12: Cash payment breakdown');
  assert(report.paymentCollection.cash.gross > 0, 'Cash gross collected is recorded');
  assertEqual(report.paymentCollection.cash.refunds, 160, 'Cash refunds is ₹160');
  assertEqual(report.paymentCollection.cash.net, report.paymentCollection.cash.gross - 160, 'Net cash equals gross minus cash refunds');
  console.log('  ✓ Scenario 12 passed');

  // -------------------------------------------------------------------------
  // Scenario 13: UPI payment
  // (Order 5 was ₹90 paid via UPI)
  // -------------------------------------------------------------------------
  console.log('\nScenario 13: UPI payment breakdown');
  assertEqual(report.paymentCollection.upi.gross, 90, 'UPI gross collected is ₹90');
  assertEqual(report.paymentCollection.upi.refunds, 0, 'UPI refunds is ₹0');
  assertEqual(report.paymentCollection.upi.net, 90, 'Net UPI is ₹90');
  console.log('  ✓ Scenario 13 passed');

  // -------------------------------------------------------------------------
  // Scenario 14: Daily and monthly Dashboard totals
  // -------------------------------------------------------------------------
  console.log('\nScenario 14: Daily and monthly Dashboard totals');
  // Add an order on Day 2 to test range aggregation
  createOrderWithBill({
    orderNumber: 'ORD-DAY2-001',
    items: [
      {
        productId: '25ru4o',
        productName: 'Dark Chocolate Pancake',
        unitPrice: 70,
        quantity: 2,
        ingredientCost: 70.0,
      },
    ],
    paymentMethod: 'upi',
    timestamp: TS_DAY2_10AM,
  });

  const reportDay1 = computeRoadsideDashboardSummary(
    db,
    `${TEST_DATE_DAY1} 00:00:00`,
    `${TEST_DATE_DAY1} 23:59:59`,
    TEST_DATE_DAY1,
    TEST_DATE_DAY1,
  );

  const reportDay2 = computeRoadsideDashboardSummary(
    db,
    `${TEST_DATE_DAY2} 00:00:00`,
    `${TEST_DATE_DAY2} 23:59:59`,
    TEST_DATE_DAY2,
    TEST_DATE_DAY2,
  );

  const reportMonth = computeRoadsideDashboardSummary(
    db,
    `2026-11-01 00:00:00`,
    `2026-11-30 23:59:59`,
    `2026-11-01`,
    `2026-11-30`,
  );

  assertEqual(reportDay1.businessSummary.netSales, 445, 'Day 1 net sales is ₹445');
  assertEqual(reportDay2.businessSummary.netSales, 140, 'Day 2 net sales is ₹140');
  assertEqual(reportMonth.businessSummary.netSales, 585, 'Month net sales is ₹585 (445 + 140)');
  assertEqual(reportMonth.businessSummary.totalPancakesPrepared, 10, 'Month pancakes prepared is 10 (8 + 2)');
  console.log('  ✓ Scenario 14 passed');

  // -------------------------------------------------------------------------
  // Scenario 15: Product-wise quantities, revenue and contribution
  // -------------------------------------------------------------------------
  console.log('\nScenario 15: Product-wise quantities, revenue and contribution');
  for (const prod of reportDay1.productPerformance) {
    assertEqual(
      prod.netRevenue,
      prod.grossRevenue - prod.discounts - prod.refunds,
      `${prod.productName} net revenue equals gross - discounts - refunds`,
    );
    assertEqual(
      prod.profit,
      Number((prod.netRevenue - (prod.ingredientCost + prod.packagingCost)).toFixed(2)),
      `${prod.productName} profit equals netRevenue - (ingredientCost + packagingCost)`,
    );
  }
  console.log('  ✓ Scenario 15 passed');

  // -------------------------------------------------------------------------
  // Scenario 16: Correct separation of pancake sales, parcel box sales and paper plate costs
  // -------------------------------------------------------------------------
  console.log('\nScenario 16: Separation of pancake sales, parcel box sales and paper plate costs');
  const boxSummary = reportDay1.packagingSummary;
  assertEqual(boxSummary.parcelBoxesSold, 1, '1 parcel box sold');
  assertEqual(boxSummary.parcelBoxRevenue, 5, 'Parcel box revenue is ₹5');
  assertEqual(boxSummary.paperPlatesConsumed, 7, 'Paper plates consumed is 7 (1 boxed pancake consumes 0 plates)');
  assertEqual(boxSummary.paperPlateCost, 17.5, 'Paper plate cost is ₹17.50 (7 × 2.50)');
  assertEqual(boxSummary.totalPackagingCost, 3.5, 'Total packaging cost is ₹3.50 (Parcel Box only)');
  console.log('  ✓ Scenario 16 passed');

  // -------------------------------------------------------------------------
  // Scenario 17: No duplicate direct cost calculations
  // (Total Direct Cost equals exactly ingredient cost + total packaging cost)
  // -------------------------------------------------------------------------
  console.log('\nScenario 17: No duplicate direct cost calculations');
  const cp = reportDay1.costProfitSummary;
  assertEqual(
    cp.totalDirectCost,
    Number((cp.ingredientCost + cp.packagingCost).toFixed(2)),
    'Total direct cost equals Ingredient Cost + Packaging Cost exactly',
  );
  assertEqual(
    cp.grossContribution,
    Number((cp.netSales - cp.totalDirectCost).toFixed(2)),
    'Gross contribution equals Net Sales - Total Direct Cost',
  );
  console.log('  ✓ Scenario 17 passed');

  // -------------------------------------------------------------------------
  // Scenario 18: BOGO discount and free pancake quantities reported correctly
  // -------------------------------------------------------------------------
  console.log('\nScenario 18: BOGO discount and free pancake quantities reported correctly');
  assertEqual(reportDay1.bogoSummary.totalOrdersWithBogo, 1, '1 BOGO order on Day 1');
  assertEqual(reportDay1.bogoSummary.totalFreePancakes, 1, '1 free pancake given on Day 1');
  assertEqual(reportDay1.bogoSummary.totalBogoDiscounts, 90, '₹90 promotional discount given');
  console.log('  ✓ Scenario 18 passed');

  // -------------------------------------------------------------------------
  // Scenario 19: Standalone Parcel Box sale isolation
  // (Selling standalone parcel boxes does NOT reduce pancake paper plate consumption or inflate pancake orders)
  // -------------------------------------------------------------------------
  console.log('\nScenario 19: Standalone Parcel Box sale isolation');
  createOrderWithBill({
    orderNumber: 'ORD-DAY2-BOX-002',
    items: [
      {
        productId: 'pr_parcel_box_5',
        productName: 'Parcel Box',
        unitPrice: 5,
        quantity: 2,
        ingredientCost: 0,
        noPackaging: 1,
      },
    ],
    paymentMethod: 'cash',
    timestamp: TS_DAY2_10AM,
  });

  const reportDay2WithBox = computeRoadsideDashboardSummary(
    db,
    `${TEST_DATE_DAY2} 00:00:00`,
    `${TEST_DATE_DAY2} 23:59:59`,
    TEST_DATE_DAY2,
    TEST_DATE_DAY2,
  );

  assertEqual(reportDay2WithBox.businessSummary.netSales, 150, 'Day 2 net sales is ₹150 (140 + 10)');
  assertEqual(reportDay2WithBox.businessSummary.totalPancakesPrepared, 2, 'Total pancakes prepared remains 2 (boxes are not pancakes)');
  assertEqual(reportDay2WithBox.businessSummary.totalOrders, 1, 'Total pancake orders remains 1 (standalone box order excluded)');
  assertEqual(reportDay2WithBox.packagingSummary.parcelBoxesSold, 2, 'Parcel boxes sold is 2');
  assertEqual(reportDay2WithBox.packagingSummary.parcelBoxRevenue, 10, 'Parcel box revenue is ₹10.00');
  assertEqual(reportDay2WithBox.packagingSummary.paperPlatesConsumed, 2, 'Paper plates consumed remains 2 (NOT reduced by separate box sale!)');
  assertEqual(reportDay2WithBox.packagingSummary.paperPlateCost, 5.0, 'Paper plate cost remains ₹5.00 (2 × ₹2.50)');
  assertEqual(reportDay2WithBox.packagingSummary.parcelBoxCost, 7.0, 'Parcel box cost is ₹7.00 (2 × ₹3.50)');
  assertEqual(reportDay2WithBox.packagingSummary.totalPackagingCost, 7.0, 'Total packaging cost is ₹7.00 (Parcel Box only: 2 × ₹3.50)');
  console.log('  ✓ Scenario 19 passed');

  // -------------------------------------------------------------------------
  // Scenario 20: Product-Wise Pancake Sales & Profit CSV Export Verification
  // -------------------------------------------------------------------------
  console.log('\nScenario 20: Product-Wise Pancake Sales & Profit CSV Export Verification');
  const csvOutput = serializeProductPerformanceCsv(reportDay1);
  const csvLines = csvOutput.trim().split('\n');

  // Verify headers
  const expectedHeaders =
    'Product Name,Paid Quantity,Free BOGO Quantity,Total Pancakes Prepared,Gross Revenue,Discounts,Refunds,Net Revenue,Sellable Recovered Qty,Wastage Qty,Ingredient Cost,Packaging Cost,Contribution / Profit';
  assertEqual(csvLines[0], expectedHeaders, 'CSV header contains all required columns matching table');

  // Verify product rows and summary total row exist
  const totalRowIndex = csvLines.findIndex((l: string) => l.startsWith('Total,'));
  assert(totalRowIndex > 1, 'CSV includes summary / Total row after product lines');

  // Compare every product row between Dashboard table and CSV
  for (let i = 1; i < totalRowIndex; i++) {
    const cols = csvLines[i].split(',');
    const prodName = cols[0];
    const match = reportDay1.productPerformance.find((p: any) => p.productName === prodName);
    assert(Boolean(match), `Product ${prodName} exists in Dashboard performance table`);
    if (match) {
      assertEqual(Number(cols[1]), match.paidQuantity, `${prodName} paidQuantity matches CSV`);
      assertEqual(Number(cols[2]), match.freeQuantity, `${prodName} freeQuantity matches CSV`);
      assertEqual(Number(cols[3]), match.totalPrepared, `${prodName} totalPrepared matches CSV`);
      assertEqual(Number(cols[4]), match.grossRevenue, `${prodName} grossRevenue matches CSV`);
      assertEqual(Number(cols[5]), match.discounts, `${prodName} discounts matches CSV`);
      assertEqual(Number(cols[6]), match.refunds, `${prodName} refunds matches CSV`);
      assertEqual(Number(cols[7]), match.netRevenue, `${prodName} netRevenue matches CSV`);
      assertEqual(Number(cols[8]), match.recoveredQuantity || 0, `${prodName} recoveredQuantity matches CSV`);
      assertEqual(Number(cols[9]), match.wastageQuantity || 0, `${prodName} wastageQuantity matches CSV`);
      assertEqual(Number(cols[10]), match.ingredientCost, `${prodName} ingredientCost matches CSV`);
      assertEqual(Number(cols[11]), match.packagingCost, `${prodName} packagingCost matches CSV`);
      assertEqual(Number(cols[12]), match.profit, `${prodName} profit matches CSV`);
    }
  }

  // Verify Normal vs BOGO Breakdown section exists in CSV
  assert(csvOutput.includes('--- Normal Pancake Sales vs BOGO Promotional Sales Breakdown ---'), 'CSV includes Normal vs BOGO Breakdown section');
  console.log('  ✓ Scenario 20 passed');

  // -------------------------------------------------------------------------
  // Scenario 21: Product-Wise Pancake Sales & Profit XLSX Export Verification
  // -------------------------------------------------------------------------
  console.log('\nScenario 21: Product-Wise Pancake Sales & Profit XLSX Export Verification');
  const xlsxBuffer = await serializeProductPerformanceXlsx(reportDay1);
  assert(Buffer.isBuffer(xlsxBuffer) && xlsxBuffer.length > 1000, 'XLSX buffer generated successfully');
  console.log('  ✓ Scenario 21 passed');

  // -------------------------------------------------------------------------
  // Scenario 22: Daily Sales Multi-Sheet Export Accounting & Reconciled Costs
  // -------------------------------------------------------------------------
  console.log('\nScenario 22: Daily Sales Multi-Sheet Export Accounting & Reconciled Costs');
  const { buildDailySalesExportDataset } = require('../main/services/daily-sales-export');
  const { serializeDailySalesExportXlsx } = require('../main/services/daily-sales-export-files');
  const dailySalesDataset = buildDailySalesExportDataset(
    { from: TEST_DATE_DAY1, to: TEST_DATE_DAY1 },
    db,
  );

  assert(Boolean(dailySalesDataset.summary), 'Daily Sales summary exists');
  assertEqual(dailySalesDataset.summary.cost_coverage_status, 'known', 'Daily Sales cost coverage status is known');
  assertEqual(
    dailySalesDataset.summary.packaging_cost_total,
    3.5,
    'Daily Sales summary packaging cost total is ₹3.50 (Parcel Box only)',
  );
  assertEqual(
    dailySalesDataset.summary.total_direct_cost,
    Number((dailySalesDataset.summary.ingredient_cost_total! + dailySalesDataset.summary.packaging_cost_total!).toFixed(2)),
    'Daily Sales direct cost is exactly ingredient + packaging cost',
  );

  const parcelBoxItem = dailySalesDataset.items.find((it: any) => it.product_id === 'pr_parcel_box_5' || it.product_name.includes('Parcel Box'));
  assert(Boolean(parcelBoxItem), 'Parcel Box exists in Daily Sales items sheet');
  assertEqual(parcelBoxItem?.ingredient_cost, 0, 'Parcel Box ingredient cost is ₹0.00');
  assertEqual(parcelBoxItem?.packaging_cost, 3.5, 'Parcel Box packaging cost is ₹3.50 (inventory cost)');
  assertEqual(parcelBoxItem?.profit, 1.5, 'Parcel Box profit is ₹1.50 (5 - 3.50)');
  assertEqual(parcelBoxItem?.cost_status, 'known', 'Parcel Box cost status is known');

  const pancakeItems = dailySalesDataset.items.filter((it: any) => it.product_id !== 'pr_parcel_box_5' && !it.product_name.includes('Parcel Box'));
  for (const pItem of pancakeItems) {
    assertEqual(pItem.packaging_cost, 0, `${pItem.product_name} packaging cost is ₹0 (paper plates are in ingredient cost)`);
    assert(pItem.ingredient_cost !== null && pItem.ingredient_cost > 0, `${pItem.product_name} ingredient cost is populated`);
    assertEqual(pItem.cost_status, 'known', `${pItem.product_name} cost status is known`);
  }

  const dsWorkbookBuffer = await serializeDailySalesExportXlsx(dailySalesDataset, { fractionDigits: 2 });
  assert(Buffer.isBuffer(dsWorkbookBuffer) && dsWorkbookBuffer.length > 1000, 'Daily Sales 5-sheet XLSX buffer generated successfully');
  console.log('  ✓ Scenario 22 passed');

  console.log('\n=============================================================');
  const { passed, failed, total } = getResults();
  console.log(`ALL 22 SCENARIOS VERIFIED: ${passed}/${total} assertions passed, ${failed} failed.`);
  console.log('=============================================================\n');

  closeDatabase();
  try {
    fs.rmSync(activeTestDir, { recursive: true, force: true });
  } catch {}

  if (failed > 0) {
    process.exit(1);
  }
}

runDashboardTests().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
