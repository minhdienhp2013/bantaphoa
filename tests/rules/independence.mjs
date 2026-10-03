import { readFileSync } from 'node:fs';
import { before, after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { ref, get, set, update } from 'firebase/database';
let env;
before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-bantaphoa',
    database: { host: '127.0.0.1', port: 9000, rules: readFileSync(new URL('../../database.rules.json', import.meta.url), 'utf8') },
  });
});
after(async () => { await env?.cleanup(); });
beforeEach(async () => {
  await env.clearDatabase();
  await env.withSecurityRulesDisabled(async (context) => set(ref(context.database()), {
    users: {
      owner: { uid: 'owner', displayName: 'Owner', role: 'owner', active: true, createdAt: 1, updatedAt: 1 },
      staff: { uid: 'staff', displayName: 'Staff', role: 'staff', active: true, permissions: { sales: true, products: true }, createdAt: 1, updatedAt: 1 },
      denied: { uid: 'denied', displayName: 'Denied', role: 'staff', active: true, permissions: { sales: false }, createdAt: 1, updatedAt: 1 },
    },
    products: { p1: { id: 'p1', sku: 'COCA', name: 'Coca', costPrice: 6000, salePrice: 10000, stockQuantity: 10, stockVersion: 0, active: true, createdAt: 1, updatedAt: 1 } },
  }));
});
const sale = {
  id: 's1', code: 'BH-TEST', saleKind: 'product', status: 'completed', createdBy: 'staff', createdAt: 2, updatedAt: 2,
  subtotal: 20000, discount: 1000, total: 19000, costTotal: 12000, profit: 7000, paymentMethod: 'cash',
  items: [{ productId: 'p1', sku: 'COCA', name: 'Coca', quantity: 2, unitPrice: 10000, costPrice: 6000, lineTotal: 20000 }],
};
function saleUpdates() {
  return {
    'sales/s1': sale,
    'stockOperations/SALE_s1': { id: 'SALE_s1', type: 'SALE', referenceType: 'sale', referenceId: 's1', actorUid: 'staff', createdAt: 2 },
    'products/p1/stockQuantity': 8, 'products/p1/stockVersion': 1, 'products/p1/lastStockOperationId': 'SALE_s1',
  };
}
test('root access and retired AI/service branches remain denied', async () => {
  await assertFails(get(ref(env.unauthenticatedContext().database(), 'products')));
  const db = env.authenticatedContext('owner').database();
  await assertFails(get(ref(db)));
  for (const path of ['quickServiceSales', 'salesAiLearning', 'salesAiLearningComponents', 'salesAiLearningEvents']) {
    await assertFails(get(ref(db, path)));
    await assertFails(set(ref(db, `${path}/x`), { id: 'x' }));
  }
});
test('staff permissions are enforced and valid sale+stock CAS remains atomic', async () => {
  const db = env.authenticatedContext('staff').database();
  await assertSucceeds(get(ref(db, 'products')));
  await assertFails(update(ref(env.authenticatedContext('denied').database()), saleUpdates()));
  await assertFails(set(ref(db, 'sales/s1'), sale));
  await assertSucceeds(update(ref(db), saleUpdates()));
  assert.equal((await get(ref(db, 'products/p1/stockQuantity'))).val(), 8);
  await assertFails(update(ref(db), saleUpdates()));
  await assertFails(update(ref(db, 'products/p1'), { stockQuantity: 7, stockVersion: 1 }));
  assert.equal((await get(ref(db, 'products/p1/stockQuantity'))).val(), 8);
});
test('service sale cannot be written into product sales', async () => {
  const updates = saleUpdates();
  updates['sales/s1'] = { ...sale, saleKind: 'quick_service', serviceCategory: 'photo' };
  await assertFails(update(ref(env.authenticatedContext('staff').database()), updates));
});

test('only existing owner can manage staff; no client owner bootstrap or promotion', async () => {
  const ownerDb = env.authenticatedContext('owner').database();
  const staffDb = env.authenticatedContext('staff').database();
  const profile = { uid: 'new-user', displayName: 'New', role: 'owner', active: true, createdAt: 1, updatedAt: 1 };
  await assertFails(set(ref(env.authenticatedContext('new-user').database(), 'users/new-user'), profile));
  await assertFails(set(ref(ownerDb, 'users/new-user'), profile));
  await assertFails(update(ref(staffDb, 'users/staff'), { role: 'owner' }));
  await assertFails(update(ref(staffDb, 'users/staff/permissions'), { reports: true }));
  await assertSucceeds(set(ref(ownerDb, 'users/new-user'), { ...profile, role: 'staff', permissions: { sales: true } }));
  await assertFails(update(ref(ownerDb, 'users/new-user'), { role: 'owner', permissions: null }));
  await assertSucceeds(update(ref(ownerDb, 'users/owner'), { displayName: 'Chủ cửa hàng mới' }));
  await assertFails(update(ref(ownerDb, 'users/owner'), { role: 'staff' }));
  await assertFails(update(ref(ownerDb, 'users/owner'), { active: false }));
});
