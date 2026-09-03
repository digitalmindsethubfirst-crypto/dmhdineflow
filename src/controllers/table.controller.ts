import { Router, Response } from 'express';
import { v4 as uuid } from 'uuid';
import QRCode from 'qrcode';
import JSZip from 'jszip';
import { db } from '../db/database';
import { AuthRequest, verifyToken, requireRole, requireRestaurant } from '../middleware/auth';
import { config } from '../config/env';

const router = Router();

// GET /api/restaurants/:restaurantId/tables
router.get('/restaurants/:restaurantId/tables', verifyToken, requireRestaurant, (req: AuthRequest, res: Response) => {
  const tables = db.find('tables', (t: any) => t.restaurant_id === req.params.restaurantId) as any[];
  tables.sort((a: any, b: any) => a.table_number - b.table_number);

  const result = tables.map((t: any) => {
    const activeSession = db.findOne('table_sessions', (s: any) => s.table_id === t.id && s.status === 'active');
    const sessionOrders = activeSession
      ? db.find('orders', (o: any) => o.table_session_id === activeSession.id) as any[]
      : [];
    return {
      ...t,
      has_active_session: !!activeSession,
      session_id: activeSession?.id,
      active_orders: sessionOrders.length,
      session_total: sessionOrders.reduce((s: number, o: any) => s + o.total, 0),
    };
  });

  res.json(result);
});

// POST /api/restaurants/:restaurantId/tables
router.post('/restaurants/:restaurantId/tables', verifyToken, requireRole('super_admin', 'restaurant_owner'), requireRestaurant, (req: AuthRequest, res: Response) => {
  const { table_number } = req.body;
  if (!table_number) {
    res.status(400).json({ error: 'Table number is required.' });
    return;
  }

  const existing = db.findOne('tables', (t: any) => t.restaurant_id === req.params.restaurantId && t.table_number === parseInt(table_number));
  if (existing) {
    res.status(400).json({ error: `Table ${table_number} already exists.` });
    return;
  }

  const now = new Date().toISOString();
  const table = {
    id: uuid(), restaurant_id: req.params.restaurantId,
    table_number: parseInt(table_number), qr_token: uuid(),
    status: 'active' as const, created_at: now, updated_at: now,
  };

  db.insert('tables', table);
  res.status(201).json(table);
});

// POST /api/restaurants/:restaurantId/tables/generate
router.post('/restaurants/:restaurantId/tables/generate', verifyToken, requireRole('super_admin', 'restaurant_owner'), requireRestaurant, (req: AuthRequest, res: Response) => {
  const { count } = req.body;
  const numCount = parseInt(count);
  if (!numCount || numCount < 1 || numCount > 100) {
    res.status(400).json({ error: 'Please provide a valid count between 1 and 100.' });
    return;
  }

  const existingTables = db.find('tables', (t: any) => t.restaurant_id === req.params.restaurantId) as any[];
  const existingNumbers = new Set(existingTables.map((t: any) => t.table_number));

  let nextNumber = 1;
  const created: any[] = [];
  const now = new Date().toISOString();

  for (let i = 0; i < numCount; i++) {
    while (existingNumbers.has(nextNumber)) nextNumber++;
    const table = {
      id: uuid(), restaurant_id: req.params.restaurantId,
      table_number: nextNumber, qr_token: uuid(),
      status: 'active' as const, created_at: now, updated_at: now,
    };
    db.insert('tables', table);
    created.push(table);
    existingNumbers.add(nextNumber);
    nextNumber++;
  }

  res.status(201).json({ message: `${created.length} tables created.`, tables: created });
});

// GET /api/tables/:id/qr
router.get('/tables/:id/qr', verifyToken, async (req: AuthRequest, res: Response) => {
  const table = db.findById('tables', req.params.id);
  if (!table) {
    res.status(404).json({ error: 'Table not found.' });
    return;
  }

  const url = `${config.frontendUrl}/m/${table.qr_token}`;
  try {
    const qrDataUrl = await QRCode.toDataURL(url, {
      width: 400, margin: 2, color: { dark: '#1e293b', light: '#ffffff' },
    });
    res.json({ qr: qrDataUrl, url, table_number: table.table_number });
  } catch {
    res.status(500).json({ error: 'Failed to generate QR code.' });
  }
});

// GET /api/restaurants/:restaurantId/tables/qr-all
router.get('/restaurants/:restaurantId/tables/qr-all', verifyToken, requireRole('super_admin', 'restaurant_owner'), requireRestaurant, async (req: AuthRequest, res: Response) => {
  const tables = db.find('tables', (t: any) => t.restaurant_id === req.params.restaurantId) as any[];
  tables.sort((a: any, b: any) => a.table_number - b.table_number);

  if (tables.length === 0) {
    res.status(400).json({ error: 'No tables found.' });
    return;
  }

  const restaurant = db.findById('restaurants', req.params.restaurantId);

  try {
    const zip = new JSZip();
    for (const table of tables) {
      const url = `${config.frontendUrl}/m/${(table as any).qr_token}`;
      const qrBuffer = await QRCode.toBuffer(url, {
        width: 600, margin: 2, color: { dark: '#1e293b', light: '#ffffff' },
      });
      zip.file(`Table_${(table as any).table_number}_QR.png`, qrBuffer);
    }

    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });
    const filename = `${restaurant?.name || 'Restaurant'}_QR_Codes.zip`.replace(/\s+/g, '_');

    res.set({
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${filename}"`,
    });
    res.send(zipBuffer);
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate QR codes.' });
  }
});

// PATCH /api/tables/:id
router.patch('/tables/:id', verifyToken, requireRole('super_admin', 'restaurant_owner'), (req: AuthRequest, res: Response) => {
  const table = db.findById('tables', req.params.id);
  if (!table) {
    res.status(404).json({ error: 'Table not found.' });
    return;
  }

  if (req.user!.role !== 'super_admin' && req.user!.restaurant_id !== table.restaurant_id) {
    res.status(403).json({ error: 'Access denied.' });
    return;
  }

  const updates: any = {};
  if (req.body.table_number) updates.table_number = parseInt(req.body.table_number);
  if (req.body.status) updates.status = req.body.status;

  const updated = db.update('tables', req.params.id, updates);
  res.json(updated);
});

// DELETE /api/tables/:id
router.delete('/tables/:id', verifyToken, requireRole('super_admin', 'restaurant_owner'), (req: AuthRequest, res: Response) => {
  const table = db.findById('tables', req.params.id);
  if (!table) {
    res.status(404).json({ error: 'Table not found.' });
    return;
  }

  if (req.user!.role !== 'super_admin' && req.user!.restaurant_id !== table.restaurant_id) {
    res.status(403).json({ error: 'Access denied.' });
    return;
  }

  // Check for active session
  const activeSession = db.findOne('table_sessions', (s: any) => s.table_id === table.id && s.status === 'active');
  if (activeSession) {
    res.status(400).json({ error: 'Cannot delete table with active session. Close the session first.' });
    return;
  }

  db.delete('tables', req.params.id);
  res.json({ message: 'Table deleted successfully.' });
});

export default router;
