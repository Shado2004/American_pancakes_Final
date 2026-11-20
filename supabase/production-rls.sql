-- ==============================================================================
-- American Pancakes POS — Supabase Production RLS & Client Access Script
-- Run this in your Supabase Project SQL Editor to enable secure client access
-- for your custom domain: https://americanpancakesshops.tech
-- ==============================================================================

-- 1. Grant schema usage to anon and authenticated roles
GRANT USAGE ON SCHEMA public TO anon, authenticated;

-- 2. Grant table and sequence permissions for catalog & client operations
GRANT SELECT ON categories TO anon, authenticated;
GRANT SELECT ON products TO anon, authenticated;
GRANT SELECT ON addon_groups TO anon, authenticated;
GRANT SELECT ON addons TO anon, authenticated;
GRANT SELECT ON product_variants TO anon, authenticated;
GRANT SELECT ON settings TO anon, authenticated;

GRANT SELECT, INSERT ON orders TO anon, authenticated;
GRANT SELECT, INSERT ON order_items TO anon, authenticated;
GRANT SELECT, INSERT ON bills TO anon, authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;

-- 3. Enable Row Level Security (RLS) on client-facing tables
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE addon_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE addons ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE bills ENABLE ROW LEVEL SECURITY;

-- 4. Create RLS Policies for Catalog (Public Read)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow public read categories') THEN
    CREATE POLICY "Allow public read categories" ON categories FOR SELECT USING (true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow public read products') THEN
    CREATE POLICY "Allow public read products" ON products FOR SELECT USING (true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow public read addon_groups') THEN
    CREATE POLICY "Allow public read addon_groups" ON addon_groups FOR SELECT USING (true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow public read addons') THEN
    CREATE POLICY "Allow public read addons" ON addons FOR SELECT USING (true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow public read product_variants') THEN
    CREATE POLICY "Allow public read product_variants" ON product_variants FOR SELECT USING (true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow public read settings') THEN
    CREATE POLICY "Allow public read settings" ON settings FOR SELECT USING (true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow client insert orders') THEN
    CREATE POLICY "Allow client insert orders" ON orders FOR INSERT WITH CHECK (true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow client read orders') THEN
    CREATE POLICY "Allow client read orders" ON orders FOR SELECT USING (true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow client insert order_items') THEN
    CREATE POLICY "Allow client insert order_items" ON order_items FOR INSERT WITH CHECK (true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow client read order_items') THEN
    CREATE POLICY "Allow client read order_items" ON order_items FOR SELECT USING (true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow client insert bills') THEN
    CREATE POLICY "Allow client insert bills" ON bills FOR INSERT WITH CHECK (true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow client read bills') THEN
    CREATE POLICY "Allow client read bills" ON bills FOR SELECT USING (true);
  END IF;
END $$;
