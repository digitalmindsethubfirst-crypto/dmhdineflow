import { db } from '../db/database';

export interface SubscriptionStatusResult {
  isDue: boolean;
  status: 'active' | 'payment_due' | 'expired' | 'suspended' | 'inactive';
  expiryDate: string;
  daysRemaining: number;
  plan: string;
}

/**
 * Checks and updates the monthly subscription status of a restaurant based on current time.
 * Dynamic and database-driven: Automatically transitions active -> payment_due when 1-month period expires.
 */
export function checkAndUpdateSubscription(restaurantId: string): SubscriptionStatusResult {
  const restaurant = db.findById('restaurants', restaurantId);
  if (!restaurant) {
    return {
      isDue: true,
      status: 'inactive',
      expiryDate: '',
      daysRemaining: 0,
      plan: 'none',
    };
  }

  const now = new Date();
  const expiryDate = restaurant.subscription_expiry ? new Date(restaurant.subscription_expiry) : new Date(0);
  const diffTime = expiryDate.getTime() - now.getTime();
  const daysRemaining = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  // Check if 1-month subscription period has expired
  if (now > expiryDate && restaurant.subscription_status === 'active') {
    // Automatically transition to payment_due
    db.update('restaurants', restaurantId, {
      subscription_status: 'payment_due',
      updated_at: now.toISOString(),
    });

    const sub = db.findOne('subscriptions', (s: any) => s.restaurant_id === restaurantId);
    if (sub) {
      db.update('subscriptions', sub.id, {
        status: 'expired',
        payment_status: 'overdue',
      });
    }

    db.forceSave();

    return {
      isDue: true,
      status: 'payment_due',
      expiryDate: restaurant.subscription_expiry,
      daysRemaining,
      plan: restaurant.package_plan || 'pro',
    };
  }

  const isDue =
    restaurant.subscription_status === 'payment_due' ||
    restaurant.subscription_status === 'expired' ||
    restaurant.subscription_status === 'suspended' ||
    restaurant.status === 'suspended' ||
    now > expiryDate;

  return {
    isDue,
    status: (restaurant.subscription_status as any) || (isDue ? 'payment_due' : 'active'),
    expiryDate: restaurant.subscription_expiry || '',
    daysRemaining,
    plan: restaurant.package_plan || 'pro',
  };
}

/**
 * Renews a restaurant subscription for 1 month (+30 days)
 */
export function renewMonthlySubscription(restaurantId: string, amount?: number): any {
  const restaurant = db.findById('restaurants', restaurantId);
  if (!restaurant) throw new Error('Restaurant not found.');

  const now = new Date();
  // Start from current expiry if it's in the future, otherwise from now
  const currentExpiry = restaurant.subscription_expiry ? new Date(restaurant.subscription_expiry) : now;
  const baseDate = currentExpiry > now ? currentExpiry : now;

  const newExpiry = new Date(baseDate);
  newExpiry.setDate(newExpiry.getDate() + 30); // 1 Month (+30 days)

  const newExpiryIso = newExpiry.toISOString();
  const nowIso = now.toISOString();

  // Update restaurant
  db.update('restaurants', restaurantId, {
    status: 'active',
    subscription_status: 'active',
    subscription_expiry: newExpiryIso,
    updated_at: nowIso,
  });

  // Update or insert subscription record
  let sub = db.findOne('subscriptions', (s: any) => s.restaurant_id === restaurantId);
  if (sub) {
    sub = db.update('subscriptions', sub.id, {
      status: 'active',
      start_date: nowIso,
      expiry_date: newExpiryIso,
      payment_status: 'paid',
      amount: amount || sub.amount || 3000,
    });
  }

  db.forceSave();

  return {
    restaurantId,
    status: 'active',
    subscription_expiry: newExpiryIso,
    subscription: sub,
  };
}
