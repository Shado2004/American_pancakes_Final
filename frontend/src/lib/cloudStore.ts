import type { AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { getSupabaseClient } from './supabase';
import type { Category, Product, Table, Customer, Order, Bill } from './types';

function makeBill(orderId: number, orderNumber: string, total: number, createdAt: string): Bill {
  return {
    id: orderId,
    bill_number: `B-${orderNumber}`,
    order_id: orderId,
    customer_id: null,
    subtotal: total,
    tax_amount: 0,
    discount_amount: 0,
    service_charge: 0,
    delivery_charge: 0,
    total,
    paid_amount: total,
    balance: 0,
    payment_status: 'paid',
    payment_details: [
      {
        method: 'cash',
        amount: total,
        timestamp: createdAt,
      },
    ],
  };
}

export function isStaticCloudHost(): boolean {
  if (typeof window === 'undefined') return false;
  const host = window.location.hostname;
  return host !== 'localhost' && host !== '127.0.0.1' && host !== '0.0.0.0';
}

export const DEFAULT_CATEGORIES: Category[] = [
  {
    id: 'ntui6l',
    name: 'Pancakes og',
    slug: 'pancakes-og',
    description: 'Freshly prepared mini pancakes with different fillings and toppings.',
    parent_id: null,
    sort_order: 0,
    is_active: true,
    color: 'pink',
    icon: null,
    products: [],
  },
];

export const DEFAULT_PRODUCTS: Product[] = [
  {
    id: 'p1',
    category_id: 'ntui6l',
    name: 'Dark Chocolate Pancake',
    sku: 'DCP-01',
    barcode: null,
    sale_unit: 'each',
    allow_fractional_quantity: false,
    weight_precision: 0,
    description: 'Rich dark chocolate mini pancakes (8 pcs / plate)',
    price: 70,
    cost: 30,
    tax_type: 'none',
    tax_rate: 0,
    track_inventory: false,
    stock_quantity: 100,
    low_stock_threshold: 10,
    is_active: true,
    available_online: true,
    has_image: false,
    updated_at: new Date().toISOString(),
    tags: ['pancake', 'chocolate', 'dessert'],
    sort_order: 1,
    modifiers: null,
  },
  {
    id: 'p2',
    category_id: 'ntui6l',
    name: 'White Chocolate Pancake',
    sku: 'WCP-01',
    barcode: null,
    sale_unit: 'each',
    allow_fractional_quantity: false,
    weight_precision: 0,
    description: 'Creamy white chocolate mini pancakes (8 pcs / plate)',
    price: 80,
    cost: 35,
    tax_type: 'none',
    tax_rate: 0,
    track_inventory: false,
    stock_quantity: 100,
    low_stock_threshold: 10,
    is_active: true,
    available_online: true,
    has_image: false,
    updated_at: new Date().toISOString(),
    tags: ['pancake', 'white-chocolate', 'dessert'],
    sort_order: 2,
    modifiers: null,
  },
  {
    id: 'p3',
    category_id: 'ntui6l',
    name: 'Milk Chocolate Pancake',
    sku: 'MCP-01',
    barcode: null,
    sale_unit: 'each',
    allow_fractional_quantity: false,
    weight_precision: 0,
    description: 'Classic milk chocolate mini pancakes (8 pcs / plate)',
    price: 80,
    cost: 35,
    tax_type: 'none',
    tax_rate: 0,
    track_inventory: false,
    stock_quantity: 100,
    low_stock_threshold: 10,
    is_active: true,
    available_online: true,
    has_image: false,
    updated_at: new Date().toISOString(),
    tags: ['pancake', 'milk-chocolate', 'dessert'],
    sort_order: 3,
    modifiers: null,
  },
  {
    id: 'p4',
    category_id: 'ntui6l',
    name: 'Cotton Candy Pancake',
    sku: 'CCP-01',
    barcode: null,
    sale_unit: 'each',
    allow_fractional_quantity: false,
    weight_precision: 0,
    description: 'Sweet cotton candy flavoured mini pancakes (8 pcs / plate)',
    price: 90,
    cost: 40,
    tax_type: 'none',
    tax_rate: 0,
    track_inventory: false,
    stock_quantity: 100,
    low_stock_threshold: 10,
    is_active: true,
    available_online: true,
    has_image: false,
    updated_at: new Date().toISOString(),
    tags: ['pancake', 'cotton-candy', 'dessert'],
    sort_order: 4,
    modifiers: null,
  },
  {
    id: 'p5',
    category_id: 'ntui6l',
    name: 'Oreo Pancake',
    sku: 'OP-01',
    barcode: null,
    sale_unit: 'each',
    allow_fractional_quantity: false,
    weight_precision: 0,
    description: 'Crunchy crushed Oreo mini pancakes (8 pcs / plate)',
    price: 90,
    cost: 40,
    tax_type: 'none',
    tax_rate: 0,
    track_inventory: false,
    stock_quantity: 100,
    low_stock_threshold: 10,
    is_active: true,
    available_online: true,
    has_image: false,
    updated_at: new Date().toISOString(),
    tags: ['pancake', 'oreo', 'dessert'],
    sort_order: 5,
    modifiers: null,
  },
  {
    id: 'p6',
    category_id: 'ntui6l',
    name: 'Parcel Box',
    sku: 'PB-01',
    barcode: null,
    sale_unit: 'each',
    allow_fractional_quantity: false,
    weight_precision: 0,
    description: 'Takeaway food grade parcel container box',
    price: 5,
    cost: 2.5,
    tax_type: 'none',
    tax_rate: 0,
    track_inventory: false,
    stock_quantity: 500,
    low_stock_threshold: 50,
    is_active: true,
    available_online: true,
    has_image: false,
    updated_at: new Date().toISOString(),
    tags: ['packaging'],
    sort_order: 6,
    modifiers: null,
  },
];

export const DEFAULT_TABLES: Table[] = [
  { id: '1', name: 'Table 1', capacity: 2, status: 'available', kitchen_station_id: null, floor: 'Main Floor', section: 'Dining', position_x: null, position_y: null, is_active: true },
  { id: '2', name: 'Table 2', capacity: 4, status: 'available', kitchen_station_id: null, floor: 'Main Floor', section: 'Dining', position_x: null, position_y: null, is_active: true },
  { id: '3', name: 'Table 3', capacity: 4, status: 'available', kitchen_station_id: null, floor: 'Main Floor', section: 'Dining', position_x: null, position_y: null, is_active: true },
  { id: '4', name: 'Table 4', capacity: 6, status: 'available', kitchen_station_id: null, floor: 'Main Floor', section: 'Dining', position_x: null, position_y: null, is_active: true },
  { id: 'takeaway', name: 'Takeaway Counter', capacity: 1, status: 'available', kitchen_station_id: null, floor: 'Counter', section: 'QSR', position_x: null, position_y: null, is_active: true },
];

export const DEFAULT_BUSINESS = {
  business_name: 'The American Pancakes',
  business_type: 'restaurant',
  service_model: 'qsr',
  currency: 'INR',
  currency_symbol: '₹',
  timezone: 'Asia/Kolkata',
  country: 'IN',
  tables_required: false,
  is_setup_completed: true,
  instagram_handle: 'theamericanpancakes',
  email: 'admin@americanpancakes.com',
};

export const DEFAULT_STAFF = [
  {
    id: 1,
    name: 'Sandeep G',
    email: 'admin@americanpancakes.com',
    role: 'owner',
    is_active: true,
    created_at: '2026-11-20 00:00:00',
  },
];

function getStored<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = localStorage.getItem(`flo_cloud_${key}`);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function setStored<T>(key: string, value: T): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(`flo_cloud_${key}`, JSON.stringify(value));
  } catch {
    // quota exceeded or private mode
  }
}

function mockResponse(data: unknown, config: InternalAxiosRequestConfig, status = 200): AxiosResponse {
  return {
    data,
    status,
    statusText: status === 200 ? 'OK' : 'Created',
    headers: { 'content-type': 'application/json' },
    config,
  };
}

function getStableOrderId(orderNumber: string, idx = 0): number {
  let hash = 0;
  for (let i = 0; i < orderNumber.length; i++) {
    hash = (hash << 5) - hash + orderNumber.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash) + idx + 1;
}

function getPathname(rawUrl: string): string {
  let p = rawUrl.replace(/^https?:\/\/[^/]+/, '').split('?')[0];
  if (p.startsWith('/api/')) p = p.slice(4);
  else if (p === '/api') p = '/';
  else if (p.startsWith('api/')) p = '/' + p.slice(4);
  if (!p.startsWith('/')) p = '/' + p;
  return p;
}

export async function handleCloudFallback(
  config: InternalAxiosRequestConfig
): Promise<AxiosResponse | null> {
  const method = (config.method || 'get').toLowerCase();
  const rawUrl = config.url || '';
  const pathname = getPathname(rawUrl);

  const supabase = getSupabaseClient();

  // CASH SESSIONS
  if (pathname.startsWith('/cash-sessions')) {
    return mockResponse(null, config);
  }

  // AUTH & SETUP STATUS
  if (pathname.startsWith('/auth/setup')) {
    if (pathname.includes('/status')) {
      return mockResponse({ needsSetup: false, masterPinAvailable: true }, config);
    }
    if (pathname.includes('/initialize')) {
      return mockResponse({ success: true, message: 'Setup completed successfully' }, config);
    }
  }

  // 1. ORDERS
  if (pathname === '/orders' || pathname.startsWith('/orders/')) {
    if (method === 'get') {
      const localOrders = getStored<Order[]>('orders', []);
      let cloudOrders: Order[] = [];
      if (supabase) {
        try {
          const fetchPromise = supabase
            .from('orders')
            .select('*')
            .order('created_at', { ascending: false });
          const timeoutPromise = new Promise<{ data: null }>((resolve) =>
            setTimeout(() => resolve({ data: null }), 1500)
          );
          const { data } = (await Promise.race([fetchPromise, timeoutPromise])) as any;
          if (data && Array.isArray(data)) {
            cloudOrders = data.map((row, idx) => {
              const orderNum = row.order_number || `AP-${1000 + idx}`;
              const stableId = row.id ? Number(row.id) : getStableOrderId(orderNum, idx);
              const createdAt = row.created_at
                ? String(row.created_at).replace(' ', 'T')
                : new Date().toISOString();
              return {
                id: stableId,
                order_number: orderNum,
                type: row.type || 'dine_in',
                status: row.status || 'completed',
                total: Number(row.total) || 0,
                subtotal: Number(row.subtotal || row.total) || 0,
                tax_amount: Number(row.tax_amount) || 0,
                discount_amount: Number(row.discount_amount) || 0,
                delivery_charge: Number(row.delivery_charge) || 0,
                service_charge: Number(row.service_charge) || 0,
                created_by: 1,
                created_at: createdAt,
                guest_count: 1,
                special_instructions: null,
                table_id: row.table_id || null,
                customer_id: row.customer_id || null,
                items: [],
                bill: makeBill(
                  stableId,
                  orderNum,
                  Number(row.total) || 0,
                  createdAt
                ),
              };
            });
          }
        } catch {
          // ignore Supabase error
        }
      }

      const storedProducts = getStored<Product[]>('products', DEFAULT_PRODUCTS);
      const productMap = new Map(storedProducts.map((p) => [p.id, p]));

      const sanitizedLocalOrders = localOrders.map((order) => {
        let orderTotal = Number(order.total) || 0;
        let orderSubtotal = Number(order.subtotal) || orderTotal;
        let calculatedSum = 0;

        const repairedItems = (order.items || []).map((it: any, idx: number) => {
          const prod = productMap.get(it.product_id);
          const unitPrice =
            Number(it.unit_price) > 0
              ? Number(it.unit_price)
              : Number(it.price_override?.price ?? prod?.price ?? 80);
          const qty = Number(it.quantity) || 1;
          const lineTotal = Number(it.total) > 0 ? Number(it.total) : unitPrice * qty;
          calculatedSum += lineTotal;

          return {
            ...it,
            id: it.id || (order.id ? Number(order.id) + idx + 1 : Date.now() + idx),
            order_id: Number(order.id) || Date.now(),
            product_id: it.product_id,
            product_name: it.product_name || prod?.name || 'Milk Chocolate Pancake',
            product_sku: it.product_sku || prod?.sku || 'MCP-01',
            unit_price: unitPrice,
            quantity: qty,
            subtotal: lineTotal,
            total: lineTotal,
            status: it.status || 'pending',
          };
        });

        if (orderTotal === 0 && calculatedSum > 0) {
          orderTotal = calculatedSum;
          orderSubtotal = calculatedSum;
        }

        return {
          ...order,
          subtotal: orderSubtotal,
          total: orderTotal,
          items: repairedItems,
          bill:
            order.bill && Number(order.bill.total) > 0
              ? order.bill
              : makeBill(
                  Number(order.id) || Date.now(),
                  order.order_number,
                  orderTotal,
                  order.created_at || new Date().toISOString()
                ),
        };
      });

      // Merge unique by order_number
      const map = new Map<string, Order>();
      for (const o of sanitizedLocalOrders) {
        map.set(o.order_number, o);
      }
      for (const o of cloudOrders) {
        if (!map.has(o.order_number)) {
          map.set(o.order_number, o);
        }
      }

      const merged = Array.from(map.values()).sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );

      if (pathname.startsWith('/orders/')) {
        const orderIdStr = pathname.replace('/orders/', '').split('/')[0];
        const targetOrder = merged.find(
          (o) => String(o.id) === orderIdStr || o.order_number === orderIdStr
        );
        return mockResponse({ order: targetOrder || null }, config);
      }

      return mockResponse({ orders: merged, nextCursor: null }, config);
    }

    if (method === 'post') {
      let body: any = {};
      try {
        body = typeof config.data === 'string' ? JSON.parse(config.data) : config.data || {};
      } catch {
        body = {};
      }

      const orderNumber =
        body.order_number || `AP-${Math.floor(1000 + Math.random() * 9000)}`;
      const orderId = Date.now();

      const storedProducts = getStored<Product[]>('products', DEFAULT_PRODUCTS);
      const productMap = new Map(storedProducts.map((p) => [p.id, p]));

      let calculatedSubtotal = 0;
      const rawItems = Array.isArray(body.items) ? body.items : [];
      const mappedItems = rawItems.map((rawItem: any, idx: number) => {
        const prod = productMap.get(rawItem.product_id);
        const unitPrice = Number(rawItem.price_override?.price ?? prod?.price ?? 0);
        const qty = Number(rawItem.quantity) || 1;
        const itemTotal = unitPrice * qty;
        calculatedSubtotal += itemTotal;
        return {
          id: orderId + idx + 1,
          order_id: orderId,
          product_id: rawItem.product_id,
          product_name: prod?.name || 'Pancake Item',
          product_sku: prod?.sku || null,
          unit_price: unitPrice,
          quantity: qty,
          subtotal: itemTotal,
          tax_amount: 0,
          total: itemTotal,
          addons: rawItem.addons || null,
          special_instructions: rawItem.special_instructions || null,
          status: 'pending' as const,
        };
      });

      const subtotal = Number(body.subtotal) || calculatedSubtotal || Number(body.total) || 0;
      const total = Number(body.total) || subtotal;

      const newOrder: Order = {
        id: orderId,
        order_number: orderNumber,
        type: body.type || 'dine_in',
        status: 'pending',
        subtotal,
        tax_amount: Number(body.tax_amount) || 0,
        discount_amount: Number(body.discount_amount) || 0,
        delivery_charge: Number(body.delivery_charge) || 0,
        service_charge: Number(body.service_charge) || 0,
        total,
        guest_count: body.guest_count || 1,
        special_instructions: body.special_instructions || null,
        created_by: 1,
        created_at: new Date().toISOString(),
        table_id: body.table_id || null,
        customer_id: body.customer_id || null,
        items: mappedItems,
        bill: makeBill(orderId, orderNumber, total, new Date().toISOString()),
      };

      const existing = getStored<Order[]>('orders', []);
      setStored('orders', [newOrder, ...existing]);

      if (supabase) {
        void supabase.from('orders').insert({
          order_number: newOrder.order_number,
          type: newOrder.type,
          total: newOrder.total,
          subtotal: newOrder.subtotal,
          status: newOrder.status,
        });
      }

      return mockResponse({ order: newOrder, bill: newOrder.bill }, config, 201);
    }

    if (method === 'patch') {
      return mockResponse({ success: true }, config);
    }
  }

  // 2. PRODUCTS
  if (pathname === '/products' || pathname.startsWith('/products/')) {
    if (method === 'get') {
      const stored = getStored<Product[]>('products', DEFAULT_PRODUCTS);
      return mockResponse({ products: stored }, config);
    }
    if (method === 'post' || method === 'put') {
      return mockResponse({ success: true }, config);
    }
    if (method === 'delete') {
      return mockResponse({ success: true }, config);
    }
  }

  // 3. CATEGORIES
  if (pathname === '/categories' || pathname.startsWith('/categories/')) {
    if (method === 'get') {
      const stored = getStored<Category[]>('categories', DEFAULT_CATEGORIES);
      return mockResponse({ categories: stored }, config);
    }
    if (method === 'post' || method === 'put' || method === 'delete') {
      return mockResponse({ success: true }, config);
    }
  }

  // 4. ADDON GROUPS
  if (pathname.includes('addon-groups')) {
    return mockResponse({ addon_groups: [] }, config);
  }

  // 5. TABLES
  if (pathname === '/tables' || pathname.startsWith('/tables/')) {
    if (method === 'get') {
      const stored = getStored<Table[]>('tables', DEFAULT_TABLES);
      return mockResponse({ tables: stored }, config);
    }
    return mockResponse({ success: true }, config);
  }

  // 6. CUSTOMERS
  if (pathname === '/customers' || pathname.startsWith('/customers')) {
    if (pathname.includes('/wallet')) {
      return mockResponse(
        {
          balance: 0,
          transactions: [],
          bills: [],
          summary: { totalSpent: 0, totalPointsEarned: 0, totalPointsRedeemed: 0 },
        },
        config
      );
    }
    const stored = getStored<Customer[]>('customers', []);
    if (method === 'get') {
      return mockResponse({ data: stored, customers: stored, total: stored.length }, config);
    }
    return mockResponse({ success: true }, config);
  }

  // 7. STAFF / USERS
  if (
    pathname === '/staff' ||
    pathname.startsWith('/staff') ||
    pathname.includes('users') ||
    pathname.includes('approvers')
  ) {
    return mockResponse(
      { staff: DEFAULT_STAFF, users: DEFAULT_STAFF, approvers: DEFAULT_STAFF },
      config
    );
  }

  // 8. EXPENSES
  if (pathname.startsWith('/expenses')) {
    if (pathname === '/expenses/categories') {
      return mockResponse(
        { categories: ['Raw Materials', 'Packaging', 'Utilities', 'Rent', 'Staff', 'Other'] },
        config
      );
    }
    if (pathname === '/expenses/context') {
      return mockResponse(
        {
          shift_active: true,
          register_open: true,
          current_user_id: 1,
          permissions: { can_create: true, can_view: true },
        },
        config
      );
    }
    return mockResponse({ expenses: [] }, config);
  }

  // 9. INVENTORY / SUPPLIES / RECIPES
  if (
    pathname.startsWith('/inventory') ||
    pathname.startsWith('/supplies') ||
    pathname.startsWith('/recipes')
  ) {
    return mockResponse({ recipes: [], supplies: [], movements: [], items: [] }, config);
  }

  // 10. BILLS
  if (pathname.startsWith('/bills')) {
    if (pathname.includes('/print-history')) {
      return mockResponse({ prints: [] }, config);
    }
    let body: any = {};
    try {
      body = typeof config.data === 'string' ? JSON.parse(config.data) : config.data || {};
    } catch {
      body = {};
    }
    const orderId = body.order_id || Date.now();
    const existingOrders = getStored<Order[]>('orders', []);
    const matchingOrder = existingOrders.find((o) => o.id === orderId);
    const billTotal = matchingOrder ? matchingOrder.total : 0;
    const billOrderNumber = matchingOrder
      ? matchingOrder.order_number
      : `AP-${Math.floor(1000 + Math.random() * 9000)}`;
    const bill = makeBill(Number(orderId) || Date.now(), billOrderNumber, billTotal, new Date().toISOString());
    return mockResponse({ bill }, config);
  }

  // 11. SETTINGS
  if (pathname.startsWith('/settings')) {
    if (pathname === '/settings/business') {
      return mockResponse(DEFAULT_BUSINESS, config);
    }
    if (pathname.includes('orders_layout')) {
      return mockResponse({ setting: { key: 'orders_layout', value: 'split' } }, config);
    }
    if (pathname.includes('product-analytics')) {
      return mockResponse({ setting: { key: 'product-analytics', value: 'off' } }, config);
    }
    if (pathname === '/settings/kds_enabled') {
      return mockResponse({ setting: { key: 'kds_enabled', value: 'true' } }, config);
    }
    if (pathname === '/settings/taxes_enabled') {
      return mockResponse({ setting: { key: 'taxes_enabled', value: 'false' } }, config);
    }
    if (pathname === '/settings/theme_mode') {
      return mockResponse({ setting: { key: 'theme_mode', value: 'system' } }, config);
    }
    if (pathname === '/settings/kds') {
      return mockResponse({ kds_default_view: 'tabs' }, config);
    }
    if (pathname === '/settings/loyalty') {
      return mockResponse({ loyalty_enabled: false }, config);
    }
    if (pathname === '/settings/discount') {
      return mockResponse({ discount_max_percentage: 20 }, config);
    }
    if (pathname === '/settings/order-numbering') {
      return mockResponse({ order_number_prefix: 'AP', order_number_digits: 4 }, config);
    }
    if (pathname.startsWith('/settings/cloud')) {
      return mockResponse(
        {
          connected: true,
          sync_status: 'synced',
          project_url: 'https://pwfmxbasjrbxqmohbsnm.supabase.co',
          email: 'admin@americanpancakes.com',
          status: 'active',
        },
        config
      );
    }
    return mockResponse({ success: true, setting: { value: null } }, config);
  }

  // 12. KDS / STATIONS / DEVICE INFO
  if (
    pathname.startsWith('/kitchen-stations') ||
    pathname.startsWith('/kds-info') ||
    pathname.startsWith('/server-app-info') ||
    pathname.startsWith('/pos-info')
  ) {
    return mockResponse(
      {
        enabled: true,
        stations: [{ id: 1, name: 'Kitchen Station', is_active: true }],
        mdns_url: '',
        ip_url: '',
        qr_url: '',
        qr_data_url: null,
      },
      config
    );
  }

  // 13. WHATSAPP
  if (pathname.startsWith('/whatsapp')) {
    return mockResponse({ status: 'disconnected', enabled: false, messages: [] }, config);
  }

  // 14. REPORTS / DASHBOARD
  if (pathname.startsWith('/reports') || pathname.startsWith('/analytics')) {
    return mockResponse(
      {
        summary: { today_sales: 0, order_count: 0 },
        sales: [],
      },
      config
    );
  }

  // 15. DB TOOLS
  if (pathname.startsWith('/db-tools')) {
    return mockResponse({ status: 'healthy', tables_ok: true, issues: [] }, config);
  }

  // Catch-all mock response for any unhandled relative API endpoint to prevent 404 toasts
  return mockResponse({ success: true }, config);
}
