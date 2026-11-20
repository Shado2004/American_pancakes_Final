import ExcelJS from 'exceljs';
import type { RoadsideDashboardSummary, ProductPerformanceItem } from './roadside-reporting';

function escapeCsvCell(val: unknown): string {
  if (val === null || val === undefined) return '';
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function serializeProductPerformanceCsv(summary: RoadsideDashboardSummary): string {
  const headers = [
    'Product Name',
    'Paid Quantity',
    'Free BOGO Quantity',
    'Total Pancakes Prepared',
    'Gross Revenue',
    'Discounts',
    'Refunds',
    'Net Revenue',
    'Sellable Recovered Qty',
    'Wastage Qty',
    'Ingredient Cost',
    'Packaging Cost',
    'Contribution / Profit',
  ];

  const lines: string[] = [headers.join(',')];

  let totalPaid = 0;
  let totalFree = 0;
  let totalPrepared = 0;
  let totalGross = 0;
  let totalDiscounts = 0;
  let totalRefunds = 0;
  let totalNet = 0;
  let totalRecovered = 0;
  let totalWastage = 0;
  let totalIngredient = 0;
  let totalPackaging = 0;
  let totalProfit = 0;

  for (const item of summary.productPerformance) {
    const recQty = item.recoveredQuantity || 0;
    const wstQty = item.wastageQuantity || 0;
    totalPaid += item.paidQuantity;
    totalFree += item.freeQuantity;
    totalPrepared += item.totalPrepared;
    totalGross += item.grossRevenue;
    totalDiscounts += item.discounts;
    totalRefunds += item.refunds;
    totalNet += item.netRevenue;
    totalRecovered += recQty;
    totalWastage += wstQty;
    totalIngredient += item.ingredientCost;
    totalPackaging += item.packagingCost;
    totalProfit += item.profit;

    const row = [
      escapeCsvCell(item.productName),
      item.paidQuantity,
      item.freeQuantity,
      item.totalPrepared,
      item.grossRevenue.toFixed(2),
      item.discounts.toFixed(2),
      item.refunds.toFixed(2),
      item.netRevenue.toFixed(2),
      recQty,
      wstQty,
      item.ingredientCost.toFixed(2),
      item.packagingCost.toFixed(2),
      item.profit.toFixed(2),
    ];
    lines.push(row.join(','));
  }

  // Summary / Total row matching Dashboard footer
  const totalRow = [
    'Total',
    totalPaid,
    totalFree,
    totalPrepared,
    totalGross.toFixed(2),
    totalDiscounts.toFixed(2),
    totalRefunds.toFixed(2),
    totalNet.toFixed(2),
    totalRecovered,
    totalWastage,
    totalIngredient.toFixed(2),
    totalPackaging.toFixed(2),
    totalProfit.toFixed(2),
  ];
  lines.push(totalRow.join(','));

  if (summary.normalSalesSummary && summary.bogoSalesSummary) {
    lines.push('');
    lines.push('--- Normal Pancake Sales vs BOGO Promotional Sales Breakdown ---');
    lines.push('Category,Quantity / Prepared,Revenue,Paper Plate Cost,Total Ingredient Cost,Profit / Contribution');
    lines.push(
      `Normal Sales,${summary.normalSalesSummary.paidQuantity},${summary.normalSalesSummary.revenue.toFixed(2)},${summary.normalSalesSummary.paperPlateCost.toFixed(2)},${summary.normalSalesSummary.totalIngredientCost.toFixed(2)},${summary.normalSalesSummary.profit.toFixed(2)}`,
    );
    lines.push(
      `BOGO Sales (${summary.bogoSalesSummary.pairsRedeemed} pairs),${summary.bogoSalesSummary.pancakesPrepared},${summary.bogoSalesSummary.revenue.toFixed(2)},${summary.bogoSalesSummary.paperPlateCost.toFixed(2)},${summary.bogoSalesSummary.totalIngredientCost.toFixed(2)},${summary.bogoSalesSummary.profit.toFixed(2)}`,
    );
  }

  return lines.join('\n') + '\n';
}

export async function serializeProductPerformanceXlsx(
  summary: RoadsideDashboardSummary,
  options?: { dateRangeLabel?: string },
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'American Pancakes POS';
  workbook.created = new Date();

  const worksheet = workbook.addWorksheet('Product-Wise Sales & Profit', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  worksheet.columns = [
    { header: 'Product Name', key: 'productName', width: 28 },
    { header: 'Paid Quantity', key: 'paidQuantity', width: 14 },
    { header: 'Free BOGO Quantity', key: 'freeQuantity', width: 18 },
    { header: 'Total Pancakes Prepared', key: 'totalPrepared', width: 22 },
    { header: 'Gross Revenue', key: 'grossRevenue', width: 16 },
    { header: 'Discounts', key: 'discounts', width: 14 },
    { header: 'Refunds', key: 'refunds', width: 14 },
    { header: 'Net Revenue', key: 'netRevenue', width: 16 },
    { header: 'Sellable Recovered Qty', key: 'recoveredQuantity', width: 22 },
    { header: 'Wastage Qty', key: 'wastageQuantity', width: 16 },
    { header: 'Ingredient Cost', key: 'ingredientCost', width: 16 },
    { header: 'Packaging Cost', key: 'packagingCost', width: 16 },
    { header: 'Contribution / Profit', key: 'profit', width: 20 },
  ];

  // Header style
  const headerRow = worksheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FF1F2937' } };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFF3F4F6' },
  };
  headerRow.alignment = { vertical: 'middle' };

  let totalPaid = 0;
  let totalFree = 0;
  let totalPrepared = 0;
  let totalGross = 0;
  let totalDiscounts = 0;
  let totalRefunds = 0;
  let totalNet = 0;
  let totalRecovered = 0;
  let totalWastage = 0;
  let totalIngredient = 0;
  let totalPackaging = 0;
  let totalProfit = 0;

  for (const item of summary.productPerformance) {
    const recQty = item.recoveredQuantity || 0;
    const wstQty = item.wastageQuantity || 0;
    totalPaid += item.paidQuantity;
    totalFree += item.freeQuantity;
    totalPrepared += item.totalPrepared;
    totalGross += item.grossRevenue;
    totalDiscounts += item.discounts;
    totalRefunds += item.refunds;
    totalNet += item.netRevenue;
    totalRecovered += recQty;
    totalWastage += wstQty;
    totalIngredient += item.ingredientCost;
    totalPackaging += item.packagingCost;
    totalProfit += item.profit;

    const row = worksheet.addRow({
      productName: item.productName,
      paidQuantity: item.paidQuantity,
      freeQuantity: item.freeQuantity,
      totalPrepared: item.totalPrepared,
      grossRevenue: item.grossRevenue,
      discounts: item.discounts,
      refunds: item.refunds,
      netRevenue: item.netRevenue,
      recoveredQuantity: recQty,
      wastageQuantity: wstQty,
      ingredientCost: item.ingredientCost,
      packagingCost: item.packagingCost,
      profit: item.profit,
    });

    row.getCell('paidQuantity').numFmt = '#,##0';
    row.getCell('freeQuantity').numFmt = '#,##0';
    row.getCell('totalPrepared').numFmt = '#,##0';
    row.getCell('grossRevenue').numFmt = '#,##0.00';
    row.getCell('discounts').numFmt = '#,##0.00';
    row.getCell('refunds').numFmt = '#,##0.00';
    row.getCell('netRevenue').numFmt = '#,##0.00';
    row.getCell('recoveredQuantity').numFmt = '#,##0';
    row.getCell('wastageQuantity').numFmt = '#,##0';
    row.getCell('ingredientCost').numFmt = '#,##0.00';
    row.getCell('packagingCost').numFmt = '#,##0.00';
    row.getCell('profit').numFmt = '#,##0.00';
  }

  // Summary / Total row
  const summaryRow = worksheet.addRow({
    productName: 'Total',
    paidQuantity: totalPaid,
    freeQuantity: totalFree,
    totalPrepared: totalPrepared,
    grossRevenue: Number(totalGross.toFixed(2)),
    discounts: Number(totalDiscounts.toFixed(2)),
    refunds: Number(totalRefunds.toFixed(2)),
    netRevenue: Number(totalNet.toFixed(2)),
    recoveredQuantity: totalRecovered,
    wastageQuantity: totalWastage,
    ingredientCost: Number(totalIngredient.toFixed(2)),
    packagingCost: Number(totalPackaging.toFixed(2)),
    profit: Number(totalProfit.toFixed(2)),
  });

  summaryRow.font = { bold: true };
  summaryRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFF9FAFB' },
  };
  summaryRow.border = {
    top: { style: 'thin' },
    bottom: { style: 'double' },
  };

  summaryRow.getCell('paidQuantity').numFmt = '#,##0';
  summaryRow.getCell('freeQuantity').numFmt = '#,##0';
  summaryRow.getCell('totalPrepared').numFmt = '#,##0';
  summaryRow.getCell('grossRevenue').numFmt = '#,##0.00';
  summaryRow.getCell('discounts').numFmt = '#,##0.00';
  summaryRow.getCell('refunds').numFmt = '#,##0.00';
  summaryRow.getCell('netRevenue').numFmt = '#,##0.00';
  summaryRow.getCell('ingredientCost').numFmt = '#,##0.00';
  summaryRow.getCell('packagingCost').numFmt = '#,##0.00';
  summaryRow.getCell('profit').numFmt = '#,##0.00';

  if (summary.normalSalesSummary && summary.bogoSalesSummary) {
    const bogoSheet = workbook.addWorksheet('Normal vs BOGO Breakdown', {
      views: [{ state: 'frozen', ySplit: 1 }],
    });

    bogoSheet.columns = [
      { header: 'Category / Stream', key: 'category', width: 28 },
      { header: 'Pancakes Sold / Prepared', key: 'quantity', width: 24 },
      { header: 'Paid Quantity', key: 'paidQuantity', width: 16 },
      { header: 'Free Quantity', key: 'freeQuantity', width: 16 },
      { header: 'Net Revenue', key: 'revenue', width: 16 },
      { header: 'Sellable Recovered Qty', key: 'recoveredQuantity', width: 22 },
      { header: 'Wastage Qty', key: 'wastageQuantity', width: 16 },
      { header: 'Raw Ingredient Cost', key: 'rawCost', width: 20 },
      { header: 'Paper Plate Cost (@₹2.50)', key: 'plateCost', width: 22 },
      { header: 'Total Ingredient Cost', key: 'totalCost', width: 20 },
      { header: 'Profit / Contribution', key: 'profit', width: 20 },
    ];

    const bogoHeaderRow = bogoSheet.getRow(1);
    bogoHeaderRow.font = { bold: true, color: { argb: 'FF1F2937' } };
    bogoHeaderRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFF3F4F6' },
    };

    const norm = summary.normalSalesSummary;
    bogoSheet.addRow({
      category: 'Normal Pancake Sales',
      quantity: norm.paidQuantity,
      paidQuantity: norm.paidQuantity,
      freeQuantity: 0,
      revenue: norm.revenue,
      recoveredQuantity: norm.recoveredQuantity || 0,
      wastageQuantity: norm.wastageQuantity || 0,
      rawCost: norm.rawIngredientCost,
      plateCost: norm.paperPlateCost,
      totalCost: norm.totalIngredientCost,
      profit: norm.profit,
    });

    const bogo = summary.bogoSalesSummary;
    bogoSheet.addRow({
      category: `BOGO Sales (${bogo.pairsRedeemed} pairs)`,
      quantity: bogo.pancakesPrepared,
      paidQuantity: bogo.paidQuantity,
      freeQuantity: bogo.freeQuantity,
      revenue: bogo.revenue,
      recoveredQuantity: bogo.recoveredQuantity || 0,
      wastageQuantity: bogo.wastageQuantity || 0,
      rawCost: bogo.rawIngredientCost,
      plateCost: bogo.paperPlateCost,
      totalCost: bogo.totalIngredientCost,
      profit: bogo.profit,
    });

    const reconRow = bogoSheet.addRow({
      category: 'Total Pancake Sales (Reconciliation)',
      quantity: norm.paidQuantity + bogo.pancakesPrepared,
      paidQuantity: norm.paidQuantity + bogo.paidQuantity,
      freeQuantity: bogo.freeQuantity,
      revenue: Number((norm.revenue + bogo.revenue).toFixed(2)),
      recoveredQuantity: (norm.recoveredQuantity || 0) + (bogo.recoveredQuantity || 0),
      wastageQuantity: (norm.wastageQuantity || 0) + (bogo.wastageQuantity || 0),
      rawCost: Number((norm.rawIngredientCost + bogo.rawIngredientCost).toFixed(2)),
      plateCost: Number((norm.paperPlateCost + bogo.paperPlateCost).toFixed(2)),
      totalCost: Number((norm.totalIngredientCost + bogo.totalIngredientCost).toFixed(2)),
      profit: Number((norm.profit + bogo.profit).toFixed(2)),
    });

    reconRow.font = { bold: true };
    reconRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFF9FAFB' },
    };
    reconRow.border = {
      top: { style: 'thin' },
      bottom: { style: 'double' },
    };
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
