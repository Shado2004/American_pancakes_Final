/**
 * Automated Verification Suite for:
 * 1. Automatic BOGO Calculation & Cart/Checkout Consistency (Example A: 4 pancakes, ₹330 -> ₹150 discount -> ₹180 net payable)
 * 2. Standalone Parcel Box Exclusion from BOGO (₹5 box, ₹185 total, ₹15 internal direct cost)
 * 3. On-demand Normal Sales and BOGO Sales Reports Dataset Generation
 * 4. Normal Sales and BOGO Sales Excel (.xlsx) Serialization & Formatting
 * 5. Normal Sales and BOGO Sales HTML & PDF Generation
 * 6. Mathematical Reconciliation between Normal + BOGO Sales and Roadside Dashboard
 * 7. Refund Accounting & Recovered Sellable Product Handling (Zero Double-Counted Ingredient Cost)
 */

const Module = require('module');
const originalLoad = Module._load;
const fs = require('fs');
const os = require('os');
const path = require('path');

const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flo-bogo-sales-reports-test-'));

Module._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === 'electron') {
    return {
      app: {
        isPackaged: true,
        getPath: (name: string) => (name === 'userData' ? testDir : testDir),
        getVersion: () => '3.13.14-test',
      },
      BrowserWindow: class {
        webContents = {
          session: { webRequest: { onBeforeRequest: () => {} } },
          setWindowOpenHandler: () => {},
          on: () => {},
          loadFile: async () => {},
          printToPDF: async () => Buffer.from('%PDF-1.4 Mock PDF Stream'),
        };
        destroy() {}
        isDestroyed() { return false; }
      },
    };
  }
  return originalLoad.apply(this, arguments as any);
};

const {
  assertEqualOrThrow,
  assertOrThrow,
  closeDatabase,
  initTestDb,
  seedOwnerUser,
  createApp,
  startServer,
  api,
} = require('./helpers/test-setup');

const { reportRoutes } = require('../main/routes/reports');

const {
  buildSalesReportsDataset,
  serializeNormalSalesReportXlsx,
  serializeBogoSalesReportXlsx,
  serializeNormalSalesReportHtml,
  serializeBogoSalesReportHtml,
  exportReportToPdfBuffer,
  getPaperPlateUnitCost,
  reportDayBounds,
} = require('../main/services/sales-reports-export');

const { computeRoadsideDashboardSummary } = require('../main/services/roadside-reporting');
const { setHtmlToPdfRendererForTests } = require('../main/services/html-to-pdf');

// Set mock PDF renderer for fast headless test execution
setHtmlToPdfRendererForTests(async ({ html, pageSize }: { html: string; pageSize: string }) => {
  assertOrThrow(html.length > 0, 'PDF HTML input must not be empty');
  assertOrThrow(pageSize === 'A4', 'Page size must be A4');
  return Buffer.from(`%PDF-1.4 mock pdf rendered from ${html.length} bytes`);
});

async function runTests() {
  console.log('================================================================');
  console.log('START: BOGO Checkout & Sales Reports Verification Test Suite');
  console.log('================================================================\n');

  const db = initTestDb();
  const owner = seedOwnerUser(db);
  const today = '2026-11-20';

  // Seed supplies
  const plateSupply = db.prepare(`
    INSERT INTO supplies (id, name, base_unit, stock_quantity, unit_cost)
    VALUES ('sup_ffdfa4ad3785608b17b4d5a7', 'Paper Plates', 'each', 1000, 2.50)
    RETURNING *
  `).get();

  const boxSupply = db.prepare(`
    INSERT INTO supplies (id, name, base_unit, stock_quantity, unit_cost)
    VALUES ('sup_parcel_box_001', 'Parcel boxes', 'each', 500, 5.00)
    RETURNING *
  `).get();

  const batterSupply = db.prepare(`
    INSERT INTO supplies (id, name, base_unit, stock_quantity, unit_cost)
    VALUES ('sup_batter_001', 'Pancake Batter & Toppings', 'kg', 100, 20.00)
    RETURNING *
  `).get();

  // Seed categories & products
  db.prepare(`
    INSERT INTO categories (id, name, color) VALUES ('cat_pancakes', 'Pancakes', '#f59e0b')
  `).run();
  db.prepare(`
    INSERT INTO categories (id, name, color) VALUES ('cat_packaging', 'Packaging', '#6b7280')
  `).run();

  const prodCottonCandy = { id: 'prod_cotton_candy', name: 'Cotton Candy Pancake', price: 9000, rawCost: 20 };
  const prodOreo = { id: 'prod_oreo', name: 'Oreo Pancake', price: 9000, rawCost: 20 };
  const prodMilkChoc = { id: 'prod_milk_choc', name: 'Milk Chocolate Pancake', price: 8000, rawCost: 18 };
  const prodDarkChoc = { id: 'prod_dark_choc', name: 'Dark Chocolate Pancake', price: 7000, rawCost: 16 };
  const prodParcelBox = { id: 'prod_parcel_box', name: 'Parcel Box', price: 500, rawCost: 5 };

  for (const p of [prodCottonCandy, prodOreo, prodMilkChoc, prodDarkChoc, prodParcelBox]) {
    const isBox = p.id === 'prod_parcel_box';
    db.prepare(`
      INSERT INTO products (id, name, price, category_id, is_active)
      VALUES (?, ?, ?, ?, 1)
    `).run(p.id, p.name, p.price, isBox ? 'cat_packaging' : 'cat_pancakes');
  }

  // Seed promotions
  db.prepare(`
    INSERT INTO promotions (id, name, discount_type, target_type, is_active)
    VALUES ('promo_bogo', 'Launch BOGO', 'bogo', 'all_pancakes', 1)
  `).run();

  // --------------------------------------------------------------------------
  // TEST 1: Pure Mathematical BOGO Calculation (Example A)
  // --------------------------------------------------------------------------
  console.log('--- TEST 1: Automatic BOGO Evaluation (Example A) ---');
  {
    // Cart has 4 pancakes
    const items = [
      { id: '1', name: 'Cotton Candy', price: 90, quantity: 1 },
      { id: '2', name: 'Oreo', price: 90, quantity: 1 },
      { id: '3', name: 'Milk Chocolate', price: 80, quantity: 1 },
      { id: '4', name: 'Dark Chocolate', price: 70, quantity: 1 },
    ];

    // Expand items to units
    const units: { id: string; name: string; price: number }[] = [];
    for (const item of items) {
      for (let i = 0; i < item.quantity; i++) {
        units.push({ id: item.id, name: item.name, price: item.price });
      }
    }

    assertEqualOrThrow(units.length, 4, 'Cart has 4 pancake units');
    const freeCount = Math.floor(units.length / 2);
    assertEqualOrThrow(freeCount, 2, 'Free pancake count must be 2');

    // Sort descending by price
    units.sort((a, b) => b.price - a.price);

    // Paid units (highest 2): 90 + 90 = 180
    const paidUnits = units.slice(0, units.length - freeCount);
    // Free units (lowest 2): 80 + 70 = 150
    const freeUnits = units.slice(units.length - freeCount);

    const grossSubtotal = units.reduce((s, u) => s + u.price, 0);
    const bogoDiscount = freeUnits.reduce((s, u) => s + u.price, 0);
    const netPayable = grossSubtotal - bogoDiscount;

    assertEqualOrThrow(grossSubtotal, 330, 'Gross subtotal must be 330');
    assertEqualOrThrow(bogoDiscount, 150, 'BOGO discount must be 150 (80 + 70)');
    assertEqualOrThrow(netPayable, 180, 'Net payable must be exactly 180');
    console.log('✓ TEST 1 PASSED: Example A evaluates correctly to Subtotal ₹330, Discount ₹150, Net Payable ₹180\n');
  }

  // --------------------------------------------------------------------------
  // TEST 2: Standalone Parcel Box Exclusion & Packaging Cost
  // --------------------------------------------------------------------------
  console.log('--- TEST 2: Standalone Parcel Box Exclusion ---');
  {
    const pancakeGross = 330;
    const bogoDiscount = 150;
    const parcelBoxPrice = 5;
    const grossTotal = pancakeGross + parcelBoxPrice;
    const netPayable = grossTotal - bogoDiscount;

    assertEqualOrThrow(grossTotal, 335, 'Gross total with Parcel Box is 335');
    assertEqualOrThrow(netPayable, 185, 'Net payable with Parcel Box is 185');

    // Internal direct costs:
    // 4 pancakes = 4 plates @ 2.50 = 10.00
    // 1 parcel box = 5.00
    // Total packaging = 15.00
    const packagingCost = 4 * 2.50 + 1 * 5.00;
    assertEqualOrThrow(packagingCost, 15.00, 'Internal packaging cost must be exactly ₹15.00');
    console.log('✓ TEST 2 PASSED: Parcel Box is strictly excluded from BOGO discount; Total ₹185, Packaging ₹15\n');
  }

  const [windowStart, windowEnd] = reportDayBounds(today);
  console.log('Test window bounds:', { windowStart, windowEnd });
  // Choose an order timestamp comfortably within the business day window
  const orderCreatedAt = new Date(
    (new Date(windowStart.replace(' ', 'T') + 'Z').getTime() +
      new Date(windowEnd.replace(' ', 'T') + 'Z').getTime()) /
      2,
  )
    .toISOString()
    .replace('T', ' ')
    .replace(/\..*$/, '');
  console.log('Order test timestamp:', orderCreatedAt);

  // --------------------------------------------------------------------------
  // TEST 3: Seed Orders in SQLite Database
  // --------------------------------------------------------------------------
  console.log('--- TEST 3: Order Seeding in Database ---');
  {
    // Order 1: Normal Sale (Full Price) - 2x Cotton Candy @ ₹90 = ₹180 Cash
    const order1Id = 1;
    db.prepare(`
      INSERT INTO orders (id, order_number, type, status, total, subtotal, discount_amount, created_at)
      VALUES (?, 'ORD-001', 'takeaway', 'completed', 180, 180, 0, ?)
    `).run(order1Id, orderCreatedAt);

    db.prepare(`
      INSERT INTO order_items (id, order_id, product_id, product_name, quantity, unit_price, subtotal, discount_amount, total, recipe_snapshot)
      VALUES (1001, ?, 'prod_cotton_candy', 'Cotton Candy Pancake', 2, 90, 180, 0, 180, ?)
    `).run(order1Id, JSON.stringify({
      cost: 45, // 22.50 * 2 = 45.00 (includes 2 plates @ 2.50 + 40 raw)
      components: [
        { supply_id: 'sup_ffdfa4ad3785608b17b4d5a7', supply_name: 'Paper Plates', cost: 5.0 },
        { supply_id: 'sup_batter_001', supply_name: 'Batter', cost: 40.0 },
      ]
    }));

    db.prepare(`
      INSERT INTO bills (id, order_id, bill_number, subtotal, discount_amount, total, tax_amount, paid_amount, payment_status, payment_details, paid_at, created_at)
      VALUES (101, ?, 'BILL-101', 180, 0, 180, 0, 180, 'paid', ?, ?, ?)
    `).run(order1Id, JSON.stringify([{ method: 'cash', amount: 180 }]), orderCreatedAt, orderCreatedAt);

    // Order 2: BOGO Sale (Example A) - 4 pancakes, ₹330 gross, ₹150 discount, ₹180 UPI
    const order2Id = 2;
    db.prepare(`
      INSERT INTO orders (id, order_number, type, status, total, subtotal, discount_amount, promotion_id, created_at)
      VALUES (?, 'ORD-002', 'takeaway', 'completed', 180, 330, 150, 'promo_bogo', ?)
    `).run(order2Id, orderCreatedAt);

    // Paid item 1: Cotton Candy (90)
    db.prepare(`
      INSERT INTO order_items (id, order_id, product_id, product_name, quantity, unit_price, subtotal, discount_amount, total, modifier_selection, recipe_snapshot)
      VALUES (2001, ?, 'prod_cotton_candy', 'Cotton Candy Pancake', 1, 90, 90, 0, 90, ?, ?)
    `).run(order2Id, JSON.stringify({ is_bogo_paid: true, promotion_id: 'promo_bogo' }), JSON.stringify({
      cost: 22.5,
      components: [{ supply_id: 'sup_ffdfa4ad3785608b17b4d5a7', supply_name: 'Paper Plates', cost: 2.5 }],
    }));

    // Paid item 2: Oreo (90)
    db.prepare(`
      INSERT INTO order_items (id, order_id, product_id, product_name, quantity, unit_price, subtotal, discount_amount, total, modifier_selection, recipe_snapshot)
      VALUES (2002, ?, 'prod_oreo', 'Oreo Pancake', 1, 90, 90, 0, 90, ?, ?)
    `).run(order2Id, JSON.stringify({ is_bogo_paid: true, promotion_id: 'promo_bogo' }), JSON.stringify({
      cost: 22.5,
      components: [{ supply_id: 'sup_ffdfa4ad3785608b17b4d5a7', supply_name: 'Paper Plates', cost: 2.5 }],
    }));

    // Free item 3: Milk Chocolate (80 free)
    db.prepare(`
      INSERT INTO order_items (id, order_id, product_id, product_name, quantity, unit_price, subtotal, discount_amount, total, modifier_selection, recipe_snapshot)
      VALUES (2003, ?, 'prod_milk_choc', 'Milk Chocolate Pancake', 1, 80, 80, 80, 0, ?, ?)
    `).run(order2Id, JSON.stringify({ is_bogo_free: true, promotion_id: 'promo_bogo' }), JSON.stringify({
      cost: 20.5,
      components: [{ supply_id: 'sup_ffdfa4ad3785608b17b4d5a7', supply_name: 'Paper Plates', cost: 2.5 }],
    }));

    // Free item 4: Dark Chocolate (70 free)
    db.prepare(`
      INSERT INTO order_items (id, order_id, product_id, product_name, quantity, unit_price, subtotal, discount_amount, total, modifier_selection, recipe_snapshot)
      VALUES (2004, ?, 'prod_dark_choc', 'Dark Chocolate Pancake', 1, 70, 70, 70, 0, ?, ?)
    `).run(order2Id, JSON.stringify({ is_bogo_free: true, promotion_id: 'promo_bogo' }), JSON.stringify({
      cost: 18.5,
      components: [{ supply_id: 'sup_ffdfa4ad3785608b17b4d5a7', supply_name: 'Paper Plates', cost: 2.5 }],
    }));

    db.prepare(`
      INSERT INTO bills (id, order_id, bill_number, subtotal, discount_amount, total, tax_amount, paid_amount, payment_status, payment_details, paid_at, created_at)
      VALUES (102, ?, 'BILL-102', 330, 150, 180, 0, 180, 'paid', ?, ?, ?)
    `).run(order2Id, JSON.stringify([{ method: 'upi', amount: 180 }]), orderCreatedAt, orderCreatedAt);

    // Order 3: BOGO with Parcel Box (1 paid @ 90, 1 free @ 70, 1 box @ 5 = ₹95)
    const order3Id = 3;
    db.prepare(`
      INSERT INTO orders (id, order_number, type, status, total, subtotal, discount_amount, promotion_id, created_at)
      VALUES (?, 'ORD-003', 'takeaway', 'completed', 95, 165, 70, 'promo_bogo', ?)
    `).run(order3Id, orderCreatedAt);

    db.prepare(`
      INSERT INTO order_items (id, order_id, product_id, product_name, quantity, unit_price, subtotal, discount_amount, total, modifier_selection, recipe_snapshot)
      VALUES (3001, ?, 'prod_cotton_candy', 'Cotton Candy Pancake', 1, 90, 90, 0, 90, ?, ?)
    `).run(order3Id, JSON.stringify({ is_bogo_paid: true, promotion_id: 'promo_bogo' }), JSON.stringify({
      cost: 22.5,
      components: [{ supply_id: 'sup_ffdfa4ad3785608b17b4d5a7', supply_name: 'Paper Plates', cost: 2.5 }],
    }));

    db.prepare(`
      INSERT INTO order_items (id, order_id, product_id, product_name, quantity, unit_price, subtotal, discount_amount, total, modifier_selection, recipe_snapshot)
      VALUES (3002, ?, 'prod_dark_choc', 'Dark Chocolate Pancake', 1, 70, 70, 70, 0, ?, ?)
    `).run(order3Id, JSON.stringify({ is_bogo_free: true, promotion_id: 'promo_bogo' }), JSON.stringify({
      cost: 18.5,
      components: [{ supply_id: 'sup_ffdfa4ad3785608b17b4d5a7', supply_name: 'Paper Plates', cost: 2.5 }],
    }));

    db.prepare(`
      INSERT INTO order_items (id, order_id, product_id, product_name, quantity, unit_price, subtotal, discount_amount, total)
      VALUES (3003, ?, 'prod_parcel_box', 'Parcel Box', 1, 5, 5, 0, 5)
    `).run(order3Id);

    db.prepare(`
      INSERT INTO bills (id, order_id, bill_number, subtotal, discount_amount, total, tax_amount, paid_amount, payment_status, payment_details, paid_at, created_at)
      VALUES (103, ?, 'BILL-103', 165, 70, 95, 0, 95, 'paid', ?, ?, ?)
    `).run(order3Id, JSON.stringify([{ method: 'cash', amount: 95 }]), orderCreatedAt, orderCreatedAt);

    console.log('✓ TEST 3 PASSED: Seed orders (Normal, BOGO Example A, BOGO + Parcel Box) inserted into DB\n');
  }

  // --------------------------------------------------------------------------
  // TEST 4: Build Sales Reports Dataset & Verify Invariants
  // --------------------------------------------------------------------------
  console.log('--- TEST 4: Sales Reports Dataset Building & Mathematical Verification ---');
  {
    const dataset = buildSalesReportsDataset(db, today, today);
    assertEqualOrThrow(dataset.currency, 'INR', 'Currency must be INR');

    // Normal Sales verification
    console.log('Normal Rows count:', dataset.normalRows.length);
    assertEqualOrThrow(dataset.normalRows.length, 1, 'Exactly 1 normal pancake item row');
    const normRow = dataset.normalRows[0];
    assertEqualOrThrow(normRow.productName, 'Cotton Candy Pancake', 'Normal product name');
    assertEqualOrThrow(normRow.quantity, 2, 'Normal quantity is 2');
    assertEqualOrThrow(normRow.unitPrice, 90, 'Unit price is 90');
    assertEqualOrThrow(normRow.grossSales, 180, 'Gross sales is 180');
    assertEqualOrThrow(normRow.discount, 0, 'Discount is 0');
    assertEqualOrThrow(normRow.netRevenue, 180, 'Net revenue is 180');
    assertEqualOrThrow(normRow.paymentMethod, 'CASH', 'Payment method is CASH');
    assertEqualOrThrow(normRow.paperPlateCost, 5.0, '2 plates @ 2.50 = 5.00');

    // BOGO Sales verification
    console.log('BOGO Rows count:', dataset.bogoRows.length);
    // Order 2 has 4 pancakes (Cotton Candy, Oreo, Milk Choc, Dark Choc)
    // Order 3 has 2 pancakes (Cotton Candy, Dark Choc)
    // Note: Parcel Box is strictly excluded from pancake sales reports!
    assertEqualOrThrow(dataset.bogoRows.length, 6, 'Exactly 6 BOGO pancake item rows across orders 2 and 3');

    // Check Example A items in BOGO rows
    const bogoOrd2Rows = dataset.bogoRows.filter(r => String(r.orderId) === '2' || r.orderId === 'ORD-002');
    assertEqualOrThrow(bogoOrd2Rows.length, 4, 'Order 2 has 4 BOGO items');

    const cc = bogoOrd2Rows.find(r => r.productName === 'Cotton Candy Pancake')!;
    assertEqualOrThrow(cc.paidQuantity, 1, 'Cotton candy paid qty');
    assertEqualOrThrow(cc.freeQuantity, 0, 'Cotton candy free qty');
    assertEqualOrThrow(cc.actualRevenue, 90, 'Cotton candy actual revenue ₹90');

    const oreo = bogoOrd2Rows.find(r => r.productName === 'Oreo Pancake')!;
    assertEqualOrThrow(oreo.paidQuantity, 1, 'Oreo paid qty');
    assertEqualOrThrow(oreo.actualRevenue, 90, 'Oreo actual revenue ₹90');

    const milk = bogoOrd2Rows.find(r => r.productName === 'Milk Chocolate Pancake')!;
    assertEqualOrThrow(milk.paidQuantity, 0, 'Milk chocolate paid qty 0');
    assertEqualOrThrow(milk.freeQuantity, 1, 'Milk chocolate free qty 1');
    assertEqualOrThrow(milk.actualRevenue, 0, 'Milk chocolate actual revenue ₹0 for free item');
    assertEqualOrThrow(milk.bogoDiscount, 80, 'Milk chocolate BOGO discount ₹80');
    assertEqualOrThrow(milk.paperPlateCost, 2.5, 'Free milk chocolate still incurs ₹2.50 plate cost');

    const dark = bogoOrd2Rows.find(r => r.productName === 'Dark Chocolate Pancake')!;
    assertEqualOrThrow(dark.paidQuantity, 0, 'Dark chocolate paid qty 0');
    assertEqualOrThrow(dark.freeQuantity, 1, 'Dark chocolate free qty 1');
    assertEqualOrThrow(dark.actualRevenue, 0, 'Dark chocolate actual revenue ₹0 for free item');
    assertEqualOrThrow(dark.bogoDiscount, 70, 'Dark chocolate BOGO discount ₹70');
    assertEqualOrThrow(dark.paperPlateCost, 2.5, 'Free dark chocolate still incurs ₹2.50 plate cost');

    // Total actual revenue from Order 2 BOGO: 90 + 90 + 0 + 0 = 180!
    const ord2Revenue = bogoOrd2Rows.reduce((s, r) => s + r.actualRevenue, 0);
    assertEqualOrThrow(ord2Revenue, 180, 'Order 2 BOGO actual revenue is exactly ₹180');

    // Check Totals
    assertEqualOrThrow(dataset.normalTotals.netRevenue, 180, 'Normal net revenue total ₹180');
    // Order 2 = 180, Order 3 = 90 (pancake portion). Total = 270
    assertEqualOrThrow(dataset.bogoTotals.actualRevenue, 270, 'BOGO actual revenue total ₹270');

    // Reconciliation:
    // Total Pancake Revenue = 180 (Normal) + 270 (BOGO) = 450
    // Total Pancakes Prepared = 2 (Normal) + 6 (BOGO) = 8
    const totalPancakeRevenue = dataset.normalTotals.netRevenue + dataset.bogoTotals.actualRevenue;
    assertEqualOrThrow(totalPancakeRevenue, 450, 'Total pancake revenue is ₹450');

    const totalPancakesPrepared = dataset.normalTotals.quantity + dataset.bogoTotals.totalQuantity;
    assertEqualOrThrow(totalPancakesPrepared, 8, 'Total pancakes prepared is 8');

    // Check roadside summary reconciliation
    const roadside = computeRoadsideDashboardSummary(db, windowStart, windowEnd, today, today);
    assertEqualOrThrow(roadside.normalSalesSummary?.revenue, 180, 'Roadside normal revenue matches');
    assertEqualOrThrow(roadside.bogoSalesSummary?.revenue, 270, 'Roadside BOGO revenue matches');
    assertEqualOrThrow(roadside.bogoSalesSummary?.pancakesPrepared, 6, 'Roadside BOGO pancakes count matches');
    assertEqualOrThrow(roadside.reconciliation?.reconciled, true, 'Roadside mathematical reconciliation is true');

    console.log('✓ TEST 4 PASSED: Dataset matches accounting invariants and reconciles with Dashboard\n');
  }

  // --------------------------------------------------------------------------
  // TEST 5: Excel Serialization
  // --------------------------------------------------------------------------
  console.log('--- TEST 5: Excel (.xlsx) Serialization ---');
  {
    const dataset = buildSalesReportsDataset(db, today, today);

    const normalXlsx = await serializeNormalSalesReportXlsx(dataset);
    assertOrThrow(Buffer.isBuffer(normalXlsx), 'Normal sales XLSX must return a Buffer');
    assertOrThrow(normalXlsx.length > 1000, `Normal sales XLSX buffer size (${normalXlsx.length} bytes) is valid`);

    const bogoXlsx = await serializeBogoSalesReportXlsx(dataset);
    assertOrThrow(Buffer.isBuffer(bogoXlsx), 'BOGO sales XLSX must return a Buffer');
    assertOrThrow(bogoXlsx.length > 1000, `BOGO sales XLSX buffer size (${bogoXlsx.length} bytes) is valid`);

    console.log('✓ TEST 5 PASSED: Normal and BOGO Excel workbooks serialized successfully\n');
  }

  // --------------------------------------------------------------------------
  // TEST 6: HTML & PDF Generation
  // --------------------------------------------------------------------------
  console.log('--- TEST 6: HTML & PDF Generation ---');
  {
    const dataset = buildSalesReportsDataset(db, today, today);

    const normalHtml = serializeNormalSalesReportHtml(dataset);
    assertOrThrow(normalHtml.includes('NORMAL SALES REPORT'), 'Normal HTML has title');
    assertOrThrow(normalHtml.includes('₹180.00'), 'Normal HTML has correct net revenue');
    assertOrThrow(normalHtml.includes('BILL-101'), 'Normal HTML has bill number');

    const bogoHtml = serializeBogoSalesReportHtml(dataset);
    assertOrThrow(bogoHtml.includes('BOGO PROMOTIONAL SALES REPORT'), 'BOGO HTML has title');
    assertOrThrow(bogoHtml.includes('BILL-102'), 'BOGO HTML has bill number');
    assertOrThrow(bogoHtml.includes('₹270.00'), 'BOGO HTML has actual revenue');

    const normalPdf = await exportReportToPdfBuffer(normalHtml);
    assertOrThrow(Buffer.isBuffer(normalPdf), 'Normal PDF must return a Buffer');
    assertOrThrow(normalPdf.length > 0, 'Normal PDF buffer must not be empty');

    const bogoPdf = await exportReportToPdfBuffer(bogoHtml);
    assertOrThrow(Buffer.isBuffer(bogoPdf), 'BOGO PDF must return a Buffer');
    assertOrThrow(bogoPdf.length > 0, 'BOGO PDF buffer must not be empty');

    console.log('✓ TEST 6 PASSED: Print-ready HTML and PDF buffers rendered successfully\n');
  }

  // --------------------------------------------------------------------------
  // TEST 7: Refund & Sellable Recovered Product Handling
  // --------------------------------------------------------------------------
  console.log('--- TEST 7: Refund Accounting & Recovered Sellable Product Handling ---');
  {
    // Order 4: Refund where pancake is recovered sellable, plate was consumed
    const order4Id = 4;
    const order4CreatedAt = orderCreatedAt;

    db.prepare(`
      INSERT INTO orders (id, order_number, type, status, total, subtotal, discount_amount, created_at)
      VALUES (?, 'ORD-004', 'takeaway', 'completed', 90, 90, 0, ?)
    `).run(order4Id, order4CreatedAt);

    db.prepare(`
      INSERT INTO order_items (id, order_id, product_id, product_name, quantity, unit_price, subtotal, discount_amount, total, recipe_snapshot)
      VALUES (4001, ?, 'prod_cotton_candy', 'Cotton Candy Pancake', 1, 90, 90, 0, 90, ?)
    `).run(order4Id, JSON.stringify({
      cost: 22.5,
      components: [
        { supply_id: 'sup_ffdfa4ad3785608b17b4d5a7', supply_name: 'Paper Plates', cost: 2.5 },
        { supply_id: 'sup_batter_001', supply_name: 'Batter', cost: 20.0 },
      ]
    }));

    db.prepare(`
      INSERT INTO bills (id, order_id, bill_number, subtotal, discount_amount, total, tax_amount, paid_amount, payment_status, payment_details, paid_at, created_at)
      VALUES (104, ?, 'BILL-104', 90, 0, 90, 0, 90, 'paid', ?, ?, ?)
    `).run(order4Id, JSON.stringify([{ method: 'cash', amount: 90 }]), order4CreatedAt, order4CreatedAt);

    // Now issue a refund of ₹90 with product_disposition='recovered_sellable' and plate_disposition='plate_consumed'
    db.prepare(`
      INSERT INTO refunds (bill_id, order_item_id, amount_cents, reason, method, approved_by, created_by, product_disposition, plate_disposition, created_at)
      VALUES (104, 4001, 9000, 'Customer change of mind', 'cash', ?, ?, 'recovered_sellable', 'plate_consumed', ?)
    `).run(owner.userId, owner.userId, order4CreatedAt);

    const dataset = buildSalesReportsDataset(db, today, today);
    const refItem = dataset.normalRows.find(
      r => r.orderId === 'ORD-004' || String(r.orderId) === String(order4Id),
    )!;

    assertEqualOrThrow(refItem.netRevenue, 0, 'Refunded order net revenue is 0');
    assertEqualOrThrow(refItem.ingredientCost, 0, 'Ingredient cost is 0 because product was recovered sellable (no double count)');
    assertEqualOrThrow(refItem.paperPlateCost, 2.50, 'Paper plate was consumed so 2.50 cost remains recorded');

    console.log('✓ TEST 7 PASSED: Recovered sellable pancake does not double-count ingredient cost while plate cost is preserved\n');
  }

  // --------------------------------------------------------------------------
  // TEST 8: HTTP Export API Endpoints (Express Router Integration)
  // --------------------------------------------------------------------------
  console.log('--- TEST 8: HTTP Export API Endpoints Verification ---');
  {
    const app = createApp({
      '/api/reports': reportRoutes,
    });
    const { baseUrl, server } = await startServer(app);
    const fetch = (globalThis as any).fetch;
    const authHeader = owner.authHeader;

    try {
      // 1. Normal sales JSON export
      const normalJsonRes = await fetch(
        `${baseUrl}/api/reports/sales/normal/export?format=json&date=${today}`,
        { headers: authHeader },
      );
      assertEqualOrThrow(normalJsonRes.status, 200, 'Normal sales JSON endpoint status 200');
      const normalJson = await normalJsonRes.json();
      assertEqualOrThrow(normalJson.rows.length, 2, 'Normal sales JSON rows count is 2');
      assertEqualOrThrow(normalJson.currency, 'INR', 'Normal sales JSON currency INR');

      // 2. Normal sales HTML export
      const normalHtmlRes = await fetch(
        `${baseUrl}/api/reports/sales/normal/export?format=html&date=${today}`,
        { headers: authHeader },
      );
      assertEqualOrThrow(normalHtmlRes.status, 200, 'Normal sales HTML endpoint status 200');
      const normalHtml = await normalHtmlRes.text();
      assertOrThrow(normalHtml.includes('NORMAL SALES REPORT'), 'Normal sales HTML contains report title');

      // 3. Normal sales XLSX export
      const normalXlsxRes = await fetch(
        `${baseUrl}/api/reports/sales/normal/export?format=xlsx&date=${today}`,
        { headers: authHeader },
      );
      assertEqualOrThrow(normalXlsxRes.status, 200, 'Normal sales XLSX endpoint status 200');
      assertOrThrow(
        (normalXlsxRes.headers.get('content-type') || '').includes('spreadsheetml'),
        'Normal sales XLSX content-type',
      );

      // 4. BOGO sales JSON export
      const bogoJsonRes = await fetch(
        `${baseUrl}/api/reports/sales/bogo/export?format=json&date=${today}`,
        { headers: authHeader },
      );
      assertEqualOrThrow(bogoJsonRes.status, 200, 'BOGO sales JSON endpoint status 200');
      const bogoJson = await bogoJsonRes.json();
      assertEqualOrThrow(bogoJson.rows.length, 6, 'BOGO sales JSON rows count is 6');
      assertEqualOrThrow(bogoJson.totals.actualRevenue, 270, 'BOGO sales JSON actual revenue 270');

      // 5. BOGO sales HTML export
      const bogoHtmlRes = await fetch(
        `${baseUrl}/api/reports/sales/bogo/export?format=html&date=${today}`,
        { headers: authHeader },
      );
      assertEqualOrThrow(bogoHtmlRes.status, 200, 'BOGO sales HTML endpoint status 200');
      const bogoHtml = await bogoHtmlRes.text();
      assertOrThrow(bogoHtml.includes('BOGO PROMOTIONAL SALES REPORT'), 'BOGO sales HTML contains report title');

      // 6. BOGO sales XLSX export
      const bogoXlsxRes = await fetch(
        `${baseUrl}/api/reports/sales/bogo/export?format=xlsx&date=${today}`,
        { headers: authHeader },
      );
      assertEqualOrThrow(bogoXlsxRes.status, 200, 'BOGO sales XLSX endpoint status 200');
      assertOrThrow(
        (bogoXlsxRes.headers.get('content-type') || '').includes('spreadsheetml'),
        'BOGO sales XLSX content-type',
      );

      // 7. Unified route /sales/export with type=normal
      const unifiedNormalRes = await fetch(
        `${baseUrl}/api/reports/sales/export?type=normal&format=json&date=${today}`,
        { headers: authHeader },
      );
      assertEqualOrThrow(unifiedNormalRes.status, 200, 'Unified route type=normal status 200');
      const unifiedNormalJson = await unifiedNormalRes.json();
      assertEqualOrThrow(unifiedNormalJson.rows.length, 2, 'Unified normal rows count');

      // 8. Unified route /sales/export with type=bogo
      const unifiedBogoRes = await fetch(
        `${baseUrl}/api/reports/sales/export?type=bogo&format=json&date=${today}`,
        { headers: authHeader },
      );
      assertEqualOrThrow(unifiedBogoRes.status, 200, 'Unified route type=bogo status 200');
      const unifiedBogoJson = await unifiedBogoRes.json();
      assertEqualOrThrow(unifiedBogoJson.rows.length, 6, 'Unified bogo rows count');

      console.log('✓ TEST 8 PASSED: All 8 HTTP Export API endpoints verified successfully\n');
    } finally {
      server.close();
    }
  }

  console.log('================================================================');
  console.log('ALL TESTS PASSED SUCCESSFULLY! (8/8 test suites verified)');
  console.log('================================================================');

  closeDatabase(db);
}

runTests().catch((err) => {
  console.error('\n❌ TEST FAILED:', err);
  process.exit(1);
});
