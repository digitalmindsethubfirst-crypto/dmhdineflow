import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import { v4 as uuid } from 'uuid';
import { db } from '../db/database';
import { AuthRequest, verifyToken, requireRole, requireRestaurant } from '../middleware/auth';
import { upload } from '../middleware/upload';

const router = Router();

// GET /api/restaurants/:restaurantId/settings
router.get('/restaurants/:restaurantId/settings', verifyToken, requireRestaurant, (req: AuthRequest, res: Response) => {
  const restaurant = db.findById('restaurants', req.params.restaurantId);
  if (!restaurant) {
    res.status(404).json({ error: 'Restaurant not found.' });
    return;
  }

  const owner = db.findOne('users', (u: any) => u.restaurant_id === restaurant.id && u.role === 'restaurant_owner');
  const subscription = db.findOne('subscriptions', (s: any) => s.restaurant_id === restaurant.id);

  res.json({
    restaurant,
    owner: owner ? { id: owner.id, name: owner.name, email: owner.email, phone: owner.phone } : null,
    subscription,
  });
});

// PATCH /api/restaurants/:restaurantId/settings
router.patch('/restaurants/:restaurantId/settings', verifyToken, requireRole('super_admin', 'restaurant_owner'), requireRestaurant, upload.fields([{ name: 'logo', maxCount: 1 }, { name: 'cover_image', maxCount: 1 }]), (req: AuthRequest, res: Response) => {
  const restaurant = db.findById('restaurants', req.params.restaurantId);
  if (!restaurant) {
    res.status(404).json({ error: 'Restaurant not found.' });
    return;
  }

  const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
  const updates: any = {};

  if (req.body.name) updates.name = req.body.name;
  if (req.body.description !== undefined) updates.description = req.body.description;
  if (req.body.phone !== undefined) updates.phone = req.body.phone;
  if (req.body.whatsapp !== undefined) updates.whatsapp = req.body.whatsapp;
  if (req.body.email !== undefined) updates.email = req.body.email;
  if (req.body.address !== undefined) updates.address = req.body.address;
  if (req.body.city !== undefined) updates.city = req.body.city;
  if (req.body.opening_time !== undefined) updates.opening_time = req.body.opening_time;
  if (req.body.closing_time !== undefined) updates.closing_time = req.body.closing_time;
  if (req.body.is_open !== undefined) updates.is_open = req.body.is_open === true || req.body.is_open === 'true';
  if (req.body.accept_orders !== undefined) updates.accept_orders = req.body.accept_orders === true || req.body.accept_orders === 'true';
  if (req.body.enable_delivery !== undefined) updates.enable_delivery = req.body.enable_delivery === true || req.body.enable_delivery === 'true';
  if (req.body.delivery_fee !== undefined) updates.delivery_fee = parseFloat(req.body.delivery_fee) || 0;
  if (req.body.min_order_amount !== undefined) updates.min_order_amount = parseFloat(req.body.min_order_amount) || 0;
  if (req.body.estimated_delivery_time !== undefined) updates.estimated_delivery_time = req.body.estimated_delivery_time;
  if (req.body.bank_details !== undefined) updates.bank_details = req.body.bank_details;
  if (req.body.payment_methods) {
    try {
      updates.payment_methods = typeof req.body.payment_methods === 'string' ? JSON.parse(req.body.payment_methods) : req.body.payment_methods;
    } catch {
      updates.payment_methods = ['cod', 'bank_transfer', 'easypaisa', 'jazzcash'];
    }
  }
  if (req.body.tax_rate !== undefined) updates.tax_rate = parseFloat(req.body.tax_rate) || 0;
  if (req.body.service_charge_rate !== undefined) updates.service_charge_rate = parseFloat(req.body.service_charge_rate) || 0;
  if (req.body.currency !== undefined) updates.currency = req.body.currency;

  if (files?.logo?.[0]) {
    updates.logo = `/uploads/${files.logo[0].filename}`;
  } else if (req.body.delete_logo === 'true' || req.body.delete_logo === true) {
    updates.logo = '';
  }
  if (files?.cover_image?.[0]) updates.cover_image = `/uploads/${files.cover_image[0].filename}`;

  const updatedRestaurant = db.update('restaurants', req.params.restaurantId, updates);

  // Update owner profile if requested
  if (req.body.owner_name || req.body.owner_phone || req.body.new_password) {
    const owner = db.findOne('users', (u: any) => u.restaurant_id === restaurant.id && u.role === 'restaurant_owner');
    if (owner) {
      const userUpdates: any = {};
      if (req.body.owner_name) userUpdates.name = req.body.owner_name;
      if (req.body.owner_phone) userUpdates.phone = req.body.owner_phone;
      if (req.body.new_password) {
        if (req.body.current_password && !bcrypt.compareSync(req.body.current_password, owner.password_hash)) {
          res.status(400).json({ error: 'Current password is incorrect.' });
          return;
        }
        userUpdates.password_hash = bcrypt.hashSync(req.body.new_password, 10);
      }
      db.update('users', owner.id, userUpdates);
    }
  }

  db.insert('audit_logs', {
    id: uuid(),
    user_id: req.user!.id,
    restaurant_id: req.params.restaurantId,
    action: 'restaurant_settings_updated',
    entity_type: 'restaurant',
    entity_id: req.params.restaurantId,
    metadata: JSON.stringify(updates),
    created_at: new Date().toISOString(),
  });

// GET /api/admin/settings/profile (Super Admin Profile Info)
router.get('/admin/settings/profile', verifyToken, requireRole('super_admin'), (req: AuthRequest, res: Response) => {
  const user = db.findById('users', req.user!.id);
  if (!user) {
    res.status(404).json({ error: 'Super Admin user not found.' });
    return;
  }

  // Get super admin platform branding / logo if set in admin profile
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
router.patch('/admin/settings/profile', verifyToken, requireRole('super_admin'), upload.single('logo'), (req: AuthRequest, res: Response) => {
  const user = db.findById('users', req.user!.id);
  if (!user) {
    res.status(404).json({ error: 'Super Admin user not found.' });
    return;
  }

  const { name, email, phone } = req.body;
  const updates: any = {};

  if (name && name.trim()) {
    updates.name = name.trim();
  }
  if (phone !== undefined) {
    updates.phone = phone.trim();
  }

  if (email && email.trim().toLowerCase() !== user.email.toLowerCase()) {
    const cleanEmail = email.trim().toLowerCase();
    const existing = db.findOne('users', (u: any) => u.email.toLowerCase() === cleanEmail && u.id !== user.id);
    if (existing) {
      res.status(400).json({ error: 'An account with this email already exists.' });
      return;
    }
    updates.email = cleanEmail;
  }

  if (req.file) {
    updates.logo = `/uploads/${req.file.filename}`;
  } else if (req.body.logo_url) {
    updates.logo = req.body.logo_url;
  }

  const updatedUser = db.update('users', user.id, updates);
  db.forceSave();

  res.json({
    message: 'Profile settings updated successfully.',
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
router.patch('/admin/settings/password', verifyToken, requireRole('super_admin'), (req: AuthRequest, res: Response) => {
  const user = db.findById('users', req.user!.id);
  if (!user) {
    res.status(404).json({ error: 'Super Admin user not found.' });
    return;
  }

  const { current_password, new_password, confirm_password } = req.body;

  if (!current_password || !new_password) {
    res.status(400).json({ error: 'Current password and new password are required.' });
    return;
  }

  if (new_password.length < 6) {
    res.status(400).json({ error: 'New password must be at least 6 characters long.' });
    return;
  }

  if (confirm_password && new_password !== confirm_password) {
    res.status(400).json({ error: 'New password and confirmation do not match.' });
    return;
  }

  if (!bcrypt.compareSync(current_password, user.password_hash)) {
    res.status(400).json({ error: 'Current password is incorrect.' });
    return;
  }

  const newHash = bcrypt.hashSync(new_password, 10);
  db.update('users', user.id, { password_hash: newHash });
  db.forceSave();

  res.json({ message: 'Password changed successfully.' });
});

export default router;
