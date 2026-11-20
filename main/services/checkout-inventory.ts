/** Authoritative v126 checkout-time inventory consumer. Call inside settlement's transaction. */
import { randomUUID } from 'crypto';
import { getDatabase, now } from '../db';
import { adjustProductStock } from './inventory';
import { parseRecipeSnapshot } from './recipes';
import { applySupplyStockChange } from './supplies';

type Database = ReturnType<typeof getDatabase>;

function hasLedger(db: Database, key: string): boolean {
  return Boolean(db.prepare('SELECT 1 FROM order_inventory_consumptions WHERE idempotency_key=?').get(key));
}

function record(db: Database, values: Record<string, unknown>): void {
  db.prepare(`INSERT INTO order_inventory_consumptions
    (id,order_id,order_item_id,packaging_allocation_id,completion_reference,idempotency_key,consumption_kind,inventory_movement_id,supply_movement_id,created_at)
    VALUES (@id,@order_id,@order_item_id,@packaging_allocation_id,@completion_reference,@idempotency_key,@consumption_kind,@inventory_movement_id,@supply_movement_id,@created_at)`).run(values);
}

/** Consumes snapshots exactly once. Legacy rows are intentionally ignored. */
export function consumeCheckoutInventory(db: Database, orderId: number, actorUserId: string, completionReference: string): void {
  const order = db.prepare('SELECT inventory_lifecycle,status FROM orders WHERE id=?').get(orderId) as any;
  if (!order || order.inventory_lifecycle !== 'checkout_v1') return;
  if (order.status === 'cancelled') return;
  const timestamp = now();
  const items = db.prepare(`SELECT id, inventory_deducted_quantity, inventory_product_id, inventory_variant_id, recipe_snapshot FROM order_items WHERE order_id=? AND status NOT IN ('cancelled','voided','void_adjustment','refunded')`).all(orderId) as any[];
  for (const item of items) {
    const productKey = `v126:${orderId}:product:${item.id}`;
    if (!hasLedger(db, productKey) && Number(item.inventory_deducted_quantity) > 0 && item.inventory_product_id) {
      const movement = adjustProductStock(db, { productId: item.inventory_product_id, variantId: item.inventory_variant_id || null, quantityDelta: -Number(item.inventory_deducted_quantity), movementType: 'sale', actorUserId, referenceType: 'order_item', referenceId: item.id, createdAt: timestamp });
      record(db, { id: randomUUID(), order_id: orderId, order_item_id: item.id, packaging_allocation_id: null, completion_reference: completionReference, idempotency_key: productKey, consumption_kind: 'product', inventory_movement_id: movement.movementId, supply_movement_id: null, created_at: timestamp });
    }
    const addons = db.prepare('SELECT addon_id,inventory_deducted_quantity FROM order_item_addons WHERE order_item_id=?').all(item.id) as any[];
    for (const addon of addons) {
      const key = `v126:${orderId}:addon:${item.id}:${addon.addon_id}`;
      if (!hasLedger(db, key) && addon.addon_id && Number(addon.inventory_deducted_quantity) > 0) {
        const movement = adjustProductStock(db, { productId: null, addonId: addon.addon_id, quantityDelta: -Number(addon.inventory_deducted_quantity), movementType: 'sale', actorUserId, referenceType: 'order_item', referenceId: item.id, createdAt: timestamp });
        record(db, { id: randomUUID(), order_id: orderId, order_item_id: item.id, packaging_allocation_id: null, completion_reference: completionReference, idempotency_key: key, consumption_kind: 'addon', inventory_movement_id: movement.movementId, supply_movement_id: null, created_at: timestamp });
      }
    }
    const recipe = parseRecipeSnapshot(item.recipe_snapshot);
    for (const [index, component] of (recipe?.components || []).entries()) {
      const key = `v126:${orderId}:ingredient:${item.id}:${index}`;
      if (hasLedger(db, key)) continue;

      const isPaperPlate =
        component.supply_id === 'sup_ffdfa4ad3785608b17b4d5a7' ||
        (component.supply_name || '').toLowerCase().includes('plate');

      let qtyDelta = -Math.abs(component.quantity);
      if (isPaperPlate) {
        const servingAllocs = db
          .prepare(
            'SELECT serving_type, quantity FROM order_item_serving_allocations WHERE order_item_id = ?',
          )
          .all(item.id) as Array<{ serving_type: string; quantity: number }>;

        let platesToDeduct: number;
        if (servingAllocs.length > 0) {
          platesToDeduct = servingAllocs
            .filter((a) => a.serving_type === 'dine_in')
            .reduce((sum, a) => sum + Number(a.quantity || 0), 0);
        } else {
          const orderBoxes = (
            db
              .prepare(
                `SELECT COALESCE(SUM(quantity), 0) as total
                 FROM order_items
                 WHERE order_id = ? AND (product_id = 'pr_parcel_box_5' OR LOWER(product_name) LIKE '%parcel box%')
                   AND status NOT IN ('cancelled','voided','void_adjustment','refunded')`,
              )
              .get(orderId) as any
          )?.total || 0;
          const orderPancakes = (
            db
              .prepare(
                `SELECT COALESCE(SUM(quantity), 0) as total
                 FROM order_items
                 WHERE order_id = ? AND product_id != 'pr_parcel_box_5' AND LOWER(product_name) NOT LIKE '%parcel box%'
                   AND status NOT IN ('cancelled','voided','void_adjustment','refunded')`,
              )
              .get(orderId) as any
          )?.total || 0;
          const fallbackPlates =
            orderPancakes > 0
              ? Math.max(0, orderPancakes - orderBoxes) *
                (Number(item.inventory_deducted_quantity || 1) / orderPancakes)
              : Math.max(0, Number(item.inventory_deducted_quantity || 1) - orderBoxes);
          platesToDeduct = Math.max(0, Math.round(fallbackPlates));
        }

        if (platesToDeduct <= 0) {
          continue;
        }
        qtyDelta = -Math.abs(platesToDeduct);
      }

      const movement = applySupplyStockChange(db, { supplyId: component.supply_id, quantityDelta: qtyDelta, movementType: 'recipe_depletion', unit: component.base_unit, actorUserId, referenceType: 'order_item', referenceId: item.id, createdAt: timestamp });
      record(db, { id: randomUUID(), order_id: orderId, order_item_id: item.id, packaging_allocation_id: null, completion_reference: completionReference, idempotency_key: key, consumption_kind: 'ingredient', inventory_movement_id: null, supply_movement_id: movement.movementId, created_at: timestamp });
    }
  }
  const packaging = db.prepare(`SELECT p.id,p.supply_id_snapshot,p.quantity,COALESCE(p.unit_snapshot, 'each') AS unit_snapshot FROM order_item_packaging_allocations p JOIN order_item_serving_allocations s ON s.id=p.serving_allocation_id JOIN order_items i ON i.id=s.order_item_id WHERE i.order_id=? AND i.status NOT IN ('cancelled','voided','void_adjustment','refunded')`).all(orderId) as any[];
  for (const item of packaging) {
    const key = `v126:${orderId}:packaging:${item.id}`;
    if (hasLedger(db, key)) continue;
    const movement = applySupplyStockChange(db, { supplyId: item.supply_id_snapshot, quantityDelta: -Math.abs(Number(item.quantity)), movementType: 'recipe_depletion', unit: item.unit_snapshot || 'each', actorUserId, referenceType: 'packaging_allocation', referenceId: item.id, createdAt: timestamp });
    record(db, { id: randomUUID(), order_id: orderId, order_item_id: null, packaging_allocation_id: item.id, completion_reference: completionReference, idempotency_key: key, consumption_kind: 'packaging', inventory_movement_id: null, supply_movement_id: movement.movementId, created_at: timestamp });
  }
}
