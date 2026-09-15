import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { db } from '../db/database';
import { AuthRequest, verifyToken, requireRole, requireRestaurant } from '../middleware/auth';

const router = Router();

// GET /api/customer/restaurant/:slug  (Public Online Ordering Endpoint - Remote/No QR)
router.get('/customer/restaurant/:slug', (req: Request, res: Response) => {
  const { slug } = req.params;
  const cleanSlug = decodeURIComponent(slug || '').trim().toLowerCase();

  // 1. Find all matching restaurants by slug, id, or normalized name
  const matches = db.find('restaurants', (r: any) => {
    if (!r) return false;
    const rSlug = (r.slug || '').toLowerCase();
    const rId = (r.id || '').toLowerCase();
    const rNameSlug = (r.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    return rSlug === cleanSlug || rId === cleanSlug || rNameSlug === cleanSlug;
  }) as any[];

  if (!matches || matches.length === 0) {
    res.status(404).json({ error: `Restaurant "${slug}" not found. Please check your link or contact the restaurant.`, status: 'not_found' });
    return;
  }

  // Prioritize active restaurant first
  const restaurant = matches.find((r: any) => r.status === 'active') || matches[0];

  // 2. Check restaurant status
  if (restaurant.status === 'suspended') {
    res.status(403).json({
      error: 'This restaurant account is currently suspended. Please contact restaurant administration.',
      status: 'suspended',
      restaurant_name: restaurant.name,
    });
    return;
  }

  if (restaurant.status === 'inactive') {
    res.status(403).json({
      error: 'This restaurant is currently inactive.',
      status: 'inactive',
      restaurant_name: restaurant.name,
    });
    return;
  }

  // 3. Check Super Admin Online Ordering Access Control (Default to true if not explicitly false)
  if (restaurant.enable_online_ordering === false) {
    res.status(403).json({
      error: 'Online ordering is currently turned off for this restaurant. Please contact restaurant administration.',
      status: 'online_ordering_disabled',
      restaurant_name: restaurant.name,
    });
    return;
  }

  // 4. Fetch active categories for this restaurant
  const categories = db.find('categories', (c: any) => c.restaurant_id === restaurant.id && c.status === 'active') as any[];
  categories.sort((a: any, b: any) => a.sort_order - b.sort_order);

  // 5. Fetch active menu items with variants
  const menuItems = db.find('menu_items', (i: any) => i.restaurant_id === restaurant.id) as any[];
  menuItems.sort((a: any, b: any) => a.sort_order - b.sort_order);

  const itemsWithVariants = menuItems.map((item: any) => {
    const variants = db.find('item_variants', (v: any) => v.item_id === item.id && v.status === 'active') as any[];
    return { ...item, variants };
  });

  res.json({
    order_mode: 'online',
    restaurant: {
      id: restaurant.id,
      name: restaurant.name,
      slug: restaurant.slug,
      logo: restaurant.logo,
      cover_image: restaurant.cover_image,
      description: restaurant.description,
      phone: restaurant.phone,
      whatsapp: restaurant.whatsapp,
      email: restaurant.email,
      address: restaurant.address,
      city: restaurant.city,
      is_open: restaurant.is_open,
      accept_orders: restaurant.accept_orders,
      enable_online_ordering: restaurant.enable_online_ordering !== false,
      enable_dine_in: restaurant.enable_dine_in !== false,
      enable_delivery: restaurant.enable_delivery !== false,
      delivery_fee: restaurant.delivery_fee || 0,
      min_order_amount: restaurant.min_order_amount || 0,
      estimated_delivery_time: restaurant.estimated_delivery_time || '30-45 mins',
      payment_methods: restaurant.payment_methods || ['cod', 'bank_transfer', 'easypaisa', 'jazzcash'],
      bank_details: restaurant.bank_details || '',
      opening_time: restaurant.opening_time,
      closing_time: restaurant.closing_time,
      tax_rate: restaurant.tax_rate || 0,
      service_charge_rate: restaurant.service_charge_rate || 0,
      currency: restaurant.currency || 'PKR',
    },
    categories,
    menu_items: itemsWithVariants,
  });
});

// GET /api/customer/table/:token  (Public QR Scan Endpoint)
router.get('/customer/table/:token', (req: Request, res: Response) => {
  const { token } = req.params;

  // 1. Find table by qr_token
  const table = db.findOne('tables', (t: any) => t.qr_token === token);
  if (!table) {
    res.status(404).json({ error: 'Invalid QR Code. Table not found.' });
    return;
  }

  // 2. Find restaurant
  const restaurant = db.findById('restaurants', table.restaurant_id);
  if (!restaurant) {
    res.status(404).json({ error: 'Restaurant not found.' });
    return;
  }

  // 3. Check restaurant status
  if (restaurant.status === 'suspended') {
    res.status(403).json({
      error: 'This restaurant account is currently suspended. Please contact restaurant administration.',
      status: 'suspended',
      restaurant_name: restaurant.name,
    });
    return;
  }

  if (restaurant.status === 'inactive') {
    res.status(403).json({
      error: 'This restaurant is currently inactive.',
      status: 'inactive',
      restaurant_name: restaurant.name,
    });
    return;
  }

  // 4. Check Super Admin Dine-In Ordering Access Control
  if (restaurant.enable_dine_in === false) {
    res.status(403).json({
      error: 'Dine-in table ordering is currently disabled for this restaurant.',
      status: 'dine_in_disabled',
      restaurant_name: restaurant.name,
    });
    return;
  }

  // 5. Check if table is active
  if (table.status !== 'active') {
    res.status(403).json({
      error: 'This table is currently not available for ordering.',
      status: 'table_inactive',
      restaurant_name: restaurant.name,
    });
    return;
  }

  // 6. Extract requesting customer's unique session token (sent by client)
  const clientToken = (req.headers['x-customer-session'] as string) || (req.query.customer_session as string) || '';

  // 7. Find or auto-close previous completed table session
  let session = db.findOne('table_sessions', (s: any) => s.table_id === table.id && s.status === 'active');
  const now = new Date().toISOString();

  if (session) {
    // Check all orders placed in this table session
    const sessionOrders = db.find('orders', (o: any) => o.table_session_id === session.id) as any[];
    const hasActiveOrders = sessionOrders.some((o: any) => !['completed', 'delivered', 'cancelled'].includes(o.status));

    // If all previous orders have reached served/completed or cancelled, automatically expire & close the session
    if (sessionOrders.length > 0 && !hasActiveOrders) {
      db.update('table_sessions', session.id, {
        status: 'closed',
        closed_at: now,
      });
      session = null; // Force creation of a fresh table session for the new customer
    }

    // Also close stale sessions with no orders that were created more than 2 hours ago
    if (session && sessionOrders.length === 0) {
      const sessionAge = now > session.started_at
        ? Date.now() - new Date(session.started_at).getTime()
        : 0;
      if (sessionAge > 2 * 60 * 60 * 1000) {
        db.update('table_sessions', session.id, {
          status: 'closed',
          closed_at: now,
        });
        session = null;
      }
    }
  }

  // Create a brand new table session if none active
  if (!session) {
    const newCustomerToken = uuid(); // Server-authoritative token for this session
    session = {
      id: uuid(),
      restaurant_id: restaurant.id,
      table_id: table.id,
      session_token: uuid(),
      customer_session_token: newCustomerToken,
      status: 'active',
      started_at: now,
    };
    db.insert('table_sessions', session);
    db.forceSave();
  }

  // CRITICAL: The authoritative customer token is ALWAYS the one stored on the session,
  // not the client's browser UUID. This ensures consistent order isolation even after
  // page refreshes, incognito windows, or shared devices.
  const authorizedToken = session.customer_session_token as string;

  // 8. Fetch categories for this restaurant
  const categories = db.find('categories', (c: any) => c.restaurant_id === restaurant.id && c.status === 'active') as any[];
  categories.sort((a: any, b: any) => a.sort_order - b.sort_order);

  // 9. Fetch active menu items
  const menuItems = db.find('menu_items', (i: any) => i.restaurant_id === restaurant.id) as any[];
  menuItems.sort((a: any, b: any) => a.sort_order - b.sort_order);

  const itemsWithVariants = menuItems.map((item: any) => {
    const variants = db.find('item_variants', (v: any) => v.item_id === item.id && v.status === 'active') as any[];
    return { ...item, variants };
  });

  // 10. STRICT CUSTOMER ORDER ISOLATION:
  // Use the SESSION'S authoritative token (server-generated), NOT the client's browser UUID.
  // This ensures isolation even if the same physical device or browser is shared between customers.
  const myActiveOrders = (db.find('orders', (o: any) =>
    o.table_id === table.id &&
    o.table_session_id === session.id &&
    o.customer_session_token === authorizedToken &&
    !['completed', 'delivered', 'cancelled'].includes(o.status)
  ) as any[]).map((o: any) => {
    const items = db.find('order_items', (oi: any) => oi.order_id === o.id);
    return { ...o, items };
  });

  res.json({
    restaurant: {
      id: restaurant.id,
      name: restaurant.name,
      slug: restaurant.slug,
      logo: restaurant.logo,
      cover_image: restaurant.cover_image,
      description: restaurant.description,
      phone: restaurant.phone,
      whatsapp: restaurant.whatsapp,
      address: restaurant.address,
      city: restaurant.city,
      is_open: restaurant.is_open,
      accept_orders: restaurant.accept_orders,
      opening_time: restaurant.opening_time,
      closing_time: restaurant.closing_time,
      tax_rate: restaurant.tax_rate,
      service_charge_rate: restaurant.service_charge_rate,
      currency: restaurant.currency,
    },
    table: {
      id: table.id,
      table_number: table.table_number,
    },
    session: {
      id: session.id,
      session_token: session.session_token,
      // CRITICAL: Return the SERVER-AUTHORITATIVE token so the client stores and uses THIS token.
      // This replaces whatever browser-generated UUID the client had before, ensuring correct
      // order isolation even after page refreshes or on shared devices.
      customer_session_token: authorizedToken,
      started_at: session.started_at,
    },
    categories,
    menu_items: itemsWithVariants,
    current_orders: myActiveOrders,
    session_total: myActiveOrders.reduce((sum: number, o: any) => sum + (o.status !== 'cancelled' ? o.total : 0), 0),
  });
});

// POST /api/sessions/:id/close (Owner/Kitchen closes table session)
router.post('/sessions/:id/close', verifyToken, requireRole('super_admin', 'restaurant_owner', 'kitchen_staff'), (req: AuthRequest, res: Response) => {
  const session = db.findById('table_sessions', req.params.id);
  if (!session) {
    res.status(404).json({ error: 'Session not found.' });
    return;
  }

  if (req.user!.role !== 'super_admin' && req.user!.restaurant_id !== session.restaurant_id) {
    res.status(403).json({ error: 'Access denied.' });
    return;
  }

  const now = new Date().toISOString();
  const updated = db.update('table_sessions', req.params.id, {
    status: 'closed',
    closed_at: now,
  });

  db.insert('audit_logs', {
    id: uuid(),
    user_id: req.user!.id,
    restaurant_id: session.restaurant_id,
    action: 'table_session_closed',
    entity_type: 'table_session',
    entity_id: session.id,
    metadata: JSON.stringify({ table_id: session.table_id, closed_at: now }),
    created_at: now,
  });

  // Socket notification to session room
  const io = (global as any).__io;
  if (io) {
    io.to(`session_${session.id}`).emit('session:closed', { session_id: session.id });
    io.to(`restaurant_${session.restaurant_id}`).emit('session:closed', { session_id: session.id, table_id: session.table_id });
  }

  res.json({ message: 'Table session closed successfully.', session: updated });
});

// GET /api/sessions/:id (Session details + orders)
router.get('/sessions/:id', (req: Request, res: Response) => {
  const session = db.findById('table_sessions', req.params.id);
  if (!session) {
    res.status(404).json({ error: 'Session not found.' });
    return;
  }

  const table = db.findById('tables', session.table_id);
  const orders = db.find('orders', (o: any) => o.table_session_id === session.id) as any[];

  // Privacy verification: Check if caller is authenticated staff or customer with session
  const authHeader = req.headers.authorization;
  let isStaff = false;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      const jwt = require('jsonwebtoken');
      const { config } = require('../config/env');
      const decoded = jwt.verify(authHeader.split(' ')[1], config.jwtSecret);
      if (decoded && (decoded.role === 'super_admin' || decoded.restaurant_id === session.restaurant_id)) {
        isStaff = true;
      }
    } catch (e) {
      // not staff
    }
  }

  const customerSessionToken = (req.headers['x-customer-session'] as string) || (req.query.customer_session as string) || '';
  let visibleOrders = orders;
  if (!isStaff) {
    visibleOrders = customerSessionToken
      ? orders.filter((o: any) => o.customer_session_token === customerSessionToken)
      : [];
  }

  const ordersWithItems = visibleOrders.map((o: any) => {
    const items = db.find('order_items', (oi: any) => oi.order_id === o.id);
    return { ...o, items };
  });

  res.json({
    session,
    table_number: table?.table_number,
    orders: ordersWithItems,
    total: ordersWithItems.reduce((sum: number, o: any) => sum + (o.status !== 'cancelled' ? o.total : 0), 0),
  });
});

export default router;
