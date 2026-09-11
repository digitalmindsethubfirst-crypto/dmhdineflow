import { Router, Response } from 'express';
import { db } from '../db/database';
import { AuthRequest, verifyToken, requireRole, requireRestaurant } from '../middleware/auth';

const router = Router();

// GET /api/restaurants/:restaurantId/reports
router.get('/restaurants/:restaurantId/reports', verifyToken, requireRole('super_admin', 'restaurant_owner'), requireRestaurant, (req: AuthRequest, res: Response) => {
  const { period = 'week', from_date, to_date } = req.query;
  const restaurantId = req.params.restaurantId;

  const now = new Date();
  let startDate = new Date();
  let endDate: Date | null = null;

  if (from_date || to_date) {
    if (from_date) {
      startDate = new Date(from_date as string);
    }
    if (to_date) {
      endDate = new Date(`${to_date}T23:59:59.999Z`);
    }
  } else if (period === 'today') {
    startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  } else if (period === 'week') {
    startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  } else if (period === 'month') {
    startDate = new Date(now.getFullYear(), now.getMonth(), 1);
  } else if (period === 'year') {
    startDate = new Date(now.getFullYear(), 0, 1);
  }

  const startIso = startDate.toISOString();
  let allOrders = db.find('orders', (o: any) => o.restaurant_id === restaurantId && o.created_at >= startIso) as any[];

  if (endDate) {
    const endIso = endDate.toISOString();
    allOrders = allOrders.filter((o: any) => o.created_at <= endIso);
  }

  // 1. Summary KPIs
  const totalOrders = allOrders.length;
  const completedOrders = allOrders.filter((o: any) => o.status === 'completed' || o.status === 'delivered');
  const cancelledOrders = allOrders.filter((o: any) => o.status === 'cancelled');
  const totalRevenue = completedOrders.reduce((sum: number, o: any) => sum + o.total, 0);
  const avgOrderValue = completedOrders.length > 0 ? Math.round(totalRevenue / completedOrders.length) : 0;

  // 2. Timeline Chart Data
  const timelineMap: Record<string, { date: string; orders: number; revenue: number; completed: number }> = {};

  const daysCount = period === 'today' ? 1 : period === 'week' ? 7 : period === 'month' ? 30 : 12;
  for (let i = daysCount - 1; i >= 0; i--) {
    const d = new Date(now);
    if (period === 'year') {
      d.setMonth(d.getMonth() - i);
      const key = d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
      timelineMap[key] = { date: key, orders: 0, revenue: 0, completed: 0 };
    } else {
      d.setDate(d.getDate() - i);
      const key = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      timelineMap[key] = { date: key, orders: 0, revenue: 0, completed: 0 };
    }
  }

  allOrders.forEach((o: any) => {
    const d = new Date(o.created_at);
    const key = period === 'year'
      ? d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
      : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

    if (timelineMap[key]) {
      timelineMap[key].orders += 1;
      if (o.status === 'completed') {
        timelineMap[key].revenue += o.total;
        timelineMap[key].completed += 1;
      }
    }
  });

  const timeline = Object.values(timelineMap);

  // 3. Top Selling Items
  const itemCounts: Record<string, { name: string; quantity: number; revenue: number }> = {};
  completedOrders.forEach((o: any) => {
    const orderItems = db.find('order_items', (oi: any) => oi.order_id === o.id) as any[];
    orderItems.forEach((oi: any) => {
      const name = oi.item_name_snapshot + (oi.variant_name_snapshot ? ` (${oi.variant_name_snapshot})` : '');
      if (!itemCounts[name]) {
        itemCounts[name] = { name, quantity: 0, revenue: 0 };
      }
      itemCounts[name].quantity += oi.quantity;
      itemCounts[name].revenue += oi.subtotal;
    });
  });

  const topItems = Object.values(itemCounts)
    .sort((a, b) => b.quantity - a.quantity)
    .slice(0, 10);

  // 4. Status breakdown
  const statusBreakdown = [
    { name: 'Completed', value: completedOrders.length, color: '#10B981' },
    { name: 'Cancelled', value: cancelledOrders.length, color: '#EF4444' },
    { name: 'Active/In Progress', value: totalOrders - completedOrders.length - cancelledOrders.length, color: '#3B82F6' },
  ];

  res.json({
    summary: {
      totalOrders,
      completedOrders: completedOrders.length,
      cancelledOrders: cancelledOrders.length,
      totalRevenue,
      avgOrderValue,
    },
    timeline,
    topItems,
    statusBreakdown,
  });
});

export default router;
