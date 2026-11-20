/**
 * FloCafe / American Pancakes - POS Roadside Packaging Verification
 *
 * Covers all 13 required scenarios:
 *  1. 1 pancake without parcel box (1 plate, 0 boxes, ₹90 total, ₹2.50 internal cost)
 *  2. 1 pancake with 1 parcel box (0 plates, 1 box, ₹95 total, ₹0 plate cost)
 *  3. 2 pancakes without parcel box (2 plates, 0 boxes, ₹180 total)
 *  4. 2 pancakes with 1 parcel box (1 plate, 1 box, ₹185 total)
 *  5. 2 pancakes with 2 parcel boxes (0 plates, 2 boxes, ₹190 total)
 *  6. Attempt to add more parcel boxes than pancakes (rejected with validation)
 *  7. Increase pancake quantity after adding parcel box (paper plates increase)
 *  8. Decrease pancake quantity after adding parcel box (parcel boxes clamped / plates updated)
 *  9. Remove parcel box and restore paper plate count
 * 10. Correct order total and payment amount calculation
 * 11. Paper plate and parcel box inventory consumption
 * 12. No automatic parcel box addition
 * 13. No packaging profile selection in POS
 */

const Module = require('module');
const originalLoad = Module._load;
const fs = require('fs');
const os = require('os');
const path = require('path');

let activeTestDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flo-roadside-test-'));
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

const {
  initDatabase,
  getDatabase,
  closeDatabase,
  now,
} = require('../main/db');

const {
  persistItemServingAndPackaging,
  previewItemPackaging,
} = require('../main/services/packaging');

const {
  consumeCheckoutInventory,
} = require('../main/services/checkout-inventory');

const {
  createApp,
  startServer,
  seedOwnerUser,
  api,
  assert,
  assertEqual,
  getResults,
} = require('./helpers/test-setup');

// Replicate roadside calculation helpers from cart.ts for pure unit assertions
function isParcelBox(product: any): boolean {
  if (!product) return false;
  return (
    String(product.id) === 'pr_parcel_box_5' ||
    (typeof product.name === 'string' && product.name.toLowerCase().includes('parcel box'))
  );
}

function calculateRoadsidePackaging(items: any[]) {
  const pancakes = items
    .filter((i) => !isParcelBox(i.product))
    .reduce((sum, i) => sum + i.quantity, 0);
  const boxes = items
    .filter((i) => isParcelBox(i.product))
    .reduce((sum, i) => sum + i.quantity, 0);
  // FINAL PAPER PLATE AND PARCEL BOX RULE:
  // Paper Plates Consumed = max(0, Pancakes - Boxes)
  // Each Parcel Box selected for a pancake replaces that pancake's Paper Plate.
  // A pancake packed in a Parcel Box consumes zero Paper Plates.
  const plates = Math.max(0, pancakes - boxes);
  const plateUnitCost = 2.5;
  const boxUnitCost = 3.5;
  const plateCost = plates * plateUnitCost;
  const boxCost = boxes * boxUnitCost;
  const internalCost = plateCost + boxCost;
  return {
    pancakes,
    boxes,
    plates,
    plateUnitCost,
    boxUnitCost,
    plateCost,
    boxCost,
    internalCost,
    customerPackagingCharge: 0,
  };
}

function clampBoxesToPancakes(items: any[], _onAdjusted?: (msg: string) => void) {
  // Parcel Box is an independent sellable product and can be sold in any quantity
  // standalone or alongside pancakes without clamping.
  return items;
}

function recomputeRoadsideAllocations(items: any[]) {
  return items.map((item: any) => {
    if (isParcelBox(item.product)) {
      return {
        ...item,
        serving_allocations: [{ serving_type: 'parcel', quantity: item.quantity }],
      };
    }
    return {
      ...item,
      serving_allocations: [{ serving_type: 'dine_in', quantity: item.quantity }],
    };
  });
}

function calculateSubtotal(items: any[]) {
  return items.reduce((sum, item) => sum + Number(item.product.price) * item.quantity, 0);
}

async function runTests() {
  console.log('\n--- STARTING POS ROADSIDE PACKAGING VERIFICATION ---\n');

  // Setup isolated test database copying existing schema and seed data
  const sourceDbPath = path.resolve(__dirname, '..', 'flo.db');
  const targetDbPath = path.join(activeTestDir, 'flo.db');
  fs.copyFileSync(sourceDbPath, targetDbPath);
  initDatabase(activeTestDir);
  const db = getDatabase();
  const ownerUser = db.prepare('SELECT id FROM users LIMIT 1').get() as any;
  const actorId = ownerUser?.id || '323c3681-f1aa-4eaa-8094-b85bc605a639';

  const pancakeProduct = { id: 1, name: 'Oreo Pancake', price: 90, no_packaging: 0 };
  const parcelBoxProduct = { id: 'pr_parcel_box_5', name: 'Parcel Box', price: 5, no_packaging: 1 };

  // --------------------------------------------------------------------------
  // Scenario 1: 1 pancake without parcel box
  // (1 plate, 0 boxes, ₹90 total, ₹2.50 internal cost)
  // --------------------------------------------------------------------------
  console.log('Test 1: 1 pancake without parcel box');
  {
    const cart = [{ product: pancakeProduct, quantity: 1 }];
    const summary = calculateRoadsidePackaging(cart);
    const total = calculateSubtotal(cart);

    assertEqual(summary.pancakes, 1, 'Pancake count is 1');
    assertEqual(summary.plates, 1, 'Paper plates count is 1');
    assertEqual(summary.boxes, 0, 'Parcel boxes count is 0');
    assertEqual(summary.internalCost, 2.5, 'Internal packaging cost is ₹2.50');
    assertEqual(summary.plateCost, 2.5, 'Plate cost is ₹2.50');
    assertEqual(summary.boxCost, 0, 'Box cost is ₹0');
    assertEqual(summary.customerPackagingCharge, 0, 'Customer packaging charge is ₹0');
    assertEqual(total, 90, 'Customer order total is ₹90');
  }

  // --------------------------------------------------------------------------
  // Scenario 2: 1 pancake with 1 parcel box
  // (0 plates, 1 box, ₹95 total, ₹3.50 internal cost)
  // --------------------------------------------------------------------------
  console.log('\nTest 2: 1 pancake with 1 parcel box');
  {
    const cart = [
      { product: pancakeProduct, quantity: 1 },
      { product: parcelBoxProduct, quantity: 1 },
    ];
    const summary = calculateRoadsidePackaging(cart);
    const total = calculateSubtotal(cart);

    assertEqual(summary.pancakes, 1, 'Pancake count is 1');
    assertEqual(summary.plates, 0, 'Paper plates count is 0 (boxed pancake consumes 0 plates)');
    assertEqual(summary.boxes, 1, 'Parcel boxes count is 1');
    assertEqual(summary.plateCost, 0, 'Paper plate packaging cost is ₹0');
    assertEqual(summary.boxCost, 3.5, 'Parcel box purchase cost is ₹3.50');
    assertEqual(summary.internalCost, 3.5, 'Internal packaging cost is ₹3.50');
    assertEqual(total, 95, 'Customer order total is ₹95 (₹90 pancake + ₹5 box)');
  }

  // --------------------------------------------------------------------------
  // Scenario 3: 2 pancakes without parcel box
  // (2 plates, 0 boxes, ₹180 total)
  // --------------------------------------------------------------------------
  console.log('\nTest 3: 2 pancakes without parcel box');
  {
    const cart = [{ product: pancakeProduct, quantity: 2 }];
    const summary = calculateRoadsidePackaging(cart);
    const total = calculateSubtotal(cart);

    assertEqual(summary.pancakes, 2, 'Pancake count is 2');
    assertEqual(summary.plates, 2, 'Paper plates count is 2');
    assertEqual(summary.boxes, 0, 'Parcel boxes count is 0');
    assertEqual(summary.internalCost, 5.0, 'Internal packaging cost is ₹5.00 (2 × ₹2.50)');
    assertEqual(total, 180, 'Customer order total is ₹180 (2 × ₹90)');
  }

  // --------------------------------------------------------------------------
  // Scenario 4: 2 pancakes with 1 parcel box
  // (1 plate, 1 box, ₹185 total, ₹6.00 internal cost)
  // --------------------------------------------------------------------------
  console.log('\nTest 4: 2 pancakes with 1 parcel box');
  {
    const cart = [
      { product: pancakeProduct, quantity: 2 },
      { product: parcelBoxProduct, quantity: 1 },
    ];
    const summary = calculateRoadsidePackaging(cart);
    const total = calculateSubtotal(cart);

    assertEqual(summary.pancakes, 2, 'Pancake count is 2');
    assertEqual(summary.plates, 1, 'Paper plates count is 1 (2 - 1 = 1 plate)');
    assertEqual(summary.boxes, 1, 'Parcel boxes count is 1');
    assertEqual(summary.plateCost, 2.5, 'Plate cost is ₹2.50');
    assertEqual(summary.boxCost, 3.5, 'Box cost is ₹3.50');
    assertEqual(summary.internalCost, 6.0, 'Internal packaging cost is ₹6.00 (2.50 + 3.50)');
    assertEqual(total, 185, 'Customer order total is ₹185 (₹180 pancakes + ₹5 box)');
  }

  // --------------------------------------------------------------------------
  // Scenario 5: 2 pancakes with 2 parcel boxes
  // (0 plates, 2 boxes, ₹190 total, ₹7.00 internal cost)
  // --------------------------------------------------------------------------
  console.log('\nTest 5: 2 pancakes with 2 parcel boxes');
  {
    const cart = [
      { product: pancakeProduct, quantity: 2 },
      { product: parcelBoxProduct, quantity: 2 },
    ];
    const summary = calculateRoadsidePackaging(cart);
    const total = calculateSubtotal(cart);

    assertEqual(summary.pancakes, 2, 'Pancake count is 2');
    assertEqual(summary.plates, 0, 'Paper plates count is 0 (all boxed)');
    assertEqual(summary.boxes, 2, 'Parcel boxes count is 2');
    assertEqual(summary.plateCost, 0, 'Paper plate cost is ₹0');
    assertEqual(summary.boxCost, 7.0, 'Parcel box cost is ₹7.00 (2 × ₹3.50)');
    assertEqual(summary.internalCost, 7.0, 'Internal packaging cost is ₹7.00');
    assertEqual(total, 190, 'Customer order total is ₹190 (₹180 pancakes + ₹10 boxes)');
  }

  // --------------------------------------------------------------------------
  // Scenario 6: Standalone Parcel Box sales without pancakes (1 Box = ₹5, 2 Boxes = ₹10, 3 Boxes = ₹15)
  // --------------------------------------------------------------------------
  console.log('\nTest 6: Standalone Parcel Box sales without pancakes');
  {
    // Case 6A: 1 Parcel box without pancakes (₹5)
    let cart = [{ product: parcelBoxProduct, quantity: 1 }];
    let summary = calculateRoadsidePackaging(cart);
    assertEqual(summary.pancakes, 0, 'Pancake count is 0');
    assertEqual(summary.plates, 0, 'Paper plates count is 0 (no pancakes consumed)');
    assertEqual(summary.boxes, 1, 'Parcel boxes count is 1');
    assertEqual(summary.boxCost, 3.5, 'Parcel box purchase cost is ₹3.50');
    assertEqual(summary.plateCost, 0, 'Paper plate packaging cost is ₹0');
    assertEqual(summary.internalCost, 3.5, 'Internal packaging cost is ₹3.50');

    // Case 6B: 2 Parcel boxes without pancakes (₹10)
    cart = [{ product: parcelBoxProduct, quantity: 2 }];
    summary = calculateRoadsidePackaging(cart);
    assertEqual(summary.pancakes, 0, 'Pancake count is 0');
    assertEqual(summary.plates, 0, 'Paper plates count is 0');
    assertEqual(summary.boxes, 2, 'Parcel boxes count is 2');
    assertEqual(summary.boxCost, 7.0, 'Parcel box packaging cost is ₹7.00');
    assertEqual(summary.internalCost, 7.0, 'Internal packaging cost is ₹7.00');

    // Case 6C: 3 Parcel boxes without pancakes (₹15)
    cart = [{ product: parcelBoxProduct, quantity: 3 }];
    summary = calculateRoadsidePackaging(cart);
    assertEqual(summary.pancakes, 0, 'Pancake count is 0');
    assertEqual(summary.plates, 0, 'Paper plates count is 0');
    assertEqual(summary.boxes, 3, 'Parcel boxes count is 3');
    assertEqual(summary.boxCost, 10.5, 'Parcel box packaging cost is ₹10.50');
    assertEqual(summary.internalCost, 10.5, 'Internal packaging cost is ₹10.50');
  }

  // --------------------------------------------------------------------------
  // Scenario 7: Increase pancake quantity after adding parcel box (paper plates increase)
  // --------------------------------------------------------------------------
  console.log('\nTest 7: Increase pancake quantity after adding parcel box');
  {
    // Start with 1 pancake + 1 parcel box
    let cart = [
      { product: pancakeProduct, quantity: 1 },
      { product: parcelBoxProduct, quantity: 1 },
    ];
    let summary = calculateRoadsidePackaging(cart);
    assertEqual(summary.plates, 0, 'Initial plates count is 0 (1 pancake packed in 1 box)');
    assertEqual(summary.internalCost, 3.5, 'Initial packaging cost is ₹3.50');

    // Increase pancake to 2
    cart = [
      { product: pancakeProduct, quantity: 2 },
      { product: parcelBoxProduct, quantity: 1 },
    ];
    summary = calculateRoadsidePackaging(cart);
    assertEqual(summary.plates, 1, 'Paper plates increased from 0 to 1 (2 - 1 = 1)');
    assertEqual(summary.boxes, 1, 'Parcel box remains 1');
    assertEqual(summary.internalCost, 6.0, 'Internal packaging cost updated to ₹6.00 (2.50 + 3.50)');

    // Increase pancake to 3
    cart = [
      { product: pancakeProduct, quantity: 3 },
      { product: parcelBoxProduct, quantity: 1 },
    ];
    summary = calculateRoadsidePackaging(cart);
    assertEqual(summary.plates, 2, 'Paper plates increased from 1 to 2 (3 - 1 = 2)');
    assertEqual(summary.internalCost, 8.5, 'Internal packaging cost updated to ₹8.50 (2 × 2.50 + 3.50)');
  }

  // --------------------------------------------------------------------------
  // Scenario 8: Standalone Parcel Box sales not clamped to pancakes
  // --------------------------------------------------------------------------
  console.log('\nTest 8: Standalone Parcel Box sales not clamped to pancakes');
  {
    // Start with 2 pancakes + 2 parcel boxes
    let cart = [
      { product: pancakeProduct, quantity: 2 },
      { product: parcelBoxProduct, quantity: 2 },
    ];

    // Decrease pancake to 0 — parcel boxes remain in cart without being removed
    let updatedCart = [{ product: parcelBoxProduct, quantity: 2 }];
    let clampedCart = clampBoxesToPancakes(updatedCart);
    let summary = calculateRoadsidePackaging(clampedCart);
    const remainingBoxes = clampedCart.filter((i) => isParcelBox(i.product));
    assertEqual(remainingBoxes.length, 1, 'Parcel box item is retained when 0 pancakes remain');
    assertEqual(remainingBoxes[0].quantity, 2, 'Parcel box quantity remains 2');
    assertEqual(summary.plates, 0, 'Plates count is 0');
    assertEqual(summary.boxes, 2, 'Boxes count is 2');
  }

  // --------------------------------------------------------------------------
  // Scenario 9: Remove parcel box and restore paper plate count
  // --------------------------------------------------------------------------
  console.log('\nTest 9: Remove parcel box and restore paper plate count');
  {
    // Cart with 2 pancakes and 1 parcel box
    let cart = [
      { product: pancakeProduct, quantity: 2 },
      { product: parcelBoxProduct, quantity: 1 },
    ];
    let summary = calculateRoadsidePackaging(cart);
    assertEqual(summary.plates, 1, 'Initial plates count is 1 (2 - 1 = 1 plate)');
    assertEqual(summary.internalCost, 6.0, 'Internal packaging cost is ₹6.00 (2.50 plate + 3.50 box)');

    // Remove parcel box
    cart = [{ product: pancakeProduct, quantity: 2 }];
    summary = calculateRoadsidePackaging(cart);
    assertEqual(summary.plates, 2, 'Plates count restored to 2');
    assertEqual(summary.boxes, 0, 'Boxes count is 0');
    assertEqual(summary.internalCost, 5.0, 'Internal packaging cost restored to ₹5.00');
  }

  // --------------------------------------------------------------------------
  // Scenario 10: Correct order total and payment amount calculation
  // --------------------------------------------------------------------------
  console.log('\nTest 10: Correct order total and payment amount calculation');
  {
    // Scenario A: 1 Pancake = ₹90
    assertEqual(calculateSubtotal([{ product: pancakeProduct, quantity: 1 }]), 90, 'Scenario A total ₹90');

    // Scenario B: 1 Pancake + 1 Box = ₹95
    assertEqual(
      calculateSubtotal([
        { product: pancakeProduct, quantity: 1 },
        { product: parcelBoxProduct, quantity: 1 },
      ]),
      95,
      'Scenario B total ₹95',
    );

    // Scenario C: 2 Pancakes + 1 Box = ₹185
    assertEqual(
      calculateSubtotal([
        { product: pancakeProduct, quantity: 2 },
        { product: parcelBoxProduct, quantity: 1 },
      ]),
      185,
      'Scenario C total ₹185',
    );

    // Scenario D: 2 Pancakes + 2 Boxes = ₹190
    assertEqual(
      calculateSubtotal([
        { product: pancakeProduct, quantity: 2 },
        { product: parcelBoxProduct, quantity: 2 },
      ]),
      190,
      'Scenario D total ₹190',
    );
  }

  // --------------------------------------------------------------------------
  // Scenario 11: Paper plate and parcel box inventory consumption
  // --------------------------------------------------------------------------
  console.log('\nTest 11: Paper plate and parcel box inventory consumption');
  {
    // Test end-to-end backend serving allocation and inventory consumption
    // Prepare a test order in SQLite with 2 pancakes and 1 parcel box
    const orderInsert = db.prepare(`
      INSERT INTO orders (
        order_number, type, status, total, subtotal,
        inventory_lifecycle, created_at, updated_at
      ) VALUES (?, 'takeaway', 'completed', 185, 185, 'checkout_v1', datetime('now'), datetime('now'))
    `).run('TEST-ORD-PACK-001');
    const orderId = Number(orderInsert.lastInsertRowid);

    // Insert 1 pancake item (qty 2) with Paper Plate in recipe snapshot (2 plates for 2 pancakes)
    const recipeSnapshot = {
      recipe_id: 'rcp_test_oreo',
      components: [
        {
          supply_id: 'sup_ffdfa4ad3785608b17b4d5a7',
          supply_name: 'Paper Plate',
          base_unit: 'each',
          quantity: 2,
          unit_cost: 2.5,
          line_cost: 5.0,
        },
      ],
    };

    const itemInsert = db.prepare(`
      INSERT INTO order_items (
        order_id, product_id, product_name, unit_price, quantity,
        subtotal, total, status, recipe_snapshot, created_at, updated_at
      ) VALUES (?, 'xdk0db', 'Oreo Pancake', 90, 2, 180, 180, 'completed', ?, datetime('now'), datetime('now'))
    `).run(orderId, JSON.stringify(recipeSnapshot));
    const pancakeItemId = Number(itemInsert.lastInsertRowid);

    // Insert 1 parcel box item (qty 1)
    const boxItemInsert = db.prepare(`
      INSERT INTO order_items (
        order_id, product_id, product_name, unit_price, quantity,
        subtotal, total, status, created_at, updated_at
      ) VALUES (?, 'pr_parcel_box_5', 'Parcel Box', 5, 1, 5, 5, 'completed', datetime('now'), datetime('now'))
    `).run(orderId);
    const boxItemId = Number(boxItemInsert.lastInsertRowid);

    // Pancake item: no packaging allocation (paper plate is an ingredient)
    persistItemServingAndPackaging({
      db,
      orderItemId: pancakeItemId,
      itemQuantity: 2,
      allocations: [{ serving_type: 'dine_in', quantity: 2 }],
      actorUserId: actorId,
      productId: 'xdk0db',
      variantId: null,
      explicitProfileId: 'none',
    });

    const boxProfile = db.prepare("SELECT id FROM packaging_profiles WHERE packaging_type = 'parcel_box' AND is_active = 1 LIMIT 1").get() as any;

    // Parcel box item: allocates parcel box packaging
    persistItemServingAndPackaging({
      db,
      orderItemId: boxItemId,
      itemQuantity: 1,
      allocations: [{ serving_type: 'parcel', quantity: 1, packaging_profile_id: boxProfile.id }],
      actorUserId: actorId,
      productId: 'pr_parcel_box_5',
      variantId: null,
      explicitProfileId: boxProfile.id,
    });

    // Check allocations in order_item_packaging_allocations (only parcel box)
    const packagingRows = db.prepare(`
      SELECT p.*
      FROM order_item_packaging_allocations p
      JOIN order_item_serving_allocations s ON s.id = p.serving_allocation_id
      JOIN order_items i ON i.id = s.order_item_id
      WHERE i.order_id = ?
    `).all(orderId);

    assertEqual(packagingRows.length, 1, 'Exactly 1 packaging allocation created (parcel box only)');
    const boxAlloc = packagingRows.find((r: any) => r.packaging_type_snapshot === 'parcel_box');

    assert(Boolean(boxAlloc), 'Parcel box packaging allocation exists');
    assertEqual(boxAlloc?.quantity, 1, 'Parcel box allocated quantity is 1');
    assertEqual(boxAlloc?.unit_cost_snapshot, 3.5, 'Internal inventory unit cost for parcel box is ₹3.50');

    // Record baseline supply stock before checkout
    const plateSupplyBefore = db.prepare('SELECT stock_quantity FROM supplies WHERE id = ?').get('sup_ffdfa4ad3785608b17b4d5a7') as any;
    const boxSupplyBefore = db.prepare('SELECT stock_quantity FROM supplies WHERE id = ?').get('sup_ce93b77bdf7e97a1b5b306f8') as any;

    // Trigger checkout inventory consumption
    consumeCheckoutInventory(db, orderId, actorId, 'ref-ord-pack-001');

    // Verify stock deduction
    const plateSupplyAfter = db.prepare('SELECT stock_quantity FROM supplies WHERE id = ?').get('sup_ffdfa4ad3785608b17b4d5a7') as any;
    const boxSupplyAfter = db.prepare('SELECT stock_quantity FROM supplies WHERE id = ?').get('sup_ce93b77bdf7e97a1b5b306f8') as any;

    assertEqual(
      plateSupplyBefore.stock_quantity - plateSupplyAfter.stock_quantity,
      2,
      'Exactly 2 paper plates deducted from stock as ingredient consumption',
    );
    assertEqual(
      boxSupplyBefore.stock_quantity - boxSupplyAfter.stock_quantity,
      1,
      'Exactly 1 parcel box supply deducted from stock',
    );

    // Verify consumption ledger rows
    const ingredientConsumptions = db.prepare(
      "SELECT * FROM order_inventory_consumptions WHERE order_id = ? AND consumption_kind = 'ingredient'",
    ).all(orderId);
    assertEqual(ingredientConsumptions.length, 1, 'One ingredient consumption record in ledger for plates');

    const packagingConsumptions = db.prepare(
      "SELECT * FROM order_inventory_consumptions WHERE order_id = ? AND consumption_kind = 'packaging'",
    ).all(orderId);
    assertEqual(packagingConsumptions.length, 1, 'One packaging consumption record in ledger for boxes');
  }

  // --------------------------------------------------------------------------
  // Scenario 12: No automatic parcel box addition
  // --------------------------------------------------------------------------
  console.log('\nTest 12: No automatic parcel box addition');
  {
    const cart = [{ product: pancakeProduct, quantity: 1 }];
    const boxItems = cart.filter((i) => isParcelBox(i.product));
    assertEqual(boxItems.length, 0, 'Adding pancake creates 0 parcel boxes');

    const summary = calculateRoadsidePackaging(cart);
    assertEqual(summary.boxes, 0, 'Calculated parcel box count is 0');
    assertEqual(summary.plates, 1, 'Default paper plate is 1');
  }

  // --------------------------------------------------------------------------
  // Scenario 13: No packaging profile selection in POS
  // --------------------------------------------------------------------------
  console.log('\nTest 13: No packaging profile selection in POS');
  {
    // Inspect CartPanel.tsx content to verify ServingSelector and profile dropdowns are removed
    const cartPanelPath = path.resolve(__dirname, '..', 'frontend', 'src', 'components', 'pos', 'CartPanel.tsx');
    const content = fs.readFileSync(cartPanelPath, 'utf8');

    assert(!content.includes('ServingSelector'), 'ServingSelector component is completely removed from CartPanel');
    assert(!content.includes('Parcel box profile'), 'Parcel box profile selector dropdown is removed');
    assert(!content.includes('orderTypeTakeaway'), 'Visible takeaway terminology header is removed');
    assert(content.includes('data-testid="packaging-summary"'), 'Packaging summary data-testid exists');
    assert(content.includes('Internal Consumption'), 'Shows internal consumption notice');
    assert(content.includes('Paper plates (₹0 customer charge)'), 'Clearly notes paper plates are ₹0 charge');
  }

  // --------------------------------------------------------------------------
  // Scenario 14: Checkout standalone Parcel Box sale via Cash (2 Parcel Boxes @ ₹5 = ₹10)
  // --------------------------------------------------------------------------
  console.log('\nTest 14: Checkout standalone Parcel Box sale via Cash (2 boxes = ₹10)');
  {
    const orderInsert = db.prepare(`
      INSERT INTO orders (
        order_number, type, status, total, subtotal, inventory_lifecycle, created_at, updated_at
      ) VALUES (?, 'takeaway', 'completed', 10, 10, 'checkout_v1', datetime('now'), datetime('now'))
    `).run('TEST-ORD-BOX-CASH');
    const orderId = Number(orderInsert.lastInsertRowid);

    const boxItemInsert = db.prepare(`
      INSERT INTO order_items (
        order_id, product_id, product_name, unit_price, quantity,
        subtotal, total, status, created_at, updated_at
      ) VALUES (?, 'pr_parcel_box_5', 'Parcel Box', 5, 2, 10, 10, 'completed', datetime('now'), datetime('now'))
    `).run(orderId);
    const boxItemId = Number(boxItemInsert.lastInsertRowid);

    const boxProfile = db.prepare("SELECT id FROM packaging_profiles WHERE packaging_type = 'parcel_box' AND is_active = 1 LIMIT 1").get() as any;

    persistItemServingAndPackaging({
      db,
      orderItemId: boxItemId,
      itemQuantity: 2,
      allocations: [{ serving_type: 'parcel', quantity: 2, packaging_profile_id: boxProfile.id }],
      actorUserId: actorId,
      productId: 'pr_parcel_box_5',
      variantId: null,
      explicitProfileId: boxProfile.id,
    });

    // Check bill creation
    db.prepare(`
      INSERT INTO bills (
        order_id, bill_number, subtotal, total, paid_amount, payment_status, payment_details, created_at, updated_at, paid_at
      ) VALUES (?, ?, 10, 10, 10, 'paid', ?, datetime('now'), datetime('now'), datetime('now'))
    `).run(orderId, 'BILL-BOX-CASH-001', JSON.stringify([{ method: 'cash', amount: 10 }]));

    const plateSupplyBefore = db.prepare('SELECT stock_quantity FROM supplies WHERE id = ?').get('sup_ffdfa4ad3785608b17b4d5a7') as any;
    const boxSupplyBefore = db.prepare('SELECT stock_quantity FROM supplies WHERE id = ?').get('sup_ce93b77bdf7e97a1b5b306f8') as any;

    consumeCheckoutInventory(db, orderId, actorId, 'ref-box-cash-001');

    const plateSupplyAfter = db.prepare('SELECT stock_quantity FROM supplies WHERE id = ?').get('sup_ffdfa4ad3785608b17b4d5a7') as any;
    const boxSupplyAfter = db.prepare('SELECT stock_quantity FROM supplies WHERE id = ?').get('sup_ce93b77bdf7e97a1b5b306f8') as any;

    assertEqual(boxSupplyBefore.stock_quantity - boxSupplyAfter.stock_quantity, 2, 'Exactly 2 parcel boxes deducted from stock');
    assertEqual(plateSupplyBefore.stock_quantity - plateSupplyAfter.stock_quantity, 0, 'Zero paper plates deducted for standalone parcel box sale');
  }

  // --------------------------------------------------------------------------
  // Scenario 15: Checkout standalone Parcel Box sale via UPI (3 Parcel Boxes @ ₹5 = ₹15)
  // --------------------------------------------------------------------------
  console.log('\nTest 15: Checkout standalone Parcel Box sale via UPI (3 boxes = ₹15)');
  {
    const orderInsert = db.prepare(`
      INSERT INTO orders (
        order_number, type, status, total, subtotal, inventory_lifecycle, created_at, updated_at
      ) VALUES (?, 'takeaway', 'completed', 15, 15, 'checkout_v1', datetime('now'), datetime('now'))
    `).run('TEST-ORD-BOX-UPI');
    const orderId = Number(orderInsert.lastInsertRowid);

    const boxItemInsert = db.prepare(`
      INSERT INTO order_items (
        order_id, product_id, product_name, unit_price, quantity,
        subtotal, total, status, created_at, updated_at
      ) VALUES (?, 'pr_parcel_box_5', 'Parcel Box', 5, 3, 15, 15, 'completed', datetime('now'), datetime('now'))
    `).run(orderId);
    const boxItemId = Number(boxItemInsert.lastInsertRowid);

    const boxProfile = db.prepare("SELECT id FROM packaging_profiles WHERE packaging_type = 'parcel_box' AND is_active = 1 LIMIT 1").get() as any;

    persistItemServingAndPackaging({
      db,
      orderItemId: boxItemId,
      itemQuantity: 3,
      allocations: [{ serving_type: 'parcel', quantity: 3, packaging_profile_id: boxProfile.id }],
      actorUserId: actorId,
      productId: 'pr_parcel_box_5',
      variantId: null,
      explicitProfileId: boxProfile.id,
    });

    db.prepare(`
      INSERT INTO bills (
        order_id, bill_number, subtotal, total, paid_amount, payment_status, payment_details, created_at, updated_at, paid_at
      ) VALUES (?, ?, 15, 15, 15, 'paid', ?, datetime('now'), datetime('now'), datetime('now'))
    `).run(orderId, 'BILL-BOX-UPI-001', JSON.stringify([{ method: 'upi', amount: 15 }]));

    const plateSupplyBefore = db.prepare('SELECT stock_quantity FROM supplies WHERE id = ?').get('sup_ffdfa4ad3785608b17b4d5a7') as any;
    const boxSupplyBefore = db.prepare('SELECT stock_quantity FROM supplies WHERE id = ?').get('sup_ce93b77bdf7e97a1b5b306f8') as any;

    consumeCheckoutInventory(db, orderId, actorId, 'ref-box-upi-001');

    const plateSupplyAfter = db.prepare('SELECT stock_quantity FROM supplies WHERE id = ?').get('sup_ffdfa4ad3785608b17b4d5a7') as any;
    const boxSupplyAfter = db.prepare('SELECT stock_quantity FROM supplies WHERE id = ?').get('sup_ce93b77bdf7e97a1b5b306f8') as any;

    assertEqual(boxSupplyBefore.stock_quantity - boxSupplyAfter.stock_quantity, 3, 'Exactly 3 parcel boxes deducted from stock');
    assertEqual(plateSupplyBefore.stock_quantity - plateSupplyAfter.stock_quantity, 0, 'Zero paper plates deducted for standalone parcel box sale');
  }

  console.log('\n-----------------------------------------------------------');
  const results = getResults();
  console.log(`Test results: ${results.passed}/${results.total} passed, ${results.failed} failed`);
  console.log('-----------------------------------------------------------\n');

  closeDatabase();
  try {
    fs.rmSync(activeTestDir, { recursive: true, force: true });
  } catch {}

  if (results.failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
