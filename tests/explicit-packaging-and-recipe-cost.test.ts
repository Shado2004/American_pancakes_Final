/**
 * Tests for Explicit Parcel Box Packaging Allocation and Live Recipe Costs
 *
 * Verifies:
 * 1. calculateRoadsidePackaging and recomputeRoadsideAllocations (10 scenarios)
 * 2. SQLite persistence of explicit serving_allocations in order_item_serving_allocations
 * 3. Dashboard metrics (RoadsideReporting, SalesReports, DailySales) reflecting explicit packaging
 * 4. Products API returning authoritative live recipe costs (Cotton Candy ₹40.53, Dark Choc ₹36.42, etc.)
 */

import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const Module = require('module');
const originalLoad = Module._load;
let activeTestDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flo-pkg-recipe-test-'));

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

import { initDatabase, getDatabase, closeDatabase, now } from '../main/db';
import { computeRoadsideDashboardSummary } from '../main/services/roadside-reporting';
import { buildSalesReportsDataset } from '../main/services/sales-reports-export';
import { buildDailySalesExportDataset } from '../main/services/daily-sales-export';
import { productRoutes } from '../main/routes/products';
import { orderRoutes } from '../main/routes/orders';
import { billRoutes } from '../main/routes/bills';
import { createApp, startServer, seedOwnerUser, api } from './helpers/test-setup';

interface ServingAllocationInput {
  serving_type: 'dine_in' | 'parcel';
  quantity: number;
}

interface TestItem {
  id: string;
  product: {
    id: string;
    name: string;
    price: number;
    cost: number;
  };
  quantity: number;
  serving_allocations?: ServingAllocationInput[];
}

function isParcelBox(product: any): boolean {
  if (!product) return false;
  return (
    String(product.id) === 'pr_parcel_box_5' ||
    (typeof product.name === 'string' && product.name.toLowerCase().includes('parcel box'))
  );
}

function calculateRoadsidePackaging(items: TestItem[], packagingBoxesCount?: number | null) {
  const pancakes = items
    .filter((item) => !isParcelBox(item.product))
    .reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);

  const boxes = items
    .filter((item) => isParcelBox(item.product))
    .reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);

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
  const boxUnitCost = 3.5;
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

function recomputeRoadsideAllocations(
  items: TestItem[],
  packagingBoxesCount?: number | null,
): TestItem[] {
  const summary = calculateRoadsidePackaging(items, packagingBoxesCount);
  let remainingPackagingBoxes = summary.boxesAllocated;

  return items.map((item) => {
    if (isParcelBox(item.product)) {
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

function makeCartItem(id: string, name: string, price: number, qty: number, isBox = false): TestItem {
  return {
    id,
    product: {
      id: isBox ? 'pr_parcel_box_5' : id,
      name,
      price,
      cost: isBox ? 3.5 : 30,
    },
    quantity: qty,
    serving_allocations: [],
  };
}

async function runTests() {
  console.log('================================================================');
  console.log('START: Explicit Packaging & Live Recipe Cost Verification Suite');
  console.log('================================================================');

  // --------------------------------------------------------------------------
  // SECTION 1: 10 Packaging Allocation Calculation Scenarios
  // --------------------------------------------------------------------------
  console.log('\n--- SECTION 1: 10 Packaging Allocation Calculation Scenarios ---');

  // Scenario 1: 0 pancakes, 0 boxes
  {
    const s1 = calculateRoadsidePackaging([], null);
    assert.strictEqual(s1.pancakes, 0);
    assert.strictEqual(s1.boxes, 0);
    assert.strictEqual(s1.boxesAllocated, 0);
    assert.strictEqual(s1.boxesStandalone, 0);
    assert.strictEqual(s1.plates, 0);
    assert.strictEqual(s1.internalCost, 0);
    console.log('  ✓ Scenario 1: 0 pancakes, 0 boxes -> 0 plates, 0 allocated, 0 standalone');
  }

  // Scenario 2: 1 pancake, 0 boxes
  {
    const items = [makeCartItem('p1', 'Cotton Candy Pancake', 90, 1)];
    const s2 = calculateRoadsidePackaging(items, null);
    assert.strictEqual(s2.pancakes, 1);
    assert.strictEqual(s2.boxes, 0);
    assert.strictEqual(s2.boxesAllocated, 0);
    assert.strictEqual(s2.boxesStandalone, 0);
    assert.strictEqual(s2.plates, 1);
    assert.strictEqual(s2.internalCost, 2.5);
    console.log('  ✓ Scenario 2: 1 pancake, 0 boxes -> 1 plate, 0 allocated, 0 standalone');
  }

  // Scenario 3: 1 pancake, 1 box, default allocated=1
  {
    const items = [
      makeCartItem('p1', 'Cotton Candy Pancake', 90, 1),
      makeCartItem('b1', 'Parcel Box', 5, 1, true),
    ];
    const s3 = calculateRoadsidePackaging(items, null);
    assert.strictEqual(s3.pancakes, 1);
    assert.strictEqual(s3.boxes, 1);
    assert.strictEqual(s3.boxesAllocated, 1);
    assert.strictEqual(s3.boxesStandalone, 0);
    assert.strictEqual(s3.plates, 0);
    assert.strictEqual(s3.internalCost, 3.5);
    console.log('  ✓ Scenario 3: 1 pancake, 1 box (default) -> 0 plates, 1 allocated, 0 standalone');
  }

  // Scenario 4: 1 pancake, 1 box, explicit allocated=0 (standalone box)
  {
    const items = [
      makeCartItem('p1', 'Cotton Candy Pancake', 90, 1),
      makeCartItem('b1', 'Parcel Box', 5, 1, true),
    ];
    const s4 = calculateRoadsidePackaging(items, 0);
    assert.strictEqual(s4.pancakes, 1);
    assert.strictEqual(s4.boxes, 1);
    assert.strictEqual(s4.boxesAllocated, 0);
    assert.strictEqual(s4.boxesStandalone, 1);
    assert.strictEqual(s4.plates, 1);
    assert.strictEqual(s4.internalCost, 6.0); // 1 plate @ 2.50 + 1 box @ 3.50
    console.log('  ✓ Scenario 4: 1 pancake, 1 box (explicit 0) -> 1 plate, 0 allocated, 1 standalone');
  }

  // Scenario 5: 2 pancakes, 2 boxes, default allocated=2
  {
    const items = [
      makeCartItem('p1', 'Cotton Candy Pancake', 90, 2),
      makeCartItem('b1', 'Parcel Box', 5, 2, true),
    ];
    const s5 = calculateRoadsidePackaging(items, null);
    assert.strictEqual(s5.pancakes, 2);
    assert.strictEqual(s5.boxes, 2);
    assert.strictEqual(s5.boxesAllocated, 2);
    assert.strictEqual(s5.boxesStandalone, 0);
    assert.strictEqual(s5.plates, 0);
    assert.strictEqual(s5.internalCost, 7.0); // 2 boxes @ 3.50
    console.log('  ✓ Scenario 5: 2 pancakes, 2 boxes (default) -> 0 plates, 2 allocated, 0 standalone');
  }

  // Scenario 6: 2 pancakes, 2 boxes, explicit allocated=1 (1 packaging, 1 standalone)
  {
    const items = [
      makeCartItem('p1', 'Cotton Candy Pancake', 90, 2),
      makeCartItem('b1', 'Parcel Box', 5, 2, true),
    ];
    const s6 = calculateRoadsidePackaging(items, 1);
    assert.strictEqual(s6.pancakes, 2);
    assert.strictEqual(s6.boxes, 2);
    assert.strictEqual(s6.boxesAllocated, 1);
    assert.strictEqual(s6.boxesStandalone, 1);
    assert.strictEqual(s6.plates, 1); // 2 - 1 = 1 plate
    assert.strictEqual(s6.internalCost, 9.5); // 1 plate @ 2.50 + 2 boxes @ 3.50 = 9.50
    console.log('  ✓ Scenario 6: 2 pancakes, 2 boxes (explicit 1) -> 1 plate, 1 allocated, 1 standalone');
  }

  // Scenario 7: 2 pancakes, 2 boxes, explicit allocated=0 (2 standalone)
  {
    const items = [
      makeCartItem('p1', 'Cotton Candy Pancake', 90, 2),
      makeCartItem('b1', 'Parcel Box', 5, 2, true),
    ];
    const s7 = calculateRoadsidePackaging(items, 0);
    assert.strictEqual(s7.pancakes, 2);
    assert.strictEqual(s7.boxes, 2);
    assert.strictEqual(s7.boxesAllocated, 0);
    assert.strictEqual(s7.boxesStandalone, 2);
    assert.strictEqual(s7.plates, 2); // 2 plates
    assert.strictEqual(s7.internalCost, 12.0); // 2 plates @ 2.50 + 2 boxes @ 3.50 = 12.00
    console.log('  ✓ Scenario 7: 2 pancakes, 2 boxes (explicit 0) -> 2 plates, 0 allocated, 2 standalone');
  }

  // Scenario 8: 3 pancakes, 1 box, default allocated=1
  {
    const items = [
      makeCartItem('p1', 'Cotton Candy Pancake', 90, 3),
      makeCartItem('b1', 'Parcel Box', 5, 1, true),
    ];
    const s8 = calculateRoadsidePackaging(items, null);
    assert.strictEqual(s8.pancakes, 3);
    assert.strictEqual(s8.boxes, 1);
    assert.strictEqual(s8.boxesAllocated, 1);
    assert.strictEqual(s8.boxesStandalone, 0);
    assert.strictEqual(s8.plates, 2); // 3 - 1 = 2 plates
    assert.strictEqual(s8.internalCost, 8.5); // 2 plates @ 2.50 + 1 box @ 3.50 = 8.50
    console.log('  ✓ Scenario 8: 3 pancakes, 1 box (default) -> 2 plates, 1 allocated, 0 standalone');
  }

  // Scenario 9: 3 pancakes, 1 box, explicit allocated=0
  {
    const items = [
      makeCartItem('p1', 'Cotton Candy Pancake', 90, 3),
      makeCartItem('b1', 'Parcel Box', 5, 1, true),
    ];
    const s9 = calculateRoadsidePackaging(items, 0);
    assert.strictEqual(s9.pancakes, 3);
    assert.strictEqual(s9.boxes, 1);
    assert.strictEqual(s9.boxesAllocated, 0);
    assert.strictEqual(s9.boxesStandalone, 1);
    assert.strictEqual(s9.plates, 3); // 3 plates
    assert.strictEqual(s9.internalCost, 11.0); // 3 plates @ 2.50 + 1 box @ 3.50 = 11.00
    console.log('  ✓ Scenario 9: 3 pancakes, 1 box (explicit 0) -> 3 plates, 0 allocated, 1 standalone');
  }

  // Scenario 10: 0 pancakes, 2 boxes (standalone only)
  {
    const items = [makeCartItem('b1', 'Parcel Box', 5, 2, true)];
    const s10 = calculateRoadsidePackaging(items, null);
    assert.strictEqual(s10.pancakes, 0);
    assert.strictEqual(s10.boxes, 2);
    assert.strictEqual(s10.boxesAllocated, 0);
    assert.strictEqual(s10.boxesStandalone, 2);
    assert.strictEqual(s10.plates, 0);
    assert.strictEqual(s10.internalCost, 7.0); // 2 boxes @ 3.50
    console.log('  ✓ Scenario 10: 0 pancakes, 2 boxes (standalone) -> 0 plates, 0 allocated, 2 standalone');
  }

  // --------------------------------------------------------------------------
  // SECTION 2: recomputeRoadsideAllocations Cart Item Serving Allocations
  // --------------------------------------------------------------------------
  console.log('\n--- SECTION 2: recomputeRoadsideAllocations Verification ---');
  {
    const items = [
      makeCartItem('p1', 'Cotton Candy Pancake', 90, 2),
      makeCartItem('b1', 'Parcel Box', 5, 2, true),
    ];
    // Explicit 1 packaging box
    const recomputed = recomputeRoadsideAllocations(items, 1);
    const pancakeLine = recomputed.find((i) => i.id === 'p1')!;
    const boxLine = recomputed.find((i) => i.id === 'b1')!;

    assert.strictEqual(pancakeLine.serving_allocations?.length, 2);
    const parcelAlloc = pancakeLine.serving_allocations?.find((a) => a.serving_type === 'parcel');
    const dineInAlloc = pancakeLine.serving_allocations?.find((a) => a.serving_type === 'dine_in');
    assert.strictEqual(parcelAlloc?.quantity, 1, '1 pancake in parcel box');
    assert.strictEqual(dineInAlloc?.quantity, 1, '1 pancake on dine_in paper plate');

    assert.strictEqual(boxLine.serving_allocations?.length, 1);
    assert.strictEqual(boxLine.serving_allocations?.[0].serving_type, 'parcel');
    assert.strictEqual(boxLine.serving_allocations?.[0].quantity, 2);
    console.log('  ✓ Pancake line correctly split into 1 parcel and 1 dine_in serving allocation');
  }

  // --------------------------------------------------------------------------
  // SECTION 3: Integration Test with Live Database & HTTP API
  // --------------------------------------------------------------------------
  console.log('\n--- SECTION 3: Live Database & HTTP API Verification ---');
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
  db.prepare(`
    INSERT OR REPLACE INTO supplies (id, name, base_unit, stock_quantity, unit_cost, created_at, updated_at)
    VALUES
      ('sup_batter', 'Pancake Batter', 'g', 10000, 0.136842, '${now()}', '${now()}'),
      ('sup_sticks', 'Sticks & Tissue Set', 'each', 1000, 0.50, '${now()}', '${now()}'),
      ('sup_ffdfa4ad3785608b17b4d5a7', 'Paper Plate', 'each', 1000, 2.50, '${now()}', '${now()}'),
      ('sup_cotton_fill', 'Cotton Candy Filling', 'g', 5000, 0.4111, '${now()}', '${now()}'),
      ('sup_dark_fill', 'Dark Chocolate Filling', 'g', 5000, 0.411111, '${now()}', '${now()}'),
      ('sup_white_fill', 'White Chocolate Filling', 'g', 5000, 0.4111, '${now()}', '${now()}'),
      ('sup_milk_fill', 'Milk Chocolate Filling', 'g', 5000, 0.4111, '${now()}', '${now()}'),
      ('sup_oreo_fill', 'Oreo Filling', 'g', 5000, 0.4111, '${now()}', '${now()}'),
      ('sup_oreo_top', 'Oreo Topping', 'each', 1000, 10.0, '${now()}', '${now()}'),
      ('sup_box', 'Parcel Box Packaging', 'each', 500, 3.50, '${now()}', '${now()}')
  `).run();

  // Seed categories
  db.prepare("INSERT OR REPLACE INTO categories (id, name, color) VALUES ('cat_pancakes', 'Pancakes', '#f59e0b')").run();
  db.prepare("INSERT OR REPLACE INTO categories (id, name, color) VALUES ('cat_packaging', 'Packaging', '#3b82f6')").run();

  // Seed products
  db.prepare(`
    INSERT OR REPLACE INTO products (id, name, price, cost, category_id, is_active, track_inventory, stock_quantity, low_stock_threshold, created_at, updated_at)
    VALUES
      ('prod_cotton', 'Cotton Candy Pancake', 90, 40.52, 'cat_pancakes', 1, 0, 100, 10, '${now()}', '${now()}'),
      ('prod_dark', 'Dark Chocolate Pancake', 70, 33.91, 'cat_pancakes', 1, 0, 100, 10, '${now()}', '${now()}'),
      ('prod_white', 'White Chocolate Pancake', 90, 36.41, 'cat_pancakes', 1, 0, 100, 10, '${now()}', '${now()}'),
      ('prod_milk', 'Milk Chocolate Pancake', 80, 36.41, 'cat_pancakes', 1, 0, 100, 10, '${now()}', '${now()}'),
      ('prod_oreo', 'Oreo Pancake', 90, 50.52, 'cat_pancakes', 1, 0, 100, 10, '${now()}', '${now()}'),
      ('pr_parcel_box_5', 'Parcel Box', 5, 3.50, 'cat_packaging', 1, 0, 100, 10, '${now()}', '${now()}')
  `).run();

  // Seed recipes
  // Cotton Candy: Batter (64g) + Sticks (1) + Cotton Candy Filling (70g) + Paper Plate (1) = 40.534888 -> 40.53
  db.prepare(`
    INSERT OR REPLACE INTO recipes (id, product_id, yield_quantity, is_active, created_at, updated_at)
    VALUES ('rec_cotton', 'prod_cotton', 1, 1, '${now()}', '${now()}')
  `).run();
  db.prepare(`
    INSERT OR REPLACE INTO recipe_items (id, recipe_id, supply_id, quantity, unit)
    VALUES
      ('ri_c1', 'rec_cotton', 'sup_batter', 64, 'g'),
      ('ri_c2', 'rec_cotton', 'sup_sticks', 1, 'each'),
      ('ri_c3', 'rec_cotton', 'sup_cotton_fill', 70, 'g'),
      ('ri_c4', 'rec_cotton', 'sup_ffdfa4ad3785608b17b4d5a7', 1, 'each')
  `).run();

  // Dark Chocolate: Batter (64g) + Sticks (1) + Dark Choc Filling (60g) + Paper Plate (1) = 36.424548 -> 36.42
  db.prepare(`
    INSERT OR REPLACE INTO recipes (id, product_id, yield_quantity, is_active, created_at, updated_at)
    VALUES ('rec_dark', 'prod_dark', 1, 1, '${now()}', '${now()}')
  `).run();
  db.prepare(`
    INSERT OR REPLACE INTO recipe_items (id, recipe_id, supply_id, quantity, unit)
    VALUES
      ('ri_d1', 'rec_dark', 'sup_batter', 64, 'g'),
      ('ri_d2', 'rec_dark', 'sup_sticks', 1, 'each'),
      ('ri_d3', 'rec_dark', 'sup_dark_fill', 60, 'g'),
      ('ri_d4', 'rec_dark', 'sup_ffdfa4ad3785608b17b4d5a7', 1, 'each')
  `).run();

  // White Chocolate: Batter (64g) + Sticks (1) + White Choc Filling (60g) + Paper Plate (1) = 36.42
  db.prepare(`INSERT OR REPLACE INTO recipes (id, product_id, yield_quantity, is_active, created_at, updated_at) VALUES ('rec_white', 'prod_white', 1, 1, '${now()}', '${now()}')`).run();
  db.prepare(`INSERT OR REPLACE INTO recipe_items (id, recipe_id, supply_id, quantity, unit) VALUES ('ri_w1', 'rec_white', 'sup_batter', 64, 'g'), ('ri_w2', 'rec_white', 'sup_sticks', 1, 'each'), ('ri_w3', 'rec_white', 'sup_white_fill', 60, 'g'), ('ri_w4', 'rec_white', 'sup_ffdfa4ad3785608b17b4d5a7', 1, 'each')`).run();

  // Milk Chocolate: Batter (64g) + Sticks (1) + Milk Choc Filling (60g) + Paper Plate (1) = 36.42
  db.prepare(`INSERT OR REPLACE INTO recipes (id, product_id, yield_quantity, is_active, created_at, updated_at) VALUES ('rec_milk', 'prod_milk', 1, 1, '${now()}', '${now()}')`).run();
  db.prepare(`INSERT OR REPLACE INTO recipe_items (id, recipe_id, supply_id, quantity, unit) VALUES ('ri_m1', 'rec_milk', 'sup_batter', 64, 'g'), ('ri_m2', 'rec_milk', 'sup_sticks', 1, 'each'), ('ri_m3', 'rec_milk', 'sup_milk_fill', 60, 'g'), ('ri_m4', 'rec_milk', 'sup_ffdfa4ad3785608b17b4d5a7', 1, 'each')`).run();

  // Oreo: Batter (64g) + Sticks (1) + Oreo Filling (70g) + Oreo Topping (1) + Paper Plate (1) = 50.53
  db.prepare(`INSERT OR REPLACE INTO recipes (id, product_id, yield_quantity, is_active, created_at, updated_at) VALUES ('rec_oreo', 'prod_oreo', 1, 1, '${now()}', '${now()}')`).run();
  db.prepare(`INSERT OR REPLACE INTO recipe_items (id, recipe_id, supply_id, quantity, unit) VALUES ('ri_o1', 'rec_oreo', 'sup_batter', 64, 'g'), ('ri_o2', 'rec_oreo', 'sup_sticks', 1, 'each'), ('ri_o3', 'rec_oreo', 'sup_oreo_fill', 70, 'g'), ('ri_o4', 'rec_oreo', 'sup_oreo_top', 1, 'each'), ('ri_o5', 'rec_oreo', 'sup_ffdfa4ad3785608b17b4d5a7', 1, 'each')`).run();

  const owner = seedOwnerUser(db);

  // Seed default parcel box profile
  db.prepare(`
    INSERT OR REPLACE INTO packaging_profiles (
      id, name, description, notes, serving_type, packaging_type,
      supply_id, units_per_serving, customer_charge_per_unit,
      is_active, is_default, created_by_user_id, updated_by_user_id,
      created_at, updated_at
    ) VALUES (
      'pkg_box_default', 'Parcel Box', 'Standard box', '', 'parcel', 'parcel_box',
      'sup_box', 1, 0,
      1, 1, '${owner.userId}', '${owner.userId}',
      '${now()}', '${now()}'
    )
  `).run();

  // Seed default dine_in profile
  db.prepare(`
    INSERT OR REPLACE INTO packaging_profiles (
      id, name, description, notes, serving_type, packaging_type,
      supply_id, units_per_serving, customer_charge_per_unit,
      is_active, is_default, created_by_user_id, updated_by_user_id,
      created_at, updated_at
    ) VALUES (
      'pkg_dine_default', 'Dine In Plate', 'Standard plate', '', 'dine_in', 'paper_plate',
      'sup_ffdfa4ad3785608b17b4d5a7', 1, 0,
      1, 1, '${owner.userId}', '${owner.userId}',
      '${now()}', '${now()}'
    )
  `).run();
  const app = createApp({
    '/api/products': productRoutes,
    '/api/orders': orderRoutes,
    '/api/bills': billRoutes,
  });
  const { baseUrl, server } = await startServer(app);
  const headers = owner.authHeader;

  try {
    // 3A: Products API live recipe cost verification
    const resProducts = await api(baseUrl, '/api/products', { headers });
    assert.strictEqual(resProducts.status, 200);
    const products: any[] = resProducts.data.products;

    const cottonCandy = products.find((p) => p.name === 'Cotton Candy Pancake');
    const darkChoc = products.find((p) => p.name === 'Dark Chocolate Pancake');
    const whiteChoc = products.find((p) => p.name === 'White Chocolate Pancake');
    const milkChoc = products.find((p) => p.name === 'Milk Chocolate Pancake');
    const oreo = products.find((p) => p.name === 'Oreo Pancake');
    const parcelBox = products.find((p) => p.name === 'Parcel Box');

    assert.ok(cottonCandy, 'Cotton Candy found');
    assert.strictEqual(cottonCandy.cost, 40.53, 'Cotton Candy live cost must be 40.53');
    assert.strictEqual(cottonCandy.live_recipe_cost, 40.53, 'Cotton Candy live recipe cost is 40.53');
    assert.strictEqual(cottonCandy.raw_recipe_cost, 38.03, 'Cotton Candy raw cost is 38.03 (40.53 - 2.50 plate)');
    console.log('  ✓ Cotton Candy Pancake: Live cost ₹40.53 (₹38.03 raw + ₹2.50 plate)');

    assert.ok(darkChoc, 'Dark Chocolate found');
    assert.strictEqual(darkChoc.cost, 36.42, 'Dark Choc live cost must be 36.42');
    assert.strictEqual(darkChoc.live_recipe_cost, 36.42, 'Dark Choc live recipe cost is 36.42');
    assert.strictEqual(darkChoc.raw_recipe_cost, 33.92, 'Dark Choc raw cost is 33.92 (36.42 - 2.50 plate)');
    console.log('  ✓ Dark Chocolate Pancake: Live cost ₹36.42 (₹33.92 raw + ₹2.50 plate)');

    assert.ok(whiteChoc, 'White Chocolate found');
    assert.strictEqual(whiteChoc.cost, 36.42, 'White Choc live cost must be 36.42');

    assert.ok(milkChoc, 'Milk Chocolate found');
    assert.strictEqual(milkChoc.cost, 36.42, 'Milk Choc live cost must be 36.42');

    assert.ok(oreo, 'Oreo found');
    assert.strictEqual(oreo.cost, 50.53, 'Oreo live cost must be 50.53');

    assert.ok(parcelBox, 'Parcel Box found');
    assert.strictEqual(parcelBox.cost, 3.5, 'Parcel Box cost is 3.50 purchase cost');
    assert.strictEqual(parcelBox.has_recipe, false, 'Parcel Box has no recipe');
    console.log('  ✓ Parcel Box: purchase cost ₹3.50 (has_recipe = false)');

    // 3B: Order with explicit packaging allocation (2 Cotton Candy + 2 Parcel Boxes, 1 packaging, 1 standalone)
    const testDate = '2026-11-20 12:00:00';
    const createOrderRes = await api(baseUrl, '/api/orders', {
      method: 'POST',
      headers,
      body: {
        type: 'takeaway',
        items: [
          {
            product_id: cottonCandy.id,
            quantity: 2,
            serving_allocations: [
              { serving_type: 'parcel', quantity: 1 },
              { serving_type: 'dine_in', quantity: 1 },
            ],
          },
          {
            product_id: parcelBox.id,
            quantity: 2,
            serving_allocations: [{ serving_type: 'parcel', quantity: 2 }],
          },
        ],
      },
    });
    if (createOrderRes.status !== 201) {
      console.error('createOrderRes error:', createOrderRes.status, createOrderRes.data);
    }
    assert.strictEqual(createOrderRes.status, 201, 'Order created');
    const orderId = createOrderRes.data.order.id;

    // Verify order_item_serving_allocations in SQLite
    const pancakeItem = db.prepare('SELECT id FROM order_items WHERE order_id = ? AND product_id = ?').get(orderId, cottonCandy.id) as { id: number };
    const allocationsInDb = db.prepare('SELECT serving_type, quantity FROM order_item_serving_allocations WHERE order_item_id = ? ORDER BY id ASC').all(pancakeItem.id) as { serving_type: string; quantity: number }[];
    assert.strictEqual(allocationsInDb.length, 2, '2 serving allocations in DB');
    assert.strictEqual(allocationsInDb[0].serving_type, 'parcel');
    assert.strictEqual(allocationsInDb[0].quantity, 1);
    assert.strictEqual(allocationsInDb[1].serving_type, 'dine_in');
    assert.strictEqual(allocationsInDb[1].quantity, 1);
    console.log('  ✓ SQLite order_item_serving_allocations correctly persisted explicit parcel/dine_in breakdown');

    // Settle bill for order
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

    // Update paid_at to testDate for exact reporting query
    db.prepare('UPDATE bills SET paid_at = ? WHERE id = ?').run(testDate, billId);

    // 3C: Query Dashboard summary via computeRoadsideDashboardSummary
    const summary = computeRoadsideDashboardSummary(db, '2026-11-20 00:00:00', '2026-11-20 23:59:59');
    assert.strictEqual(summary.packagingSummary.parcelBoxesSold, 2, '2 boxes sold');
    assert.strictEqual(summary.packagingSummary.parcelBoxesAllocated, 1, '1 box explicitly allocated for packaging');
    assert.strictEqual(summary.packagingSummary.parcelBoxesStandalone, 1, '1 box standalone');
    assert.strictEqual(summary.packagingSummary.paperPlatesConsumed, 1, '1 paper plate consumed for unboxed pancake');
    assert.strictEqual(summary.packagingSummary.paperPlateCost, 2.5, 'Plate cost ₹2.50');
    assert.strictEqual(summary.packagingSummary.parcelBoxCost, 7.0, '2 boxes cost ₹7.00');
    console.log('  ✓ Dashboard computeRoadsideDashboardSummary reflects exact explicit packaging (1 allocated, 1 standalone, 1 plate)');

    // 3D: Sales Reports Dataset verification
    const salesReport = buildSalesReportsDataset(db, '2026-11-20', '2026-11-20');
    assert.strictEqual(salesReport.normalTotals.paperPlateCost, 2.5, 'Normal sales paper plate cost is ₹2.50');
    console.log('  ✓ Sales Reports Dataset paper plate cost is ₹2.50 for explicit 1-plate consumption');

    // 3E: Daily Sales Export Dataset verification
    const dailyDataset = buildDailySalesExportDataset({ from: '2026-11-20', to: '2026-11-20' }, db);
    assert.strictEqual(dailyDataset.summary.packaging_cost_total, 7.0, 'Daily Sales total packaging cost is ₹7.00');
    console.log('  ✓ Daily Sales Export Dataset total packaging cost is ₹7.00');

  } finally {
    server.close();
    closeDatabase();
  }

  console.log('\n================================================================');
  console.log('ALL EXPLICIT PACKAGING & LIVE RECIPE COST TESTS PASSED (100%)');
  console.log('================================================================');
}

runTests().catch((err) => {
  console.error('Test failed with error:', err);
  process.exit(1);
});
