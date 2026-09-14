import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import path from 'path';
import fs from 'fs';
import { v4 as uuid } from 'uuid';
import { db } from '../db/database';
import { AuthRequest, verifyToken, requireRole } from '../middleware/auth';
import { config } from '../config/env';
import { checkAndUpdateSubscription, renewMonthlySubscription } from '../services/subscription.service';

const router = Router();

// Helper to reliably find Super Admin user
function resolveSuperAdminUser(req: AuthRequest) {
  if (req.user?.id) {
    const byId = db.findById('users', req.user.id);
    if (byId) return byId;
  }
  if (req.user?.email) {
    const byEmail = db.findOne('users', (u: any) => (u.email || '').toLowerCase() === req.user!.email.toLowerCase());
    if (byEmail) return byEmail;
  }
  return db.findOne('users', (u: any) => u.role === 'super_admin');
}

// GET /api/admin/dashboard (Platform SaaS Metrics - Zero Restaurant Revenue Exposure for Privacy)
router.get('/dashboard', verifyToken, requireRole('super_admin'), (_req: AuthRequest, res: Response) => {
  const now = new Date();

  const totalRestaurants = db.count('restaurants');
  const activeRestaurants = db.count('restaurants', (r: any) => r.status === 'active');
  const suspendedRestaurants = db.count('restaurants', (r: any) => r.status === 'suspended');

  const activeSubscriptions = db.count('subscriptions', (s: any) => s.status === 'active');
  const expiredSubscriptions = db.count('subscriptions', (s: any) => s.status === 'expired');
  const pendingPayments = db.count('subscriptions', (s: any) => s.payment_status === 'pending' || s.payment_status === 'overdue');

  // Platform SaaS Subscription Fees collected from restaurant software licenses
  const allPaidSubscriptions = db.find('subscriptions', (s: any) => s.payment_status === 'paid') as any[];
  const monthlySaaSBilling = allPaidSubscriptions.reduce((sum: number, s: any) => sum + (s.amount || 0), 0);

  // Tenant registrations growth over time (last 7 days)
  const tenantsOverTime: { date: string; count: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString();
    const dayEnd = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).toISOString();
    const dayTenants = db.find('restaurants', (r: any) => r.created_at >= dayStart && r.created_at < dayEnd) as any[];
    tenantsOverTime.push({
      date: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      count: dayTenants.length,
    });
  }

  res.json({
    totalRestaurants,
    activeRestaurants,
    suspendedRestaurants,
    activeSubscriptions,
    expiredSubscriptions,
    pendingPayments,
    monthlySaaSBilling,
    tenantsOverTime,
  });
});

// GET /api/admin/restaurants
router.get('/restaurants', verifyToken, requireRole('super_admin'), (req: AuthRequest, res: Response) => {
  let restaurants = db.getAll('restaurants') as any[];
  const { status, search, subscription, from_date, to_date } = req.query;

  if (status && status !== 'all') {
    restaurants = restaurants.filter((r: any) => r.status === status);
  }
  if (subscription && subscription !== 'all') {
    restaurants = restaurants.filter((r: any) => r.subscription_status === subscription);
  }
  if (from_date) {
    const fromStr = `${from_date}T00:00:00.000Z`;
    restaurants = restaurants.filter((r: any) => r.created_at >= fromStr || r.created_at >= (from_date as string));
  }
  if (to_date) {
    const toStr = `${to_date}T23:59:59.999Z`;
    restaurants = restaurants.filter((r: any) => r.created_at <= toStr);
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
    return {
      ...r,
      enable_dine_in: r.enable_dine_in !== false,
      enable_online_ordering: r.enable_online_ordering !== false,
      owner: owner ? { name: owner.name, email: owner.email, phone: owner.phone } : null,
    };
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

  const packagePlan = restaurant.package_plan || restaurant.plan || 'pro';
  // Package-based default: Starter has dine-in only; Pro/Enterprise has both online & dine-in
  const defaultOnlineOrdering = restaurant.enable_online_ordering !== undefined
    ? Boolean(restaurant.enable_online_ordering)
    : packagePlan !== 'starter';

  db.insert('restaurants', {
    id: restaurantId, name: restaurant.name, slug,
    logo: restaurant.logo || '', cover_image: restaurant.cover_image || '',
    description: restaurant.description || '', phone: restaurant.phone || '',
    whatsapp: restaurant.whatsapp || '', email: restaurant.email || owner.email,
    address: restaurant.address || '', city: restaurant.city || '',
    opening_time: restaurant.opening_time || '09:00',
    closing_time: restaurant.closing_time || '23:00',
    status: 'active', is_open: true, accept_orders: true,
    // Super Admin Access Controls
    enable_dine_in: restaurant.enable_dine_in !== undefined ? Boolean(restaurant.enable_dine_in) : true,
    enable_online_ordering: defaultOnlineOrdering,
    package_plan: packagePlan,
    enable_delivery: defaultOnlineOrdering,
    delivery_fee: restaurant.delivery_fee || 150,
    min_order_amount: restaurant.min_order_amount || 500,
    estimated_delivery_time: restaurant.estimated_delivery_time || '25-35 mins',
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
    id: uuid(), restaurant_id: restaurantId, plan: packagePlan,
    status: restaurant.subscription_status || 'active',
    start_date: now,
    expiry_date: restaurant.subscription_expiry || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    amount: restaurant.subscription_amount || 3000,
    payment_status: 'paid', created_at: now,
  });

  db.insert('audit_logs', {
    id: uuid(), user_id: req.user!.id, restaurant_id: restaurantId,
    action: 'restaurant_created', entity_type: 'restaurant', entity_id: restaurantId,
    metadata: JSON.stringify({ name: restaurant.name, package_plan: packagePlan }), created_at: now,
  });

  res.status(201).json({ id: restaurantId, message: 'Restaurant and owner account created successfully.' });
});

// GET /api/admin/restaurants/:id (Privacy-Protected: No Customer Sales/Revenue Data)
router.get('/restaurants/:id', verifyToken, requireRole('super_admin'), (req: AuthRequest, res: Response) => {
  const restaurant = db.findById('restaurants', req.params.id);
  if (!restaurant) {
    res.status(404).json({ error: 'Restaurant not found.' });
    return;
  }
  const owner = db.findOne('users', (u: any) => u.restaurant_id === restaurant.id && u.role === 'restaurant_owner');
  const subscription = db.findOne('subscriptions', (s: any) => s.restaurant_id === restaurant.id);
  const totalTables = db.count('tables', (t: any) => t.restaurant_id === restaurant.id);
  const totalItems = db.count('menu_items', (i: any) => i.restaurant_id === restaurant.id);

  res.json({
    ...restaurant,
    owner: owner ? { id: owner.id, name: owner.name, email: owner.email, phone: owner.phone } : null,
    subscription,
    stats: { totalTables, totalItems },
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
  db.forceSave();

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
  db.forceSave();

  db.insert('audit_logs', {
    id: uuid(), user_id: req.user!.id, restaurant_id: req.params.id,
    action: `restaurant_${status}`, entity_type: 'restaurant', entity_id: req.params.id,
    metadata: JSON.stringify({ previous_status: restaurant.status, new_status: status }),
    created_at: new Date().toISOString(),
  });

  res.json({ message: `Restaurant ${status} successfully.` });
});

// DELETE /api/admin/restaurants/:id (Complete cascade delete of restaurant and all associated data)
router.delete('/restaurants/:id', verifyToken, requireRole('super_admin'), (req: AuthRequest, res: Response) => {
  const restaurantId = req.params.id;
  const restaurant = db.findById('restaurants', restaurantId);
  if (!restaurant) {
    res.status(404).json({ error: 'Restaurant not found.' });
    return;
  }

  // 1. Collect all associated file paths for cleanup
  const filesToDelete: string[] = [];
  if (restaurant.logo) filesToDelete.push(restaurant.logo);
  if (restaurant.cover_image) filesToDelete.push(restaurant.cover_image);

  // Categories
  const categories = db.find('categories', (c: any) => c.restaurant_id === restaurantId);
  categories.forEach((c: any) => {
    if (c.image) filesToDelete.push(c.image);
  });

  // Menu items & item variants
  const menuItems = db.find('menu_items', (m: any) => m.restaurant_id === restaurantId);
  const menuItemIds = menuItems.map((m: any) => m.id);
  menuItems.forEach((m: any) => {
    if (m.image) filesToDelete.push(m.image);
  });

  // Orders & order items
  const orders = db.find('orders', (o: any) => o.restaurant_id === restaurantId);
  const orderIds = orders.map((o: any) => o.id);

  // Payments
  const payments = db.find('payments', (p: any) => p.restaurant_id === restaurantId);
  payments.forEach((p: any) => {
    if (p.screenshot_url) filesToDelete.push(p.screenshot_url);
  });

  // 2. Delete physical files from disk
  const uploadDir = path.resolve(config.uploadDir);
  filesToDelete.forEach((fileRelPath) => {
    try {
      const filename = path.basename(fileRelPath);
      const fullPath = path.join(uploadDir, filename);
      if (fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath);
      }
    } catch (err) {
      console.warn('Could not delete file during restaurant purge:', fileRelPath, err);
    }
  });

  // 3. Cascade delete all database records
  db.deleteWhere('order_items', (oi: any) => orderIds.includes(oi.order_id));
  db.deleteWhere('orders', (o: any) => o.restaurant_id === restaurantId);
  db.deleteWhere('table_sessions', (ts: any) => ts.restaurant_id === restaurantId);
  db.deleteWhere('tables', (t: any) => t.restaurant_id === restaurantId);
  db.deleteWhere('item_variants', (iv: any) => menuItemIds.includes(iv.item_id));
  db.deleteWhere('menu_items', (m: any) => m.restaurant_id === restaurantId);
  db.deleteWhere('categories', (c: any) => c.restaurant_id === restaurantId);
  db.deleteWhere('payments', (p: any) => p.restaurant_id === restaurantId);
  db.deleteWhere('subscriptions', (s: any) => s.restaurant_id === restaurantId);
  db.deleteWhere('users', (u: any) => u.restaurant_id === restaurantId);
  db.delete('restaurants', restaurantId);

  db.insert('audit_logs', {
    id: uuid(),
    user_id: req.user!.id,
    restaurant_id: restaurantId,
    action: 'restaurant_completely_deleted',
    entity_type: 'restaurant',
    entity_id: restaurantId,
    metadata: JSON.stringify({ name: restaurant.name, deleted_at: new Date().toISOString() }),
    created_at: new Date().toISOString(),
  });

  db.forceSave();

  res.json({ message: `Restaurant "${restaurant.name}" and all associated data permanently deleted.` });
});

// GET /api/admin/audit-logs
router.get('/audit-logs', verifyToken, requireRole('super_admin'), (req: AuthRequest, res: Response) => {
  let logs = db.getAll('audit_logs') as any[];

  const { from_date, to_date } = req.query;
  if (from_date) {
    const from = new Date(from_date as string);
    logs = logs.filter((l: any) => new Date(l.created_at) >= from);
  }
  if (to_date) {
    const to = new Date(to_date as string);
    to.setHours(23, 59, 59, 999);
    logs = logs.filter((l: any) => new Date(l.created_at) <= to);
  }

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

// GET /api/admin/subscriptions (Dynamic Monthly Subscription Management)
router.get('/subscriptions', verifyToken, requireRole('super_admin'), (req: AuthRequest, res: Response) => {
  const subs = db.getAll('subscriptions') as any[];
  const now = new Date();

  const result = subs.map((s: any) => {
    const restaurant = db.findById('restaurants', s.restaurant_id);
    const subCheck = checkAndUpdateSubscription(s.restaurant_id);
    const expiryDate = s.expiry_date ? new Date(s.expiry_date) : (restaurant?.subscription_expiry ? new Date(restaurant.subscription_expiry) : new Date(0));
    const daysRemaining = Math.ceil((expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

    return {
      ...s,
      status: subCheck.status,
      expiry_date: restaurant?.subscription_expiry || s.expiry_date,
      restaurant_name: restaurant?.name || 'Unknown',
      restaurant_slug: restaurant?.slug || '',
      restaurant_status: restaurant?.status || 'inactive',
      days_remaining: daysRemaining,
      is_expired: now > expiryDate || subCheck.isDue,
    };
  });

  res.json(result);
});

// POST /api/admin/subscriptions/:id/renew (Renew / Extend Monthly Subscription by 1 Month)
router.post('/subscriptions/:id/renew', verifyToken, requireRole('super_admin'), (req: AuthRequest, res: Response) => {
  const sub = db.findById('subscriptions', req.params.id);
  if (!sub) {
    res.status(404).json({ error: 'Subscription not found.' });
    return;
  }

  const renewed = renewMonthlySubscription(sub.restaurant_id, req.body.amount);
  res.json({ message: 'Subscription successfully renewed for 1 Month (+30 Days).', ...renewed });
});

// POST /api/admin/restaurants/:id/renew-subscription (Direct Restaurant Subscription Renewal)
router.post('/restaurants/:id/renew-subscription', verifyToken, requireRole('super_admin'), (req: AuthRequest, res: Response) => {
  const restaurantId = req.params.id;
  const restaurant = db.findById('restaurants', restaurantId);
  if (!restaurant) {
    res.status(404).json({ error: 'Restaurant not found.' });
    return;
  }

  const renewed = renewMonthlySubscription(restaurantId, req.body.amount);
  res.json({ message: `Subscription for "${restaurant.name}" renewed for 1 Month (+30 Days).`, ...renewed });
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
  if (req.body.expiry_date) {
    db.update('restaurants', sub.restaurant_id, { subscription_expiry: req.body.expiry_date });
  }
  db.forceSave();

  res.json(updated);
});

// GET /api/admin/settings/profile (Super Admin Profile Info)
router.get('/settings/profile', verifyToken, requireRole('super_admin'), (req: AuthRequest, res: Response) => {
  const user = resolveSuperAdminUser(req);
  if (!user) {
    res.status(404).json({ error: 'Super Admin user not found.' });
    return;
  }

  res.json({
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone || '',
    role: user.role,
    logo: (user as any).logo || '/dmh-logo.png',
  });
});

// PATCH /api/admin/settings/profile (Update Super Admin Profile & Platform Logo)
router.patch('/settings/profile', verifyToken, requireRole('super_admin'), (req: AuthRequest, res: Response) => {
  const user = resolveSuperAdminUser(req);
  if (!user) {
    res.status(404).json({ error: 'Super Admin user not found.' });
    return;
  }

  const { name, email, phone, logo_url } = req.body;
  const updates: any = {};

  if (name && typeof name === 'string' && name.trim()) {
    updates.name = name.trim();
  }
  if (phone !== undefined) {
    updates.phone = typeof phone === 'string' ? phone.trim() : '';
  }

  if (email && typeof email === 'string' && email.trim()) {
    const cleanEmail = email.trim().toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(cleanEmail)) {
      res.status(400).json({ error: 'Please enter a valid email address.' });
      return;
    }

    if (cleanEmail !== (user.email || '').toLowerCase()) {
      const existing = db.findOne('users', (u: any) => (u.email || '').toLowerCase() === cleanEmail && u.id !== user.id);
      if (existing) {
        res.status(400).json({ error: 'An account with this email already exists.' });
        return;
      }
      updates.email = cleanEmail;
    }
  }

  if (logo_url) {
    updates.logo = logo_url;
  }

  const updatedUser = db.update('users', user.id, updates);
  db.forceSave();

  // Generate fresh token with updated credentials
  const token = jwt.sign(
    {
      id: updatedUser.id,
      email: updatedUser.email,
      role: updatedUser.role,
      name: updatedUser.name,
    },
    config.jwtSecret,
    { expiresIn: '24h' }
  );

  res.json({
    message: 'Profile settings updated successfully.',
    token,
    user: {
      id: updatedUser.id,
      name: updatedUser.name,
      email: updatedUser.email,
      phone: updatedUser.phone,
      role: updatedUser.role,
      logo: updatedUser.logo || '/dmh-logo.png',
    },
  });
});

// PATCH /api/admin/settings/password (Update Super Admin Password)
router.patch('/settings/password', verifyToken, requireRole('super_admin'), (req: AuthRequest, res: Response) => {
  const user = resolveSuperAdminUser(req);
  if (!user) {
    res.status(404).json({ error: 'Super Admin user not found.' });
    return;
  }

  const { current_password, new_password, confirm_password } = req.body;

  if (!current_password || !new_password) {
    res.status(400).json({ error: 'Current password and new password are required.' });
    return;
  }

  const cleanCurrent = String(current_password).trim();
  const cleanNew = String(new_password).trim();
  const cleanConfirm = confirm_password ? String(confirm_password).trim() : '';

  if (cleanNew.length < 6) {
    res.status(400).json({ error: 'New password must be at least 6 characters long.' });
    return;
  }

  if (cleanConfirm && cleanNew !== cleanConfirm) {
    res.status(400).json({ error: 'New password and confirmation do not match.' });
    return;
  }

  // Check current password (try both raw and trimmed)
  const isMatch = bcrypt.compareSync(current_password, user.password_hash) || bcrypt.compareSync(cleanCurrent, user.password_hash);
  if (!isMatch) {
    res.status(400).json({ error: 'Current password is incorrect. Please check and try again.' });
    return;
  }

  const newHash = bcrypt.hashSync(cleanNew, 10);
  const updatedUser = db.update('users', user.id, { password_hash: newHash });
  db.forceSave();

  // Generate fresh token
  const token = jwt.sign(
    {
      id: updatedUser.id,
      email: updatedUser.email,
      role: updatedUser.role,
      name: updatedUser.name,
    },
    config.jwtSecret,
    { expiresIn: '24h' }
  );

  res.json({
    message: 'Password changed successfully.',
    token,
  });
});

export default router;
