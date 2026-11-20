# Supabase Setup & Provisioning Guide

This guide describes how to configure Supabase PostgreSQL for the American Pancakes POS.

---

## 1. Project Creation
1. Go to [supabase.com](https://supabase.com) and create a new project.
2. **Name:** `american-pancakes-pos`
3. **Region:** `ap-south-1` (Mumbai) — matches Asia/Kolkata timezone.
4. **Database Password:** Store this securely.

---

## 2. Bootstrap Database Role & Security
1. Open the **SQL Editor** in the Supabase Dashboard.
2. Open `scripts/supabase-bootstrap.sql` from this repository.
3. Paste the contents into the SQL Editor and click **Run**.
   * Creates the `pos_app` role.
   * Locks down the `public` schema from direct PostgREST `anon` and `authenticated` access.
   * Enables Row-Level Security (RLS) across application tables.

---

## 3. Apply Consolidated PostgreSQL Schema
1. Open `main/db/migrations/postgres/schema.sql`.
2. Paste the contents into the Supabase **SQL Editor** and click **Run**.
3. All 97 tables, sequences, and indexes are now established.

---

## 4. Migrate Data from Local SQLite (`flo.db`)
From your local terminal, run the one-command migration:

```bash
DATABASE_URL="postgresql://postgres.[REF]:[PASSWORD]@aws-0-ap-south-1.pooler.supabase.com:5432/postgres" npm run migrate:to-pg
```

The script will:
1. Read existing historical orders, inventory, products, and configurations from `flo.db`.
2. Insert them in foreign-key safe order.
3. Reset all identity sequences.
4. Print a full table-by-table reconciliation report verifying row counts and checksums.
