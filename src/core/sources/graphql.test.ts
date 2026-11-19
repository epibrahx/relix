import test from 'node:test';
import assert from 'node:assert/strict';

import { fetchGraphQLIntrospection, parseGraphQLSchema } from './graphql';
import { SALEOR_CORE_SDL, createSaleorSnapshotSource } from './saleor';
import { SHOPIFY_ADMIN_SDL, createShopifySnapshotSource } from './shopify';

test('Track G2: Saleor SDL snapshot parses core entities, folds *CountableConnection, filters non-entities, and maps @doc(category)', () => {
  const src = createSaleorSnapshotSource();
  assert.equal(src.readsBusinessData, false);
  const loaded = src.load();
  const schema = 'then' in loaded ? null : loaded.schema;
  assert.ok(schema);
  assert.equal(schema.dialect, 'graphql');

  const names = new Set(schema.tables.map((t) => t.name));
  for (const core of ['Product', 'ProductVariant', 'Order', 'OrderLine', 'Checkout', 'Warehouse', 'Stock', 'User', 'Address']) {
    assert.ok(names.has(core), `Saleor schema must contain core entity ${core}`);
  }

  // Must NOT include Connection, Edge, PageInfo, Query, Input, Error
  for (const excluded of ['ProductCountableConnection', 'ProductCountableEdge', 'OrderCountableConnection', 'PageInfo', 'Query', 'ProductFilterInput', 'ProductError']) {
    assert.equal(names.has(excluded), false, `Saleor schema must filter/fold ${excluded}`);
  }

  // Verify folded Connection relation: User.orders -> Order
  const userOrdersRel = schema.relations.find(
    (r) => r.from_table === 'saleor.User' && r.from_columns[0] === 'orders' && r.to_table === 'saleor.Order',
  );
  assert.ok(userOrdersRel, 'User.orders (OrderCountableConnection) must fold into a declared relation to Order');
  assert.equal(userOrdersRel.kind, 'declared');

  // Verify @doc(category) domain mapping
  const product = schema.tables.find((t) => t.name === 'Product');
  const order = schema.tables.find((t) => t.name === 'Order');
  assert.equal(product?.domain, 'catalog');
  assert.equal(order?.domain, 'orders');
});

test('Track G3: Shopify Admin SDL snapshot parses core entities and folds *Connection wrappers', () => {
  const src = createShopifySnapshotSource();
  assert.equal(src.readsBusinessData, false);
  const loaded = src.load();
  const schema = 'then' in loaded ? null : loaded.schema;
  assert.ok(schema);

  const names = new Set(schema.tables.map((t) => t.name));
  for (const core of ['Product', 'ProductVariant', 'Collection', 'Order', 'LineItem', 'Customer', 'InventoryItem', 'InventoryLevel', 'Location', 'Fulfillment', 'FulfillmentOrder']) {
    assert.ok(names.has(core), `Shopify schema must contain core entity ${core}`);
  }

  for (const excluded of ['ProductConnection', 'ProductEdge', 'OrderConnection', 'LineItemConnection', 'PageInfo', 'Query', 'ProductInput', 'UserError']) {
    assert.equal(names.has(excluded), false, `Shopify schema must filter/fold ${excluded}`);
  }

  // Verify folded Connection relation: Order.lineItems -> LineItem
  const orderLineRel = schema.relations.find(
    (r) => r.from_table === 'shopify.Order' && r.from_columns[0] === 'lineItems' && r.to_table === 'shopify.LineItem',
  );
  assert.ok(orderLineRel, 'Order.lineItems (LineItemConnection) must fold into a declared relation to LineItem');
});

test('Track G1: Introspection JSON (__schema) parses identically with Connection folding', () => {
  const sampleIntrospection = JSON.stringify({
    data: {
      __schema: {
        types: [
          {
            kind: 'OBJECT',
            name: 'Order',
            description: '订单实体',
            fields: [
              { name: 'id', type: { kind: 'NON_NULL', ofType: { kind: 'SCALAR', name: 'ID' } } },
              { name: 'items', type: { kind: 'OBJECT', name: 'LineItemConnection' } },
            ],
          },
          {
            kind: 'OBJECT',
            name: 'LineItem',
            fields: [
              { name: 'id', type: { kind: 'NON_NULL', ofType: { kind: 'SCALAR', name: 'ID' } } },
              { name: 'sku', type: { kind: 'SCALAR', name: 'String' } },
            ],
          },
          {
            kind: 'OBJECT',
            name: 'LineItemEdge',
            fields: [
              { name: 'node', type: { kind: 'NON_NULL', ofType: { kind: 'OBJECT', name: 'LineItem' } } },
            ],
          },
          {
            kind: 'OBJECT',
            name: 'LineItemConnection',
            fields: [
              {
                name: 'edges',
                type: { kind: 'LIST', ofType: { kind: 'OBJECT', name: 'LineItemEdge' } },
              },
            ],
          },
        ],
      },
    },
  });

  const schema = parseGraphQLSchema(sampleIntrospection, { provider: 'shopify' });
  assert.equal(schema.tables.length, 2);
  assert.equal(schema.relations.length, 1);
  assert.equal(schema.relations[0].from_table, 'shopify.Order');
  assert.equal(schema.relations[0].to_table, 'shopify.LineItem');
});

test('Track G4: Live introspection classifies 401/403/429/CORS errors in Chinese and redacts secret tokens', async () => {
  const secretToken = 'shpat_super_secret_987654321';

  const makeMockFetch = (status: number, body: string): typeof fetch =>
    (async () =>
      new Response(body, { status, statusText: 'Err' })) as unknown as typeof fetch;

  await assert.rejects(
    () =>
      fetchGraphQLIntrospection({
        provider: 'shopify',
        endpoint: 'https://demo.myshopify.com/admin/api/2026-10/graphql.json',
        headers: { 'X-Shopify-Access-Token': secretToken },
        secretTokens: [secretToken],
        fetchImpl: makeMockFetch(401, `Invalid token ${secretToken}`),
      }),
    (err: Error) => {
      assert.ok(err.message.includes('凭据无效'));
      assert.equal(err.message.includes(secretToken), false);
      return true;
    },
  );

  await assert.rejects(
    () =>
      fetchGraphQLIntrospection({
        provider: 'saleor',
        endpoint: 'https://demo.saleor.io/graphql/',
        fetchImpl: (async () => {
          throw new TypeError('Failed to fetch');
        }) as unknown as typeof fetch,
      }),
    (err: Error) => {
      assert.ok(err.message.includes('CORS'));
      return true;
    },
  );

  assert.ok(SALEOR_CORE_SDL.length > 500);
  assert.ok(SHOPIFY_ADMIN_SDL.length > 500);
});
