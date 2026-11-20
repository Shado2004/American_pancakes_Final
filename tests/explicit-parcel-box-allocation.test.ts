/**
 * Explicit Parcel Box Allocation & Paper Plate Accounting Test Suite
 *
 * Validates Acceptance Tests A through J:
 * - Test A: 2 pancakes, 2 boxes, 0 allocated -> 2 standalone, 2 plates consumed.
 * - Test B: 2 pancakes, 2 boxes, 1 allocated -> 1 standalone, 1 packaging, 1 plate consumed.
 * - Test C: 2 pancakes, 2 boxes, 2 allocated -> 0 standalone, 2 packaging, 0 plates consumed.
 * - Test D: 2 pancakes, 1 box, 1 allocated -> 0 standalone, 1 packaging, 1 plate consumed.
 * - Test E: 2 pancakes, 0 boxes -> 2 plates consumed.
 * - Test F: 2 pancakes with BOGO active, 1 allocated box -> 2 prepared, 1 box, 1 plate consumed, free pancake ingredient cost included.
 * - Test G: Actual ledger deductions (supply_movements and order_inventory_consumptions) equal order allocation exactly.
 * - Test H: Dashboard, product-wise reporting, packaging reports, normal/BOGO reports, and exports agree with persisted allocation and actual costs.
 * - Test I: Standalone box sale (0 pancakes, 2 boxes) -> 0 plates consumed, 2 boxes consumed.
 * - Test J: Cancelled order does NOT consume inventory.
 */

import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const Module = require('module');
const originalLoad = Module._load;
let activeTestDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flo-parcel-alloc-test-'));

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

import { createApp, startServer, api, seedOwnerUser } from './helpers/test-setup';
import { productRoutes } from '../main/routes/products';
import { orderRoutes } from '../main/routes/orders';
import { billRoutes } from '../main/routes/bills';
import promotionRoutes from '../main/routes/promotions';
import { initDatabase, getDatabase, closeDatabase, now } from '../main/db';
import { computeRoadsideDashboardSummary } from '../main/services/roadside-reporting';
import { buildSalesReportsDataset } from '../main/services/sales-reports-export';
import { buildDailySalesExportDataset } from '../main/services/daily-sales-export';
import { calculateRoadsidePackaging, recomputeRoadsideAllocations } from '../frontend/src/store/cart';
import type { CartItem } from '../frontend/src/store/cart';

async function runTests() {
  console.log('================================================================');
  console.log('START: Explicit Parcel Box Allocation & Paper Plate Accounting Test');
  console.log('================================================================');

  // Set isolated temp db
  const testDbPath = path.join(activeTestDir, 'flo.db');
  process.env.DATABASE_PATH = testDbPath;
  process.env.APP_DATA_DIR = activeTestDir;

  initDatabase();
  const db = getDatabase();

  // Configure regional settings
  db.prepare(`
    INSERT OR REPLACE INTO settings (key, value) VALUES
      ('country', 'IN'),
      ('currency', 'INR'),
      ('timezone', 'Asia/Kolkata')
  `).run();

  // Seed supplies
  const plateSupplyId = 'sup_ffdfa4ad3785608b17b4d5a7';
  const boxSupplyId = 'sup_box_test';
  db.prepare(`
    INSERT OR REPLACE INTO supplies (id, name, base_unit, stock_quantity, unit_cost, created_at, updated_at)
    VALUES
      ('sup_batter', 'Pancake Batter', 'g', 50000, 0.15, '${now()}', '${now()}'),
      ('sup_sticks', 'Sticks & Tissue Set', 'each', 5000, 0.50, '${now()}', '${now()}'),
      ('${plateSupplyId}', 'Paper Plate', 'each', 5000, 2.50, '${now()}', '${now()}'),
      ('sup_chocolate', 'Chocolate Sauce', 'g', 10000, 0.40, '${now()}', '${now()}'),
      ('${boxSupplyId}', 'Parcel Box Packaging', 'each', 5000, 3.50, '${now()}', '${now()}')
  `).run();

  // Seed categories
  db.prepare("INSERT OR REPLACE INTO categories (id, name, color) VALUES ('cat_pancakes', 'Pancakes', '#f59e0b')").run();
  db.prepare("INSERT OR REPLACE INTO categories (id, name, color) VALUES ('cat_packaging', 'Packaging', '#3b82f6')").run();

  // Seed products
  const pancakeProdId = 'prod_choco_pancake';
  const parcelBoxProdId = 'pr_parcel_box_5';
  db.prepare(`
    INSERT OR REPLACE INTO products (id, name, price, cost, category_id, is_active, track_inventory, no_packaging, stock_quantity, created_at, updated_at)
    VALUES
      ('${pancakeProdId}', 'Chocolate Pancake', 80, 42.10, 'cat_pancakes', 1, 0, 1, 100, '${now()}', '${now()}'),
      ('${parcelBoxProdId}', 'Parcel Box', 5, 3.50, 'cat_packaging', 1, 0, 1, 100, '${now()}', '${now()}')
  `).run();

  // Seed recipe for pancake:
  // Batter (64g @ 0.15 = 9.60) + Sticks (1 @ 0.50 = 0.50) + Choc (70g @ 0.40 = 28.00) + Plate (1 @ 2.50 = 2.50) = 40.60
  db.prepare(`
    INSERT OR REPLACE INTO recipes (id, product_id, yield_quantity, is_active, created_at, updated_at)
    VALUES ('rec_choco', '${pancakeProdId}', 1, 1, '${now()}', '${now()}')
  `).run();
  db.prepare(`
    INSERT OR REPLACE INTO recipe_items (id, recipe_id, supply_id, quantity, unit)
    VALUES
      ('ri_1', 'rec_choco', 'sup_batter', 64, 'g'),
      ('ri_2', 'rec_choco', 'sup_sticks', 1, 'each'),
      ('ri_3', 'rec_choco', 'sup_chocolate', 70, 'g'),
      ('ri_4', 'rec_choco', '${plateSupplyId}', 1, 'each')
  `).run();

  const owner = seedOwnerUser(db);

  // Seed default packaging profiles
  db.prepare(`
    INSERT OR REPLACE INTO packaging_profiles (
      id, name, description, notes, serving_type, packaging_type,
      supply_id, units_per_serving, customer_charge_per_unit,
      is_active, is_default, created_by_user_id, updated_by_user_id,
      created_at, updated_at
    ) VALUES (
      'pkg_box_profile', 'Parcel Box', 'Standard box', '', 'parcel', 'parcel_box',
      '${boxSupplyId}', 1, 0,
      1, 1, '${owner.userId}', '${owner.userId}',
      '${now()}', '${now()}'
    )
  `).run();

  // Seed BOGO Promotion
  db.prepare(`
    INSERT OR REPLACE INTO promotions (
      id, name, description, discount_type, target_type, discount_value,
      bogo_buy_qty, bogo_get_qty, bogo_pricing_rule, is_loyalty_reward,
      is_active, is_automatic, created_at, updated_at
    ) VALUES (
      'launch-bogo', 'BOGO Promotion', 'Buy 1 Get 1 Free', 'bogo', 'all_pancakes', 0,
      1, 1, 'cheapest_free', 0,
      1, 0, '${now()}', '${now()}'
    )
  `).run();

  const app = createApp({
    '/api/products': productRoutes,
    '/api/orders': orderRoutes,
    '/api/bills': billRoutes,
    '/api/promotions': promotionRoutes,
  });
  const { baseUrl, server } = await startServer(app);
  const headers = owner.authHeader;

  // Helper function to create and settle an order
  async function createAndSettleOrder(args: {
    items: Array<{
      product_id: string;
      quantity: number;
      serving_allocations?: Array<{ serving_type: 'dine_in' | 'parcel'; quantity: number }>;
    }>;
    packaging_boxes_count?: number;
    applyBogo?: boolean;
    paidAtDate?: string;
  }) {
    const createRes = await api(baseUrl, '/api/orders', {
      method: 'POST',
      headers,
      body: {
        type: 'takeaway',
        items: args.items,
        packaging_boxes_count: args.packaging_boxes_count,
        boxes_for_packaging: args.packaging_boxes_count,
      },
    });
    assert.strictEqual(createRes.status, 201, 'Order created successfully');
    const orderId = createRes.data.order.id;

    if (args.applyBogo) {
      const promoRes = await api(baseUrl, '/api/promotions/apply', {
        method: 'POST',
        headers,
        body: { order_id: orderId, promotion_id: 'launch-bogo' },
      });
      assert.strictEqual(promoRes.status, 200, 'BOGO applied to order');
    }

    const billRes = await api(baseUrl, '/api/bills/generate', {
      method: 'POST',
      headers,
      body: { order_id: orderId },
    });
    assert.strictEqual(billRes.status, 201, 'Bill generated');
    const billId = billRes.data.bill.id;

    const payRes = await api(baseUrl, `/api/bills/${billId}/payment`, {
      method: 'POST',
      headers,
      body: {
        method: 'cash',
        amount: billRes.data.bill.total,
      },
    });
    assert.strictEqual(payRes.status, 200, 'Bill paid');

    if (args.paidAtDate) {
      db.prepare('UPDATE bills SET paid_at = ? WHERE id = ?').run(args.paidAtDate, billId);
    }

    return { orderId, billId };
  }

  try {
    // ------------------------------------------------------------------------
    // TEST A: 2 pancakes, 2 boxes, 0 allocated -> 2 standalone, 2 plates consumed
    // ------------------------------------------------------------------------
    console.log('\n--- TEST A: 2 pancakes, 2 boxes, 0 allocated ---');
    const dateA = '2026-11-20 10:00:00';
    const orderA = await createAndSettleOrder({
      items: [
        {
          product_id: pancakeProdId,
          quantity: 2,
          serving_allocations: [{ serving_type: 'dine_in', quantity: 2 }],
        },
        {
          product_id: parcelBoxProdId,
          quantity: 2,
          serving_allocations: [{ serving_type: 'parcel', quantity: 2 }],
        },
      ],
      packaging_boxes_count: 0,
      paidAtDate: dateA,
    });

    // Check movements in DB for Order A
    const plateMovementsA = db.prepare(`
      SELECT sm.quantity_delta
      FROM supply_movements sm
      JOIN order_inventory_consumptions oic ON oic.supply_movement_id = sm.id
      WHERE oic.order_id = ? AND sm.supply_id = ?
    `).all(orderA.orderId, plateSupplyId) as Array<{ quantity_delta: number }>;
    const totalPlatesA = plateMovementsA.reduce((s, m) => s + Math.abs(m.quantity_delta), 0);
    assert.strictEqual(totalPlatesA, 2, 'Test A: Exactly 2 plates consumed');

    const boxMovementsA = db.prepare(`
      SELECT sm.quantity_delta
      FROM supply_movements sm
      JOIN order_inventory_consumptions oic ON oic.supply_movement_id = sm.id
      WHERE oic.order_id = ? AND sm.supply_id = ?
    `).all(orderA.orderId, boxSupplyId) as Array<{ quantity_delta: number }>;
    const totalBoxesA = boxMovementsA.reduce((s, m) => s + Math.abs(m.quantity_delta), 0);
    assert.strictEqual(totalBoxesA, 2, 'Test A: Exactly 2 boxes consumed (standalone)');

    console.log('  ✓ Test A Passed: 2 standalone boxes, 2 plates consumed in supply_movements');

    // ------------------------------------------------------------------------
    // TEST B: 2 pancakes, 2 boxes, 1 allocated -> 1 standalone, 1 packaging, 1 plate consumed
    // ------------------------------------------------------------------------
    console.log('\n--- TEST B: 2 pancakes, 2 boxes, 1 allocated ---');
    const dateB = '2026-11-20 11:00:00';
    const orderB = await createAndSettleOrder({
      items: [
        {
          product_id: pancakeProdId,
          quantity: 2,
          serving_allocations: [
            { serving_type: 'parcel', quantity: 1 },
            { serving_type: 'dine_in', quantity: 1 },
          ],
        },
        {
          product_id: parcelBoxProdId,
          quantity: 2,
          serving_allocations: [{ serving_type: 'parcel', quantity: 2 }],
        },
      ],
      packaging_boxes_count: 1,
      paidAtDate: dateB,
    });

    const plateMovementsB = db.prepare(`
      SELECT sm.quantity_delta
      FROM supply_movements sm
      JOIN order_inventory_consumptions oic ON oic.supply_movement_id = sm.id
      WHERE oic.order_id = ? AND sm.supply_id = ?
    `).all(orderB.orderId, plateSupplyId) as Array<{ quantity_delta: number }>;
    const totalPlatesB = plateMovementsB.reduce((s, m) => s + Math.abs(m.quantity_delta), 0);
    assert.strictEqual(totalPlatesB, 1, 'Test B: Exactly 1 plate consumed');

    const boxMovementsB = db.prepare(`
      SELECT sm.quantity_delta
      FROM supply_movements sm
      JOIN order_inventory_consumptions oic ON oic.supply_movement_id = sm.id
      WHERE oic.order_id = ? AND sm.supply_id = ?
    `).all(orderB.orderId, boxSupplyId) as Array<{ quantity_delta: number }>;
    const totalBoxesB = boxMovementsB.reduce((s, m) => s + Math.abs(m.quantity_delta), 0);
    assert.strictEqual(totalBoxesB, 2, 'Test B: Exactly 2 boxes consumed (1 packaging + 1 standalone)');

    console.log('  ✓ Test B Passed: 1 packaging box, 1 standalone box, 1 plate consumed');

    // ------------------------------------------------------------------------
    // TEST C: 2 pancakes, 2 boxes, 2 allocated -> 0 standalone, 2 packaging, 0 plates consumed
    // ------------------------------------------------------------------------
    console.log('\n--- TEST C: 2 pancakes, 2 boxes, 2 allocated ---');
    const dateC = '2026-11-20 12:00:00';
    const orderC = await createAndSettleOrder({
      items: [
        {
          product_id: pancakeProdId,
          quantity: 2,
          serving_allocations: [{ serving_type: 'parcel', quantity: 2 }],
        },
        {
          product_id: parcelBoxProdId,
          quantity: 2,
          serving_allocations: [{ serving_type: 'parcel', quantity: 2 }],
        },
      ],
      packaging_boxes_count: 2,
      paidAtDate: dateC,
    });

    const plateMovementsC = db.prepare(`
      SELECT sm.quantity_delta
      FROM supply_movements sm
      JOIN order_inventory_consumptions oic ON oic.supply_movement_id = sm.id
      WHERE oic.order_id = ? AND sm.supply_id = ?
    `).all(orderC.orderId, plateSupplyId) as Array<{ quantity_delta: number }>;
    const totalPlatesC = plateMovementsC.reduce((s, m) => s + Math.abs(m.quantity_delta), 0);
    assert.strictEqual(totalPlatesC, 0, 'Test C: 0 plates consumed in supply_movements');

    const plateConsumptionsC = db.prepare(`
      SELECT oic.*
      FROM order_inventory_consumptions oic
      JOIN supply_movements sm ON sm.id = oic.supply_movement_id
      WHERE oic.order_id = ? AND sm.supply_id = ?
    `).all(orderC.orderId, plateSupplyId);
    assert.strictEqual(plateConsumptionsC.length, 0, 'No plate consumption rows for 0-plate order');

    const boxMovementsC = db.prepare(`
      SELECT sm.quantity_delta
      FROM supply_movements sm
      JOIN order_inventory_consumptions oic ON oic.supply_movement_id = sm.id
      WHERE oic.order_id = ? AND sm.supply_id = ?
    `).all(orderC.orderId, boxSupplyId) as Array<{ quantity_delta: number }>;
    const totalBoxesC = boxMovementsC.reduce((s, m) => s + Math.abs(m.quantity_delta), 0);
    assert.strictEqual(totalBoxesC, 2, 'Test C: 2 boxes consumed for packaging');

    console.log('  ✓ Test C Passed: 2 packaging boxes, 0 standalone, 0 plates consumed');

    // ------------------------------------------------------------------------
    // TEST D: 2 pancakes, 1 box, 1 allocated -> 0 standalone, 1 packaging, 1 plate consumed
    // ------------------------------------------------------------------------
    console.log('\n--- TEST D: 2 pancakes, 1 box, 1 allocated ---');
    const dateD = '2026-11-20 13:00:00';
    const orderD = await createAndSettleOrder({
      items: [
        {
          product_id: pancakeProdId,
          quantity: 2,
          serving_allocations: [
            { serving_type: 'parcel', quantity: 1 },
            { serving_type: 'dine_in', quantity: 1 },
          ],
        },
        {
          product_id: parcelBoxProdId,
          quantity: 1,
          serving_allocations: [{ serving_type: 'parcel', quantity: 1 }],
        },
      ],
      packaging_boxes_count: 1,
      paidAtDate: dateD,
    });

    const plateMovementsD = db.prepare(`
      SELECT sm.quantity_delta
      FROM supply_movements sm
      JOIN order_inventory_consumptions oic ON oic.supply_movement_id = sm.id
      WHERE oic.order_id = ? AND sm.supply_id = ?
    `).all(orderD.orderId, plateSupplyId) as Array<{ quantity_delta: number }>;
    assert.strictEqual(plateMovementsD.reduce((s, m) => s + Math.abs(m.quantity_delta), 0), 1, 'Test D: 1 plate consumed');

    const boxMovementsD = db.prepare(`
      SELECT sm.quantity_delta
      FROM supply_movements sm
      JOIN order_inventory_consumptions oic ON oic.supply_movement_id = sm.id
      WHERE oic.order_id = ? AND sm.supply_id = ?
    `).all(orderD.orderId, boxSupplyId) as Array<{ quantity_delta: number }>;
    assert.strictEqual(boxMovementsD.reduce((s, m) => s + Math.abs(m.quantity_delta), 0), 1, 'Test D: 1 box consumed');

    console.log('  ✓ Test D Passed: 1 packaging box, 0 standalone, 1 plate consumed');

    // ------------------------------------------------------------------------
    // TEST E: 2 pancakes, 0 boxes -> 2 plates consumed
    // ------------------------------------------------------------------------
    console.log('\n--- TEST E: 2 pancakes, 0 boxes ---');
    const dateE = '2026-11-20 14:00:00';
    const orderE = await createAndSettleOrder({
      items: [
        {
          product_id: pancakeProdId,
          quantity: 2,
          serving_allocations: [{ serving_type: 'dine_in', quantity: 2 }],
        },
      ],
      packaging_boxes_count: 0,
      paidAtDate: dateE,
    });

    const plateMovementsE = db.prepare(`
      SELECT sm.quantity_delta
      FROM supply_movements sm
      JOIN order_inventory_consumptions oic ON oic.supply_movement_id = sm.id
      WHERE oic.order_id = ? AND sm.supply_id = ?
    `).all(orderE.orderId, plateSupplyId) as Array<{ quantity_delta: number }>;
    assert.strictEqual(plateMovementsE.reduce((s, m) => s + Math.abs(m.quantity_delta), 0), 2, 'Test E: 2 plates consumed');

    const boxMovementsE = db.prepare(`
      SELECT sm.quantity_delta
      FROM supply_movements sm
      JOIN order_inventory_consumptions oic ON oic.supply_movement_id = sm.id
      WHERE oic.order_id = ? AND sm.supply_id = ?
    `).all(orderE.orderId, boxSupplyId) as Array<{ quantity_delta: number }>;
    assert.strictEqual(boxMovementsE.length, 0, 'Test E: 0 boxes consumed');

    console.log('  ✓ Test E Passed: 0 boxes, 2 plates consumed');

    // ------------------------------------------------------------------------
    // TEST F: 2 pancakes with BOGO active, 1 allocated box -> 2 prepared, 1 box, 1 plate consumed, free pancake ingredient cost included
    // ------------------------------------------------------------------------
    console.log('\n--- TEST F: 2 pancakes with BOGO active, 1 allocated box ---');
    const dateF = '2026-11-20 15:00:00';
    const orderF = await createAndSettleOrder({
      items: [
        {
          product_id: pancakeProdId,
          quantity: 2,
          serving_allocations: [
            { serving_type: 'parcel', quantity: 1 },
            { serving_type: 'dine_in', quantity: 1 },
          ],
        },
        {
          product_id: parcelBoxProdId,
          quantity: 1,
          serving_allocations: [{ serving_type: 'parcel', quantity: 1 }],
        },
      ],
      packaging_boxes_count: 1,
      applyBogo: true,
      paidAtDate: dateF,
    });

    // Check items in order: 1 paid, 1 free
    const itemsF = db.prepare('SELECT id, product_name, unit_price, quantity, subtotal, discount_amount, total FROM order_items WHERE order_id = ?').all(orderF.orderId) as any[];
    assert.strictEqual(itemsF.length, 3, 'Order F has 3 items: paid pancake, free pancake, parcel box');

    const freeItem = itemsF.find((i) => i.product_name.includes('(BOGO Free)'));
    assert.ok(freeItem, 'Free BOGO pancake exists');
    assert.strictEqual(freeItem.discount_amount, 80, 'Free pancake discount is ₹80');
    assert.strictEqual(freeItem.total, 0, 'Free pancake total is 0');

    // Check raw batter consumed for Order F: 2 pancakes prepared * 64g = 128g
    const batterMovementsF = db.prepare(`
      SELECT sm.quantity_delta
      FROM supply_movements sm
      JOIN order_inventory_consumptions oic ON oic.supply_movement_id = sm.id
      WHERE oic.order_id = ? AND sm.supply_id = 'sup_batter'
    `).all(orderF.orderId) as Array<{ quantity_delta: number }>;
    const totalBatterF = batterMovementsF.reduce((s, m) => s + Math.abs(m.quantity_delta), 0);
    assert.strictEqual(totalBatterF, 128, 'Test F: 128g batter consumed (64g paid + 64g free pancake)');

    // Check chocolate filling consumed: 2 * 70g = 140g
    const chocMovementsF = db.prepare(`
      SELECT sm.quantity_delta
      FROM supply_movements sm
      JOIN order_inventory_consumptions oic ON oic.supply_movement_id = sm.id
      WHERE oic.order_id = ? AND sm.supply_id = 'sup_chocolate'
    `).all(orderF.orderId) as Array<{ quantity_delta: number }>;
    assert.strictEqual(chocMovementsF.reduce((s, m) => s + Math.abs(m.quantity_delta), 0), 140, 'Test F: 140g chocolate consumed');

    // Check plate movements for Order F: exactly 1 plate consumed
    const plateMovementsF = db.prepare(`
      SELECT sm.quantity_delta
      FROM supply_movements sm
      JOIN order_inventory_consumptions oic ON oic.supply_movement_id = sm.id
      WHERE oic.order_id = ? AND sm.supply_id = ?
    `).all(orderF.orderId, plateSupplyId) as Array<{ quantity_delta: number }>;
    assert.strictEqual(plateMovementsF.reduce((s, m) => s + Math.abs(m.quantity_delta), 0), 1, 'Test F: Exactly 1 plate consumed');

    // Check box movements for Order F: exactly 1 box consumed
    const boxMovementsF = db.prepare(`
      SELECT sm.quantity_delta
      FROM supply_movements sm
      JOIN order_inventory_consumptions oic ON oic.supply_movement_id = sm.id
      WHERE oic.order_id = ? AND sm.supply_id = ?
    `).all(orderF.orderId, boxSupplyId) as Array<{ quantity_delta: number }>;
    assert.strictEqual(boxMovementsF.reduce((s, m) => s + Math.abs(m.quantity_delta), 0), 1, 'Test F: Exactly 1 box consumed');

    console.log('  ✓ Test F Passed: BOGO active -> 2 prepared, full ingredients deducted, 1 box, 1 plate');

    // ------------------------------------------------------------------------
    // TEST I: Standalone box sale (0 pancakes, 2 boxes) -> 0 plates, 2 boxes consumed
    // ------------------------------------------------------------------------
    console.log('\n--- TEST I: Standalone box sale (0 pancakes, 2 boxes) ---');
    const dateI = '2026-11-20 16:00:00';
    const orderI = await createAndSettleOrder({
      items: [
        {
          product_id: parcelBoxProdId,
          quantity: 2,
          serving_allocations: [{ serving_type: 'parcel', quantity: 2 }],
        },
      ],
      packaging_boxes_count: 0,
      paidAtDate: dateI,
    });

    const plateMovementsI = db.prepare(`
      SELECT sm.quantity_delta
      FROM supply_movements sm
      JOIN order_inventory_consumptions oic ON oic.supply_movement_id = sm.id
      WHERE oic.order_id = ? AND sm.supply_id = ?
    `).all(orderI.orderId, plateSupplyId) as Array<{ quantity_delta: number }>;
    assert.strictEqual(plateMovementsI.length, 0, 'Test I: 0 plate movements for standalone boxes');

    const boxMovementsI = db.prepare(`
      SELECT sm.quantity_delta
      FROM supply_movements sm
      JOIN order_inventory_consumptions oic ON oic.supply_movement_id = sm.id
      WHERE oic.order_id = ? AND sm.supply_id = ?
    `).all(orderI.orderId, boxSupplyId) as Array<{ quantity_delta: number }>;
    assert.strictEqual(boxMovementsI.reduce((s, m) => s + Math.abs(m.quantity_delta), 0), 2, 'Test I: 2 boxes consumed');

    console.log('  ✓ Test I Passed: Standalone box sale consumed 2 boxes and 0 plates');

    // ------------------------------------------------------------------------
    // TEST J: Cancelled order does NOT consume inventory
    // ------------------------------------------------------------------------
    console.log('\n--- TEST J: Cancelled order does not consume inventory ---');
    const cancelCreateRes = await api(baseUrl, '/api/orders', {
      method: 'POST',
      headers,
      body: {
        type: 'takeaway',
        items: [
          {
            product_id: pancakeProdId,
            quantity: 2,
            serving_allocations: [{ serving_type: 'dine_in', quantity: 2 }],
          },
          {
            product_id: parcelBoxProdId,
            quantity: 1,
            serving_allocations: [{ serving_type: 'parcel', quantity: 1 }],
          },
        ],
      },
    });
    const cancelOrderId = cancelCreateRes.data.order.id;

    // Cancel order
    const cancelRes = await api(baseUrl, `/api/orders/${cancelOrderId}/status`, {
      method: 'PATCH',
      headers,
      body: { status: 'cancelled', reason: 'Customer changed mind' },
    });
    assert.strictEqual(cancelRes.status, 200, 'Order cancelled');

    // Verify 0 consumptions or movements for this cancelled order
    const cancelConsumptions = db.prepare('SELECT COUNT(*) as count FROM order_inventory_consumptions WHERE order_id = ?').get(cancelOrderId) as any;
    assert.strictEqual(cancelConsumptions.count, 0, 'Test J: 0 inventory consumptions for cancelled order');

    const cancelSupplyMovements = db.prepare("SELECT COUNT(*) as count FROM supply_movements WHERE reference_id = ? AND reference_type = 'order_item'").get(cancelOrderId) as any;
    assert.strictEqual(cancelSupplyMovements.count, 0, 'Test J: 0 supply movements for cancelled order');

    console.log('  ✓ Test J Passed: Cancelled order consumed 0 inventory');

    // ------------------------------------------------------------------------
    // TEST G: Actual ledger deductions equal order allocation exactly
    // ------------------------------------------------------------------------
    console.log('\n--- TEST G: Actual ledger deductions equal order allocation exactly ---');
    // Summary of settled orders: A, B, C, D, E, F, I
    // Order A: 2 plates, 2 boxes (2 standalone, 0 allocated)
    // Order B: 1 plate, 2 boxes (1 standalone, 1 allocated)
    // Order C: 0 plates, 2 boxes (0 standalone, 2 allocated)
    // Order D: 1 plate, 1 box (0 standalone, 1 allocated)
    // Order E: 2 plates, 0 boxes (0 standalone, 0 allocated)
    // Order F: 1 plate, 1 box (0 standalone, 1 allocated)
    // Order I: 0 plates, 2 boxes (2 standalone, 0 allocated)
    // Total Expected:
    // Plates = 2 + 1 + 0 + 1 + 2 + 1 + 0 = 7 plates
    // Boxes = 2 + 2 + 2 + 1 + 0 + 1 + 2 = 10 boxes (5 allocated, 5 standalone)
    const allPlateDeductions = db.prepare(`
      SELECT SUM(ABS(sm.quantity_delta)) as total
      FROM supply_movements sm
      WHERE sm.supply_id = ?
    `).get(plateSupplyId) as any;
    assert.strictEqual(Number(allPlateDeductions.total), 7, 'Test G: Total ledger plate deductions = 7');

    const allBoxDeductions = db.prepare(`
      SELECT SUM(ABS(sm.quantity_delta)) as total
      FROM supply_movements sm
      WHERE sm.supply_id = ?
    `).get(boxSupplyId) as any;
    assert.strictEqual(Number(allBoxDeductions.total), 10, 'Test G: Total ledger box deductions = 10');

    console.log('  ✓ Test G Passed: Total ledger plate deductions = 7, box deductions = 10');

    // ------------------------------------------------------------------------
    // TEST H: Dashboard, product-wise reporting, packaging reports, normal/BOGO, and exports
    // ------------------------------------------------------------------------
    console.log('\n--- TEST H: Dashboard, Reports, and Export Reconciliation ---');
    const dashboard = computeRoadsideDashboardSummary(db, '2026-11-20 00:00:00', '2026-11-20 23:59:59', '2026-11-20', '2026-11-20');

    // Verify packagingSummary
    assert.strictEqual(dashboard.packagingSummary.paperPlatesConsumed, 7, 'Dashboard plates consumed = 7');
    assert.strictEqual(dashboard.packagingSummary.parcelBoxesSold, 10, 'Dashboard boxes sold = 10');
    assert.strictEqual(dashboard.packagingSummary.parcelBoxesAllocated, 5, 'Dashboard boxes allocated = 5');
    assert.strictEqual(dashboard.packagingSummary.parcelBoxesStandalone, 5, 'Dashboard boxes standalone = 5');
    assert.strictEqual(dashboard.packagingSummary.paperPlateCost, 7 * 2.5, 'Dashboard plate cost = 17.50');
    assert.strictEqual(dashboard.packagingSummary.parcelBoxCost, 10 * 3.5, 'Dashboard box cost = 35.00');

    // Verify product performance
    const pancakePerf = dashboard.productPerformance.find((p) => p.productId === pancakeProdId);
    assert.ok(pancakePerf, 'Pancake performance found');
    // Prepared: 2(A) + 2(B) + 2(C) + 2(D) + 2(E) + 2(F) = 12 pancakes (11 paid, 1 free)
    assert.strictEqual(pancakePerf.totalPrepared, 12, '12 pancakes prepared');
    assert.strictEqual(pancakePerf.paidQuantity, 11, '11 paid pancakes');
    assert.strictEqual(pancakePerf.freeQuantity, 1, '1 free pancake');

    const boxPerf = dashboard.productPerformance.find((p) => p.productId === parcelBoxProdId);
    assert.ok(boxPerf, 'Parcel Box performance found');
    assert.strictEqual(boxPerf.paidQuantity, 10, '10 parcel boxes sold');

    // Verify Normal Sales vs BOGO Sales
    assert.strictEqual(dashboard.bogoSalesSummary.pancakesPrepared, 2, 'BOGO pancakes prepared = 2');
    assert.strictEqual(dashboard.bogoSalesSummary.paidQuantity, 1, 'BOGO paid quantity = 1');
    assert.strictEqual(dashboard.bogoSalesSummary.freeQuantity, 1, 'BOGO free quantity = 1');
    assert.strictEqual(dashboard.bogoSalesSummary.pairsRedeemed, 1, 'BOGO 1 pair redeemed');
    assert.strictEqual(dashboard.normalSalesSummary.paidQuantity, 10, 'Normal sales paid quantity = 10');

    // Verify Daily Sales Export dataset
    const dailyDataset = buildDailySalesExportDataset({ from: '2026-11-20', to: '2026-11-20' }, db);
    assert.strictEqual(dailyDataset.summary.packaging_cost_total, 35.0, 'Daily export packaging cost total = ₹35.00');

    // Verify Sales Reports Dataset
    const salesReport = buildSalesReportsDataset(db, '2026-11-20', '2026-11-20');
    assert.strictEqual(salesReport.normalTotals.quantity, 10, 'Sales report normal quantity = 10');
    assert.strictEqual(salesReport.bogoTotals.paidQuantity, 1, 'Sales report BOGO paid quantity = 1');
    assert.strictEqual(salesReport.bogoTotals.freeQuantity, 1, 'Sales report BOGO free quantity = 1');
    assert.strictEqual(
      salesReport.normalTotals.paperPlateCost + salesReport.bogoTotals.paperPlateCost,
      17.5,
      'Sales report total plate cost = ₹17.50 (7 plates)',
    );

    console.log('  ✓ Test H Passed: Dashboard, reports, and exports are 100% reconciled with actuals');

  } finally {
    server.close();
    closeDatabase();
  }

  console.log('\n================================================================');
  console.log('ALL ACCEPTANCE TESTS A THROUGH J PASSED PERFECTLY (100%)');
  console.log('================================================================');
}

runTests().catch((err) => {
  console.error('Test suite failed with error:', err);
  process.exit(1);
});
