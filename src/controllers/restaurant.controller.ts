import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import { v4 as uuid } from 'uuid';
import { db } from '../db/database';
import { AuthRequest, verifyToken, requireRole } from '../middleware/auth';

const router = Router();

// GET /api/admin/dashboard
router.get('/dashboard', verifyToken, requireRole('super_admin'), (_req: AuthRequest, res: Response) => {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();

  const totalRestaurants = db.count('restaurants');
  const activeRestaurants = db.count('restaurants', (r: any) => r.status === 'active');
  const suspendedRestaurants = db.count('restaurants', (r: any) => r.status === 'suspended');
  const totalOrders = db.count('orders');
  const todayOrders = db.count('orders', (o: any) => o.created_at >= todayStart);

  const todayCompletedOrders = db.find('orders', (o: any) => o.created_at >= todayStart && o.status === 'completed') as any[];
  const todayRevenue = todayCompletedOrders.reduce((sum: number, o: any) => sum + o.total, 0);

  const activeSubscriptions = db.count('subscriptions', (s: any) => s.status === 'active');
  const expiredSubscriptions = db.count('subscriptions', (s: any) => s.status === 'expired');
  const pendingPayments = db.count('subscriptions', (s: any) => s.payment_status === 'pending' || s.payment_status === 'overdue');

  // Orders by day for last 7 days
  const ordersOverTime: { date: string; count: number; revenue: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString();
    const dayEnd = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).toISOString();
    const dayOrders = db.find('orders', (o: any) => o.created_at >= dayStart && o.created_at < dayEnd) as any[];
    const dayRevenue = dayOrders.filter((o: any) => o.status === 'completed').reduce((s: number, o: any) => s + o.total, 0);
    ordersOverTime.push({
      date: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      count: dayOrders.length,
      revenue: dayRevenue,
    });
  }

  res.json({
    totalRestaurants, activeRestaurants, suspendedRestaurants,
    totalOrders, todayOrders, todayRevenue,
    activeSubscriptions, expiredSubscriptions, pendingPayments,
    ordersOverTime,
  });
});

// GET /api/admin/restaurants
router.get('/restaurants', verifyToken, requireRole('super_admin'), (req: AuthRequest, res: Response) => {
  let restaurants = db.getAll('restaurants') as any[];
  const { status, search, subscription } = req.query;

  if (status && status !== 'all') {
    restaurants = restaurants.filter((r: any) => r.status === status);
  }
  if (subscription && subscription !== 'all') {
    restaurants = restaurants.filter((r: any) => r.subscription_status === subscription);
  }
  if (search) {
    const s = (search as string).toLowerCase();
    restaurants = restaurants.filter((r: any) =>
      r.name.toLowerCase().includes(s) || r.email.toLowerCase().includes(s) || r.city.toLowerCase().includes(s)
    );
  }

  // Attach owner info
  const result = restaurants.map((r: any) => {
    const owner = db.findOne('users', (u: any) => u.restaurant_id === r.id && u.role === 'restaurant_owner');
    return { ...r, owner: owner ? { name: owner.name, email: owner.email, phone: owner.phone } : null };
  });

  res.json(result);
});

// POST /api/admin/restaurants
router.post('/restaurants', verifyToken, requireRole('super_admin'), (req: AuthRequest, res: Response) => {
  const { restaurant, owner } = req.body;
  if (!restaurant?.name || !owner?.email || !owner?.password) {
    res.status(400).json({ error: 'Restaurant name, owner email, and password are required.' });
    return;
  }

  // Check duplicate email
  const existingUser = db.findOne('users', (u: any) => u.email === owner.email);
  if (existingUser) {
    res.status(400).json({ error: 'An account with this email already exists.' });
    return;
  }

  const now = new Date().toISOString();
  const restaurantId = uuid();
  const ownerId = uuid();
  const slug = restaurant.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

  db.insert('restaurants', {
    id: restaurantId, name: restaurant.name, slug,
    logo: restaurant.logo || '', cover_image: restaurant.cover_image || '',
    description: restaurant.description || '', phone: restaurant.phone || '',
    whatsapp: restaurant.whatsapp || '', email: restaurant.email || owner.email,
    address: restaurant.address || '', city: restaurant.city || '',
    opening_time: restaurant.opening_time || '09:00',
    closing_time: restaurant.closing_time || '23:00',
    status: 'active', is_open: true, accept_orders: true,
    tax_rate: restaurant.tax_rate || 0, service_charge_rate: restaurant.service_charge_rate || 0,
    currency: restaurant.currency || 'PKR',
    subscription_status: restaurant.subscription_status || 'active',
    subscription_expiry: restaurant.subscription_expiry || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    created_at: now, updated_at: now,
  });

  db.insert('users', {
    id: ownerId, name: owner.name || 'Restaurant Owner', email: owner.email,
    phone: owner.phone || '', password_hash: bcrypt.hashSync(owner.password, 10),
    role: 'restaurant_owner', status: 'active', restaurant_id: restaurantId,
    created_at: now, updated_at: now,
  });

  db.insert('subscriptions', {
    id: uuid(), restaurant_id: restaurantId, plan: restaurant.plan || 'Standard',
    status: restaurant.subscription_status || 'active',
    start_date: now,
    expiry_date: restaurant.subscription_expiry || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    amount: restaurant.subscription_amount || 3000,
    payment_status: 'paid', created_at: now,
  });

  db.insert('audit_logs', {
    id: uuid(), user_id: req.user!.id, restaurant_id: restaurantId,
    action: 'restaurant_created', entity_type: 'restaurant', entity_id: restaurantId,
    metadata: JSON.stringify({ name: restaurant.name }), created_at: now,
  });

  res.status(201).json({ id: restaurantId, message: 'Restaurant and owner account created successfully.' });
});

// GET /api/admin/restaurants/:id
router.get('/restaurants/:id', verifyToken, requireRole('super_admin'), (req: AuthRequest, res: Response) => {
  const restaurant = db.findById('restaurants', req.params.id);
  if (!restaurant) {
    res.status(404).json({ error: 'Restaurant not found.' });
    return;
  }
  const owner = db.findOne('users', (u: any) => u.restaurant_id === restaurant.id && u.role === 'restaurant_owner');
  const subscription = db.findOne('subscriptions', (s: any) => s.restaurant_id === restaurant.id);
  const totalOrders = db.count('orders', (o: any) => o.restaurant_id === restaurant.id);
  const completedOrders = db.find('orders', (o: any) => o.restaurant_id === restaurant.id && o.status === 'completed') as any[];
  const totalRevenue = completedOrders.reduce((s: number, o: any) => s + o.total, 0);
  const totalTables = db.count('tables', (t: any) => t.restaurant_id === restaurant.id);
  const totalItems = db.count('menu_items', (i: any) => i.restaurant_id === restaurant.id);

  res.json({
    ...restaurant,
    owner: owner ? { id: owner.id, name: owner.name, email: owner.email, phone: owner.phone } : null,
    subscription,
    stats: { totalOrders, totalRevenue, totalTables, totalItems },
  });
});

// PATCH /api/admin/restaurants/:id
router.patch('/restaurants/:id', verifyToken, requireRole('super_admin'), (req: AuthRequest, res: Response) => {
  const restaurant = db.findById('restaurants', req.params.id);
  if (!restaurant) {
    res.status(404).json({ error: 'Restaurant not found.' });
    return;
  }

  const updates = req.body;
  const updated = db.update('restaurants', req.params.id, updates);

  db.insert('audit_logs', {
    id: uuid(), user_id: req.user!.id, restaurant_id: req.params.id,
    action: 'restaurant_updated', entity_type: 'restaurant', entity_id: req.params.id,
    metadata: JSON.stringify(updates), created_at: new Date().toISOString(),
  });

  res.json(updated);
});

// PATCH /api/admin/restaurants/:id/status
router.patch('/restaurants/:id/status', verifyToken, requireRole('super_admin'), (req: AuthRequest, res: Response) => {
  const restaurant = db.findById('restaurants', req.params.id);
  if (!restaurant) {
    res.status(404).json({ error: 'Restaurant not found.' });
    return;
  }

  const { status } = req.body;
  if (!['active', 'inactive', 'suspended'].includes(status)) {
    res.status(400).json({ error: 'Invalid status. Must be active, inactive, or suspended.' });
    return;
  }

  db.update('restaurants', req.params.id, { status });

  db.insert('audit_logs', {
    id: uuid(), user_id: req.user!.id, restaurant_id: req.params.id,
    action: `restaurant_${status}`, entity_type: 'restaurant', entity_id: req.params.id,
    metadata: JSON.stringify({ previous_status: restaurant.status, new_status: status }),
    created_at: new Date().toISOString(),
  });

  res.json({ message: `Restaurant ${status} successfully.` });
});

// DELETE /api/admin/restaurants/:id
router.delete('/restaurants/:id', verifyToken, requireRole('super_admin'), (req: AuthRequest, res: Response) => {
  const restaurant = db.findById('restaurants', req.params.id);
  if (!restaurant) {
    res.status(404).json({ error: 'Restaurant not found.' });
    return;
  }

  // Soft delete - just set inactive
  db.update('restaurants', req.params.id, { status: 'inactive' });

  db.insert('audit_logs', {
    id: uuid(), user_id: req.user!.id, restaurant_id: req.params.id,
    action: 'restaurant_deleted', entity_type: 'restaurant', entity_id: req.params.id,
    metadata: JSON.stringify({ name: restaurant.name }), created_at: new Date().toISOString(),
  });

  res.json({ message: 'Restaurant deactivated successfully.' });
});

// GET /api/admin/audit-logs
router.get('/audit-logs', verifyToken, requireRole('super_admin'), (req: AuthRequest, res: Response) => {
  let logs = db.getAll('audit_logs') as any[];
  logs.sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 50;
  const start = (page - 1) * limit;

  res.json({
    logs: logs.slice(start, start + limit),
    total: logs.length,
    page, limit,
  });
});

// GET /api/admin/subscriptions
router.get('/subscriptions', verifyToken, requireRole('super_admin'), (req: AuthRequest, res: Response) => {
  const subs = db.getAll('subscriptions') as any[];
  const result = subs.map((s: any) => {
    const restaurant = db.findById('restaurants', s.restaurant_id);
    return { ...s, restaurant_name: restaurant?.name || 'Unknown' };
  });
  res.json(result);
});

// PATCH /api/admin/subscriptions/:id
router.patch('/subscriptions/:id', verifyToken, requireRole('super_admin'), (req: AuthRequest, res: Response) => {
  const sub = db.findById('subscriptions', req.params.id);
  if (!sub) {
    res.status(404).json({ error: 'Subscription not found.' });
    return;
  }
  const updated = db.update('subscriptions', req.params.id, req.body);

  // Update restaurant subscription status if changed
  if (req.body.status) {
    db.update('restaurants', sub.restaurant_id, { subscription_status: req.body.status });
  }

  res.json(updated);
});

export default router;
