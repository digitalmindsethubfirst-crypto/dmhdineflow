import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { db } from '../db/database';
import { AuthRequest, verifyToken, requireRole, requireRestaurant } from '../middleware/auth';

const router = Router();

// GET /api/customer/restaurant/:slug  (Public Online Ordering Endpoint - Remote/No QR)
router.get('/customer/restaurant/:slug', (req: Request, res: Response) => {
  const { slug } = req.params;

  // 1. Find restaurant by slug (case-insensitive)
  const restaurant = db.findOne('restaurants', (r: any) => r.slug?.toLowerCase() === slug?.toLowerCase());
  if (!restaurant) {
    res.status(404).json({ error: 'Restaurant not found.', status: 'not_found' });
    return;
  }

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

  // 3. Check Super Admin Online Ordering Access Control
  if (restaurant.enable_online_ordering === false) {
    res.status(403).json({
      error: 'Online ordering is currently not enabled for this restaurant. Please contact restaurant administration.',
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

  // 5. Find or create active table session
  let session = db.findOne('table_sessions', (s: any) => s.table_id === table.id && s.status === 'active');
  const now = new Date().toISOString();

  if (!session) {
    session = {
      id: uuid(),
      restaurant_id: restaurant.id,
      table_id: table.id,
      session_token: uuid(),
      status: 'active',
      started_at: now,
    };
    db.insert('table_sessions', session);
  }

  // 6. Fetch categories for this restaurant
  const categories = db.find('categories', (c: any) => c.restaurant_id === restaurant.id && c.status === 'active') as any[];
  categories.sort((a: any, b: any) => a.sort_order - b.sort_order);

  // 7. Fetch active menu items
  const menuItems = db.find('menu_items', (i: any) => i.restaurant_id === restaurant.id) as any[];
  menuItems.sort((a: any, b: any) => a.sort_order - b.sort_order);

  const itemsWithVariants = menuItems.map((item: any) => {
    const variants = db.find('item_variants', (v: any) => v.item_id === item.id && v.status === 'active') as any[];
    return { ...item, variants };
  });

  // 8. Fetch current session orders (for table session aggregate view)
  const sessionOrders = db.find('orders', (o: any) => o.table_session_id === session.id) as any[];
  const formattedOrders = sessionOrders.map((o: any) => {
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
      started_at: session.started_at,
    },
    categories,
    menu_items: itemsWithVariants,
    current_orders: formattedOrders,
    session_total: formattedOrders.reduce((sum: number, o: any) => sum + (o.status !== 'cancelled' ? o.total : 0), 0),
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
  const ordersWithItems = orders.map((o: any) => {
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
