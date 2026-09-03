import { Router } from 'express';
import authRoutes from '../controllers/auth.controller';
import restaurantRoutes from '../controllers/restaurant.controller';
import categoryRoutes from '../controllers/category.controller';
import menuRoutes from '../controllers/menu.controller';
import tableRoutes from '../controllers/table.controller';
import orderRoutes from '../controllers/order.controller';
import sessionRoutes from '../controllers/session.controller';
import reportsRoutes from '../controllers/reports.controller';
import settingsRoutes from '../controllers/settings.controller';
import uploadRoutes from '../controllers/upload.controller';
import backupRoutes from '../controllers/backup.controller';
import paymentRoutes from '../controllers/payment.controller';

const router = Router();

router.use('/auth', authRoutes);
router.use('/admin', restaurantRoutes);
router.use('/', paymentRoutes);
router.use('/', backupRoutes);
router.use('/', categoryRoutes);
router.use('/', menuRoutes);
router.use('/', tableRoutes);
router.use('/', orderRoutes);
router.use('/', sessionRoutes);
router.use('/', reportsRoutes);
router.use('/', settingsRoutes);
router.use('/', uploadRoutes);

export default router;
