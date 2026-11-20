import ExcelJS from 'exceljs';
import type Database from 'better-sqlite3';
import { isBogoFreeItem, isParcelBoxProduct } from './roadside-reporting';
import { getTenantCurrency } from './refund';
import { getCurrencyFractionDigits } from '../countries';
import { roundCurrencyCost } from './supplies';
import { deliverySandboxExclusionSql } from './sandbox-exclusion';
import {
  getDatabase,
  dayBoundsInTimezone,
  tenantBusinessDayStartTime,
  localDateInTimezone,
  now,
} from '../db';
import { parseValidBusinessDate } from './daily-sales-export';
import { renderHtmlToPdfBuffer } from './html-to-pdf';

export function reportToday(): string {
  const db = getDatabase();
  const startTime = tenantBusinessDayStartTime(db);
  return localDateInTimezone(new Date(), 'Asia/Kolkata', startTime);
}

export function reportDayBounds(date: string): [string, string] {
  const db = getDatabase();
  const startTime = tenantBusinessDayStartTime(db);
  return dayBoundsInTimezone(date, 'Asia/Kolkata', startTime);
}

export function reportDate(value: unknown, fallback: string): string {
  return typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    parseValidBusinessDate(value) !== null
    ? value
    : fallback;
}

export function getPaperPlateUnitCost(db: Database.Database): number {
  let cost = 2.5;
  try {
    const row = db
      .prepare(
        "SELECT unit_cost FROM supplies WHERE name LIKE '%paper%plate%' OR name LIKE '%plate%' LIMIT 1",
      )
      .get() as { unit_cost?: number } | undefined;
    if (
      row &&
      typeof row.unit_cost === 'number' &&
      Number.isFinite(row.unit_cost) &&
      row.unit_cost > 0
    ) {
      cost = row.unit_cost;
    }
  } catch {}
  return cost;
}

export interface NormalSalesRow {
  date: string;
  orderId: string;
  billNumber: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  grossSales: number;
  discount: number;
  netRevenue: number;
  paymentMethod: string;
  ingredientCost: number;
  paperPlateCost: number;
  profit: number;
}

export interface BogoSalesRow {
  date: string;
  orderId: string;
  billNumber: string;
  productName: string;
  totalQuantity: number;
  paidQuantity: number;
  freeQuantity: number;
  unitPrice: number;
  grossValue: number;
  bogoDiscount: number;
  actualRevenue: number;
  ingredientCost: number;
  paperPlateCost: number;
  profit: number;
  promotionSource: string;
}

export interface SalesReportDataset {
  startDate: string;
  endDate: string;
  currency: string;
  normalRows: NormalSalesRow[];
  bogoRows: BogoSalesRow[];
  normalTotals: {
    quantity: number;
    grossSales: number;
    discount: number;
    netRevenue: number;
    ingredientCost: number;
    paperPlateCost: number;
    profit: number;
  };
  bogoTotals: {
    totalQuantity: number;
    paidQuantity: number;
    freeQuantity: number;
    grossValue: number;
    bogoDiscount: number;
    actualRevenue: number;
    ingredientCost: number;
    paperPlateCost: number;
    profit: number;
  };
}

export function buildSalesReportsDataset(
  db: Database.Database,
  startDate: string,
  endDate: string,
): SalesReportDataset {
  const currency = getTenantCurrency();
  const fractionDigits = getCurrencyFractionDigits(currency);
  const minorFactor = Math.pow(10, fractionDigits);
  const paperPlateUnitCost = getPaperPlateUnitCost(db);

  const [windowStart] = reportDayBounds(startDate);
  const [, windowEnd] = reportDayBounds(endDate);

  // 1. Fetch refunds in period
  const refundTableCols = new Set(
    (db.prepare('PRAGMA table_info(refunds)').all() as Array<{ name: string }>).map((c) => c.name),
  );
  const selProdDisp = refundTableCols.has('product_disposition')
    ? 'r.product_disposition'
    : "'retained_by_customer' AS product_disposition";
  const selPlateDisp = refundTableCols.has('plate_disposition')
    ? 'r.plate_disposition'
    : "'plate_consumed' AS plate_disposition";

  const refunds = db
    .prepare(
      `SELECT
        r.id,
        r.bill_id,
        r.order_item_id,
        CAST(r.amount_cents AS REAL) / ? AS amount,
        r.method,
        ${selProdDisp},
        ${selPlateDisp}
      FROM refunds r
      JOIN bills b ON b.id = r.bill_id
      JOIN orders o ON o.id = b.order_id
      WHERE (
        (b.paid_at >= ? AND b.paid_at < ?)
        OR (r.created_at >= ? AND r.created_at < ?)
      )
      AND o.status != 'cancelled'
      AND ${deliverySandboxExclusionSql('o.id')}`,
    )
    .all(minorFactor, windowStart, windowEnd, windowStart, windowEnd) as any[];

  const itemRefundMap = new Map<number, number>();
  const itemDispMap = new Map<
    number,
    { productDisp: string; plateDisp: string }
  >();

  for (const r of refunds) {
    const amt = Number(r.amount || 0);
    if (r.order_item_id) {
      const oiId = Number(r.order_item_id);
      itemRefundMap.set(oiId, (itemRefundMap.get(oiId) || 0) + amt);
      itemDispMap.set(oiId, {
        productDisp: r.product_disposition || 'retained_by_customer',
        plateDisp: r.plate_disposition || 'plate_consumed',
      });
    }
  }

  // 2. Fetch order items for settled bills
  const items = db
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
        oi.modifier_selection,
        oi.recipe_snapshot,
        oi.status AS item_status,
        p.name AS catalog_name,
        b.id AS bill_id,
        b.bill_number,
        b.paid_at,
        b.paid_amount,
        b.payment_details,
        b.discount_type AS bill_discount_type,
        b.discount_amount AS bill_discount_amount,
        o.order_number,
        o.discount_type AS order_discount_type,
        o.discount_amount AS order_discount_amount,
        o.promotion_id AS order_promotion_id
      FROM bills b
      JOIN orders o ON o.id = b.order_id
      JOIN order_items oi ON oi.order_id = o.id
      LEFT JOIN products p ON p.id = oi.product_id
      WHERE b.paid_at >= ? AND b.paid_at < ?
        AND o.status != 'cancelled'
        AND (oi.status IS NULL OR oi.status NOT IN ('cancelled', 'voided', 'void_adjustment', 'swapped'))
        AND ${deliverySandboxExclusionSql('o.id')}
      ORDER BY b.paid_at ASC, b.id ASC, oi.id ASC`,
    )
    .all(windowStart, windowEnd) as any[];

  const normalRows: NormalSalesRow[] = [];
  const bogoRows: BogoSalesRow[] = [];

  // Group non-box pancake items by order for BOGO pair allocation
  const pancakeItemsByOrder = new Map<number, any[]>();
  for (const item of items) {
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

  // Pre-calculate pancake and parcel box quantities per order to implement the
  // FINAL PAPER PLATE AND PARCEL BOX RULE:
  // Each Parcel Box explicitly allocated to a pancake replaces that pancake's Paper Plate.
  // Standalone Parcel Boxes do not replace plates.
  const orderPancakesMap = new Map<number, number>();
  const orderBoxesMap = new Map<number, number>();
  const orderRecoveredPlatesMap = new Map<number, number>();

  const itemIds = items.map((oi) => oi.order_item_id);
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
  const orderHasExplicitAllocMap = new Map<number, boolean>();

  for (const it of items) {
    const oId = Number(it.order_id);
    const oiId = Number(it.order_item_id);
    const qty = Number(it.quantity || 1);
    if (isParcelBoxProduct(it)) {
      orderBoxesMap.set(oId, (orderBoxesMap.get(oId) || 0) + qty);
    } else {
      orderPancakesMap.set(oId, (orderPancakesMap.get(oId) || 0) + qty);
      const disp = itemDispMap.get(oiId);
      if (disp?.plateDisp === 'plate_recovered') {
        orderRecoveredPlatesMap.set(oId, (orderRecoveredPlatesMap.get(oId) || 0) + qty);
      }

      const itemAllocs = allocationsByItem.get(oiId);
      if (itemAllocs && itemAllocs.length > 0) {
        orderHasExplicitAllocMap.set(oId, true);
        for (const a of itemAllocs) {
          if (a.serving_type !== 'parcel') {
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

  for (const item of items) {
    if (isParcelBoxProduct(item)) continue;

    const oiId = Number(item.order_item_id);
    const qty = Number(item.quantity || 1);
    const subtotal = Number(item.subtotal || 0);
    const discount = Number(item.discount_amount || 0);
    const itemRefund = itemRefundMap.get(oiId) || 0;
    const disp = itemDispMap.get(oiId) || {
      productDisp: 'retained_by_customer',
      plateDisp: 'plate_consumed',
    };

    let itemRawCost = Number(item.ingredient_cost || 0);
    if (item.recipe_snapshot) {
      try {
        const parsed =
          typeof item.recipe_snapshot === 'string'
            ? JSON.parse(item.recipe_snapshot)
            : item.recipe_snapshot;
        const hasPlate = (parsed?.components || []).some(
          (c: any) =>
            c.supply_id === 'sup_ffdfa4ad3785608b17b4d5a7' ||
            (c.supply_name || '').toLowerCase().includes('plate'),
        );
        if (hasPlate) {
          itemRawCost = Math.max(0, itemRawCost - qty * paperPlateUnitCost);
        }
      } catch {}
    }

    const oId = Number(item.order_id);
    const plateRatio = getOrderPlateRatio(oId);
    const effectiveRawCost =
      disp.productDisp === 'recovered_sellable' ? 0 : itemRawCost;
    const effectiveUnitPlateCost = plateRatio * paperPlateUnitCost;

    const split = itemSplits.get(oiId) || {
      bogoPaidUnits: 0,
      bogoFreeUnits: 0,
      normalPaidUnits: qty,
      bogoSource: 'launch',
    };

    const isFree = isBogoFreeItem(item);
    const promoSource =
      split.bogoSource === 'loyalty' ? 'Loyalty BOGO' : 'Launch BOGO';

    // Determine payment method from bill
    let paymentMethod = 'Cash';
    if (item.payment_details) {
      try {
        const pd =
          typeof item.payment_details === 'string'
            ? JSON.parse(item.payment_details)
            : item.payment_details;
        if (Array.isArray(pd) && pd.length > 0) {
          const methods = Array.from(
            new Set(pd.map((p: any) => String(p.method || '').toUpperCase())),
          );
          if (methods.length === 1) {
            paymentMethod = methods[0];
          } else if (methods.length > 1) {
            paymentMethod = `Split (${methods.join('/')})`;
          }
        }
      } catch {}
    }

    const dateStr = String(item.paid_at || '').slice(0, 10);
    const orderIdentifier = item.order_number || String(item.order_id);
    const baseProdName = String(
      item.catalog_name || item.product_name || '',
    )
      .replace(' (BOGO Free)', '')
      .trim();

    if (split.bogoPaidUnits > 0 || split.bogoFreeUnits > 0) {
      const bogoTotalQty = split.bogoPaidUnits + split.bogoFreeUnits;
      const actualRevenue =
        (split.bogoPaidUnits / qty) * Math.max(0, subtotal - discount - itemRefund);
      const bogoDiscount = split.bogoFreeUnits > 0 ? (isFree ? subtotal : discount) : 0;
      const bogoIngCost = (bogoTotalQty / qty) * effectiveRawCost;
      const bogoPlateCost = bogoTotalQty * effectiveUnitPlateCost;
      const profit = roundCurrencyCost(
        actualRevenue - bogoIngCost - bogoPlateCost,
        fractionDigits,
      );

      bogoRows.push({
        date: dateStr,
        orderId: orderIdentifier,
        billNumber: item.bill_number || '',
        productName: baseProdName,
        totalQuantity: bogoTotalQty,
        paidQuantity: split.bogoPaidUnits,
        freeQuantity: split.bogoFreeUnits,
        unitPrice: Number(item.unit_price || 0),
        grossValue: bogoTotalQty * Number(item.unit_price || 0),
        bogoDiscount,
        actualRevenue,
        ingredientCost: bogoIngCost,
        paperPlateCost: bogoPlateCost,
        profit,
        promotionSource: promoSource,
      });
    }

    if (split.normalPaidUnits > 0) {
      const normalQty = split.normalPaidUnits;
      const netRevenue =
        (normalQty / qty) * Math.max(0, subtotal - discount - itemRefund);
      const normalIngCost = (normalQty / qty) * effectiveRawCost;
      const normalPlateCost = normalQty * effectiveUnitPlateCost;
      const profit = roundCurrencyCost(
        netRevenue - normalIngCost - normalPlateCost,
        fractionDigits,
      );

      normalRows.push({
        date: dateStr,
        orderId: orderIdentifier,
        billNumber: item.bill_number || '',
        productName: baseProdName,
        quantity: normalQty,
        unitPrice: Number(item.unit_price || 0),
        grossSales: normalQty * Number(item.unit_price || 0),
        discount: 0,
        netRevenue,
        paymentMethod,
        ingredientCost: normalIngCost,
        paperPlateCost: normalPlateCost,
        profit,
      });
    }
  }

  // Calculate totals
  const normalTotals = normalRows.reduce(
    (acc, row) => ({
      quantity: acc.quantity + row.quantity,
      grossSales: roundCurrencyCost(acc.grossSales + row.grossSales, fractionDigits),
      discount: roundCurrencyCost(acc.discount + row.discount, fractionDigits),
      netRevenue: roundCurrencyCost(acc.netRevenue + row.netRevenue, fractionDigits),
      ingredientCost: roundCurrencyCost(acc.ingredientCost + row.ingredientCost, fractionDigits),
      paperPlateCost: roundCurrencyCost(acc.paperPlateCost + row.paperPlateCost, fractionDigits),
      profit: roundCurrencyCost(acc.profit + row.profit, fractionDigits),
    }),
    {
      quantity: 0,
      grossSales: 0,
      discount: 0,
      netRevenue: 0,
      ingredientCost: 0,
      paperPlateCost: 0,
      profit: 0,
    },
  );

  const bogoTotals = bogoRows.reduce(
    (acc, row) => ({
      totalQuantity: acc.totalQuantity + row.totalQuantity,
      paidQuantity: acc.paidQuantity + row.paidQuantity,
      freeQuantity: acc.freeQuantity + row.freeQuantity,
      grossValue: roundCurrencyCost(acc.grossValue + row.grossValue, fractionDigits),
      bogoDiscount: roundCurrencyCost(acc.bogoDiscount + row.bogoDiscount, fractionDigits),
      actualRevenue: roundCurrencyCost(acc.actualRevenue + row.actualRevenue, fractionDigits),
      ingredientCost: roundCurrencyCost(acc.ingredientCost + row.ingredientCost, fractionDigits),
      paperPlateCost: roundCurrencyCost(acc.paperPlateCost + row.paperPlateCost, fractionDigits),
      profit: roundCurrencyCost(acc.profit + row.profit, fractionDigits),
    }),
    {
      totalQuantity: 0,
      paidQuantity: 0,
      freeQuantity: 0,
      grossValue: 0,
      bogoDiscount: 0,
      actualRevenue: 0,
      ingredientCost: 0,
      paperPlateCost: 0,
      profit: 0,
    },
  );

  return {
    startDate,
    endDate,
    currency,
    normalRows,
    bogoRows,
    normalTotals,
    bogoTotals,
  };
}

export async function serializeNormalSalesReportXlsx(
  dataset: SalesReportDataset,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'American Pancakes POS';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Normal Sales Report', {
    views: [{ state: 'frozen', ySplit: 2 }],
  });

  sheet.columns = [
    { header: 'Date', key: 'date', width: 14 },
    { header: 'Order ID', key: 'orderId', width: 16 },
    { header: 'Bill #', key: 'billNumber', width: 14 },
    { header: 'Product Name', key: 'productName', width: 28 },
    { header: 'Quantity', key: 'quantity', width: 12 },
    { header: 'Unit Price', key: 'unitPrice', width: 14 },
    { header: 'Gross Sales', key: 'grossSales', width: 15 },
    { header: 'Discounts', key: 'discount', width: 14 },
    { header: 'Net Revenue', key: 'netRevenue', width: 16 },
    { header: 'Payment Method', key: 'paymentMethod', width: 18 },
    { header: 'Ingredient Cost', key: 'ingredientCost', width: 16 },
    { header: 'Paper Plate Cost', key: 'paperPlateCost', width: 16 },
    { header: 'Contribution / Profit', key: 'profit', width: 20 },
  ];

  // Title Row (row 1)
  sheet.spliceRows(1, 0, [
    `AMERICAN PANCAKES — NORMAL SALES REPORT (${dataset.startDate === dataset.endDate ? dataset.startDate : `${dataset.startDate} to ${dataset.endDate}`})`,
  ]);
  sheet.mergeCells('A1:M1');
  const titleCell = sheet.getCell('A1');
  titleCell.font = { bold: true, size: 12, color: { argb: 'FF1E3A8A' } };
  titleCell.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFDBEAFE' },
  };
  titleCell.alignment = { vertical: 'middle', horizontal: 'center' };

  // Header row (now row 2)
  const headerRow = sheet.getRow(2);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF2563EB' },
  };
  headerRow.alignment = { vertical: 'middle' };

  for (const row of dataset.normalRows) {
    const r = sheet.addRow({
      date: row.date,
      orderId: row.orderId,
      billNumber: row.billNumber,
      productName: row.productName,
      quantity: row.quantity,
      unitPrice: row.unitPrice,
      grossSales: row.grossSales,
      discount: row.discount,
      netRevenue: row.netRevenue,
      paymentMethod: row.paymentMethod,
      ingredientCost: row.ingredientCost,
      paperPlateCost: row.paperPlateCost,
      profit: row.profit,
    });
    r.getCell('unitPrice').numFmt = '₹#,##0.00';
    r.getCell('grossSales').numFmt = '₹#,##0.00';
    r.getCell('discount').numFmt = '₹#,##0.00';
    r.getCell('netRevenue').numFmt = '₹#,##0.00';
    r.getCell('ingredientCost').numFmt = '₹#,##0.00';
    r.getCell('paperPlateCost').numFmt = '₹#,##0.00';
    r.getCell('profit').numFmt = '₹#,##0.00';
  }

  // Totals Row
  const totalRow = sheet.addRow({
    date: 'TOTAL',
    orderId: '',
    billNumber: '',
    productName: '',
    quantity: dataset.normalTotals.quantity,
    unitPrice: '',
    grossSales: dataset.normalTotals.grossSales,
    discount: dataset.normalTotals.discount,
    netRevenue: dataset.normalTotals.netRevenue,
    paymentMethod: '',
    ingredientCost: dataset.normalTotals.ingredientCost,
    paperPlateCost: dataset.normalTotals.paperPlateCost,
    profit: dataset.normalTotals.profit,
  });
  totalRow.font = { bold: true };
  totalRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFF3F4F6' },
  };
  totalRow.getCell('grossSales').numFmt = '₹#,##0.00';
  totalRow.getCell('discount').numFmt = '₹#,##0.00';
  totalRow.getCell('netRevenue').numFmt = '₹#,##0.00';
  totalRow.getCell('ingredientCost').numFmt = '₹#,##0.00';
  totalRow.getCell('paperPlateCost').numFmt = '₹#,##0.00';
  totalRow.getCell('profit').numFmt = '₹#,##0.00';

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

export async function serializeBogoSalesReportXlsx(
  dataset: SalesReportDataset,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'American Pancakes POS';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('BOGO Sales Report', {
    views: [{ state: 'frozen', ySplit: 2 }],
  });

  sheet.columns = [
    { header: 'Date', key: 'date', width: 14 },
    { header: 'Order ID', key: 'orderId', width: 16 },
    { header: 'Bill #', key: 'billNumber', width: 14 },
    { header: 'Product Name', key: 'productName', width: 28 },
    { header: 'Total Qty', key: 'totalQuantity', width: 12 },
    { header: 'Paid Qty', key: 'paidQuantity', width: 12 },
    { header: 'Free Qty', key: 'freeQuantity', width: 12 },
    { header: 'Unit Price', key: 'unitPrice', width: 14 },
    { header: 'Gross Value', key: 'grossValue', width: 15 },
    { header: 'BOGO Discount', key: 'bogoDiscount', width: 15 },
    { header: 'Actual Revenue', key: 'actualRevenue', width: 16 },
    { header: 'Ingredient Cost', key: 'ingredientCost', width: 16 },
    { header: 'Paper Plate Cost', key: 'paperPlateCost', width: 16 },
    { header: 'Contribution / Profit', key: 'profit', width: 20 },
    { header: 'Promotion Source', key: 'promotionSource', width: 18 },
  ];

  // Title Row (row 1)
  sheet.spliceRows(1, 0, [
    `AMERICAN PANCAKES — BOGO SALES REPORT (${dataset.startDate === dataset.endDate ? dataset.startDate : `${dataset.startDate} to ${dataset.endDate}`})`,
  ]);
  sheet.mergeCells('A1:O1');
  const titleCell = sheet.getCell('A1');
  titleCell.font = { bold: true, size: 12, color: { argb: 'FF78350F' } };
  titleCell.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFFEF3C7' },
  };
  titleCell.alignment = { vertical: 'middle', horizontal: 'center' };

  // Header row (now row 2)
  const headerRow = sheet.getRow(2);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFD97706' },
  };
  headerRow.alignment = { vertical: 'middle' };

  for (const row of dataset.bogoRows) {
    const r = sheet.addRow({
      date: row.date,
      orderId: row.orderId,
      billNumber: row.billNumber,
      productName: row.productName,
      totalQuantity: row.totalQuantity,
      paidQuantity: row.paidQuantity,
      freeQuantity: row.freeQuantity,
      unitPrice: row.unitPrice,
      grossValue: row.grossValue,
      bogoDiscount: row.bogoDiscount,
      actualRevenue: row.actualRevenue,
      ingredientCost: row.ingredientCost,
      paperPlateCost: row.paperPlateCost,
      profit: row.profit,
      promotionSource: row.promotionSource,
    });
    r.getCell('unitPrice').numFmt = '₹#,##0.00';
    r.getCell('grossValue').numFmt = '₹#,##0.00';
    r.getCell('bogoDiscount').numFmt = '₹#,##0.00';
    r.getCell('actualRevenue').numFmt = '₹#,##0.00';
    r.getCell('ingredientCost').numFmt = '₹#,##0.00';
    r.getCell('paperPlateCost').numFmt = '₹#,##0.00';
    r.getCell('profit').numFmt = '₹#,##0.00';
  }

  // Totals Row
  const totalRow = sheet.addRow({
    date: 'TOTAL',
    orderId: '',
    billNumber: '',
    productName: '',
    totalQuantity: dataset.bogoTotals.totalQuantity,
    paidQuantity: dataset.bogoTotals.paidQuantity,
    freeQuantity: dataset.bogoTotals.freeQuantity,
    unitPrice: '',
    grossValue: dataset.bogoTotals.grossValue,
    bogoDiscount: dataset.bogoTotals.bogoDiscount,
    actualRevenue: dataset.bogoTotals.actualRevenue,
    ingredientCost: dataset.bogoTotals.ingredientCost,
    paperPlateCost: dataset.bogoTotals.paperPlateCost,
    profit: dataset.bogoTotals.profit,
    promotionSource: '',
  });
  totalRow.font = { bold: true };
  totalRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFF3F4F6' },
  };
  totalRow.getCell('grossValue').numFmt = '₹#,##0.00';
  totalRow.getCell('bogoDiscount').numFmt = '₹#,##0.00';
  totalRow.getCell('actualRevenue').numFmt = '₹#,##0.00';
  totalRow.getCell('ingredientCost').numFmt = '₹#,##0.00';
  totalRow.getCell('paperPlateCost').numFmt = '₹#,##0.00';
  totalRow.getCell('profit').numFmt = '₹#,##0.00';

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

export function serializeNormalSalesReportHtml(dataset: SalesReportDataset): string {
  const span =
    dataset.startDate === dataset.endDate
      ? dataset.startDate
      : `${dataset.startDate} to ${dataset.endDate}`;

  const rowsHtml = dataset.normalRows
    .map(
      (r) => `
    <tr>
      <td>${r.date}</td>
      <td class="mono">${r.orderId}</td>
      <td class="mono">${r.billNumber}</td>
      <td>${r.productName}</td>
      <td class="num">${r.quantity}</td>
      <td class="num">₹${r.unitPrice.toFixed(2)}</td>
      <td class="num">₹${r.grossSales.toFixed(2)}</td>
      <td class="num">${r.discount > 0 ? `-₹${r.discount.toFixed(2)}` : '₹0.00'}</td>
      <td class="num font-bold">₹${r.netRevenue.toFixed(2)}</td>
      <td>${r.paymentMethod}</td>
      <td class="num">₹${r.ingredientCost.toFixed(2)}</td>
      <td class="num">₹${r.paperPlateCost.toFixed(2)}</td>
      <td class="num font-bold ${r.profit >= 0 ? 'text-emerald' : 'text-rose'}">₹${r.profit.toFixed(2)}</td>
    </tr>`,
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Normal Sales Report — ${span}</title>
  <style>
    @page { size: A4 landscape; margin: 12mm; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #1f2937; margin: 0; padding: 16px; font-size: 11px; }
    h1 { font-size: 18px; margin: 0 0 4px 0; color: #111827; }
    .subtitle { font-size: 12px; color: #6b7280; margin-bottom: 16px; }
    .kpi-row { display: flex; gap: 12px; margin-bottom: 16px; }
    .kpi-card { flex: 1; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 10px; }
    .kpi-label { font-size: 10px; text-transform: uppercase; color: #6b7280; font-weight: 600; }
    .kpi-val { font-size: 15px; font-weight: 700; color: #111827; margin-top: 2px; }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; }
    th { background: #2563eb; color: #ffffff; text-align: left; padding: 6px 8px; font-size: 10px; text-transform: uppercase; }
    td { padding: 5px 8px; border-bottom: 1px solid #e5e7eb; }
    tr:nth-child(even) { background-color: #f9fafb; }
    .num { text-align: right; }
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
    .font-bold { font-weight: 700; }
    .text-emerald { color: #059669; }
    .text-rose { color: #e11d48; }
    .total-row { background: #f3f4f6; font-weight: 700; border-top: 2px solid #9ca3af; }
    @media print {
      body { padding: 0; }
      .no-print { display: none; }
    }
  </style>
</head>
<body>
  <h1>AMERICAN PANCAKES — NORMAL SALES REPORT</h1>
  <div class="subtitle">Reporting Period: <strong>${span}</strong> · Generated on ${new Date().toLocaleString()}</div>

  <div class="kpi-row">
    <div class="kpi-card"><div class="kpi-label">Pancakes Sold</div><div class="kpi-val">${dataset.normalTotals.quantity}</div></div>
    <div class="kpi-card"><div class="kpi-label">Gross Sales</div><div class="kpi-val">₹${dataset.normalTotals.grossSales.toFixed(2)}</div></div>
    <div class="kpi-card"><div class="kpi-label">Discounts</div><div class="kpi-val">-₹${dataset.normalTotals.discount.toFixed(2)}</div></div>
    <div class="kpi-card"><div class="kpi-label">Net Revenue</div><div class="kpi-val">₹${dataset.normalTotals.netRevenue.toFixed(2)}</div></div>
    <div class="kpi-card"><div class="kpi-label">Ingredient Cost</div><div class="kpi-val">₹${dataset.normalTotals.ingredientCost.toFixed(2)}</div></div>
    <div class="kpi-card"><div class="kpi-label">Paper Plate Cost</div><div class="kpi-val">₹${dataset.normalTotals.paperPlateCost.toFixed(2)}</div></div>
    <div class="kpi-card"><div class="kpi-label">Net Profit</div><div class="kpi-val text-emerald">₹${dataset.normalTotals.profit.toFixed(2)}</div></div>
  </div>

  <table>
    <thead>
      <tr>
        <th>Date</th>
        <th>Order ID</th>
        <th>Bill #</th>
        <th>Product Name</th>
        <th class="num">Qty</th>
        <th class="num">Unit Price</th>
        <th class="num">Gross Sales</th>
        <th class="num">Discount</th>
        <th class="num">Net Revenue</th>
        <th>Payment</th>
        <th class="num">Raw Cost</th>
        <th class="num">Plate Cost</th>
        <th class="num">Profit</th>
      </tr>
    </thead>
    <tbody>
      ${rowsHtml}
    </tbody>
    <tfoot>
      <tr class="total-row">
        <td colspan="4">TOTAL</td>
        <td class="num">${dataset.normalTotals.quantity}</td>
        <td class="num">-</td>
        <td class="num">₹${dataset.normalTotals.grossSales.toFixed(2)}</td>
        <td class="num">-₹${dataset.normalTotals.discount.toFixed(2)}</td>
        <td class="num">₹${dataset.normalTotals.netRevenue.toFixed(2)}</td>
        <td>-</td>
        <td class="num">₹${dataset.normalTotals.ingredientCost.toFixed(2)}</td>
        <td class="num">₹${dataset.normalTotals.paperPlateCost.toFixed(2)}</td>
        <td class="num text-emerald">₹${dataset.normalTotals.profit.toFixed(2)}</td>
      </tr>
    </tfoot>
  </table>
</body>
</html>`;
}

export function serializeBogoSalesReportHtml(dataset: SalesReportDataset): string {
  const span =
    dataset.startDate === dataset.endDate
      ? dataset.startDate
      : `${dataset.startDate} to ${dataset.endDate}`;

  const rowsHtml = dataset.bogoRows
    .map(
      (r) => `
    <tr>
      <td>${r.date}</td>
      <td class="mono">${r.orderId}</td>
      <td class="mono">${r.billNumber}</td>
      <td>${r.productName}</td>
      <td class="num font-bold">${r.totalQuantity}</td>
      <td class="num">${r.paidQuantity}</td>
      <td class="num text-emerald font-bold">${r.freeQuantity}</td>
      <td class="num">₹${r.unitPrice.toFixed(2)}</td>
      <td class="num">₹${r.grossValue.toFixed(2)}</td>
      <td class="num text-rose">${r.bogoDiscount > 0 ? `-₹${r.bogoDiscount.toFixed(2)}` : '₹0.00'}</td>
      <td class="num font-bold">₹${r.actualRevenue.toFixed(2)}</td>
      <td class="num">₹${r.ingredientCost.toFixed(2)}</td>
      <td class="num">₹${r.paperPlateCost.toFixed(2)}</td>
      <td class="num font-bold ${r.profit >= 0 ? 'text-emerald' : 'text-rose'}">₹${r.profit.toFixed(2)}</td>
      <td><span class="badge">${r.promotionSource}</span></td>
    </tr>`,
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>BOGO Sales Report — ${span}</title>
  <style>
    @page { size: A4 landscape; margin: 12mm; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #1f2937; margin: 0; padding: 16px; font-size: 11px; }
    h1 { font-size: 18px; margin: 0 0 4px 0; color: #92400e; }
    .subtitle { font-size: 12px; color: #6b7280; margin-bottom: 16px; }
    .kpi-row { display: flex; gap: 12px; margin-bottom: 16px; }
    .kpi-card { flex: 1; background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 10px; }
    .kpi-label { font-size: 10px; text-transform: uppercase; color: #92400e; font-weight: 600; }
    .kpi-val { font-size: 15px; font-weight: 700; color: #78350f; margin-top: 2px; }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; }
    th { background: #d97706; color: #ffffff; text-align: left; padding: 6px 8px; font-size: 10px; text-transform: uppercase; }
    td { padding: 5px 8px; border-bottom: 1px solid #e5e7eb; }
    tr:nth-child(even) { background-color: #fffbeb/20; }
    .num { text-align: right; }
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
    .font-bold { font-weight: 700; }
    .text-emerald { color: #059669; }
    .text-rose { color: #e11d48; }
    .badge { display: inline-block; padding: 2px 6px; border-radius: 4px; font-size: 9px; font-weight: 600; background: #fef3c7; color: #92400e; }
    .total-row { background: #fef3c7; font-weight: 700; border-top: 2px solid #f59e0b; color: #78350f; }
    @media print {
      body { padding: 0; }
      .no-print { display: none; }
    }
  </style>
</head>
<body>
  <h1>AMERICAN PANCAKES — BOGO PROMOTIONAL SALES REPORT</h1>
  <div class="subtitle">Reporting Period: <strong>${span}</strong> · Generated on ${new Date().toLocaleString()}</div>

  <div class="kpi-row">
    <div class="kpi-card"><div class="kpi-label">Pancakes Prepared</div><div class="kpi-val">${dataset.bogoTotals.totalQuantity} (${dataset.bogoTotals.paidQuantity} Paid · ${dataset.bogoTotals.freeQuantity} Free)</div></div>
    <div class="kpi-card"><div class="kpi-label">Gross Value</div><div class="kpi-val">₹${dataset.bogoTotals.grossValue.toFixed(2)}</div></div>
    <div class="kpi-card"><div class="kpi-label">BOGO Discounts</div><div class="kpi-val text-rose">-₹${dataset.bogoTotals.bogoDiscount.toFixed(2)}</div></div>
    <div class="kpi-card"><div class="kpi-label">Actual Revenue</div><div class="kpi-val">₹${dataset.bogoTotals.actualRevenue.toFixed(2)}</div></div>
    <div class="kpi-card"><div class="kpi-label">Ingredient Cost</div><div class="kpi-val">₹${dataset.bogoTotals.ingredientCost.toFixed(2)}</div></div>
    <div class="kpi-card"><div class="kpi-label">Paper Plate Cost</div><div class="kpi-val">₹${dataset.bogoTotals.paperPlateCost.toFixed(2)}</div></div>
    <div class="kpi-card"><div class="kpi-label">Net Profit</div><div class="kpi-val text-emerald">₹${dataset.bogoTotals.profit.toFixed(2)}</div></div>
  </div>

  <table>
    <thead>
      <tr>
        <th>Date</th>
        <th>Order ID</th>
        <th>Bill #</th>
        <th>Product Name</th>
        <th class="num">Total Qty</th>
        <th class="num">Paid</th>
        <th class="num">Free</th>
        <th class="num">Unit Price</th>
        <th class="num">Gross Value</th>
        <th class="num">BOGO Discount</th>
        <th class="num">Actual Revenue</th>
        <th class="num">Raw Cost</th>
        <th class="num">Plate Cost</th>
        <th class="num">Profit</th>
        <th>Promotion</th>
      </tr>
    </thead>
    <tbody>
      ${rowsHtml}
    </tbody>
    <tfoot>
      <tr class="total-row">
        <td colspan="4">TOTAL</td>
        <td class="num">${dataset.bogoTotals.totalQuantity}</td>
        <td class="num">${dataset.bogoTotals.paidQuantity}</td>
        <td class="num">${dataset.bogoTotals.freeQuantity}</td>
        <td class="num">-</td>
        <td class="num">₹${dataset.bogoTotals.grossValue.toFixed(2)}</td>
        <td class="num text-rose">-₹${dataset.bogoTotals.bogoDiscount.toFixed(2)}</td>
        <td class="num">₹${dataset.bogoTotals.actualRevenue.toFixed(2)}</td>
        <td class="num">₹${dataset.bogoTotals.ingredientCost.toFixed(2)}</td>
        <td class="num">₹${dataset.bogoTotals.paperPlateCost.toFixed(2)}</td>
        <td class="num text-emerald">₹${dataset.bogoTotals.profit.toFixed(2)}</td>
        <td>-</td>
      </tr>
    </tfoot>
  </table>
</body>
</html>`;
}

export async function exportReportToPdfBuffer(html: string): Promise<Buffer> {
  return renderHtmlToPdfBuffer({ html, pageSize: 'A4' });
}
