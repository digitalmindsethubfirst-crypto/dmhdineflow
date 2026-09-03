import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config/env';
import { db, User } from '../db/database';

export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
    role: string;
    restaurant_id?: string;
    name: string;
  };
}

export function verifyToken(req: AuthRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Access denied. No token provided.' });
    return;
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, config.jwtSecret) as any;
    req.user = decoded;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token.' });
  }
}

export function requireRole(...roles: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: 'You do not have permission to access this resource.' });
      return;
    }
    next();
  };
}

export function requireRestaurant(req: AuthRequest, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }

  // Super admins can access any restaurant
  if (req.user.role === 'super_admin') {
    next();
    return;
  }

  // Get restaurant_id from params or body
  const restaurantId = req.params.restaurantId || req.body?.restaurant_id;

  if (restaurantId && req.user.restaurant_id !== restaurantId) {
    res.status(403).json({ error: 'You do not have access to this restaurant.' });
    return;
  }

  next();
}

export function requireActiveRestaurant(req: AuthRequest, res: Response, next: NextFunction): void {
  if (!req.user || !req.user.restaurant_id) {
    next();
    return;
  }

  const restaurant = db.findById('restaurants', req.user.restaurant_id);
  if (!restaurant) {
    res.status(404).json({ error: 'Restaurant not found.' });
    return;
  }

  if (restaurant.status === 'suspended') {
    res.status(403).json({ error: 'Your restaurant account is currently suspended. Please contact administration.' });
    return;
  }

  if (restaurant.status === 'inactive') {
    res.status(403).json({ error: 'Your restaurant account is inactive. Please contact administration.' });
    return;
  }

  next();
}
