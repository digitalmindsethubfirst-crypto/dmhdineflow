import { Router, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { db } from '../db/database';
import { AuthRequest, verifyToken, requireRole, requireRestaurant } from '../middleware/auth';
import { upload } from '../middleware/upload';

const router = Router();

// GET /api/restaurants/:restaurantId/categories
router.get('/restaurants/:restaurantId/categories', verifyToken, requireRestaurant, (req: AuthRequest, res: Response) => {
  const categories = db.find('categories', (c: any) => c.restaurant_id === req.params.restaurantId) as any[];
  categories.sort((a: any, b: any) => a.sort_order - b.sort_order);

  const result = categories.map((c: any) => {
    const itemCount = db.count('menu_items', (i: any) => i.category_id === c.id);
    return { ...c, item_count: itemCount };
  });

  res.json(result);
});

// POST /api/restaurants/:restaurantId/categories
router.post('/restaurants/:restaurantId/categories', verifyToken, requireRole('super_admin', 'restaurant_owner'), requireRestaurant, upload.single('image'), (req: AuthRequest, res: Response) => {
  const { name, description, sort_order } = req.body;
  if (!name) {
    res.status(400).json({ error: 'Category name is required.' });
    return;
  }

  const existing = db.findOne('categories', (c: any) => c.restaurant_id === req.params.restaurantId && c.name.toLowerCase() === name.toLowerCase() && c.status === 'active');
  if (existing) {
    res.status(400).json({ error: 'A category with this name already exists.' });
    return;
  }

  const now = new Date().toISOString();
  const category = {
    id: uuid(), restaurant_id: req.params.restaurantId,
    name, image: req.file ? `/uploads/${req.file.filename}` : '',
    description: description || '', sort_order: parseInt(sort_order) || 0,
    status: 'active' as const, created_at: now, updated_at: now,
  };

  db.insert('categories', category);

  db.insert('audit_logs', {
    id: uuid(), user_id: req.user!.id, restaurant_id: req.params.restaurantId,
    action: 'category_created', entity_type: 'category', entity_id: category.id,
    metadata: JSON.stringify({ name }), created_at: now,
  });

  res.status(201).json(category);
});

// PATCH /api/categories/:id
router.patch('/categories/:id', verifyToken, requireRole('super_admin', 'restaurant_owner'), upload.single('image'), (req: AuthRequest, res: Response) => {
  const category = db.findById('categories', req.params.id);
  if (!category) {
    res.status(404).json({ error: 'Category not found.' });
    return;
  }

  // Tenant check
  if (req.user!.role !== 'super_admin' && req.user!.restaurant_id !== category.restaurant_id) {
    res.status(403).json({ error: 'Access denied.' });
    return;
  }

  const updates: any = {};
  if (req.body.name) updates.name = req.body.name;
  if (req.body.description !== undefined) updates.description = req.body.description;
  if (req.body.sort_order !== undefined) updates.sort_order = parseInt(req.body.sort_order);
  if (req.body.status) updates.status = req.body.status;
  if (req.file) updates.image = `/uploads/${req.file.filename}`;

  const updated = db.update('categories', req.params.id, updates);
  res.json(updated);
});

// DELETE /api/categories/:id
router.delete('/categories/:id', verifyToken, requireRole('super_admin', 'restaurant_owner'), (req: AuthRequest, res: Response) => {
  const category = db.findById('categories', req.params.id);
  if (!category) {
    res.status(404).json({ error: 'Category not found.' });
    return;
  }

  if (req.user!.role !== 'super_admin' && req.user!.restaurant_id !== category.restaurant_id) {
    res.status(403).json({ error: 'Access denied.' });
    return;
  }

  const itemCount = db.count('menu_items', (i: any) => i.category_id === req.params.id);
  if (itemCount > 0) {
    res.status(400).json({ error: `Cannot delete category with ${itemCount} item(s). Remove items first.` });
    return;
  }

  db.delete('categories', req.params.id);
  res.json({ message: 'Category deleted successfully.' });
});

export default router;
