import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { db } from '../db/database';
import { AuthRequest, verifyToken, requireRole, requireRestaurant } from '../middleware/auth';

const router = Router();

// POST /api/customer/orders/online (Public Online Delivery & Takeaway Order Creation)
router.post('/customer/orders/online', (req: Request, res: Response) => {
  const {
    restaurant_id,
    order_type = 'delivery',
    customer_name,
    customer_phone,
    customer_whatsapp,
    customer_email,
    delivery_address,
    delivery_city,
    delivery_notes,
    payment_method = 'cod',
    items,
  } = req.body;

  // 1. Validate restaurant
  const restaurant = db.findById('restaurants', restaurant_id);
  if (!restaurant) {
    res.status(404).json({ error: 'Restaurant not found.' });
    return;
  }
  if (restaurant.status !== 'active') {
    res.status(403).json({ error: 'This restaurant is currently unavailable.' });
    return;
  }
  if (restaurant.enable_online_ordering === false) {
    res.status(403).json({ error: 'Online ordering is disabled for this restaurant.' });
    return;
  }
  if (!restaurant.accept_orders || !restaurant.is_open) {
    res.status(403).json({ error: 'This restaurant is not accepting orders right now.' });
    return;
  }

  // 2. Validate customer contact & address for delivery
  if (!customer_name || !customer_name.trim()) {
    res.status(400).json({ error: 'Customer name is required.' });
    return;
  }
  if (!customer_phone || !customer_phone.trim()) {
    res.status(400).json({ error: 'Customer mobile / phone number is required.' });
    return;
  }
  if (order_type === 'delivery' && (!delivery_address || !delivery_address.trim())) {
    res.status(400).json({ error: 'Complete delivery address is required for online delivery.' });
    return;
  }

  // 3. Validate items & prevent manipulation
  if (!items || !Array.isArray(items) || items.length === 0) {
    res.status(400).json({ error: 'At least one menu dish is required.' });
    return;
  }

  let subtotal = 0;
  const orderItems: any[] = [];

  for (const item of items) {
    const menuItem = db.findById('menu_items', item.menu_item_id);
    if (!menuItem || menuItem.restaurant_id !== restaurant_id) {
      res.status(400).json({ error: `Item not found: ${item.menu_item_id}` });
      return;
    }
    if (!menuItem.available) {
      res.status(400).json({ error: `Sorry, "${menuItem.name}" is currently sold out.` });
      return;
    }

    const quantity = parseInt(item.quantity);
    if (!quantity || quantity < 1 || quantity > 50) {
      res.status(400).json({ error: `Invalid quantity for ${menuItem.name}.` });
      return;
    }

    let unitPrice = menuItem.base_price;
    let variantName: string | undefined;
    let variantId: string | undefined;

    if (item.variant_id) {
      const variant = db.findById('item_variants', item.variant_id);
      if (!variant || variant.item_id !== menuItem.id || variant.status !== 'active') {
        res.status(400).json({ error: `Invalid size/option for ${menuItem.name}.` });
        return;
      }
      unitPrice = variant.price;
      variantName = variant.name;
      variantId = variant.id;
    }

    const itemSubtotal = unitPrice * quantity;
    subtotal += itemSubtotal;

    orderItems.push({
      id: uuid(),
      menu_item_id: menuItem.id,
      variant_id: variantId,
      item_name_snapshot: menuItem.name,
      variant_name_snapshot: variantName,
      quantity,
      unit_price: unitPrice,
      subtotal: itemSubtotal,
    });
  }

  // 4. Validate minimum order amount if configured
  if (restaurant.min_order_amount && subtotal < restaurant.min_order_amount) {
    res.status(400).json({
      error: `Minimum order amount for this restaurant is ${restaurant.currency || 'PKR'} ${restaurant.min_order_amount}.`,
    });
    return;
  }

  // 5. Calculate taxes, service charges, delivery fees, grand total
  const deliveryFee = order_type === 'delivery' ? (restaurant.delivery_fee || 0) : 0;
  const tax = Math.round((subtotal * (restaurant.tax_rate || 0)) / 100);
  const serviceCharge = Math.round((subtotal * (restaurant.service_charge_rate || 0)) / 100);
  const total = subtotal + deliveryFee + tax + serviceCharge;

  const now = new Date().toISOString();
  const orderId = uuid();
  const orderNumber = db.nextOrderNumber();

  const sanitizedName = customer_name.trim().slice(0, 80);
  const sanitizedPhone = customer_phone.trim().slice(0, 30);
  const sanitizedWhatsApp = typeof customer_whatsapp === 'string' ? customer_whatsapp.trim().slice(0, 30) : sanitizedPhone;
  const sanitizedEmail = typeof customer_email === 'string' ? customer_email.trim().slice(0, 80) : '';
  const sanitizedAddress = typeof delivery_address === 'string' ? delivery_address.trim().slice(0, 300) : '';
  const sanitizedCity = typeof delivery_city === 'string' ? delivery_city.trim().slice(0, 80) : (restaurant.city || '');
  const sanitizedNotes = typeof delivery_notes === 'string' ? delivery_notes.trim().slice(0, 300) : '';

  const order = {
    id: orderId,
    restaurant_id,
    order_type: order_type as 'delivery' | 'pickup',
    order_number: orderNumber,
    status: 'new' as const,
    subtotal,
    tax,
    service_charge: serviceCharge,
    delivery_fee: deliveryFee,
    discount: 0,
    total,
    customer_name: sanitizedName,
    customer_phone: sanitizedPhone,
    customer_whatsapp: sanitizedWhatsApp,
    customer_email: sanitizedEmail,
    delivery_address: sanitizedAddress,
    delivery_city: sanitizedCity,
    delivery_notes: sanitizedNotes,
    payment_status: 'pending' as const,
    payment_method: payment_method as any,
    created_at: now,
    updated_at: now,
  };

  db.insert('orders', order);

  for (const oi of orderItems) {
    db.insert('order_items', { ...oi, order_id: orderId });
  }

  const fullOrder = {
    ...order,
    items: orderItems,
    restaurant_name: restaurant.name,
    currency: restaurant.currency || 'PKR',
  };

  // Socket notification to Restaurant & Kitchen
  const io = (global as any).__io;
  if (io) {
    io.to(`restaurant_${restaurant_id}`).emit('order:new', fullOrder);
    io.to(`kitchen_${restaurant_id}`).emit('order:new', fullOrder);
  }

  res.status(201).json(fullOrder);
});

// POST /api/orders  (Table QR Order - server validates everything)
router.post('/orders', (req: Request, res: Response) => {
  const { restaurant_id, table_id, session_id, items, customer_name, customer_note } = req.body;

  // 1. Validate restaurant
  const restaurant = db.findById('restaurants', restaurant_id);
  if (!restaurant) { res.status(404).json({ error: 'Restaurant not found.' }); return; }
  if (restaurant.status !== 'active') { res.status(403).json({ error: 'This restaurant is currently unavailable.' }); return; }
  if (restaurant.enable_dine_in === false) { res.status(403).json({ error: 'Dine-in ordering is disabled for this restaurant.' }); return; }
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
    id: orderId,
    restaurant_id,
    order_type: 'table' as const,
    table_id,
    table_session_id: session_id,
    order_number: orderNumber,
    status: 'new' as const,
    subtotal,
    tax,
    service_charge: serviceCharge,
    delivery_fee: 0,
    discount: 0,
    total,
    customer_name: sanitizedName,
    customer_note: sanitizedNote,
    created_at: now,
    updated_at: now,
  };

  db.insert('orders', order);

  for (const oi of orderItems) {
    db.insert('order_items', { ...oi, order_id: orderId });
  }

  const fullOrder = {
    ...order,
    items: orderItems,
    table_number: table.table_number,
    restaurant_name: restaurant.name,
    currency: restaurant.currency || 'PKR',
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

  const restaurant = db.findById('restaurants', order.restaurant_id);
  const table = order.table_id ? db.findById('tables', order.table_id) : null;
  const orderItems = db.find('order_items', (oi: any) => oi.order_id === order.id);

  // Return sanitized customer tracking details (no sensitive admin keys)
  res.json({
    id: order.id,
    restaurant_id: order.restaurant_id,
    restaurant_name: restaurant?.name || '',
    restaurant_phone: restaurant?.phone || '',
    restaurant_whatsapp: restaurant?.whatsapp || '',
    currency: restaurant?.currency || 'PKR',
    order_number: order.order_number,
    order_type: order.order_type || (order.table_id ? 'table' : 'delivery'),
    status: order.status,
    table_number: table?.table_number || (order.order_type === 'delivery' ? 'Delivery' : '?'),
    table_session_id: order.table_session_id,
    customer_name: order.customer_name,
    customer_phone: order.customer_phone,
    customer_whatsapp: order.customer_whatsapp,
    delivery_address: order.delivery_address,
    delivery_city: order.delivery_city,
    delivery_notes: order.delivery_notes,
    payment_method: order.payment_method,
    payment_status: order.payment_status,
    items: orderItems,
    subtotal: order.subtotal,
    delivery_fee: order.delivery_fee || 0,
    tax: order.tax,
    service_charge: order.service_charge,
    discount: order.discount || 0,
    total: order.total,
    created_at: order.created_at,
    updated_at: order.updated_at,
  });
});

// GET /api/restaurants/:restaurantId/orders (Staff/Owner protected list)
router.get('/restaurants/:restaurantId/orders', verifyToken, requireRole('super_admin', 'restaurant_owner', 'kitchen_staff'), requireRestaurant, (req: AuthRequest, res: Response) => {
  let orders = db.find('orders', (o: any) => o.restaurant_id === req.params.restaurantId) as any[];

  // Filter parameters
  const { date_filter, from_date, to_date, status, order_type, search, start_date, end_date } = req.query;
  const now = new Date();

  if (from_date || to_date) {
    if (from_date) {
      const fromStr = `${from_date}T00:00:00.000Z`;
      orders = orders.filter((o: any) => o.created_at >= fromStr || o.created_at >= (from_date as string));
    }
    if (to_date) {
      const toStr = `${to_date}T23:59:59.999Z`;
      orders = orders.filter((o: any) => o.created_at <= toStr);
    }
  } else if (date_filter === 'today' || (!date_filter && !start_date)) {
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

  if (order_type && order_type !== 'all') {
    orders = orders.filter((o: any) => {
      const type = o.order_type || (o.table_id ? 'table' : 'delivery');
      return type === order_type;
    });
  }

  if (search) {
    const s = (search as string).toLowerCase();
    orders = orders.filter((o: any) =>
      o.order_number.toLowerCase().includes(s) ||
      (o.customer_name && o.customer_name.toLowerCase().includes(s)) ||
      (o.customer_phone && o.customer_phone.toLowerCase().includes(s))
    );
  }

  orders.sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  const result = orders.map((o: any) => {
    const table = o.table_id ? db.findById('tables', o.table_id) : null;
    const orderItems = db.find('order_items', (oi: any) => oi.order_id === o.id);
    return {
      ...o,
      order_type: o.order_type || (o.table_id ? 'table' : 'delivery'),
      table_number: table?.table_number || (o.order_type === 'delivery' ? 'Delivery' : '?'),
      items: orderItems,
    };
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
    ready: todayOrders.filter((o: any) => o.status === 'ready' || o.status === 'out_for_delivery').length,
    completed: todayOrders.filter((o: any) => o.status === 'completed' || o.status === 'delivered').length,
    cancelled: todayOrders.filter((o: any) => o.status === 'cancelled').length,
    revenue: todayOrders.filter((o: any) => o.status === 'completed' || o.status === 'delivered').reduce((s: number, o: any) => s + o.total, 0),
    online_count: todayOrders.filter((o: any) => o.order_type === 'delivery').length,
    table_count: todayOrders.filter((o: any) => o.order_type !== 'delivery').length,
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

  const table = order.table_id ? db.findById('tables', order.table_id) : null;
  const orderItems = db.find('order_items', (oi: any) => oi.order_id === order.id);
  const session = order.table_session_id ? db.findById('table_sessions', order.table_session_id) : null;

  res.json({
    ...order,
    order_type: order.order_type || (order.table_id ? 'table' : 'delivery'),
    table_number: table?.table_number || (order.order_type === 'delivery' ? 'Delivery' : '?'),
    items: orderItems,
    session,
  });
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
    cooking: ['ready', 'out_for_delivery', 'cancelled'],
    ready: ['out_for_delivery', 'completed', 'delivered'],
    out_for_delivery: ['delivered', 'completed'],
    completed: [],
    delivered: [],
    cancelled: [],
  };

  if (!validTransitions[order.status]?.includes(status)) {
    res.status(400).json({ error: `Cannot change status from ${order.status} to ${status}.` }); return;
  }

  const updated = db.update('orders', req.params.id, { status, updated_at: new Date().toISOString() });
  const table = order.table_id ? db.findById('tables', order.table_id) : null;
  const orderItems = db.find('order_items', (oi: any) => oi.order_id === order.id);

  const fullOrder = {
    ...updated,
    order_type: order.order_type || (order.table_id ? 'table' : 'delivery'),
    table_number: table?.table_number || (order.order_type === 'delivery' ? 'Delivery' : '?'),
    items: orderItems,
  };

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
    if (order.table_session_id) {
      io.to(`session_${order.table_session_id}`).emit('order:status_updated', fullOrder);
    }
  }

});

// PATCH /api/orders/:id/payment (Owner records actual payment received and approves order)
router.patch('/orders/:id/payment', verifyToken, requireRole('super_admin', 'restaurant_owner'), (req: AuthRequest, res: Response) => {
  const order = db.findById('orders', req.params.id);
  if (!order) { res.status(404).json({ error: 'Order not found.' }); return; }

  if (req.user!.role !== 'super_admin' && req.user!.restaurant_id !== order.restaurant_id) {
    res.status(403).json({ error: 'Access denied.' }); return;
  }

  const { amount_paid, payment_method, auto_complete } = req.body;
  const numPaid = parseFloat(amount_paid);

  if (isNaN(numPaid) || numPaid < 0) {
    res.status(400).json({ error: 'Please enter a valid payment amount.' });
    return;
  }

  const changeAmount = Math.max(0, numPaid - order.total);
  const now = new Date().toISOString();

  const updates: any = {
    payment_status: 'paid',
    amount_paid: numPaid,
    change_amount: changeAmount,
    payment_method: payment_method || 'cash',
    paid_at: now,
  };

  if (auto_complete || order.status === 'ready' || order.status === 'cooking' || order.status === 'accepted' || order.status === 'new' || order.status === 'out_for_delivery') {
    updates.status = order.order_type === 'delivery' ? 'delivered' : 'completed';
  }

  const updated = db.update('orders', req.params.id, updates);
  const table = order.table_id ? db.findById('tables', order.table_id) : null;
  const orderItems = db.find('order_items', (oi: any) => oi.order_id === order.id);

  const fullOrder = {
    ...updated,
    order_type: order.order_type || (order.table_id ? 'table' : 'delivery'),
    table_number: table?.table_number || (order.order_type === 'delivery' ? 'Delivery' : '?'),
    items: orderItems,
  };

  db.insert('audit_logs', {
    id: uuid(), user_id: req.user!.id, restaurant_id: order.restaurant_id,
    action: 'order_payment_recorded', entity_type: 'order', entity_id: order.id,
    metadata: JSON.stringify({ order_number: order.order_number, amount_paid: numPaid, change_amount: changeAmount, payment_method: payment_method || 'cash' }),
    created_at: now,
  });

  // Socket emit
  const io = (global as any).__io;
  if (io) {
    io.to(`restaurant_${order.restaurant_id}`).emit('order:status_updated', fullOrder);
    io.to(`kitchen_${order.restaurant_id}`).emit('order:status_updated', fullOrder);
    if (order.table_session_id) {
      io.to(`session_${order.table_session_id}`).emit('order:status_updated', fullOrder);
    }
  }

  res.json(fullOrder);
});

export default router;

