import fs from 'fs';
import path from 'path';
import { config } from '../config/env';

export interface User {
  id: string;
  name: string;
  email: string;
  phone: string;
  password_hash: string;
  role: 'super_admin' | 'restaurant_owner' | 'kitchen_staff';
  status: 'active' | 'inactive';
  restaurant_id?: string;
  created_at: string;
  updated_at: string;
}

export interface Restaurant {
  id: string;
  name: string;
  slug: string;
  logo?: string;
  cover_image?: string;
  description: string;
  phone: string;
  whatsapp?: string;
  email: string;
  address: string;
  city: string;
  opening_time: string;
  closing_time: string;
  status: 'active' | 'inactive' | 'suspended';
  is_open: boolean;
  accept_orders: boolean;
  enable_delivery?: boolean;
  delivery_fee?: number;
  min_order_amount?: number;
  estimated_delivery_time?: string;
  payment_methods?: string[];
  bank_details?: string;
  tax_rate: number;
  service_charge_rate: number;
  currency: string;
  subscription_status: 'active' | 'expired' | 'pending';
  subscription_expiry: string;
  created_at: string;
  updated_at: string;
}

export interface Category {
  id: string;
  restaurant_id: string;
  name: string;
  image?: string;
  description?: string;
  sort_order: number;
  status: 'active' | 'inactive';
  created_at: string;
  updated_at: string;
}

export interface MenuItem {
  id: string;
  restaurant_id: string;
  category_id: string;
  name: string;
  description: string;
  image?: string;
  base_price: number;
  available: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface ItemVariant {
  id: string;
  item_id: string;
  name: string;
  price: number;
  status: 'active' | 'inactive';
}

export interface Table {
  id: string;
  restaurant_id: string;
  table_number: number;
  qr_token: string;
  status: 'active' | 'inactive';
  created_at: string;
  updated_at: string;
}

export interface TableSession {
  id: string;
  restaurant_id: string;
  table_id: string;
  session_token: string;
  status: 'active' | 'closed';
  started_at: string;
  closed_at?: string;
}

export interface Order {
  id: string;
  restaurant_id: string;
  order_type?: 'table' | 'delivery' | 'pickup';
  table_id?: string;
  table_session_id?: string;
  order_number: string;
  status: 'new' | 'accepted' | 'cooking' | 'ready' | 'out_for_delivery' | 'completed' | 'delivered' | 'cancelled';
  subtotal: number;
  tax: number;
  service_charge: number;
  delivery_fee?: number;
  discount: number;
  total: number;
  customer_name?: string;
  customer_phone?: string;
  customer_whatsapp?: string;
  customer_email?: string;
  customer_note?: string;
  delivery_address?: string;
  delivery_city?: string;
  delivery_notes?: string;
  payment_status?: 'pending' | 'paid' | 'waived';
  payment_method?: 'cod' | 'cash' | 'card' | 'online' | 'bank_transfer' | 'easypaisa' | 'jazzcash' | 'other';
  payment_proof?: string;
  amount_paid?: number;
  change_amount?: number;
  paid_at?: string;
  created_at: string;
  updated_at: string;
}

export interface OrderItem {
  id: string;
  order_id: string;
  menu_item_id: string;
  variant_id?: string;
  item_name_snapshot: string;
  variant_name_snapshot?: string;
  quantity: number;
  unit_price: number;
  subtotal: number;
}

export interface Subscription {
  id: string;
  restaurant_id: string;
  plan: string;
  status: 'active' | 'expired' | 'pending';
  start_date: string;
  expiry_date: string;
  amount: number;
  payment_status: 'paid' | 'pending' | 'overdue' | 'pending_verification';
  created_at: string;
}

export interface PaymentProof {
  id: string;
  restaurant_id: string;
  subscription_id?: string;
  amount: number;
  screenshot_url: string;
  transaction_reference?: string;
  notes?: string;
  status: 'pending' | 'approved' | 'rejected';
  submitted_at: string;
  reviewed_at?: string;
  reviewed_by?: string;
  rejection_reason?: string;
}

export interface AuditLog {
  id: string;
  user_id?: string;
  restaurant_id?: string;
  action: string;
  entity_type: string;
  entity_id?: string;
  metadata?: string;
  created_at: string;
}

interface DbData {
  users: User[];
  restaurants: Restaurant[];
  categories: Category[];
  menu_items: MenuItem[];
  item_variants: ItemVariant[];
  tables: Table[];
  table_sessions: TableSession[];
  orders: Order[];
  order_items: OrderItem[];
  subscriptions: Subscription[];
  payments: PaymentProof[];
  audit_logs: AuditLog[];
  _meta: { order_counter: number };
}

const defaultData: DbData = {
  users: [],
  restaurants: [],
  categories: [],
  menu_items: [],
  item_variants: [],
  tables: [],
  table_sessions: [],
  orders: [],
  order_items: [],
  subscriptions: [],
  payments: [],
  audit_logs: [],
  _meta: { order_counter: 1000 },
};

class Database {
  private data: DbData;
  private dbPath: string;
  private saveTimeout: NodeJS.Timeout | null = null;

  constructor() {
    this.dbPath = path.resolve(config.dbPath);
    this.data = this.load();
  }

  private load(): DbData {
    try {
      const dir = path.dirname(this.dbPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      if (fs.existsSync(this.dbPath)) {
        const raw = fs.readFileSync(this.dbPath, 'utf-8');
        const parsed = JSON.parse(raw);
        if (!parsed.payments) parsed.payments = [];
        return parsed;
      }
    } catch (e) {
      console.error('Error loading database, starting fresh:', e);
    }
    return JSON.parse(JSON.stringify(defaultData));
  }

  save(): void {
    if (this.saveTimeout) clearTimeout(this.saveTimeout);
    this.saveTimeout = setTimeout(() => {
      try {
        const dir = path.dirname(this.dbPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(this.dbPath, JSON.stringify(this.data, null, 2), 'utf-8');
      } catch (e) {
        console.error('Error saving database:', e);
      }
    }, 100);
  }

  forceSave(): void {
    if (this.saveTimeout) clearTimeout(this.saveTimeout);
    try {
      const dir = path.dirname(this.dbPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.dbPath, JSON.stringify(this.data, null, 2), 'utf-8');
    } catch (e) {
      console.error('Error saving database:', e);
    }
  }

  // Generic CRUD helpers
  getAll<K extends keyof Omit<DbData, '_meta'>>(table: K): DbData[K] {
    return this.data[table] || ([] as any);
  }

  find<K extends keyof Omit<DbData, '_meta'>>(
    table: K,
    predicate: (item: any) => boolean
  ): DbData[K] {
    return ((this.data[table] || []) as any[]).filter(predicate) as DbData[K];
  }

  findOne<K extends keyof Omit<DbData, '_meta'>>(
    table: K,
    predicate: (item: any) => boolean
  ): any | undefined {
    return ((this.data[table] || []) as any[]).find(predicate);
  }

  findById<K extends keyof Omit<DbData, '_meta'>>(table: K, id: string): any | undefined {
    return ((this.data[table] || []) as any[]).find((item: any) => item.id === id);
  }

  insert<K extends keyof Omit<DbData, '_meta'>>(table: K, item: any): void {
    if (!this.data[table]) (this.data as any)[table] = [];
    (this.data[table] as any[]).push(item);
    this.save();
  }

  update<K extends keyof Omit<DbData, '_meta'>>(
    table: K,
    id: string,
    updates: Partial<any>
  ): any | null {
    if (!this.data[table]) return null;
    const arr = this.data[table] as any[];
    const idx = arr.findIndex((item: any) => item.id === id);
    if (idx === -1) return null;
    arr[idx] = { ...arr[idx], ...updates, updated_at: new Date().toISOString() };
    this.save();
    return arr[idx];
  }

  delete<K extends keyof Omit<DbData, '_meta'>>(table: K, id: string): boolean {
    if (!this.data[table]) return false;
    const arr = this.data[table] as any[];
    const idx = arr.findIndex((item: any) => item.id === id);
    if (idx === -1) return false;
    arr.splice(idx, 1);
    this.save();
    return true;
  }

  deleteWhere<K extends keyof Omit<DbData, '_meta'>>(
    table: K,
    predicate: (item: any) => boolean
  ): number {
    if (!this.data[table]) return 0;
    const arr = this.data[table] as any[];
    const before = arr.length;
    this.data[table] = arr.filter((item: any) => !predicate(item)) as any;
    this.save();
    return before - (this.data[table] as any[]).length;
  }

  nextOrderNumber(): string {
    this.data._meta.order_counter += 1;
    this.save();
    return `#${this.data._meta.order_counter}`;
  }

  getOrderCounter(): number {
    return this.data._meta.order_counter;
  }

  count<K extends keyof Omit<DbData, '_meta'>>(
    table: K,
    predicate?: (item: any) => boolean
  ): number {
    if (!this.data[table]) return 0;
    if (!predicate) return (this.data[table] as any[]).length;
    return (this.data[table] as any[]).filter(predicate).length;
  }

  reset(): void {
    this.data = JSON.parse(JSON.stringify(defaultData));
    this.forceSave();
  }

  setData(data: DbData): void {
    this.data = data;
    this.forceSave();
  }
}

export const db = new Database();
