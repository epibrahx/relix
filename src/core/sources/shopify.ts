import { loadPersistedConfig } from '../config';
import { fetchGraphQLIntrospection, parseGraphQLSchema } from './graphql';
import { LoadedSource, SchemaSource } from './types';

export const SHOPIFY_SNAPSHOT_VERSION = 'Shopify Admin 2026-10';
export const SHOPIFY_SNAPSHOT_DATE = '2026-11-18';
export const SHOPIFY_PUBLIC_PROXY_BASE = 'https://shopify.dev/admin-graphql-direct-proxy';

/**
 * Curated Shopify Admin GraphQL SDL snapshot preserving authentic Shopify Admin
 * API core entities, `*Connection` Relay wrappers, and bilingual field descriptions.
 */
export const SHOPIFY_ADMIN_SDL = `
scalar DateTime
scalar Decimal
scalar URL
scalar UnsignedInt64
scalar JSON

enum ProductStatus {
  ACTIVE
  ARCHIVED
  DRAFT
}

enum OrderDisplayFinancialStatus {
  PENDING
  AUTHORIZED
  PARTIALLY_PAID
  PAID
  PARTIALLY_REFUNDED
  REFUNDED
  VOIDED
}

enum OrderDisplayFulfillmentStatus {
  UNFULFILLED
  PARTIALLY_FULFILLED
  FULFILLED
  ON_HOLD
  SCHEDULED
}

enum FulfillmentOrderStatus {
  OPEN
  IN_PROGRESS
  SCHEDULED
  ON_HOLD
  CLOSED
  CANCELLED
}

type PageInfo {
  hasNextPage: Boolean!
  hasPreviousPage: Boolean!
}

"""Shopify 商品主实体（Product）：包含标题、Handle、状态、变体与媒体资源"""
type Product @doc(category: "Catalog") {
  "Shopify GID（gid://shopify/Product/...）"
  id: ID!
  "商品 URL Handle"
  handle: String!
  "商品标题"
  title: String!
  "品牌/供应商"
  vendor: String!
  "商品分类标签"
  productType: String!
  "上架状态（ACTIVE / DRAFT / ARCHIVED）"
  status: ProductStatus!
  "SKU 变体分页集合"
  variants: ProductVariantConnection!
  "所属集合"
  collections: CollectionConnection!
  "关联图片与视频媒体"
  media: MediaConnection!
  createdAt: DateTime!
  updatedAt: DateTime!
}

"""Shopify 商品变体（SKU）：挂接商品与库存条目"""
type ProductVariant @doc(category: "Catalog") {
  id: ID!
  title: String!
  "SKU 货号"
  sku: String
  "条形码"
  barcode: String
  "销售单价"
  price: Decimal!
  "划线原价"
  compareAtPrice: Decimal
  "可售库存总数"
  inventoryQuantity: Int
  "所属商品"
  product: Product!
  "对应的库存管理条目"
  inventoryItem: InventoryItem!
  createdAt: DateTime!
}

"""商品集合（手动集合或智能规则集合）"""
type Collection @doc(category: "Catalog") {
  id: ID!
  handle: String!
  title: String!
  description: String
  "集合内商品"
  products: ProductConnection!
  updatedAt: DateTime!
}

"""商品媒体资源（图片 / 3D 模型 / 视频）"""
type Media @doc(category: "Catalog") {
  id: ID!
  alt: String
  mediaContentType: String!
  previewUrl: URL
}

"""库存条目（InventoryItem）：跨多仓位跟踪 SKU 成本与库存"""
type InventoryItem @doc(category: "Inventory") {
  id: ID!
  sku: String
  "是否跟踪库存"
  tracked: Boolean!
  "是否需要物流配送"
  requiresShipping: Boolean!
  "采购单位成本"
  unitCostAmount: Decimal
  "所属变体"
  variant: ProductVariant
  "各仓库/门店的库存水位"
  inventoryLevels: InventoryLevelConnection!
  updatedAt: DateTime!
}

"""库位库存水位（InventoryLevel）：记录特定仓库下某 SKU 的可用量"""
type InventoryLevel @doc(category: "Inventory") {
  id: ID!
  "可用库存数量"
  available: Int!
  "在途补货数量"
  incoming: Int!
  "所属库存条目"
  item: InventoryItem!
  "所在仓库/门店位置"
  location: Location!
  updatedAt: DateTime!
}

"""仓库与线下门店位置（Location）"""
type Location @doc(category: "Inventory") {
  id: ID!
  name: String!
  isActive: Boolean!
  fulfillsOnlineOrders: Boolean!
  "仓库物理地址"
  address: MailingAddress!
  "该位置的全部库存水位"
  inventoryLevels: InventoryLevelConnection!
}

"""Shopify 订单（Order）：连接买家、订单行、履约单与发货记录"""
type Order @doc(category: "Orders") {
  id: ID!
  "订单展示号（如 #1001）"
  name: String!
  email: String
  "财务支付状态"
  displayFinancialStatus: OrderDisplayFinancialStatus
  "履约发货状态"
  displayFulfillmentStatus: OrderDisplayFulfillmentStatus!
  "订单实付总金额"
  totalPriceAmount: Decimal!
  "币种代码"
  currencyCode: String!
  "下单客户"
  customer: Customer
  "收货地址"
  shippingAddress: MailingAddress
  "账单地址"
  billingAddress: MailingAddress
  "订单商品明细行"
  lineItems: LineItemConnection!
  "履约指令单"
  fulfillmentOrders: FulfillmentOrderConnection!
  "已生成的发货单"
  fulfillments: [Fulfillment!]!
  "使用的促销折扣"
  discountNode: DiscountNode
  createdAt: DateTime!
}

"""订单商品明细行（LineItem）"""
type LineItem @doc(category: "Orders") {
  id: ID!
  title: String!
  sku: String
  quantity: Int!
  originalUnitPriceAmount: Decimal!
  "关联商品"
  product: Product
  "关联变体"
  variant: ProductVariant
}

"""草稿订单（DraftOrder）：用于 B2B 报价单或客服代下单"""
type DraftOrder @doc(category: "Orders") {
  id: ID!
  name: String!
  status: String!
  "关联客户"
  customer: Customer
  "转化生成的正式订单"
  order: Order
  "草稿商品行"
  lineItems: LineItemConnection!
  "收货地址"
  shippingAddress: MailingAddress
  createdAt: DateTime!
}

"""履约指令单（FulfillmentOrder）：分配给具体仓库执行的发货任务"""
type FulfillmentOrder @doc(category: "Inventory") {
  id: ID!
  status: FulfillmentOrderStatus!
  "所属订单"
  order: Order!
  "指派履约仓库"
  assignedLocation: Location!
  "关联发货单"
  fulfillments: FulfillmentConnection!
  fulfillAt: DateTime
}

"""发货单（Fulfillment）：记录承运商、运单号与发货状态"""
type Fulfillment @doc(category: "Inventory") {
  id: ID!
  status: String!
  trackingCompany: String
  trackingNumber: String
  "所属订单"
  order: Order!
  "出库仓库"
  location: Location
  createdAt: DateTime!
}

"""客户档案（Customer）"""
type Customer @doc(category: "Customers") {
  id: ID!
  email: String
  firstName: String
  lastName: String
  phone: String
  "历史订单总数"
  numberOfOrders: UnsignedInt64!
  "默认收货地址"
  defaultAddress: MailingAddress
  "客户地址簿"
  addresses: [MailingAddress!]!
  "客户历史订单"
  orders: OrderConnection!
  createdAt: DateTime!
}

"""邮寄地址（MailingAddress）"""
type MailingAddress @doc(category: "Customers") {
  id: ID!
  address1: String
  city: String
  province: String
  country: String
  zip: String
  phone: String
}

"""促销折扣节点（DiscountNode）"""
type DiscountNode @doc(category: "Billing") {
  id: ID!
  title: String!
  code: String
  status: String!
  startsAt: DateTime!
  endsAt: DateTime
}

"""跨境市场（Market）：管理区域币种与定价目录"""
type Market @doc(category: "Channels") {
  id: ID!
  name: String!
  handle: String!
  enabled: Boolean!
  primary: Boolean!
}

# Shopify Relay Connection wrappers (folded by RELIX into 1:N relations)
type ProductEdge { node: Product! cursor: String! }
type ProductConnection { edges: [ProductEdge!]! nodes: [Product!]! pageInfo: PageInfo! }

type ProductVariantEdge { node: ProductVariant! cursor: String! }
type ProductVariantConnection { edges: [ProductVariantEdge!]! nodes: [ProductVariant!]! pageInfo: PageInfo! }

type CollectionEdge { node: Collection! cursor: String! }
type CollectionConnection { edges: [CollectionEdge!]! nodes: [Collection!]! pageInfo: PageInfo! }

type MediaEdge { node: Media! cursor: String! }
type MediaConnection { edges: [MediaEdge!]! nodes: [Media!]! pageInfo: PageInfo! }

type InventoryLevelEdge { node: InventoryLevel! cursor: String! }
type InventoryLevelConnection { edges: [InventoryLevelEdge!]! nodes: [InventoryLevel!]! pageInfo: PageInfo! }

type OrderEdge { node: Order! cursor: String! }
type OrderConnection { edges: [OrderEdge!]! nodes: [Order!]! pageInfo: PageInfo! }

type LineItemEdge { node: LineItem! cursor: String! }
type LineItemConnection { edges: [LineItemEdge!]! nodes: [LineItem!]! pageInfo: PageInfo! }

type FulfillmentOrderEdge { node: FulfillmentOrder! cursor: String! }
type FulfillmentOrderConnection { edges: [FulfillmentOrderEdge!]! nodes: [FulfillmentOrder!]! pageInfo: PageInfo! }

type FulfillmentEdge { node: Fulfillment! cursor: String! }
type FulfillmentConnection { edges: [FulfillmentEdge!]! nodes: [Fulfillment!]! pageInfo: PageInfo! }

# Non-entity root & input types (filtered out by RELIX)
type Query {
  products(first: Int): ProductConnection!
  orders(first: Int): OrderConnection!
}
input ProductInput { title: String }
type UserError { field: [String!] message: String! }
`.trim();

export function createShopifySnapshotSource(): SchemaSource {
  return {
    id: 'graphql:shopify:snapshot',
    provider: 'shopify',
    readsBusinessData: false,
    load(): LoadedSource {
      const schema = parseGraphQLSchema(SHOPIFY_ADMIN_SDL, {
        provider: 'shopify',
        schemaName: 'shopify',
        version: SHOPIFY_SNAPSHOT_VERSION,
        fetchedAt: SHOPIFY_SNAPSHOT_DATE,
      });
      const sourceKey = 'graphql:shopify:snapshot';
      return {
        schema,
        rawSql: SHOPIFY_ADMIN_SDL,
        rawFormat: 'graphql',
        sourceLabel: `Shopify Admin · ${SHOPIFY_SNAPSHOT_VERSION}`,
        sourceKey,
        config: loadPersistedConfig(sourceKey),
        spec: { type: 'graphql_snapshot', provider: 'shopify' },
        snapshotVersion: SHOPIFY_SNAPSHOT_VERSION,
        snapshotTime: SHOPIFY_SNAPSHOT_DATE,
      };
    },
  };
}

export function loadShopifyFromContent(content: string, label: string): LoadedSource {
  const fetchedAt = new Date().toISOString().slice(0, 10);
  const schema = parseGraphQLSchema(content, {
    provider: 'shopify',
    schemaName: 'shopify',
    version: label,
    fetchedAt,
  });
  const sourceKey = `graphql:shopify:file:${label}`;
  return {
    schema,
    rawSql: content,
    rawFormat: content.trim().startsWith('{') ? 'json' : 'graphql',
    sourceLabel: `Shopify · ${label}`,
    sourceKey,
    config: loadPersistedConfig(sourceKey),
    spec: { type: 'graphql_sdl', provider: 'shopify', label, content },
    snapshotVersion: label,
    snapshotTime: fetchedAt,
  };
}

export async function fetchShopifyLiveSource(params: {
  endpoint: string;
  accessToken?: string;
  apiVersion?: string;
}): Promise<LoadedSource> {
  const cleanToken = params.accessToken?.trim() ?? '';
  const headers: Record<string, string> = {};
  if (cleanToken) {
    headers['X-Shopify-Access-Token'] = cleanToken;
  }

  const versionLabel = params.apiVersion?.trim() || '2026-10';
  const { schema, rawJson } = await fetchGraphQLIntrospection({
    provider: 'shopify',
    endpoint: params.endpoint,
    headers,
    secretTokens: cleanToken ? [cleanToken] : [],
    version: `Shopify Admin ${versionLabel}`,
  });

  const safeHost = (() => {
    try {
      return new URL(params.endpoint).host;
    } catch {
      return 'shopify';
    }
  })();

  const sourceKey = `graphql:shopify:live:${safeHost}:${versionLabel}`;
  return {
    schema,
    rawSql: rawJson,
    rawFormat: 'json',
    sourceLabel: `Shopify (${safeHost} · ${versionLabel})`,
    sourceKey,
    config: loadPersistedConfig(sourceKey),
    spec: {
      type: 'graphql_live',
      provider: 'shopify',
      endpoint: params.endpoint,
      apiVersion: versionLabel,
      label: safeHost,
    },
    snapshotVersion: `Admin ${versionLabel}`,
    snapshotTime: schema.source_meta?.fetched_at,
  };
}
