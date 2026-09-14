import bcrypt from 'bcryptjs';
import { v4 as uuid } from 'uuid';
import { db } from './database';

async function seed() {
  console.log('🌱 Seeding DMH DineFlow database...');
  db.reset();

  const now = new Date().toISOString();
  const expiry = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
  const hash = (pw: string) => bcrypt.hashSync(pw, 10);

  // ── Super Admin ──
  const adminId = uuid();
  db.insert('users', {
    id: adminId, name: 'Super Admin', email: 'admin@dineflow.com',
    phone: '03001234567', password_hash: hash('admin123'),
    role: 'super_admin', status: 'active', created_at: now, updated_at: now,
  });

  // ── Restaurant 1: Royal Karahi ──
  const r1Id = uuid();
  const r1OwnerId = uuid();
  const r1KitchenId = uuid();

  db.insert('restaurants', {
    id: r1Id, name: 'Royal Karahi', slug: 'royal-karahi',
    description: 'Authentic Pakistani cuisine with traditional karahi, BBQ, and biryani specialties. Serving since 2010.',
    phone: '03111234567', whatsapp: '03111234567', email: 'info@royalkarahi.com',
    address: 'Main Boulevard, Gulberg III', city: 'Lahore',
    opening_time: '11:00', closing_time: '23:00',
    status: 'active', is_open: true, accept_orders: true,
    tax_rate: 5, service_charge_rate: 0, currency: 'PKR',
    subscription_status: 'active', subscription_expiry: expiry,
    created_at: now, updated_at: now,
  });

  db.insert('users', {
    id: r1OwnerId, name: 'Ahmed Khan', email: 'owner@royalkarahi.com',
    phone: '03211234567', password_hash: hash('owner123'),
    role: 'restaurant_owner', status: 'active', restaurant_id: r1Id,
    created_at: now, updated_at: now,
  });

  db.insert('users', {
    id: r1KitchenId, name: 'Chef Rashid', email: 'kitchen@royalkarahi.com',
    phone: '03311234567', password_hash: hash('kitchen123'),
    role: 'kitchen_staff', status: 'active', restaurant_id: r1Id,
    created_at: now, updated_at: now,
  });

  db.insert('subscriptions', {
    id: uuid(), restaurant_id: r1Id, plan: 'Premium', status: 'active',
    start_date: now, expiry_date: expiry, amount: 5000,
    payment_status: 'paid', created_at: now,
  });

  // Categories for Royal Karahi
  const cats: { id: string; name: string; desc: string; order: number }[] = [
    { id: uuid(), name: 'Karahi', desc: 'Traditional karahi dishes cooked in wok', order: 1 },
    { id: uuid(), name: 'BBQ', desc: 'Grilled meats and tikka specialties', order: 2 },
    { id: uuid(), name: 'Biryani & Rice', desc: 'Aromatic rice dishes', order: 3 },
    { id: uuid(), name: 'Naan & Roti', desc: 'Fresh baked breads', order: 4 },
    { id: uuid(), name: 'Drinks', desc: 'Refreshing beverages', order: 5 },
    { id: uuid(), name: 'Desserts', desc: 'Sweet delights', order: 6 },
  ];

  for (const c of cats) {
    db.insert('categories', {
      id: c.id, restaurant_id: r1Id, name: c.name, description: c.desc,
      sort_order: c.order, status: 'active', created_at: now, updated_at: now,
    });
  }

  // Menu items for Royal Karahi
  const items = [
    { catIdx: 0, name: 'Chicken Karahi', desc: 'Traditional chicken karahi prepared with fresh tomatoes, green chilies, and aromatic spices', price: 850, variants: [{ name: 'Half', price: 850 }, { name: 'Full', price: 1600 }] },
    { catIdx: 0, name: 'Mutton Karahi', desc: 'Tender mutton cooked in a wok with special masala blend', price: 1200, variants: [{ name: 'Half', price: 1200 }, { name: 'Full', price: 2200 }] },
    { catIdx: 0, name: 'Beef Karahi', desc: 'Juicy beef karahi with rich gravy and fresh ingredients', price: 950, variants: [{ name: 'Half', price: 950 }, { name: 'Full', price: 1800 }] },
    { catIdx: 0, name: 'Prawn Karahi', desc: 'Fresh prawns cooked karahi style with tomatoes and spices', price: 1400, variants: [{ name: 'Half', price: 1400 }, { name: 'Full', price: 2600 }] },
    { catIdx: 1, name: 'Chicken Tikka', desc: 'Marinated chicken pieces grilled to perfection in tandoor', price: 650, variants: [] },
    { catIdx: 1, name: 'Seekh Kebab', desc: 'Spiced minced meat kebabs grilled on skewers', price: 500, variants: [{ name: '4 Pcs', price: 500 }, { name: '8 Pcs', price: 950 }] },
    { catIdx: 1, name: 'Malai Boti', desc: 'Creamy marinated chicken cubes grilled in tandoor', price: 750, variants: [] },
    { catIdx: 1, name: 'Mutton Chops', desc: 'Tender mutton chops marinated and grilled', price: 1100, variants: [] },
    { catIdx: 2, name: 'Chicken Biryani', desc: 'Fragrant basmati rice layered with spiced chicken', price: 450, variants: [{ name: 'Single', price: 450 }, { name: 'Family', price: 1600 }] },
    { catIdx: 2, name: 'Mutton Biryani', desc: 'Aromatic rice with tender mutton pieces', price: 550, variants: [{ name: 'Single', price: 550 }, { name: 'Family', price: 1900 }] },
    { catIdx: 2, name: 'Chicken Pulao', desc: 'Lightly spiced rice with chicken', price: 400, variants: [] },
    { catIdx: 3, name: 'Butter Naan', desc: 'Soft leavened bread brushed with butter', price: 80, variants: [] },
    { catIdx: 3, name: 'Garlic Naan', desc: 'Naan topped with fresh garlic and herbs', price: 100, variants: [] },
    { catIdx: 3, name: 'Roghni Naan', desc: 'Rich buttery naan with sesame seeds', price: 120, variants: [] },
    { catIdx: 4, name: 'Coca Cola', desc: 'Chilled Coca Cola', price: 120, variants: [{ name: 'Regular', price: 120 }, { name: 'Large', price: 200 }] },
    { catIdx: 4, name: 'Fresh Lime Water', desc: 'Freshly squeezed lime with mint', price: 150, variants: [] },
    { catIdx: 4, name: 'Lassi', desc: 'Traditional yogurt drink', price: 180, variants: [{ name: 'Sweet', price: 180 }, { name: 'Salted', price: 180 }] },
    { catIdx: 5, name: 'Kheer', desc: 'Creamy rice pudding with cardamom and nuts', price: 250, variants: [] },
    { catIdx: 5, name: 'Gulab Jamun', desc: 'Deep fried milk dumplings in sugar syrup', price: 200, variants: [{ name: '2 Pcs', price: 200 }, { name: '4 Pcs', price: 380 }] },
  ];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const itemId = uuid();
    db.insert('menu_items', {
      id: itemId, restaurant_id: r1Id, category_id: cats[item.catIdx].id,
      name: item.name, description: item.desc, base_price: item.price,
      available: true, sort_order: i + 1, created_at: now, updated_at: now,
    });
    for (const v of item.variants) {
      db.insert('item_variants', {
        id: uuid(), item_id: itemId, name: v.name, price: v.price, status: 'active',
      });
    }
  }

  // Tables for Royal Karahi
  for (let t = 1; t <= 6; t++) {
    db.insert('tables', {
      id: uuid(), restaurant_id: r1Id, table_number: t, qr_token: uuid(),
      status: 'active', created_at: now, updated_at: now,
    });
  }

  // Create an active session for Table 3 with sample orders
  const r1Tables = db.find('tables', (t: any) => t.restaurant_id === r1Id);
  const table3 = r1Tables.find((t: any) => t.table_number === 3);

  if (table3) {
    const sessionId = uuid();
    db.insert('table_sessions', {
      id: sessionId, restaurant_id: r1Id, table_id: (table3 as any).id,
      session_token: uuid(), status: 'active', started_at: now,
    });

    // Sample orders
    const allItems = db.find('menu_items', (i: any) => i.restaurant_id === r1Id);
    const chickenKarahi = allItems.find((i: any) => (i as any).name === 'Chicken Karahi') as any;
    const garlichNaan = allItems.find((i: any) => (i as any).name === 'Garlic Naan') as any;
    const coke = allItems.find((i: any) => (i as any).name === 'Coca Cola') as any;

    if (chickenKarahi && garlichNaan && coke) {
      const ckVariants = db.find('item_variants', (v: any) => v.item_id === chickenKarahi.id) as any[];
      const halfVariant = ckVariants.find((v: any) => v.name === 'Half');
      const cokeVariants = db.find('item_variants', (v: any) => v.item_id === coke.id) as any[];
      const regCoke = cokeVariants.find((v: any) => v.name === 'Regular');

      // Order 1 - Completed
      const o1Id = uuid();
      const o1Sub = (halfVariant ? halfVariant.price : 850) * 2 + garlichNaan.base_price * 3 + (regCoke ? regCoke.price : 120) * 2;
      const o1Tax = Math.round(o1Sub * 5 / 100);
      db.insert('orders', {
        id: o1Id, restaurant_id: r1Id, table_id: (table3 as any).id, table_session_id: sessionId,
        order_number: '#1001', status: 'completed', subtotal: o1Sub,
        tax: o1Tax, service_charge: 0, discount: 0, total: o1Sub + o1Tax,
        customer_name: 'Ali', customer_note: 'Less spicy please',
        created_at: new Date(Date.now() - 3600000).toISOString(),
        updated_at: new Date(Date.now() - 1800000).toISOString(),
      });
      db.insert('order_items', { id: uuid(), order_id: o1Id, menu_item_id: chickenKarahi.id, variant_id: halfVariant?.id, item_name_snapshot: 'Chicken Karahi', variant_name_snapshot: 'Half', quantity: 2, unit_price: halfVariant ? halfVariant.price : 850, subtotal: (halfVariant ? halfVariant.price : 850) * 2 });
      db.insert('order_items', { id: uuid(), order_id: o1Id, menu_item_id: garlichNaan.id, item_name_snapshot: 'Garlic Naan', quantity: 3, unit_price: garlichNaan.base_price, subtotal: garlichNaan.base_price * 3 });
      db.insert('order_items', { id: uuid(), order_id: o1Id, menu_item_id: coke.id, variant_id: regCoke?.id, item_name_snapshot: 'Coca Cola', variant_name_snapshot: 'Regular', quantity: 2, unit_price: regCoke ? regCoke.price : 120, subtotal: (regCoke ? regCoke.price : 120) * 2 });

      // Order 2 - Cooking
      const o2Id = uuid();
      const muttonKarahi = allItems.find((i: any) => (i as any).name === 'Mutton Karahi') as any;
      const mkVariants = muttonKarahi ? db.find('item_variants', (v: any) => v.item_id === muttonKarahi.id) as any[] : [];
      const mkFull = mkVariants.find((v: any) => v.name === 'Full');
      const o2Sub = (mkFull ? mkFull.price : 2200);
      const o2Tax = Math.round(o2Sub * 5 / 100);
      db.insert('orders', {
        id: o2Id, restaurant_id: r1Id, table_id: (table3 as any).id, table_session_id: sessionId,
        order_number: '#1002', status: 'cooking', subtotal: o2Sub,
        tax: o2Tax, service_charge: 0, discount: 0, total: o2Sub + o2Tax,
        customer_name: 'Hassan',
        created_at: new Date(Date.now() - 1200000).toISOString(),
        updated_at: new Date(Date.now() - 600000).toISOString(),
      });
      db.insert('order_items', { id: uuid(), order_id: o2Id, menu_item_id: muttonKarahi?.id || '', variant_id: mkFull?.id, item_name_snapshot: 'Mutton Karahi', variant_name_snapshot: 'Full', quantity: 1, unit_price: mkFull ? mkFull.price : 2200, subtotal: mkFull ? mkFull.price : 2200 });
    }
  }

  // ── Restaurant 2: Artisan Pizza & Pasta ──
  const r2Id = uuid();
  const r2OwnerId = uuid();

  db.insert('restaurants', {
    id: r2Id, name: 'Artisan Pizza & Pasta', slug: 'artisan-pizza',
    description: 'Handcrafted pizzas and fresh pasta made with imported Italian ingredients.',
    phone: '03009876543', whatsapp: '03009876543', email: 'info@artisanpizza.com',
    address: 'MM Alam Road, Gulberg II', city: 'Lahore',
    opening_time: '12:00', closing_time: '00:00',
    status: 'active', is_open: true, accept_orders: true,
    tax_rate: 10, service_charge_rate: 5, currency: 'PKR',
    subscription_status: 'active', subscription_expiry: expiry,
    created_at: now, updated_at: now,
  });

  db.insert('users', {
    id: r2OwnerId, name: 'Sara Ali', email: 'owner@artisan.com',
    phone: '03219876543', password_hash: hash('owner123'),
    role: 'restaurant_owner', status: 'active', restaurant_id: r2Id,
    created_at: now, updated_at: now,
  });

  db.insert('subscriptions', {
    id: uuid(), restaurant_id: r2Id, plan: 'Standard', status: 'active',
    start_date: now, expiry_date: expiry, amount: 3000,
    payment_status: 'paid', created_at: now,
  });

  // Categories for Artisan Pizza
  const r2Cats = [
    { id: uuid(), name: 'Pizza', desc: 'Handcrafted wood-fired pizzas', order: 1 },
    { id: uuid(), name: 'Pasta', desc: 'Fresh homemade pasta', order: 2 },
    { id: uuid(), name: 'Appetizers', desc: 'Starters and sides', order: 3 },
    { id: uuid(), name: 'Beverages', desc: 'Drinks and shakes', order: 4 },
  ];

  for (const c of r2Cats) {
    db.insert('categories', {
      id: c.id, restaurant_id: r2Id, name: c.name, description: c.desc,
      sort_order: c.order, status: 'active', created_at: now, updated_at: now,
    });
  }

  const r2Items = [
    { catIdx: 0, name: 'Margherita Pizza', desc: 'Classic tomato sauce, mozzarella, fresh basil', price: 950, variants: [{ name: 'Small 8"', price: 950 }, { name: 'Medium 12"', price: 1400 }, { name: 'Large 16"', price: 1900 }] },
    { catIdx: 0, name: 'Pepperoni Pizza', desc: 'Loaded with pepperoni and melted cheese', price: 1100, variants: [{ name: 'Small 8"', price: 1100 }, { name: 'Medium 12"', price: 1600 }, { name: 'Large 16"', price: 2200 }] },
    { catIdx: 0, name: 'BBQ Chicken Pizza', desc: 'BBQ sauce, grilled chicken, red onion, cilantro', price: 1200, variants: [{ name: 'Small 8"', price: 1200 }, { name: 'Medium 12"', price: 1700 }, { name: 'Large 16"', price: 2400 }] },
    { catIdx: 1, name: 'Spaghetti Carbonara', desc: 'Creamy egg sauce with pancetta and parmesan', price: 850, variants: [] },
    { catIdx: 1, name: 'Penne Arrabbiata', desc: 'Spicy tomato sauce with garlic and chili', price: 750, variants: [] },
    { catIdx: 2, name: 'Garlic Bread', desc: 'Toasted bread with garlic butter and herbs', price: 350, variants: [] },
    { catIdx: 2, name: 'Caesar Salad', desc: 'Romaine lettuce, croutons, parmesan, caesar dressing', price: 550, variants: [] },
    { catIdx: 3, name: 'Iced Coffee', desc: 'Cold brew with milk and ice', price: 400, variants: [] },
    { catIdx: 3, name: 'Fresh Juice', desc: 'Seasonal fresh fruit juice', price: 350, variants: [{ name: 'Orange', price: 350 }, { name: 'Mango', price: 400 }] },
  ];

  for (let i = 0; i < r2Items.length; i++) {
    const item = r2Items[i];
    const itemId = uuid();
    db.insert('menu_items', {
      id: itemId, restaurant_id: r2Id, category_id: r2Cats[item.catIdx].id,
      name: item.name, description: item.desc, base_price: item.price,
      available: true, sort_order: i + 1, created_at: now, updated_at: now,
    });
    for (const v of item.variants) {
      db.insert('item_variants', {
        id: uuid(), item_id: itemId, name: v.name, price: v.price, status: 'active',
      });
    }
  }

  // Tables for Artisan Pizza
  for (let t = 1; t <= 4; t++) {
    db.insert('tables', {
      id: uuid(), restaurant_id: r2Id, table_number: t, qr_token: uuid(),
      status: 'active', created_at: now, updated_at: now,
    });
  }

  // ── Restaurant 3: Burgerizza ──
  const r3Id = 'e803fea9-e988-402f-94e0-fa8bce615a26';
  const r3OwnerId = uuid();
  const r3KitchenId = uuid();

  db.insert('restaurants', {
    id: r3Id, name: 'Burgerizza', slug: 'burgerizza',
    logo: 'https://images.unsplash.com/photo-1550547660-d9450f859349?w=300&auto=format&fit=crop&q=80',
    cover_image: 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=1200&auto=format&fit=crop&q=80',
    description: 'Where burger meets Pizza - Serving signature gourmet burgers, crispy broast, and handcrafted pizzas.',
    phone: '03455555590', whatsapp: '03455555590', email: 'burgerizza1@gmail.com',
    address: 'Unit No 06 Near Jazz Point Latifabad', city: 'Hyderabad',
    opening_time: '18:00', closing_time: '05:00',
    status: 'active', is_open: true, accept_orders: true,
    enable_online_ordering: true, enable_dine_in: true, enable_delivery: true,
    package_plan: 'pro',
    delivery_fee: 100, min_order_amount: 500, estimated_delivery_time: '30-45 mins',
    payment_methods: ['cod', 'bank_transfer', 'easypaisa', 'jazzcash'],
    tax_rate: 5, service_charge_rate: 0, currency: 'PKR',
    subscription_status: 'active', subscription_expiry: expiry,
    created_at: now, updated_at: now,
  });

  db.insert('users', {
    id: r3OwnerId, name: 'Nasir', email: 'burgerizza1@gmail.com',
    phone: '03455555590', password_hash: hash('owner123'),
    role: 'restaurant_owner', status: 'active', restaurant_id: r3Id,
    created_at: now, updated_at: now,
  });

  db.insert('users', {
    id: r3KitchenId, name: 'Chef Burgerizza', email: 'kitchen@burgerizza.com',
    phone: '03455555591', password_hash: hash('kitchen123'),
    role: 'kitchen_staff', status: 'active', restaurant_id: r3Id,
    created_at: now, updated_at: now,
  });

  db.insert('subscriptions', {
    id: uuid(), restaurant_id: r3Id, plan: 'Pro', status: 'active',
    start_date: now, expiry_date: expiry, amount: 5000,
    payment_status: 'paid', created_at: now,
  });

  const r3Cats = [
    { id: uuid(), name: 'Burgers & Sandwiches', desc: 'Signature gourmet burgers & toasted sandwiches', order: 1, image: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=600&auto=format&fit=crop&q=80' },
    { id: uuid(), name: 'Crispy Broast', desc: 'Golden crispy fried broast with signature spices', order: 2, image: 'https://images.unsplash.com/photo-1626082927389-6cd097cdc6ec?w=600&auto=format&fit=crop&q=80' },
    { id: uuid(), name: 'Handcrafted Pizzas', desc: 'Cheesy hot-crust stone-baked pizzas', order: 3, image: 'https://images.unsplash.com/photo-1513104890138-7c749659a591?w=600&auto=format&fit=crop&q=80' },
    { id: uuid(), name: 'Sides & Beverages', desc: 'Loaded fries and chilled refreshments', order: 4, image: 'https://images.unsplash.com/photo-1551024709-8f23befc6f87?w=600&auto=format&fit=crop&q=80' },
  ];

  for (const c of r3Cats) {
    db.insert('categories', {
      id: c.id, restaurant_id: r3Id, name: c.name, description: c.desc, image: c.image,
      sort_order: c.order, status: 'active', created_at: now, updated_at: now,
    });
  }

  const r3Items = [
    { catIdx: 0, name: 'Steak Burger', desc: 'Juicy tender steak patty with caramelized onions, cheddar cheese and signature sauces', price: 500, origPrice: 600, image: 'https://images.unsplash.com/photo-1586190848861-99aa4a171e90?w=600&auto=format&fit=crop&q=80', variants: [{ name: 'Single Patty', price: 500 }, { name: 'Double Patty', price: 750 }] },
    { catIdx: 0, name: 'Crunch Burger', desc: 'Extra crispy golden fried chicken fillet topped with fresh iceberg and spicy mayo', price: 399, origPrice: 500, image: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=600&auto=format&fit=crop&q=80', variants: [{ name: 'Classic Regular', price: 399 }, { name: 'Spicy Zinger', price: 449 }] },
    { catIdx: 0, name: 'Mexican Sandwich', desc: 'Spicy Mexican grilled chicken strips loaded in toasted artisan bread with jalapenos', price: 499, origPrice: 599, image: 'https://images.unsplash.com/photo-1528735602780-2552fd46c7af?w=600&auto=format&fit=crop&q=80', variants: [] },
    { catIdx: 0, name: 'Club Sandwiches', desc: 'Classic triple layer club sandwich with shredded chicken, boiled egg, cheese and salad', price: 450, origPrice: 550, image: 'https://images.unsplash.com/photo-1553909489-cd47e0907980?w=600&auto=format&fit=crop&q=80', variants: [] },
    { catIdx: 0, name: 'BBQ Club Sandwiches', desc: 'Smokey BBQ shredded chicken club sandwich served with french fries and garlic mayo', price: 399, origPrice: 500, image: 'https://images.unsplash.com/photo-1509722747041-616f39b57569?w=600&auto=format&fit=crop&q=80', variants: [] },
    { catIdx: 1, name: 'Plain Broast', desc: 'Quarter crispy golden fried broast served with french fries, garlic sauce and dinner roll', price: 450, origPrice: 550, image: 'https://images.unsplash.com/photo-1626082927389-6cd097cdc6ec?w=600&auto=format&fit=crop&q=80', variants: [{ name: 'Quarter (1 Pc)', price: 450 }, { name: 'Half (2 Pcs)', price: 850 }] },
    { catIdx: 1, name: 'Injected Broast', desc: 'Special secret spiced sauce injected deep into the chicken meat for explosive tenderness and flavor', price: 599, origPrice: 700, image: 'https://images.unsplash.com/photo-1562967914-608f82629710?w=600&auto=format&fit=crop&q=80', variants: [{ name: 'Quarter (1 Pc)', price: 599 }, { name: 'Half (2 Pcs)', price: 1100 }] },
    { catIdx: 1, name: 'Spicy Masala Broast', desc: 'Quarter crispy broast generously tossed in hot peri-peri style aromatic red masala', price: 450, origPrice: 550, image: 'https://images.unsplash.com/photo-1626645738196-c2a7c87a8f58?w=600&auto=format&fit=crop&q=80', variants: [{ name: 'Quarter (1 Pc)', price: 450 }, { name: 'Half (2 Pcs)', price: 850 }] },
    { catIdx: 2, name: 'Pizza Tikka', desc: 'Topped with spicy marinated chicken tikka chunks, onions, green peppers and melted mozzarella cheese', price: 500, origPrice: 650, image: 'https://images.unsplash.com/photo-1513104890138-7c749659a591?w=600&auto=format&fit=crop&q=80', variants: [{ name: 'Small 8"', price: 500 }, { name: 'Medium 10"', price: 950 }, { name: 'Large 13"', price: 1450 }] },
    { catIdx: 2, name: 'Pizza Fajita', desc: 'Smokey chicken fajita chunks, capsicum, olives, mushrooms and generous mozzarella cheese layer', price: 550, origPrice: 700, image: 'https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=600&auto=format&fit=crop&q=80', variants: [{ name: 'Small 8"', price: 550 }, { name: 'Medium 10"', price: 1050 }, { name: 'Large 13"', price: 1550 }] },
    { catIdx: 3, name: 'Loaded Fries', desc: 'Crispy french fries loaded with cheddar cheese sauce, chicken chunks and sliced jalapenos', price: 350, origPrice: 450, image: 'https://images.unsplash.com/photo-1585109649139-366815a0d713?w=600&auto=format&fit=crop&q=80', variants: [] },
    { catIdx: 3, name: 'Coca Cola / Soft Drinks', desc: 'Chilled refreshing soft drinks', price: 120, origPrice: 140, image: 'https://images.unsplash.com/photo-1622483767028-3f66f32aef97?w=600&auto=format&fit=crop&q=80', variants: [{ name: 'Regular 500ml', price: 120 }, { name: 'Large 1.5L', price: 250 }] },
  ];

  for (let i = 0; i < r3Items.length; i++) {
    const item = r3Items[i];
    const itemId = uuid();
    db.insert('menu_items', {
      id: itemId, restaurant_id: r3Id, category_id: r3Cats[item.catIdx].id,
      name: item.name, description: item.desc, base_price: item.price, original_price: item.origPrice,
      image: item.image,
      available: true, sort_order: i + 1, created_at: now, updated_at: now,
    });
    for (const v of item.variants) {
      db.insert('item_variants', {
        id: uuid(), item_id: itemId, name: v.name, price: v.price, status: 'active',
      });
    }
  }

  for (let t = 1; t <= 8; t++) {
    db.insert('tables', {
      id: uuid(), restaurant_id: r3Id, table_number: t, qr_token: uuid(),
      status: 'active', created_at: now, updated_at: now,
    });
  }

  // Audit logs
  db.insert('audit_logs', { id: uuid(), user_id: adminId, action: 'restaurant_created', entity_type: 'restaurant', entity_id: r1Id, metadata: JSON.stringify({ name: 'Royal Karahi' }), created_at: now });
  db.insert('audit_logs', { id: uuid(), user_id: adminId, action: 'restaurant_created', entity_type: 'restaurant', entity_id: r2Id, metadata: JSON.stringify({ name: 'Artisan Pizza & Pasta' }), created_at: now });
  db.insert('audit_logs', { id: uuid(), user_id: adminId, action: 'restaurant_created', entity_type: 'restaurant', entity_id: r3Id, metadata: JSON.stringify({ name: 'Burgerizza' }), created_at: now });

  db.forceSave();
  console.log('✅ Database seeded successfully!');
  console.log('   Super Admin: admin@dineflow.com / admin123');
  console.log('   Royal Karahi Owner: owner@royalkarahi.com / owner123');
  console.log('   Burgerizza Owner: burgerizza1@gmail.com / owner123');
  console.log('   Artisan Pizza Owner: owner@artisan.com / owner123');
}

seed().catch(console.error);
