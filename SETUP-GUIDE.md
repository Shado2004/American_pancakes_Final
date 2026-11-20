# American Pancakes POS — Portable Installation & Operation Guide

**Application:** American Pancakes POS (Stage 4 / Stage 7 Authoritative Release)  
**Target Environment:** Windows 10 / Windows 11  
**Recommended Runtime:** Node.js 22 LTS (Node >= 22.12.0)  
**Primary Database:** Local SQLite (`flo.db`)  
**Package Type:** Complete Source Code (Desktop Electron + Web Next.js + Express API)

---

## 1. Overview & Business Use

This package is a clean, portable distribution of the American Pancakes POS application. It contains the complete source code, backend services, frontend user interface, test suites, and the active SQLite database with all configured pancake recipes, supplies, products, and historical data.

This package serves two purposes:
1. **Immediate Personal Business Operation:** Run the full POS on another Windows laptop with offline-first local SQLite reliability.
2. **Future Cloud / Web Migration Readiness:** Retains clean architectural separation between Next.js frontend, Express API routes, services, and database schema for seamless future migration to GitHub + Supabase PostgreSQL.

---

## 2. Prerequisites & System Requirements

Before running the application on the new laptop:

1. **Operating System:** Windows 10 or Windows 11 (64-bit).
2. **Node.js:** Version **22 LTS** (specifically **Node >= 22.12.0**, verified on Node 22.23.4 LTS).
   - Download the official Windows installer (.msi) from: [https://nodejs.org](https://nodejs.org)
   - Verify installation in Command Prompt or PowerShell:
     ```cmd
     node -v
     npm -v
     ```
3. **Build Tools (optional / recommended):** Standard Node.js build tools (included with standard Node.js installation).

---

## 3. Quick Start (One-Click Setup on Windows)

### Step 1 — Extract the Package
Extract the portable ZIP archive to any directory on your laptop (for example, `C:\AmericanPancakesPOS` or your Desktop).

### Step 2 — Run Automated Setup
Double-click **`setup.bat`** (or open Command Prompt in the project folder and run `setup.bat`).

The script will automatically:
1. Verify your Node.js version.
2. Install root dependencies (Electron, Express, `better-sqlite3`, etc.).
3. Install frontend dependencies (Next.js 16, React 19, Tailwind, Lucide, etc.).
4. Compile the Next.js frontend production bundle (`npm run build:frontend`).
5. Compile the backend TypeScript code into `dist/` (`npm run build`).

### Step 3 — Launch the POS Application
Double-click **`run.bat`**.

The desktop POS window will open, connected to the local offline SQLite database.

---

## 4. Manual Installation & CLI Commands

If you prefer using the terminal or PowerShell instead of the `.bat` files:

```bash
# 1. Install root dependencies (compiles native SQLite bindings for your machine)
npm install

# 2. Install frontend dependencies
cd frontend
npm install
cd ..

# 3. Build frontend bundle and backend TypeScript
npm run build:frontend
npm run build

# 4. Start the POS application
npm start
# OR (clean ports and run dev mode)
npm run dev
```

### Running in Web-Only Mode (Browser Mode)
If you wish to access the POS via a standard web browser without Electron:
1. Double-click **`run-web.bat`** (or run `npm run dev:frontend`).
2. Open your browser and navigate to: `http://localhost:3000`

---

## 5. Database Handling & Safety (`flo.db`)

### How the Database Works
- The application uses SQLite via the high-performance `better-sqlite3` driver.
- In desktop operation, the database file is located directly in the project root: **`flo.db`**.
- This package includes the active `flo.db` pre-populated with:
  - 5 American Pancake products + Parcel Box retail product
  - Authoritative recipes and ingredient quantities (flour batter, fillings, toppings, Paper Plate)
  - Raw supplies and purchase costs (Batter ₹0.15/g, Paper Plate ₹2.50, Parcel Box ₹3.50, etc.)
  - Regional settings (INR currency ₹, Asia/Kolkata timezone, India localization)
  - Prior order records, bills, and sales transactions

### How to Back Up the Database
To create a backup at any time:
1. Close the POS application.
2. Make a copy of **`flo.db`** (e.g. name it `flo_backup_2026_11_20.db`).
3. Store the copy in a secure folder or external drive.

### How to Start Fresh Without Losing Existing Data
If you ever want to test with a completely clean database:
1. Rename `flo.db` to `flo.db.saved`.
2. Start the application (`run.bat` or `npm start`).
3. The application will detect the missing database and automatically create a fresh `flo.db`, run migrations v0 through v134, and initialize default categories and settings.
4. To return to your saved data later: delete the newly created `flo.db` and rename `flo.db.saved` back to `flo.db`.

---

## 6. Authoritative POS Business Logic Verified

This package preserves the following business logic:

1. **BOGO Promotion Default OFF:**
   - Every fresh cart opens as a **Normal Sale** with full pricing.
   - BOGO never activates automatically; cashier must explicitly click the BOGO button.
   - Clearing or cancelling an order reverts BOGO to OFF for subsequent sales.
2. **Explicit Parcel Box Packaging Allocation & Paper Plate Accounting:**
   - Parcel Box is an independent retail product (selling price ₹5.00, purchase cost ₹3.50).
   - Cashier explicitly specifies how many boxes are used for packaging ($N$).
   - Remaining boxes ($B - N$) are standalone retail sales.
   - Paper Plates consumed = total pancakes − packaging boxes ($P - N$).
   - Standalone boxes never reduce Paper Plate consumption.
   - Inventory deductions (`supply_movements`) and order ledger records match the exact allocation.
   - Free BOGO pancakes consume ingredients and applicable Paper Plates.
3. **Cash & UPI Payment Handling:**
   - Physical cash drawer strictly reconciles physical cash; digital UPI collections are isolated.
4. **Dashboard & Export Parity:**
   - The Roadside Dashboard, Product-Wise reports, Normal vs. BOGO reports, and CSV/XLSX exports use the exact same calculation formulas as the POS.

---

## 7. Future Web & Cloud Migration Architecture

When you are ready to migrate this POS to a cloud/web application (GitHub + Supabase PostgreSQL):

- **Frontend (`frontend/`):** Built with Next.js App Router, React 19, and Tailwind CSS. Can be deployed directly to Vercel, Netlify, or any Node.js hosting platform.
- **Backend API (`main/routes/`):** Structured as modular Express.js routes (`orders.ts`, `bills.ts`, `products.ts`, `reports.ts`, `promotions.ts`).
- **Services (`main/services/`):** Pure TypeScript business logic (`roadside-reporting.ts`, `daily-sales-export.ts`, `promotions.ts`, `checkout-inventory.ts`).
- **Database Schema (`main/db.ts`):** All 134 SQLite migrations are well-documented and provide a 1:1 roadmap for drafting Supabase PostgreSQL tables and Row-Level Security (RLS) policies.

---

## 8. Troubleshooting

- **`node-gyp` or native module error on `npm install`:**
  - Ensure you are using Node.js 22 LTS (e.g. `22.12.0` or higher).
  - Run `npm install` from an administrator Command Prompt if Windows permissions restrict building native binaries.
- **Port already in use error (3001, 3002, 3003):**
  - Run `run.bat` or run `node kill-ports.js 3001 3002 3003`.
- **Database locked error:**
  - Ensure no other instances of FloCafe or SQLite browser are holding a lock on `flo.db`.
