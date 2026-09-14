import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from '../config/env';
import { db } from '../db/database';
import { AuthRequest, verifyToken } from '../middleware/auth';
import { checkAndUpdateSubscription } from '../services/subscription.service';

const router = Router();

// POST /api/auth/login
router.post('/login', (req: Request, res: Response) => {
  const { email, password } = req.body;
  if (!email || !password) {
    res.status(400).json({ error: 'Email and password are required.' });
    return;
  }

  const cleanEmail = (email || '').trim().toLowerCase();
  const user = db.findOne('users', (u: any) => (u.email || '').toLowerCase() === cleanEmail);
  if (!user) {
    res.status(401).json({ error: 'Invalid email or password.' });
    return;
  }

  if (!bcrypt.compareSync(password, user.password_hash)) {
    res.status(401).json({ error: 'Invalid email or password.' });
    return;
  }

  if (user.status !== 'active') {
    res.status(403).json({ error: 'Your account is inactive. Please contact administration.' });
    return;
  }

  // Automatic Monthly Subscription & Expiry Check for Restaurant Staff/Owners
  if (user.restaurant_id && (user.role === 'restaurant_owner' || user.role === 'kitchen_staff')) {
    const subCheck = checkAndUpdateSubscription(user.restaurant_id);
    if (subCheck.isDue) {
      res.status(403).json({
        error: 'Your subscription payment is due. Please contact the administrator to renew your subscription.',
        code: 'SUBSCRIPTION_PAYMENT_DUE',
        status: subCheck.status,
        expiry: subCheck.expiryDate,
      });
      return;
    }
  }

  const token = jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role,
      restaurant_id: user.restaurant_id,
      name: user.name,
    },
    config.jwtSecret,
    { expiresIn: '24h' }
  );

  const restaurant = user.restaurant_id ? db.findById('restaurants', user.restaurant_id) : null;

  res.json({
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
      restaurant_id: user.restaurant_id,
      restaurant_name: restaurant?.name,
      restaurant_logo: restaurant?.logo,
    },
  });
});

// GET /api/auth/me
router.get('/me', verifyToken, (req: AuthRequest, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: 'Not authenticated.' });
    return;
  }
  const user = db.findById('users', req.user.id);
  if (!user) {
    res.status(404).json({ error: 'User not found.' });
    return;
  }
  const restaurant = user.restaurant_id ? db.findById('restaurants', user.restaurant_id) : null;
  res.json({
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role,
    restaurant_id: user.restaurant_id,
    restaurant_name: restaurant?.name,
    restaurant_logo: restaurant?.logo,
  });
});

// PATCH /api/auth/profile
router.patch('/profile', verifyToken, (req: AuthRequest, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: 'Not authenticated.' });
    return;
  }
  const user = db.findById('users', req.user.id) || (req.user.email ? db.findOne('users', (u: any) => (u.email || '').toLowerCase() === req.user!.email.toLowerCase()) : null);
  if (!user) {
    res.status(404).json({ error: 'User not found.' });
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

  const token = jwt.sign(
    {
      id: updatedUser.id,
      email: updatedUser.email,
      role: updatedUser.role,
      restaurant_id: updatedUser.restaurant_id,
      name: updatedUser.name,
    },
    config.jwtSecret,
    { expiresIn: '24h' }
  );

  res.json({
    message: 'Profile updated successfully.',
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

// PATCH /api/auth/password
router.patch('/password', verifyToken, (req: AuthRequest, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: 'Not authenticated.' });
    return;
  }
  const user = db.findById('users', req.user.id) || (req.user.email ? db.findOne('users', (u: any) => (u.email || '').toLowerCase() === req.user!.email.toLowerCase()) : null);
  if (!user) {
    res.status(404).json({ error: 'User not found.' });
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

  const isMatch = bcrypt.compareSync(current_password, user.password_hash) || bcrypt.compareSync(cleanCurrent, user.password_hash);
  if (!isMatch) {
    res.status(400).json({ error: 'Current password is incorrect. Please check and try again.' });
    return;
  }

  const newHash = bcrypt.hashSync(cleanNew, 10);
  const updatedUser = db.update('users', user.id, { password_hash: newHash });
  db.forceSave();

  const token = jwt.sign(
    {
      id: updatedUser.id,
      email: updatedUser.email,
      role: updatedUser.role,
      restaurant_id: updatedUser.restaurant_id,
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
