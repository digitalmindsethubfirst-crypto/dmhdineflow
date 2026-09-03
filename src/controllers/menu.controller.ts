import { Router, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { db } from '../db/database';
import { AuthRequest, verifyToken, requireRole, requireRestaurant } from '../middleware/auth';
import { upload } from '../middleware/upload';

const router = Router();

// GET /api/restaurants/:restaurantId/menu-items
router.get('/restaurants/:restaurantId/menu-items', verifyToken, requireRestaurant, (req: AuthRequest, res: Response) => {
  let items = db.find('menu_items', (i: any) => i.restaurant_id === req.params.restaurantId) as any[];

  if (req.query.category_id) {
    items = items.filter((i: any) => i.category_id === req.query.category_id);
  }
  if (req.query.available !== undefined) {
    items = items.filter((i: any) => i.available === (req.query.available === 'true'));
  }
  if (req.query.search) {
    const s = (req.query.search as string).toLowerCase();
    items = items.filter((i: any) => i.name.toLowerCase().includes(s));
  }

  items.sort((a: any, b: any) => a.sort_order - b.sort_order);

  const result = items.map((item: any) => {
    const variants = db.find('item_variants', (v: any) => v.item_id === item.id) as any[];
    const category = db.findById('categories', item.category_id);
    return { ...item, variants, category_name: category?.name || '' };
  });

  res.json(result);
});

// POST /api/restaurants/:restaurantId/menu-items
router.post('/restaurants/:restaurantId/menu-items', verifyToken, requireRole('super_admin', 'restaurant_owner'), requireRestaurant, upload.single('image'), (req: AuthRequest, res: Response) => {
  const { name, description, category_id, base_price, sort_order, variants } = req.body;
  if (!name || !category_id || !base_price) {
    res.status(400).json({ error: 'Name, category, and price are required.' });
    return;
  }

  // Verify category belongs to restaurant
  const category = db.findById('categories', category_id);
  if (!category || category.restaurant_id !== req.params.restaurantId) {
    res.status(400).json({ error: 'Invalid category.' });
    return;
  }

  const now = new Date().toISOString();
  const itemId = uuid();
  const item = {
    id: itemId, restaurant_id: req.params.restaurantId, category_id,
    name, description: description || '',
    image: req.file ? `/uploads/${req.file.filename}` : '',
    base_price: parseFloat(base_price), available: true,
    sort_order: parseInt(sort_order) || 0,
    created_at: now, updated_at: now,
  };

  db.insert('menu_items', item);

  // Add variants
  let parsedVariants: any[] = [];
  try {
    parsedVariants = typeof variants === 'string' ? JSON.parse(variants) : (variants || []);
  } catch { parsedVariants = []; }

  for (const v of parsedVariants) {
    if (v.name && v.price) {
      db.insert('item_variants', {
        id: uuid(), item_id: itemId, name: v.name, price: parseFloat(v.price), status: 'active',
      });
    }
  }

  const savedVariants = db.find('item_variants', (v: any) => v.item_id === itemId);

  db.insert('audit_logs', {
    id: uuid(), user_id: req.user!.id, restaurant_id: req.params.restaurantId,
    action: 'item_created', entity_type: 'menu_item', entity_id: itemId,
    metadata: JSON.stringify({ name }), created_at: now,
  });

  res.status(201).json({ ...item, variants: savedVariants });
});

// PATCH /api/menu-items/:id
router.patch('/menu-items/:id', verifyToken, requireRole('super_admin', 'restaurant_owner'), upload.single('image'), (req: AuthRequest, res: Response) => {
  const item = db.findById('menu_items', req.params.id);
  if (!item) {
    res.status(404).json({ error: 'Menu item not found.' });
    return;
  }

  if (req.user!.role !== 'super_admin' && req.user!.restaurant_id !== item.restaurant_id) {
    res.status(403).json({ error: 'Access denied.' });
    return;
  }

  const updates: any = {};
  if (req.body.name) updates.name = req.body.name;
  if (req.body.description !== undefined) updates.description = req.body.description;
  if (req.body.category_id) updates.category_id = req.body.category_id;
  if (req.body.base_price) updates.base_price = parseFloat(req.body.base_price);
  if (req.body.sort_order !== undefined) updates.sort_order = parseInt(req.body.sort_order);
  if (req.body.available !== undefined) updates.available = req.body.available === true || req.body.available === 'true';
  if (req.file) updates.image = `/uploads/${req.file.filename}`;

  const updated = db.update('menu_items', req.params.id, updates);

  // Update variants if provided
  if (req.body.variants) {
    let parsedVariants: any[] = [];
    try {
      parsedVariants = typeof req.body.variants === 'string' ? JSON.parse(req.body.variants) : req.body.variants;
    } catch { parsedVariants = []; }

    // Delete existing variants
    db.deleteWhere('item_variants', (v: any) => v.item_id === req.params.id);

    // Insert new variants
    for (const v of parsedVariants) {
      if (v.name && v.price) {
        db.insert('item_variants', {
          id: uuid(), item_id: req.params.id, name: v.name, price: parseFloat(v.price), status: 'active',
        });
      }
    }
  }

  const variants = db.find('item_variants', (v: any) => v.item_id === req.params.id);
  res.json({ ...updated, variants });
});

// PATCH /api/menu-items/:id/availability
router.patch('/menu-items/:id/availability', verifyToken, requireRole('super_admin', 'restaurant_owner'), (req: AuthRequest, res: Response) => {
  const item = db.findById('menu_items', req.params.id);
  if (!item) {
    res.status(404).json({ error: 'Menu item not found.' });
    return;
  }

  if (req.user!.role !== 'super_admin' && req.user!.restaurant_id !== item.restaurant_id) {
    res.status(403).json({ error: 'Access denied.' });
    return;
  }

  const updated = db.update('menu_items', req.params.id, { available: !item.available });

  db.insert('audit_logs', {
    id: uuid(), user_id: req.user!.id, restaurant_id: item.restaurant_id,
    action: 'item_availability_changed', entity_type: 'menu_item', entity_id: req.params.id,
    metadata: JSON.stringify({ name: item.name, available: !item.available }),
    created_at: new Date().toISOString(),
  });

  res.json(updated);
});

// DELETE /api/menu-items/:id
router.delete('/menu-items/:id', verifyToken, requireRole('super_admin', 'restaurant_owner'), (req: AuthRequest, res: Response) => {
  const item = db.findById('menu_items', req.params.id);
  if (!item) {
    res.status(404).json({ error: 'Menu item not found.' });
    return;
  }

  if (req.user!.role !== 'super_admin' && req.user!.restaurant_id !== item.restaurant_id) {
    res.status(403).json({ error: 'Access denied.' });
    return;
  }

  // Delete variants
  db.deleteWhere('item_variants', (v: any) => v.item_id === req.params.id);
  db.delete('menu_items', req.params.id);

  res.json({ message: 'Menu item deleted successfully.' });
});

export default router;
