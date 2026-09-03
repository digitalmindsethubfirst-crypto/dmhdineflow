import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { db } from '../db/database';
import { AuthRequest, verifyToken, requireRole, requireRestaurant } from '../middleware/auth';

const router = Router();

// POST /api/orders  (Customer-facing - server validates everything)
router.post('/orders', (req: Request, res: Response) => {
  const { restaurant_id, table_id, session_id, items, customer_name, customer_note } = req.body;

  // 1. Validate restaurant
  const restaurant = db.findById('restaurants', restaurant_id);
  if (!restaurant) { res.status(404).json({ error: 'Restaurant not found.' }); return; }
  if (restaurant.status !== 'active') { res.status(403).json({ error: 'This restaurant is currently unavailable.' }); return; }
  if (!restaurant.accept_orders || !restaurant.is_open) { res.status(403).json({ error: 'This restaurant is not accepting orders right now.' }); return; }

  // 2. Validate table
  const table = db.findById('tables', table_id);
  if (!table || table.restaurant_id !== restaurant_id) { res.status(400).json({ error: 'Invalid table.' }); return; }
  if (table.status !== 'active') { res.status(400).json({ error: 'This table is currently inactive.' }); return; }

  // 3. Validate session
  const session = db.findById('table_sessions', session_id);
  if (!session || session.table_id !== table_id || session.status !== 'active') {
    res.status(400).json({ error: 'Invalid or expired table session.' }); return;
  }

  // 4. Validate items & prevent negative/zero quantities or manipulation
  if (!items || !Array.isArray(items) || items.length === 0) {
    res.status(400).json({ error: 'At least one item is required.' }); return;
  }

  let subtotal = 0;
  const orderItems: any[] = [];

  for (const item of items) {
    const menuItem = db.findById('menu_items', item.menu_item_id);
    if (!menuItem || menuItem.restaurant_id !== restaurant_id) {
      res.status(400).json({ error: `Item not found: ${item.menu_item_id}` }); return;
    }
    if (!menuItem.available) {
      res.status(400).json({ error: `Sorry, "${menuItem.name}" is currently unavailable.` }); return;
    }

    const quantity = parseInt(item.quantity);
    if (!quantity || quantity < 1 || quantity > 50) {
      res.status(400).json({ error: `Invalid quantity for ${menuItem.name}. Must be between 1 and 50.` }); return;
    }

    let unitPrice = menuItem.base_price;
    let variantName: string | undefined;
    let variantId: string | undefined;

    if (item.variant_id) {
      const variant = db.findById('item_variants', item.variant_id);
      if (!variant || variant.item_id !== menuItem.id || variant.status !== 'active') {
        res.status(400).json({ error: `Invalid variant for ${menuItem.name}.` }); return;
      }
      unitPrice = variant.price;
      variantName = variant.name;
      variantId = variant.id;
    }

    const itemSubtotal = unitPrice * quantity;
    subtotal += itemSubtotal;

    orderItems.push({
      id: uuid(), menu_item_id: menuItem.id, variant_id: variantId,
      item_name_snapshot: menuItem.name, variant_name_snapshot: variantName,
      quantity, unit_price: unitPrice, subtotal: itemSubtotal,
    });
  }

  // 5. Server calculates totals with restaurant tax & service charges
  const tax = Math.round((subtotal * (restaurant.tax_rate || 0)) / 100);
  const serviceCharge = Math.round((subtotal * (restaurant.service_charge_rate || 0)) / 100);
  const total = subtotal + tax + serviceCharge;

  const now = new Date().toISOString();
  const orderId = uuid();
  const orderNumber = db.nextOrderNumber();

  // Sanitize notes & name
  const sanitizedName = typeof customer_name === 'string' ? customer_name.trim().slice(0, 50) : '';
  const sanitizedNote = typeof customer_note === 'string' ? customer_note.trim().slice(0, 200) : '';

  const order = {
    id: orderId, restaurant_id, table_id, table_session_id: session_id,
    order_number: orderNumber, status: 'new' as const,
    subtotal, tax, service_charge: serviceCharge, discount: 0, total,
    customer_name: sanitizedName, customer_note: sanitizedNote,
    created_at: now, updated_at: now,
  };

  db.insert('orders', order);

  for (const oi of orderItems) {
    db.insert('order_items', { ...oi, order_id: orderId });
  }

  const fullOrder = {
    ...order,
    items: orderItems,
    table_number: table.table_number,
  };

  // Emit socket event to scoped rooms
  const io = (global as any).__io;
  if (io) {
    io.to(`restaurant_${restaurant_id}`).emit('order:new', fullOrder);
    io.to(`kitchen_${restaurant_id}`).emit('order:new', fullOrder);
    io.to(`session_${session_id}`).emit('order:new', fullOrder);
  }

  res.status(201).json(fullOrder);
});

// GET /api/customer/orders/:id (Public customer order tracking endpoint)
router.get('/customer/orders/:id', (req: Request, res: Response) => {
  const order = db.findById('orders', req.params.id);
  if (!order) {
    res.status(404).json({ error: 'Order not found.' });
    return;
  }

  const table = db.findById('tables', order.table_id);
  const orderItems = db.find('order_items', (oi: any) => oi.order_id === order.id);

  // Return sanitized customer tracking details (no sensitive admin keys)
  res.json({
    id: order.id,
    order_number: order.order_number,
    status: order.status,
    table_number: table?.table_number || '?',
    table_session_id: order.table_session_id,
    items: orderItems,
    subtotal: order.subtotal,
    tax: order.tax,
    service_charge: order.service_charge,
    total: order.total,
    created_at: order.created_at,
    updated_at: order.updated_at,
  });
});

// GET /api/restaurants/:restaurantId/orders (Staff/Owner protected list)
router.get('/restaurants/:restaurantId/orders', verifyToken, requireRole('super_admin', 'restaurant_owner', 'kitchen_staff'), requireRestaurant, (req: AuthRequest, res: Response) => {
  let orders = db.find('orders', (o: any) => o.restaurant_id === req.params.restaurantId) as any[];

  // Date filter
  const { date_filter, status, search, start_date, end_date } = req.query;
  const now = new Date();

  if (date_filter === 'today' || (!date_filter && !start_date)) {
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    orders = orders.filter((o: any) => o.created_at >= todayStart);
  } else if (date_filter === 'yesterday') {
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const yStart = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate()).toISOString();
    const yEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    orders = orders.filter((o: any) => o.created_at >= yStart && o.created_at < yEnd);
  } else if (date_filter === 'week') {
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    orders = orders.filter((o: any) => o.created_at >= weekAgo);
  } else if (date_filter === 'month') {
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    orders = orders.filter((o: any) => o.created_at >= monthStart);
  } else if (start_date && end_date) {
    orders = orders.filter((o: any) => o.created_at >= start_date && o.created_at <= end_date);
  }

  if (status && status !== 'all') {
    orders = orders.filter((o: any) => o.status === status);
  }

  if (search) {
    const s = (search as string).toLowerCase();
    orders = orders.filter((o: any) => o.order_number.toLowerCase().includes(s));
  }

  orders.sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  const result = orders.map((o: any) => {
    const table = db.findById('tables', o.table_id);
    const orderItems = db.find('order_items', (oi: any) => oi.order_id === o.id);
    return { ...o, table_number: table?.table_number || '?', items: orderItems };
  });

  res.json(result);
});

// GET /api/restaurants/:restaurantId/orders/stats (Staff/Owner KPIs)
router.get('/restaurants/:restaurantId/orders/stats', verifyToken, requireRole('super_admin', 'restaurant_owner', 'kitchen_staff'), requireRestaurant, (req: AuthRequest, res: Response) => {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const todayOrders = db.find('orders', (o: any) => o.restaurant_id === req.params.restaurantId && o.created_at >= todayStart) as any[];

  const stats = {
    total: todayOrders.length,
    new: todayOrders.filter((o: any) => o.status === 'new').length,
    accepted: todayOrders.filter((o: any) => o.status === 'accepted').length,
    cooking: todayOrders.filter((o: any) => o.status === 'cooking').length,
    ready: todayOrders.filter((o: any) => o.status === 'ready').length,
    completed: todayOrders.filter((o: any) => o.status === 'completed').length,
    cancelled: todayOrders.filter((o: any) => o.status === 'cancelled').length,
    revenue: todayOrders.filter((o: any) => o.status === 'completed').reduce((s: number, o: any) => s + o.total, 0),
    totalItems: db.count('menu_items', (i: any) => i.restaurant_id === req.params.restaurantId),
    totalCategories: db.count('categories', (c: any) => c.restaurant_id === req.params.restaurantId),
    totalTables: db.count('tables', (t: any) => t.restaurant_id === req.params.restaurantId),
  };

  res.json(stats);
});

// GET /api/orders/:id (Protected for staff/owner)
router.get('/orders/:id', verifyToken, requireRole('super_admin', 'restaurant_owner', 'kitchen_staff'), (req: AuthRequest, res: Response) => {
  const order = db.findById('orders', req.params.id);
  if (!order) { res.status(404).json({ error: 'Order not found.' }); return; }

  if (req.user!.role !== 'super_admin' && req.user!.restaurant_id !== order.restaurant_id) {
    res.status(403).json({ error: 'Access denied.' }); return;
  }

  const table = db.findById('tables', order.table_id);
  const orderItems = db.find('order_items', (oi: any) => oi.order_id === order.id);
  const session = db.findById('table_sessions', order.table_session_id);

  res.json({ ...order, table_number: table?.table_number || '?', items: orderItems, session });
});

// PATCH /api/orders/:id/status (Staff/owner status progression)
router.patch('/orders/:id/status', verifyToken, requireRole('super_admin', 'restaurant_owner', 'kitchen_staff'), (req: AuthRequest, res: Response) => {
  const order = db.findById('orders', req.params.id);
  if (!order) { res.status(404).json({ error: 'Order not found.' }); return; }

  if (req.user!.role !== 'super_admin' && req.user!.restaurant_id !== order.restaurant_id) {
    res.status(403).json({ error: 'Access denied.' }); return;
  }

  const { status } = req.body;
  const validTransitions: Record<string, string[]> = {
    new: ['accepted', 'cancelled'],
    accepted: ['cooking', 'cancelled'],
    cooking: ['ready', 'cancelled'],
    ready: ['completed'],
    completed: [],
    cancelled: [],
  };

  if (!validTransitions[order.status]?.includes(status)) {
    res.status(400).json({ error: `Cannot change status from ${order.status} to ${status}.` }); return;
  }

  const updated = db.update('orders', req.params.id, { status });
  const table = db.findById('tables', order.table_id);
  const orderItems = db.find('order_items', (oi: any) => oi.order_id === order.id);

  const fullOrder = { ...updated, table_number: table?.table_number || '?', items: orderItems };

  db.insert('audit_logs', {
    id: uuid(), user_id: req.user!.id, restaurant_id: order.restaurant_id,
    action: 'order_status_changed', entity_type: 'order', entity_id: order.id,
    metadata: JSON.stringify({ order_number: order.order_number, from: order.status, to: status }),
    created_at: new Date().toISOString(),
  });

  // Socket emit
  const io = (global as any).__io;
  if (io) {
    io.to(`restaurant_${order.restaurant_id}`).emit('order:status_updated', fullOrder);
    io.to(`kitchen_${order.restaurant_id}`).emit('order:status_updated', fullOrder);
    io.to(`session_${order.table_session_id}`).emit('order:status_updated', fullOrder);
  }

  res.json(fullOrder);
});

export default router;
