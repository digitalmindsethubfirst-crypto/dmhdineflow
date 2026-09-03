import { Router, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { db } from '../db/database';
import { AuthRequest, verifyToken, requireRole, requireRestaurant } from '../middleware/auth';
import { upload } from '../middleware/upload';

const router = Router();

// POST /api/restaurants/:restaurantId/payment-proof
// (Restaurant Owner uploads monthly software fee payment screenshot)
router.post(
  '/restaurants/:restaurantId/payment-proof',
  verifyToken,
  requireRole('super_admin', 'restaurant_owner'),
  requireRestaurant,
  upload.single('screenshot'),
  (req: AuthRequest, res: Response) => {
    const restaurantId = req.params.restaurantId;
    const restaurant = db.findById('restaurants', restaurantId);
    if (!restaurant) {
      res.status(404).json({ error: 'Restaurant not found.' });
      return;
    }

    if (!req.file) {
      res.status(400).json({ error: 'Payment screenshot image is required.' });
      return;
    }

    const { amount, transaction_reference, notes } = req.body;
    const subscription = db.findOne('subscriptions', (s: any) => s.restaurant_id === restaurantId);

    const now = new Date().toISOString();
    const paymentId = uuid();
    const screenshotUrl = `/uploads/${req.file.filename}`;

    const paymentProof = {
      id: paymentId,
      restaurant_id: restaurantId,
      subscription_id: subscription?.id,
      amount: parseFloat(amount) || subscription?.amount || 5000,
      screenshot_url: screenshotUrl,
      transaction_reference: transaction_reference || '',
      notes: notes || '',
      status: 'pending' as const,
      submitted_at: now,
    };

    db.insert('payments', paymentProof);

    // Update subscription to pending_verification
    if (subscription) {
      db.update('subscriptions', subscription.id, {
        payment_status: 'pending_verification',
      });
    }

    // Create audit log
    db.insert('audit_logs', {
      id: uuid(),
      user_id: req.user!.id,
      restaurant_id: restaurantId,
      action: 'payment_proof_submitted',
      entity_type: 'payment',
      entity_id: paymentId,
      metadata: JSON.stringify({ amount: paymentProof.amount, transaction_reference }),
      created_at: now,
    });

    res.status(201).json({
      message: 'Payment proof screenshot submitted successfully. Pending Admin verification.',
      payment: paymentProof,
    });
  }
);

// GET /api/restaurants/:restaurantId/payments (Owner view of submissions)
router.get(
  '/restaurants/:restaurantId/payments',
  verifyToken,
  requireRole('super_admin', 'restaurant_owner'),
  requireRestaurant,
  (req: AuthRequest, res: Response) => {
    const list = db.find('payments', (p: any) => p.restaurant_id === req.params.restaurantId) as any[];
    list.sort((a, b) => new Date(b.submitted_at).getTime() - new Date(a.submitted_at).getTime());
    res.json(list);
  }
);

// GET /api/admin/payments (Super Admin view of all payment proofs)
router.get(
  '/admin/payments',
  verifyToken,
  requireRole('super_admin'),
  (_req: AuthRequest, res: Response) => {
    const list = db.getAll('payments') as any[];
    list.sort((a, b) => new Date(b.submitted_at).getTime() - new Date(a.submitted_at).getTime());

    const enriched = list.map((p) => {
      const restaurant = db.findById('restaurants', p.restaurant_id);
      const owner = db.findOne('users', (u: any) => u.restaurant_id === p.restaurant_id && u.role === 'restaurant_owner');
      return {
        ...p,
        restaurant_name: restaurant?.name || 'Unknown',
        owner_name: owner?.name || 'Unknown',
        owner_email: owner?.email || '',
        owner_phone: owner?.phone || '',
      };
    });

    res.json(enriched);
  }
);

// PATCH /api/admin/payments/:id/verify (Super Admin approves or rejects payment proof)
router.patch(
  '/admin/payments/:id/verify',
  verifyToken,
  requireRole('super_admin'),
  (req: AuthRequest, res: Response) => {
    const payment = db.findById('payments', req.params.id);
    if (!payment) {
      res.status(404).json({ error: 'Payment record not found.' });
      return;
    }

    const { action, rejection_reason, extend_months = 1 } = req.body; // 'approve' | 'reject'
    const now = new Date().toISOString();

    if (action === 'approve') {
      db.update('payments', req.params.id, {
        status: 'approved',
        reviewed_at: now,
        reviewed_by: req.user!.id,
      });

      // Update subscription & extend expiry
      const subscription = db.findOne('subscriptions', (s: any) => s.restaurant_id === payment.restaurant_id);
      let newExpiry = new Date();
      if (subscription && new Date(subscription.expiry_date) > new Date()) {
        newExpiry = new Date(subscription.expiry_date);
      }
      newExpiry.setMonth(newExpiry.getMonth() + parseInt(extend_months));

      if (subscription) {
        db.update('subscriptions', subscription.id, {
          status: 'active',
          payment_status: 'paid',
          expiry_date: newExpiry.toISOString(),
        });
      }

      // Ensure restaurant is active
      db.update('restaurants', payment.restaurant_id, {
        status: 'active',
        subscription_status: 'active',
        subscription_expiry: newExpiry.toISOString(),
      });

      db.insert('audit_logs', {
        id: uuid(),
        user_id: req.user!.id,
        restaurant_id: payment.restaurant_id,
        action: 'payment_approved',
        entity_type: 'payment',
        entity_id: payment.id,
        metadata: JSON.stringify({ extended_until: newExpiry.toISOString() }),
        created_at: now,
      });

      res.json({ message: 'Payment approved successfully! Subscription extended and active.', new_expiry: newExpiry });
    } else if (action === 'reject') {
      db.update('payments', req.params.id, {
        status: 'rejected',
        reviewed_at: now,
        reviewed_by: req.user!.id,
        rejection_reason: rejection_reason || 'Payment verification failed',
      });

      const subscription = db.findOne('subscriptions', (s: any) => s.restaurant_id === payment.restaurant_id);
      if (subscription) {
        db.update('subscriptions', subscription.id, {
          payment_status: 'overdue',
        });
      }

      db.insert('audit_logs', {
        id: uuid(),
        user_id: req.user!.id,
        restaurant_id: payment.restaurant_id,
        action: 'payment_rejected',
        entity_type: 'payment',
        entity_id: payment.id,
        metadata: JSON.stringify({ reason: rejection_reason }),
        created_at: now,
      });

      res.json({ message: 'Payment rejected.' });
    } else {
      res.status(400).json({ error: 'Invalid verification action. Must be approve or reject.' });
    }
  }
);

export default router;
