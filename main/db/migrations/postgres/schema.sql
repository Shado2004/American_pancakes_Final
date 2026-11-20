-- ==============================================================================
-- Consolidated PostgreSQL Schema for American Pancakes POS
-- Compatible with Supabase PostgreSQL 15+
-- ==============================================================================

-- Migration ledger to track applied migrations
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE IF NOT EXISTS "addon_group_product" (
  "product_id" TEXT,
  "addon_group_id" TEXT,
  PRIMARY KEY ("product_id", "addon_group_id")
);
CREATE TABLE IF NOT EXISTS "addon_groups" (
  "id" TEXT,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "is_required" SMALLINT DEFAULT 0,
  "min_selection" INTEGER DEFAULT 0,
  "max_selection" INTEGER DEFAULT 1,
  "allow_multiple_quantities" SMALLINT DEFAULT 0,
  "is_active" SMALLINT DEFAULT 1,
  "sort_order" INTEGER DEFAULT 0,
  "created_at" TEXT DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  "updated_at" TEXT DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "addons" (
  "id" TEXT,
  "addon_group_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "price" NUMERIC(12,2) NOT NULL DEFAULT 0,
  "tax_category_id" TEXT DEFAULT NULL,
  "tax_behavior" TEXT DEFAULT 'country_default',
  "inherit_parent_tax_category" SMALLINT DEFAULT 1,
  "is_active" SMALLINT DEFAULT 1,
  "sort_order" INTEGER DEFAULT 0,
  "created_at" TEXT DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  "updated_at" TEXT DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  "track_inventory" SMALLINT DEFAULT 0,
  "stock_quantity" DOUBLE PRECISION DEFAULT 0,
  "low_stock_threshold" DOUBLE PRECISION DEFAULT 0,
  PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "auth_audit_log" (
  "user_id" TEXT,
  "event_type" TEXT NOT NULL,
  "outcome" TEXT NOT NULL,
  "ip_address" TEXT,
  "details_json" TEXT,
  "created_at" TEXT NOT NULL DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
);
CREATE TABLE IF NOT EXISTS "authorization_audit_log" (
  "batch_id" TEXT NOT NULL,
  "actor_user_id" TEXT NOT NULL,
  "target_type" TEXT NOT NULL,
  "target_id" TEXT NOT NULL,
  "permission_id" TEXT NOT NULL,
  "previous_effect" TEXT,
  "next_effect" TEXT,
  "details_json" TEXT,
  "created_at" TEXT NOT NULL DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
);
CREATE TABLE IF NOT EXISTS "bill_items" (
  "bill_id" INTEGER,
  "order_item_id" INTEGER,
  "quantity" INTEGER NOT NULL,
  PRIMARY KEY ("bill_id", "order_item_id")
);
CREATE TABLE IF NOT EXISTS "bills" (
  "bill_number" TEXT NOT NULL,
  "order_id" INTEGER NOT NULL,
  "customer_id" TEXT,
  "subtotal" NUMERIC(12,2) DEFAULT 0,
  "tax_amount" NUMERIC(12,2) DEFAULT 0,
  "tax_breakdown" TEXT,
  "tax_snapshot" TEXT DEFAULT NULL,
  "discount_amount" NUMERIC(12,2) DEFAULT 0,
  "discount_type" TEXT,
  "discount_value" DOUBLE PRECISION,
  "discount_reason" TEXT,
  "delivery_charge" NUMERIC(12,2) DEFAULT 0,
  "packaging_charge" NUMERIC(12,2) DEFAULT 0,
  "service_charge" NUMERIC(12,2) DEFAULT 0,
  "charges_breakdown" TEXT,
  "round_off" NUMERIC(12,2) DEFAULT 0,
  "total" NUMERIC(12,2) DEFAULT 0,
  "paid_amount" NUMERIC(12,2) DEFAULT 0,
  "balance" NUMERIC(12,2) DEFAULT 0,
  "payment_status" TEXT DEFAULT 'unpaid',
  "payment_details" TEXT,
  "paid_at" TEXT,
  "printed_at" TEXT,
  "created_at" TEXT DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  "updated_at" TEXT DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  "split_group_id" TEXT,
  "split_label" TEXT,
  "promotion_id" TEXT DEFAULT NULL
);
CREATE TABLE IF NOT EXISTS "cash_closures" (
  "scope" TEXT NOT NULL DEFAULT 'day',
  "business_date" TEXT NOT NULL,
  "period_start" TEXT NOT NULL,
  "period_end" TEXT NOT NULL,
  "opening_float_cents" INTEGER NOT NULL DEFAULT 0,
  "expected_cash_cents" INTEGER NOT NULL,
  "counted_cash_cents" INTEGER NOT NULL,
  "variance_cents" INTEGER NOT NULL,
  "gross_collected_cents" INTEGER NOT NULL,
  "refunded_cents" INTEGER NOT NULL,
  "net_collected_cents" INTEGER NOT NULL,
  "bill_count" INTEGER NOT NULL,
  "refund_count" INTEGER NOT NULL,
  "payment_methods_json" TEXT NOT NULL DEFAULT '[]',
  "staff_sales_json" TEXT NOT NULL DEFAULT '[]',
  "tax_components_json" TEXT NOT NULL DEFAULT '[]',
  "z_number" INTEGER NOT NULL,
  "closed_by" TEXT NOT NULL,
  "notes" TEXT,
  "created_at" TEXT NOT NULL DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  "pay_in_cents" INTEGER NOT NULL DEFAULT 0,
  "pay_out_cents" INTEGER NOT NULL DEFAULT 0,
  "safe_drop_cents" INTEGER NOT NULL DEFAULT 0,
  "cash_movements_json" TEXT NOT NULL DEFAULT '[]'
);
CREATE TABLE IF NOT EXISTS "cash_drawer_movements" (
  "business_date" TEXT NOT NULL,
  "movement_type" TEXT NOT NULL,
  "amount_cents" INTEGER NOT NULL,
  "reason" TEXT,
  "created_by" TEXT NOT NULL,
  "created_at" TEXT NOT NULL DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  "voided_at" TEXT,
  "voided_by" TEXT,
  "void_reason" TEXT,
  "cash_session_id" INTEGER
);
CREATE TABLE IF NOT EXISTS "cash_sessions" (
  "opened_by" TEXT NOT NULL,
  "opened_by_name" TEXT NOT NULL DEFAULT '',
  "opened_at" TEXT NOT NULL,
  "opening_float_cents" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'open',
  "closed_at" TEXT,
  "closed_by" TEXT,
  "closure_id" INTEGER
);
CREATE TABLE IF NOT EXISTS "categories" (
  "id" TEXT,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "image_url" TEXT,
  "sort_order" INTEGER DEFAULT 0,
  "is_active" SMALLINT DEFAULT 1,
  "parent_id" TEXT,
  "slug" TEXT,
  "color" TEXT,
  "icon" TEXT,
  "deleted_at" TEXT,
  "created_at" TEXT DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  "updated_at" TEXT DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "category_addon_groups" (
  "category_id" TEXT,
  "addon_group_id" TEXT,
  PRIMARY KEY ("category_id", "addon_group_id")
);
CREATE TABLE IF NOT EXISTS "cloud_sync_outbox" (
  "id" TEXT,
  "event_type" TEXT NOT NULL,
  "entity_type" TEXT,
  "entity_id" TEXT,
  "payload" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "next_attempt_at" TEXT,
  "last_error" TEXT,
  "delivered_at" TEXT,
  "created_at" TEXT DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  "updated_at" TEXT DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "counters" (
  "id" TEXT,
  "name" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "is_active" SMALLINT NOT NULL DEFAULT 1,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TEXT DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  "updated_at" TEXT DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "country_pack_versions" (
  "id" TEXT,
  "pack_id" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "schema_version" INTEGER NOT NULL,
  "manifest_json" TEXT NOT NULL,
  "pack_json" TEXT NOT NULL,
  "digest" TEXT,
  "signature" TEXT,
  "effective_from" TEXT NOT NULL,
  "effective_to" TEXT,
  "min_flo_version" TEXT NOT NULL,
  "published_at" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'staged',
  "created_at" TEXT DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "country_packs" (
  "id" TEXT,
  "publisher" TEXT NOT NULL,
  "country" TEXT NOT NULL,
  "jurisdiction" TEXT NOT NULL,
  "active_version_id" TEXT,
  "status" TEXT NOT NULL DEFAULT 'installed',
  "disclaimer_acknowledged_at" TEXT,
  "disclaimer_acknowledged_by" TEXT,
  "created_at" TEXT DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  "updated_at" TEXT DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "customer_display_tokens" (
  "id" TEXT,
  "token_hash" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "created_by" TEXT,
  "created_at" TEXT NOT NULL,
  "last_seen_at" TEXT,
  "revoked_at" TEXT,
  PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "customers" (
  "id" TEXT,
  "name" TEXT NOT NULL,
  "email" TEXT,
  "phone" TEXT,
  "country_code" TEXT DEFAULT '+91',
  "address" TEXT,
  "notes" TEXT,
  "tag_counts" TEXT DEFAULT NULL,
  "is_active" SMALLINT DEFAULT 1,
  "created_at" TEXT DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  "updated_at" TEXT DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "customers_search_fts" (
  "name" TEXT,
  "phone" TEXT,
  "phone_digits" TEXT
);
CREATE TABLE IF NOT EXISTS "customers_search_fts_config" (
  "k" TEXT,
  "v" TEXT,
  PRIMARY KEY ("k")
);
CREATE TABLE IF NOT EXISTS "customers_search_fts_data" (
  "block" BYTEA
);
CREATE TABLE IF NOT EXISTS "customers_search_fts_docsize" (
  "sz" BYTEA
);
CREATE TABLE IF NOT EXISTS "customers_search_fts_idx" (
  "segid" TEXT,
  "term" TEXT,
  "pgno" TEXT,
  PRIMARY KEY ("segid", "term")
);
CREATE TABLE IF NOT EXISTS "delivery_menu_mappings" (
  "provider" TEXT NOT NULL,
  "external_item_id" TEXT NOT NULL,
  "external_variant_id" TEXT DEFAULT NULL,
  "internal_product_id" TEXT NOT NULL,
  "internal_variant_id" TEXT DEFAULT NULL,
  "external_name" TEXT NOT NULL,
  "is_active" SMALLINT NOT NULL DEFAULT 1,
  "sync_status" TEXT NOT NULL DEFAULT 'mapped',
  "last_synced_at" TEXT DEFAULT NULL,
  "created_at" TEXT NOT NULL DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  "updated_at" TEXT NOT NULL DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
);
CREATE TABLE IF NOT EXISTS "delivery_order_tracking" (
  "internal_order_id" INTEGER NOT NULL,
  "provider" TEXT NOT NULL,
  "external_order_id" TEXT NOT NULL,
  "is_simulated" SMALLINT NOT NULL DEFAULT 0,
  "external_status" TEXT NOT NULL,
  "internal_status" TEXT NOT NULL,
  "pickup_code" TEXT DEFAULT NULL,
  "rider_name" TEXT DEFAULT NULL,
  "rider_phone" TEXT DEFAULT NULL,
  "estimated_delivery_time" TEXT DEFAULT NULL,
  "delivery_address" TEXT DEFAULT NULL,
  "raw_details_json" TEXT DEFAULT NULL,
  "created_at" TEXT NOT NULL DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  "updated_at" TEXT NOT NULL DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
);
CREATE TABLE IF NOT EXISTS "delivery_platform_configs" (
  "provider" TEXT,
  "display_name" TEXT NOT NULL,
  "is_enabled" SMALLINT NOT NULL DEFAULT 0,
  "mode" TEXT NOT NULL DEFAULT 'disconnected',
  "api_key_configured" INTEGER NOT NULL DEFAULT 0,
  "api_secret_configured" INTEGER NOT NULL DEFAULT 0,
  "merchant_id" TEXT DEFAULT NULL,
  "store_id" TEXT DEFAULT NULL,
  "auto_accept_orders" INTEGER NOT NULL DEFAULT 0,
  "last_sync_at" TEXT DEFAULT NULL,
  "last_error" TEXT DEFAULT NULL,
  "last_error_at" TEXT DEFAULT NULL,
  "notes" TEXT DEFAULT NULL,
  "created_at" TEXT NOT NULL DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  "updated_at" TEXT NOT NULL DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  PRIMARY KEY ("provider")
);
CREATE TABLE IF NOT EXISTS "delivery_webhook_events" (
  "event_id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "event_type" TEXT NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "payload_json" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'received',
  "internal_order_id" INTEGER DEFAULT NULL,
  "external_order_id" TEXT DEFAULT NULL,
  "retry_count" INTEGER NOT NULL DEFAULT 0,
  "last_error" TEXT DEFAULT NULL,
  "created_at" TEXT NOT NULL DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  "processed_at" TEXT DEFAULT NULL
);
CREATE TABLE IF NOT EXISTS "diagnostics_delivery_gaps" (
  "reason_code" TEXT,
  "count" INTEGER NOT NULL,
  "first_occurred_at" TEXT NOT NULL DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  "last_occurred_at" TEXT NOT NULL DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  "updated_at" TEXT NOT NULL,
  PRIMARY KEY ("reason_code")
);
CREATE TABLE IF NOT EXISTS "diagnostics_hourly_aggregates" (
  "aggregate_key" TEXT,
  "capture_point" TEXT NOT NULL,
  "reason_code" TEXT NOT NULL,
  "classification" TEXT NOT NULL,
  "operation" TEXT NOT NULL,
  "stage" TEXT NOT NULL,
  "outcome" TEXT NOT NULL,
  "window_start" TEXT NOT NULL,
  "count" INTEGER NOT NULL,
  "first_occurred_at" TEXT NOT NULL,
  "last_occurred_at" TEXT NOT NULL,
  "app_version" TEXT NOT NULL,
  "app_build" TEXT NOT NULL,
  "platform" TEXT NOT NULL,
  "examples_json" TEXT NOT NULL DEFAULT '[]',
  "facts_json" TEXT NOT NULL DEFAULT '{}',
  "updated_at" TEXT NOT NULL,
  PRIMARY KEY ("aggregate_key")
);
CREATE TABLE IF NOT EXISTS "expense_categories" (
  "id" TEXT,
  "name" TEXT NOT NULL,
  "name_key" TEXT NOT NULL,
  "is_active" SMALLINT NOT NULL DEFAULT 1,
  "created_by" TEXT NOT NULL,
  "updated_by" TEXT NOT NULL,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "expense_mutations" (
  "actor_user_id" TEXT,
  "idempotency_key" TEXT,
  "operation" TEXT NOT NULL,
  "resource_id" TEXT NOT NULL,
  "request_hash" TEXT NOT NULL,
  "response_json" TEXT NOT NULL,
  "created_at" TEXT NOT NULL,
  PRIMARY KEY ("actor_user_id", "idempotency_key")
);
CREATE TABLE IF NOT EXISTS "expense_payments" (
  "id" TEXT,
  "expense_id" TEXT NOT NULL,
  "amount_minor" INTEGER NOT NULL,
  "method" TEXT NOT NULL,
  "business_date" TEXT NOT NULL,
  "reversal_of" TEXT,
  "reason" TEXT,
  "cash_movement_id" INTEGER,
  "created_by" TEXT NOT NULL,
  "created_at" TEXT NOT NULL,
  "reference" TEXT,
  PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "expenses" (
  "id" TEXT,
  "category_id" TEXT NOT NULL,
  "category_name" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "payee" TEXT,
  "notes" TEXT,
  "amount_minor" INTEGER NOT NULL,
  "currency_code" TEXT NOT NULL,
  "incurred_on" TEXT NOT NULL,
  "created_by" TEXT NOT NULL,
  "created_at" TEXT NOT NULL,
  "replaces_expense_id" TEXT,
  "voided_at" TEXT,
  "voided_by" TEXT,
  "void_reason" TEXT,
  PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "held_orders" (
  "id" TEXT,
  "table_id" TEXT NOT NULL,
  "items" TEXT NOT NULL,
  "customer_id" TEXT,
  "guest_count" INTEGER DEFAULT 1,
  "order_notes" TEXT,
  "created_at" TEXT DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  "updated_at" TEXT DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  "waived_charge_ids" TEXT NOT NULL DEFAULT '[]',
  "opted_in_charge_ids" TEXT NOT NULL DEFAULT '[]',
  PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "installed_print_templates" (
  "template_id" TEXT,
  "pack_id" TEXT NOT NULL,
  "pack_version_id" TEXT NOT NULL,
  "country" TEXT NOT NULL,
  "jurisdiction" TEXT NOT NULL,
  "display_name" TEXT NOT NULL,
  "paper_widths_json" TEXT NOT NULL,
  "renderer_json" TEXT NOT NULL,
  "template_payload_json" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'installed',
  "created_at" TEXT DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  PRIMARY KEY ("template_id")
);
CREATE TABLE IF NOT EXISTS "inventory_movements" (
  "product_id" TEXT DEFAULT NULL,
  "quantity_delta" DOUBLE PRECISION NOT NULL,
  "movement_type" TEXT NOT NULL,
  "reference_type" TEXT,
  "reference_id" TEXT,
  "reason" TEXT,
  "actor_user_id" TEXT NOT NULL,
  "stock_after" DOUBLE PRECISION NOT NULL,
  "created_at" TEXT NOT NULL DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  "imported_by_user_id" TEXT,
  "import_batch_id" TEXT,
  "source_actor_user_id" TEXT,
  "source_reference_type" TEXT,
  "source_reference_id" TEXT,
  "source_reason" TEXT,
  "source_created_at" TEXT,
  "variant_id" TEXT DEFAULT NULL,
  "addon_id" TEXT DEFAULT NULL
);
CREATE TABLE IF NOT EXISTS "kds_pairing_tokens" (
  "id" TEXT,
  "token" TEXT NOT NULL,
  "station_id" TEXT,
  "expires_at" TEXT NOT NULL,
  "created_at" TEXT DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "kitchen_stations" (
  "id" TEXT,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "category_ids" TEXT,
  "printer_id" TEXT,
  "printer_ip" TEXT,
  "printer_port" INTEGER DEFAULT 9100,
  "printer_name" TEXT,
  "is_active" SMALLINT DEFAULT 1,
  "sort_order" INTEGER DEFAULT 0,
  "created_at" TEXT DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  "updated_at" TEXT DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "local_diagnostics" (
  "event_code" TEXT NOT NULL,
  "severity" TEXT NOT NULL,
  "error_class" TEXT NOT NULL,
  "signature" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "metadata_json" TEXT,
  "occurred_at" TEXT NOT NULL,
  "created_at" TEXT NOT NULL DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
);
CREATE TABLE IF NOT EXISTS "loyalty_ledger" (
  "customer_id" TEXT NOT NULL,
  "bill_id" INTEGER,
  "type" TEXT NOT NULL,
  "amount" NUMERIC(12,2) NOT NULL,
  "description" TEXT,
  "expires_at" TEXT,
  "created_at" TEXT DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  "updated_at" TEXT DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
);
CREATE TABLE IF NOT EXISTS "merchant_print_templates" (
  "id" TEXT,
  "business_id" TEXT NOT NULL DEFAULT 'local',
  "name" TEXT NOT NULL,
  "origin" TEXT NOT NULL DEFAULT 'created',
  "derived_from" TEXT,
  "document_type" TEXT NOT NULL DEFAULT 'receipt',
  "schema_version" INTEGER NOT NULL DEFAULT 1,
  "payload_json" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "previous_payload_json" TEXT,
  "checksum" TEXT NOT NULL DEFAULT '',
  "created_by" TEXT,
  "updated_by" TEXT,
  "created_at" TEXT NOT NULL DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  "updated_at" TEXT NOT NULL DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "order_audit_log" (
  "order_id" INTEGER NOT NULL,
  "order_item_id" INTEGER,
  "actor_user_id" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "details_json" TEXT,
  "created_at" TEXT NOT NULL DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
);
CREATE TABLE IF NOT EXISTS "order_idempotency" (
  "user_id" TEXT,
  "idempotency_key" TEXT,
  "request_hash" TEXT NOT NULL,
  "response_json" TEXT NOT NULL,
  "created_at" TEXT NOT NULL,
  PRIMARY KEY ("user_id", "idempotency_key")
);
CREATE TABLE IF NOT EXISTS "order_inventory_consumptions" (
  "id" TEXT,
  "order_id" INTEGER NOT NULL,
  "order_item_id" INTEGER,
  "packaging_allocation_id" INTEGER,
  "completion_reference" TEXT NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "consumption_kind" TEXT NOT NULL,
  "inventory_movement_id" INTEGER,
  "supply_movement_id" INTEGER,
  "created_at" TEXT NOT NULL DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "order_item_addons" (
  "order_item_id" INTEGER NOT NULL,
  "addon_id" TEXT,
  "addon_name" TEXT NOT NULL,
  "price" NUMERIC(12,2) NOT NULL DEFAULT 0,
  "quantity" INTEGER NOT NULL DEFAULT 1,
  "created_at" TEXT NOT NULL,
  "inventory_deducted_quantity" DOUBLE PRECISION NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS "order_item_packaging_allocations" (
  "serving_allocation_id" INTEGER NOT NULL,
  "packaging_profile_id" TEXT NOT NULL,
  "supply_id_snapshot" TEXT NOT NULL,
  "packaging_name_snapshot" TEXT NOT NULL,
  "packaging_type_snapshot" TEXT NOT NULL,
  "unit_snapshot" TEXT NOT NULL DEFAULT 'each',
  "quantity" DOUBLE PRECISION NOT NULL,
  "unit_cost_snapshot" DOUBLE PRECISION,
  "total_cost_snapshot" DOUBLE PRECISION,
  "cost_known" INTEGER NOT NULL DEFAULT 0,
  "customer_charge_per_unit_snapshot" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "customer_charge_total_snapshot" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "allocation_source" TEXT NOT NULL,
  "confirmed_by_user_id" TEXT,
  "confirmed_at" TEXT,
  "notes" TEXT,
  "created_at" TEXT NOT NULL DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  "updated_at" TEXT NOT NULL DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
);
CREATE TABLE IF NOT EXISTS "order_item_serving_allocations" (
  "order_item_id" INTEGER NOT NULL,
  "serving_type" TEXT NOT NULL,
  "quantity" DOUBLE PRECISION NOT NULL,
  "created_at" TEXT NOT NULL DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  "updated_at" TEXT NOT NULL DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
);
CREATE TABLE IF NOT EXISTS "order_items" (
  "order_id" INTEGER NOT NULL,
  "product_id" TEXT NOT NULL,
  "product_name" TEXT NOT NULL,
  "product_sku" TEXT,
  "unit_price" DOUBLE PRECISION NOT NULL,
  "quantity" INTEGER NOT NULL DEFAULT 1,
  "inventory_deducted_quantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "inventory_product_id" TEXT DEFAULT NULL,
  "subtotal" NUMERIC(12,2) NOT NULL,
  "tax_amount" NUMERIC(12,2) DEFAULT 0,
  "tax_breakdown" TEXT,
  "tax_snapshot" TEXT DEFAULT NULL,
  "tax_type" TEXT,
  "discount_amount" NUMERIC(12,2) DEFAULT 0,
  "total" NUMERIC(12,2) NOT NULL,
  "variant_selection" TEXT,
  "modifier_selection" TEXT,
  "special_instructions" TEXT,
  "status" TEXT DEFAULT 'pending',
  "created_at" TEXT DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  "updated_at" TEXT DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  "voided_at" TEXT DEFAULT NULL,
  "recipe_snapshot" TEXT DEFAULT NULL,
  "variant_id" TEXT DEFAULT NULL,
  "inventory_variant_id" TEXT DEFAULT NULL,
  "price_overridden" INTEGER NOT NULL DEFAULT 0,
  "original_unit_price" DOUBLE PRECISION,
  "price_override_reason" TEXT,
  "price_overridden_by" TEXT,
  "price_overridden_at" TEXT,
  "ingredient_cost" DOUBLE PRECISION DEFAULT NULL,
  "ingredient_cost_known" INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS "orders" (
  "order_number" TEXT NOT NULL,
  "table_id" TEXT,
  "customer_id" TEXT,
  "user_id" TEXT,
  "type" TEXT DEFAULT 'takeaway',
  "delivery_address" TEXT DEFAULT NULL,
  "expected_payment_method" TEXT DEFAULT NULL,
  "delivery_note" TEXT DEFAULT NULL,
  "guest_count" INTEGER,
  "special_instructions" TEXT,
  "packaging_charge" NUMERIC(12,2) DEFAULT 0,
  "delivery_charge" NUMERIC(12,2) DEFAULT 0,
  "service_charge" NUMERIC(12,2) DEFAULT 0,
  "charges_breakdown" TEXT,
  "status" TEXT DEFAULT 'pending',
  "subtotal" NUMERIC(12,2) DEFAULT 0,
  "tax_amount" NUMERIC(12,2) DEFAULT 0,
  "tax_breakdown" TEXT,
  "tax_snapshot" TEXT DEFAULT NULL,
  "packaging_tax_category_id" TEXT DEFAULT NULL,
  "delivery_tax_category_id" TEXT DEFAULT NULL,
  "service_charge_tax_category_id" TEXT DEFAULT NULL,
  "discount_amount" NUMERIC(12,2) DEFAULT 0,
  "discount_type" TEXT,
  "discount_value" DOUBLE PRECISION,
  "discount_reason" TEXT,
  "round_off" NUMERIC(12,2) DEFAULT 0,
  "total" NUMERIC(12,2) DEFAULT 0,
  "cooking_started_at" TEXT,
  "ready_at" TEXT,
  "served_at" TEXT,
  "completed_at" TEXT,
  "cancelled_at" TEXT,
  "cancellation_reason" TEXT,
  "created_at" TEXT DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  "updated_at" TEXT DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  "online_platform" TEXT DEFAULT NULL,
  "external_order_id" TEXT DEFAULT NULL,
  "expected_payment_method_id" INTEGER DEFAULT NULL,
  "scheduled_for" TEXT DEFAULT NULL,
  "release_status" TEXT NOT NULL DEFAULT 'released',
  "released_at" TEXT DEFAULT NULL,
  "release_blocked_reason" TEXT DEFAULT NULL,
  "checkout_stage" TEXT NOT NULL DEFAULT 'paid',
  "dispatch_policy" TEXT NOT NULL DEFAULT 'immediate',
  "inventory_lifecycle" TEXT NOT NULL DEFAULT 'legacy',
  "promotion_id" TEXT DEFAULT NULL
);
CREATE TABLE IF NOT EXISTS "orders_search_fts" (
  "order_number" TEXT
);
CREATE TABLE IF NOT EXISTS "orders_search_fts_config" (
  "k" TEXT,
  "v" TEXT,
  PRIMARY KEY ("k")
);
CREATE TABLE IF NOT EXISTS "orders_search_fts_data" (
  "block" BYTEA
);
CREATE TABLE IF NOT EXISTS "orders_search_fts_docsize" (
  "sz" BYTEA
);
CREATE TABLE IF NOT EXISTS "orders_search_fts_idx" (
  "segid" TEXT,
  "term" TEXT,
  "pgno" TEXT,
  PRIMARY KEY ("segid", "term")
);
CREATE TABLE IF NOT EXISTS "packaging_profile_materials" (
  "profile_id" TEXT NOT NULL,
  "material_id" TEXT NOT NULL,
  "quantity" DOUBLE PRECISION NOT NULL,
  "created_at" TEXT NOT NULL DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  "updated_at" TEXT NOT NULL DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
);
CREATE TABLE IF NOT EXISTS "packaging_profiles" (
  "id" TEXT,
  "name" TEXT NOT NULL,
  "serving_type" TEXT NOT NULL,
  "packaging_type" TEXT NOT NULL,
  "supply_id" TEXT NOT NULL,
  "units_per_serving" DOUBLE PRECISION NOT NULL DEFAULT 1,
  "customer_charge_per_unit" NUMERIC(12,2) NOT NULL DEFAULT 0,
  "is_active" SMALLINT NOT NULL DEFAULT 1,
  "is_default" SMALLINT NOT NULL DEFAULT 0,
  "created_by_user_id" TEXT,
  "updated_by_user_id" TEXT,
  "created_at" TEXT NOT NULL DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  "updated_at" TEXT NOT NULL DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  "description" TEXT DEFAULT NULL,
  "notes" TEXT DEFAULT NULL,
  PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "payment_idempotency" (
  "user_id" TEXT,
  "idempotency_key" TEXT,
  "bill_id" TEXT NOT NULL,
  "request_hash" TEXT NOT NULL,
  "response_json" TEXT NOT NULL,
  "created_at" TEXT NOT NULL,
  PRIMARY KEY ("user_id", "idempotency_key")
);
CREATE TABLE IF NOT EXISTS "payment_method_merges" (
  "source_name" TEXT NOT NULL,
  "target_name" TEXT NOT NULL,
  "affected_payments" INTEGER NOT NULL DEFAULT 0,
  "merged_at" TEXT NOT NULL DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
);
CREATE TABLE IF NOT EXISTS "payment_methods" (
  "name" TEXT NOT NULL,
  "is_active" SMALLINT NOT NULL DEFAULT 1,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TEXT NOT NULL DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  "updated_at" TEXT NOT NULL DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
);
CREATE TABLE IF NOT EXISTS "payment_transaction_ref_conflicts" (
  "method" TEXT NOT NULL,
  "transaction_id" TEXT NOT NULL,
  "bill_id" TEXT NOT NULL,
  "created_at" TEXT NOT NULL,
  "detected_at" TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS "payment_transaction_refs" (
  "method" TEXT,
  "transaction_id" TEXT,
  "bill_id" TEXT NOT NULL,
  "created_at" TEXT NOT NULL,
  PRIMARY KEY ("method", "transaction_id")
);
CREATE TABLE IF NOT EXISTS "print_logs" (
  "bill_id" INTEGER NOT NULL,
  "user_id" TEXT NOT NULL,
  "printed_at" TEXT DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  "print_type" TEXT DEFAULT 'receipt'
);
CREATE TABLE IF NOT EXISTS "printers" (
  "id" TEXT,
  "name" TEXT NOT NULL,
  "connection_type" TEXT NOT NULL,
  "ip_address" TEXT,
  "port" INTEGER DEFAULT 9100,
  "is_default" SMALLINT DEFAULT 0,
  "cash_drawer_pulse_enabled" SMALLINT NOT NULL DEFAULT 0,
  "paper_width" TEXT DEFAULT '80mm',
  "text_size" TEXT NOT NULL DEFAULT 'normal',
  "created_at" TEXT DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  "updated_at" TEXT DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "product_variants" (
  "id" TEXT,
  "product_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "sku" TEXT,
  "barcode" TEXT,
  "price" NUMERIC(12,2) NOT NULL,
  "online_price" DOUBLE PRECISION DEFAULT NULL,
  "cost_price" DOUBLE PRECISION DEFAULT NULL,
  "track_inventory" SMALLINT DEFAULT 0,
  "stock_quantity" DOUBLE PRECISION DEFAULT 0,
  "low_stock_threshold" DOUBLE PRECISION DEFAULT NULL,
  "inventory_product_id" TEXT DEFAULT NULL,
  "inventory_deduction_quantity" DOUBLE PRECISION DEFAULT 1,
  "is_active" SMALLINT DEFAULT 1,
  "sort_order" INTEGER DEFAULT 0,
  "created_at" TEXT DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  "updated_at" TEXT DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  "recipe_multiplier" DOUBLE PRECISION NOT NULL DEFAULT 1,
  "packaging_profile_id" TEXT DEFAULT NULL,
  "no_packaging" SMALLINT NOT NULL DEFAULT 0,
  PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "products" (
  "id" TEXT,
  "category_id" TEXT,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "price" NUMERIC(12,2) NOT NULL DEFAULT 0,
  "cost" NUMERIC(12,2) DEFAULT 0,
  "sku" TEXT,
  "barcode" TEXT,
  "sale_unit" TEXT NOT NULL DEFAULT 'each',
  "allow_fractional_quantity" SMALLINT NOT NULL DEFAULT 0,
  "weight_precision" INTEGER NOT NULL DEFAULT 3,
  "image_url" TEXT,
  "is_active" SMALLINT DEFAULT 1,
  "sort_order" INTEGER DEFAULT 0,
  "track_inventory" SMALLINT DEFAULT 0,
  "stock_quantity" DOUBLE PRECISION DEFAULT 0,
  "low_stock_threshold" DOUBLE PRECISION DEFAULT 5,
  "tax_type" TEXT DEFAULT 'none',
  "tax_rate" DOUBLE PRECISION DEFAULT 0,
  "tax_category_id" TEXT DEFAULT NULL,
  "tax_behavior" TEXT DEFAULT 'country_default',
  "cb_percent" DOUBLE PRECISION DEFAULT 0,
  "tags" TEXT,
  "inventory_product_id" TEXT DEFAULT NULL,
  "inventory_deduction_quantity" DOUBLE PRECISION DEFAULT 1,
  "deleted_at" TEXT,
  "created_at" TEXT DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  "updated_at" TEXT DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  "dietary_tags" TEXT DEFAULT NULL,
  "packaging_profile_id" TEXT DEFAULT NULL,
  "no_packaging" SMALLINT NOT NULL DEFAULT 0,
  PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "promotion_products" (
  "promotion_id" TEXT NOT NULL,
  "product_id" TEXT NOT NULL,
  "variant_id" TEXT DEFAULT NULL,
  "created_at" TEXT NOT NULL DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
);
CREATE TABLE IF NOT EXISTS "promotion_redemptions" (
  "promotion_id" TEXT NOT NULL,
  "order_id" INTEGER,
  "bill_id" INTEGER,
  "customer_id" TEXT DEFAULT NULL,
  "cashier_user_id" TEXT DEFAULT NULL,
  "discount_amount" NUMERIC(12,2) NOT NULL DEFAULT 0,
  "is_loyalty_reward" SMALLINT NOT NULL DEFAULT 0,
  "details_json" TEXT DEFAULT NULL,
  "created_at" TEXT NOT NULL DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
);
CREATE TABLE IF NOT EXISTS "promotions" (
  "id" TEXT,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "discount_type" TEXT NOT NULL,
  "target_type" TEXT NOT NULL DEFAULT 'all_pancakes',
  "target_category_id" TEXT DEFAULT NULL,
  "discount_value" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "bogo_buy_qty" INTEGER NOT NULL DEFAULT 1,
  "bogo_get_qty" INTEGER NOT NULL DEFAULT 1,
  "bogo_pricing_rule" TEXT NOT NULL DEFAULT 'cheapest_free',
  "is_loyalty_reward" SMALLINT NOT NULL DEFAULT 0,
  "loyalty_qualifying_visits_required" SMALLINT NOT NULL DEFAULT 5,
  "start_at" TEXT DEFAULT NULL,
  "end_at" TEXT DEFAULT NULL,
  "is_active" SMALLINT NOT NULL DEFAULT 1,
  "is_automatic" SMALLINT NOT NULL DEFAULT 0,
  "max_redemptions" INTEGER DEFAULT NULL,
  "current_redemptions_count" INTEGER NOT NULL DEFAULT 0,
  "created_by" TEXT DEFAULT NULL,
  "updated_by" TEXT DEFAULT NULL,
  "created_at" TEXT NOT NULL DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  "updated_at" TEXT NOT NULL DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "purchase_items" (
  "purchase_id" TEXT NOT NULL,
  "supply_id" TEXT NOT NULL,
  "supply_name_snapshot" TEXT NOT NULL,
  "supply_base_unit_snapshot" TEXT NOT NULL,
  "quantity" DOUBLE PRECISION NOT NULL,
  "purchase_unit" TEXT NOT NULL,
  "pack_size_in_base" DOUBLE PRECISION,
  "quantity_in_base" DOUBLE PRECISION NOT NULL,
  "unit_price" DOUBLE PRECISION NOT NULL,
  "line_total" DOUBLE PRECISION NOT NULL,
  "created_at" TEXT NOT NULL DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
);
CREATE TABLE IF NOT EXISTS "purchases" (
  "id" TEXT,
  "supplier_id" TEXT,
  "purchase_date" TEXT NOT NULL,
  "invoice_number" TEXT,
  "additional_expenses" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "payment_status" TEXT NOT NULL DEFAULT 'unpaid',
  "notes" TEXT,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "items_total" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "grand_total" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "received_at" TEXT,
  "received_by_user_id" TEXT,
  "created_by_user_id" TEXT NOT NULL,
  "created_at" TEXT NOT NULL DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  "updated_at" TEXT NOT NULL DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "recipe_items" (
  "id" TEXT,
  "recipe_id" TEXT NOT NULL,
  "supply_id" TEXT NOT NULL,
  "quantity" DOUBLE PRECISION NOT NULL,
  "unit" TEXT NOT NULL,
  "created_at" TEXT NOT NULL DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "recipes" (
  "id" TEXT,
  "product_id" TEXT NOT NULL,
  "yield_quantity" DOUBLE PRECISION NOT NULL DEFAULT 1,
  "is_active" SMALLINT NOT NULL DEFAULT 1,
  "created_at" TEXT NOT NULL DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  "updated_at" TEXT NOT NULL DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "refund_idempotency" (
  "user_id" TEXT,
  "idempotency_key" TEXT,
  "bill_id" TEXT NOT NULL,
  "request_hash" TEXT NOT NULL,
  "response_json" TEXT NOT NULL,
  "created_at" TEXT NOT NULL,
  PRIMARY KEY ("user_id", "idempotency_key")
);
CREATE TABLE IF NOT EXISTS "refunds" (
  "bill_id" INTEGER NOT NULL,
  "order_item_id" INTEGER,
  "amount_cents" INTEGER NOT NULL,
  "method" TEXT NOT NULL,
  "reason" TEXT,
  "shift_id" TEXT,
  "approved_by" TEXT NOT NULL,
  "created_by" TEXT NOT NULL,
  "created_at" TEXT NOT NULL,
  "cash_session_id" INTEGER,
  "product_disposition" TEXT DEFAULT 'retained_by_customer',
  "plate_disposition" TEXT DEFAULT 'plate_consumed',
  "recovered_ingredient_cost" NUMERIC(12,2) DEFAULT 0.0,
  "recovered_plate_cost" NUMERIC(12,2) DEFAULT 0.0
);
CREATE TABLE IF NOT EXISTS "revoked_tokens" (
  "token_hash" TEXT,
  "expires_at" INTEGER NOT NULL,
  "revoked_at" TEXT NOT NULL,
  PRIMARY KEY ("token_hash")
);
CREATE TABLE IF NOT EXISTS "role_permission_overrides" (
  "role" TEXT,
  "permission_id" TEXT,
  "effect" TEXT NOT NULL,
  "updated_by" TEXT NOT NULL,
  "created_at" TEXT NOT NULL DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  "updated_at" TEXT NOT NULL DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  PRIMARY KEY ("role", "permission_id")
);
CREATE TABLE IF NOT EXISTS "sequences" (
  "name" TEXT,
  "date" TEXT,
  "current_value" INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY ("name", "date")
);
CREATE TABLE IF NOT EXISTS "settings" (
  "key" TEXT,
  "value" TEXT,
  "updated_at" TEXT DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  PRIMARY KEY ("key")
);
CREATE TABLE IF NOT EXISTS "station_users" (
  "user_id" TEXT,
  "station_id" TEXT,
  "created_at" TEXT DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  PRIMARY KEY ("user_id", "station_id")
);
CREATE TABLE IF NOT EXISTS "stock_count_items" (
  "stock_count_id" TEXT NOT NULL,
  "supply_id" TEXT NOT NULL,
  "supply_name_snapshot" TEXT NOT NULL,
  "base_unit_snapshot" TEXT NOT NULL,
  "expected_quantity" DOUBLE PRECISION NOT NULL,
  "actual_quantity" DOUBLE PRECISION,
  "unit_cost_snapshot" DOUBLE PRECISION,
  "variance_quantity" DOUBLE PRECISION,
  "variance_cost" DOUBLE PRECISION,
  "reason" TEXT,
  "supply_movement_id" INTEGER,
  "observed_stock_quantity" DOUBLE PRECISION,
  "observed_at" TEXT
);
CREATE TABLE IF NOT EXISTS "stock_counts" (
  "id" TEXT,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "notes" TEXT,
  "started_by_user_id" TEXT NOT NULL,
  "reviewed_by_user_id" TEXT,
  "posted_by_user_id" TEXT,
  "reviewed_at" TEXT,
  "posted_at" TEXT,
  "created_at" TEXT NOT NULL DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  "updated_at" TEXT NOT NULL DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "stock_wastage_records" (
  "id" TEXT,
  "supply_id" TEXT NOT NULL,
  "quantity" DOUBLE PRECISION NOT NULL,
  "unit" TEXT NOT NULL,
  "wastage_date" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "notes" TEXT,
  "supply_movement_id" INTEGER,
  "recorded_by_user_id" TEXT NOT NULL,
  "created_at" TEXT NOT NULL DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "store_diagnostics_outbox" (
  "event_id" TEXT,
  "payload" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "next_attempt_at" TEXT,
  "last_error" TEXT,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  "delivered_at" TEXT,
  "transport" TEXT NOT NULL DEFAULT 'signed',
  "permanent_failure" INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY ("event_id")
);
CREATE TABLE IF NOT EXISTS "suppliers" (
  "id" TEXT,
  "name" TEXT NOT NULL,
  "contact_name" TEXT,
  "phone" TEXT,
  "email" TEXT,
  "address" TEXT,
  "notes" TEXT,
  "is_active" SMALLINT NOT NULL DEFAULT 1,
  "deleted_at" TEXT,
  "created_at" TEXT NOT NULL DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  "updated_at" TEXT NOT NULL DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "supplies" (
  "id" TEXT,
  "name" TEXT NOT NULL,
  "base_unit" TEXT NOT NULL,
  "stock_quantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "low_stock_threshold" DOUBLE PRECISION,
  "is_active" SMALLINT NOT NULL DEFAULT 1,
  "deleted_at" TEXT,
  "created_at" TEXT NOT NULL DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  "updated_at" TEXT NOT NULL DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  "unit_cost" NUMERIC(12,2) DEFAULT NULL,
  "sku" TEXT DEFAULT NULL,
  "category" TEXT DEFAULT NULL,
  "is_packaging" SMALLINT NOT NULL DEFAULT 0,
  PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "supply_movements" (
  "supply_id" TEXT NOT NULL,
  "quantity_delta" DOUBLE PRECISION NOT NULL,
  "movement_type" TEXT NOT NULL,
  "unit" TEXT NOT NULL,
  "stock_after" DOUBLE PRECISION NOT NULL,
  "reason" TEXT,
  "actor_user_id" TEXT NOT NULL,
  "reference_type" TEXT,
  "reference_id" TEXT,
  "created_at" TEXT NOT NULL DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  "unit_cost" NUMERIC(12,2) DEFAULT NULL,
  "total_cost" DOUBLE PRECISION DEFAULT NULL,
  "unit_cost_after" DOUBLE PRECISION DEFAULT NULL
);
CREATE TABLE IF NOT EXISTS "support_ticket_outbox" (
  "client_ticket_id" TEXT,
  "payload" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "support_code" TEXT,
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "next_attempt_at" TEXT,
  "last_error" TEXT,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  "delivered_at" TEXT,
  PRIMARY KEY ("client_ticket_id")
);
CREATE TABLE IF NOT EXISTS "tables" (
  "id" TEXT,
  "number" TEXT NOT NULL,
  "capacity" INTEGER DEFAULT 4,
  "status" TEXT DEFAULT 'available',
  "floor" TEXT,
  "section" TEXT,
  "position_x" DOUBLE PRECISION,
  "position_y" DOUBLE PRECISION,
  "kitchen_station_id" TEXT,
  "is_active" SMALLINT DEFAULT 1,
  "created_at" TEXT DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  "updated_at" TEXT DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  "reservation_customer_id" TEXT,
  PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "tax_categories" (
  "id" TEXT,
  "pack_version_id" TEXT NOT NULL,
  "category_id" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "default_behavior" TEXT,
  "definition_json" TEXT NOT NULL,
  "created_at" TEXT DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "tax_config_audit" (
  "action" TEXT NOT NULL,
  "pack_id" TEXT,
  "pack_version_id" TEXT,
  "override_id" TEXT,
  "actor_user_id" TEXT,
  "details_json" TEXT,
  "created_at" TEXT DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
);
CREATE TABLE IF NOT EXISTS "tax_overrides" (
  "id" TEXT,
  "pack_version_id" TEXT NOT NULL,
  "entity_type" TEXT NOT NULL,
  "entity_id" TEXT,
  "field_name" TEXT NOT NULL,
  "value_json" TEXT NOT NULL,
  "created_by_user_id" TEXT,
  "created_at" TEXT DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  "updated_at" TEXT DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "tax_rules" (
  "id" TEXT,
  "pack_version_id" TEXT NOT NULL,
  "rule_id" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "calculation_type" TEXT NOT NULL,
  "rate" TEXT,
  "amount" TEXT,
  "applies_per" TEXT,
  "base_rule_ids" TEXT,
  "definition_json" TEXT NOT NULL,
  "created_at" TEXT DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "user_permission_overrides" (
  "user_id" TEXT,
  "permission_id" TEXT,
  "effect" TEXT NOT NULL,
  "updated_by" TEXT NOT NULL,
  "created_at" TEXT NOT NULL DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  "updated_at" TEXT NOT NULL DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  PRIMARY KEY ("user_id", "permission_id")
);
CREATE TABLE IF NOT EXISTS "users" (
  "id" TEXT,
  "name" TEXT NOT NULL,
  "email" TEXT,
  "password" TEXT NOT NULL,
  "role" TEXT NOT NULL DEFAULT 'cashier',
  "pin" TEXT,
  "pin_hash" TEXT,
  "category_ids" TEXT,
  "is_active" SMALLINT DEFAULT 1,
  "terms_accepted_at" TEXT,
  "tokens_valid_after" TEXT DEFAULT NULL,
  "station_assignments_configured" INTEGER NOT NULL DEFAULT 0,
  "created_at" TEXT DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  "updated_at" TEXT DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "whatsapp_blocklist" (
  "phone_e164" TEXT,
  "reason" TEXT,
  "blocked_at" TEXT DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  "blocked_by_user_id" TEXT,
  PRIMARY KEY ("phone_e164")
);
CREATE TABLE IF NOT EXISTS "whatsapp_message_attempts" (
  "message_id" INTEGER NOT NULL,
  "external_message_id" TEXT NOT NULL,
  "created_at" TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS "whatsapp_messages" (
  "bill_id" INTEGER,
  "customer_id" TEXT,
  "phone_e164" TEXT NOT NULL,
  "direction" TEXT NOT NULL,
  "kind" TEXT NOT NULL DEFAULT 'manual_reply',
  "status" TEXT NOT NULL DEFAULT 'queued',
  "body" TEXT NOT NULL,
  "external_message_id" TEXT,
  "error" TEXT,
  "queued_at" TEXT DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  "seen_at" TEXT,
  "typing_at" TEXT,
  "sent_at" TEXT,
  "delivered_at" TEXT,
  "read_at" TEXT,
  "failed_at" TEXT,
  "created_by_user_id" TEXT,
  "cash_closure_id" INTEGER
);
