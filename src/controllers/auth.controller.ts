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

export default router;
