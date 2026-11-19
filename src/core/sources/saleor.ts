import { loadPersistedConfig } from '../config';
import { fetchGraphQLIntrospection, parseGraphQLSchema } from './graphql';
import { LoadedSource, SchemaSource } from './types';

export const SALEOR_SNAPSHOT_VERSION = 'Saleor 3.20 (Core SDL)';
export const SALEOR_SNAPSHOT_DATE = '2026-11-18';

/**
 * Curated core Saleor GraphQL SDL snapshot preserving authentic Saleor types,
 * `@doc(category: ...)` domain directives, and `*CountableConnection` Relay wrappers.
 */
export const SALEOR_CORE_SDL = `
scalar DateTime
scalar Decimal
scalar JSONString
scalar UUID

enum OrderStatus {
  DRAFT
  UNCONFIRMED
  UNFULFILLED
  PARTIALLY_FULFILLED
  FULFILLED
  CANCELED
}

enum PaymentChargeStatusEnum {
  NOT_CHARGED
  PENDING
  PARTIALLY_CHARGED
  FULLY_CHARGED
  PARTIALLY_REFUNDED
  FULLY_REFUNDED
}

enum FulfillmentStatus {
  FULFILLED
  REFUNDED
  RETURNED
  CANCELED
  WAITING_FOR_APPROVAL
}

type PageInfo {
  hasNextPage: Boolean!
  hasPreviousPage: Boolean!
  startCursor: String
  endCursor: String
}

"""商品主表（SPU）：定义商品名称、类目、商品类型与多渠道上架信息"""
type Product @doc(category: "Catalog") {
  "全局唯一 ID"
  id: ID!
  "商品 URL Slug"
  slug: String!
  "商品名称"
  name: String!
  "富文本描述（EditorJS JSON）"
  description: JSONString
  "所属商品类型"
  productType: ProductType!
  "所属商品类目"
  category: Category
  "默认 SKU 变体"
  defaultVariant: ProductVariant
  "下属 SKU 变体列表"
  variants: [ProductVariant!]
  "所属营销集合"
  collections: [Collection!]
  "渠道定价与上架配置"
  channelListings: [ProductChannelListing!]
  "是否可销售"
  isAvailableForPurchase: Boolean
  "最后更新时间"
  updatedAt: DateTime!
}

"""商品变体（SKU）：定义货号、库存与渠道价格"""
type ProductVariant @doc(category: "Catalog") {
  id: ID!
  "SKU 编码"
  sku: String
  "变体名称"
  name: String!
  "所属商品 SPU"
  product: Product!
  "是否跟踪库存"
  trackInventory: Boolean!
  "各仓库库存记录"
  stocks: [Stock!]
  "渠道售价配置"
  channelListings: [ProductVariantChannelListing!]
  updatedAt: DateTime!
}

"""商品类型：决定商品及变体的属性模板与物流属性"""
type ProductType @doc(category: "Catalog") {
  id: ID!
  name: String!
  slug: String!
  "是否需要物流配送"
  isShippingRequired: Boolean!
  "是否为数字商品"
  isDigital: Boolean!
  "该类型下的商品"
  products: ProductCountableConnection
}

"""商品类目树：支持多级父子类目"""
type Category @doc(category: "Catalog") {
  id: ID!
  name: String!
  slug: String!
  level: Int!
  "上级类目"
  parent: Category
  "下级子类目"
  children: CategoryCountableConnection
  "类目下的商品"
  products: ProductCountableConnection
}

"""营销商品集合"""
type Collection @doc(category: "Catalog") {
  id: ID!
  name: String!
  slug: String!
  "集合内商品"
  products: ProductCountableConnection
}

"""销售渠道：按国家、币种隔离定价与库存"""
type Channel @doc(category: "Channels") {
  id: ID!
  slug: String!
  name: String!
  isActive: Boolean!
  "默认币种代码（如 USD / CNY）"
  currencyCode: String!
  "关联的履约仓库"
  warehouses: [Warehouse!]!
}

"""商品渠道上架与可见性配置"""
type ProductChannelListing @doc(category: "Channels") {
  id: ID!
  channel: Channel!
  isPublished: Boolean!
  visibleInListings: Boolean!
  availableForPurchaseAt: DateTime
}

"""变体渠道售价配置"""
type ProductVariantChannelListing @doc(category: "Channels") {
  id: ID!
  channel: Channel!
  priceAmount: Decimal!
  costPriceAmount: Decimal
}

"""仓库：管理实体库位与可履约区域"""
type Warehouse @doc(category: "Inventory") {
  id: ID!
  name: String!
  slug: String!
  email: String!
  "仓库地址"
  address: Address!
  "仓库内 SKU 库存"
  stocks: StockCountableConnection
}

"""SKU 仓库库存：记录在库量与已锁定配额"""
type Stock @doc(category: "Inventory") {
  id: ID!
  warehouse: Warehouse!
  productVariant: ProductVariant!
  "在库总数量"
  quantity: Int!
  "已被订单锁定的数量"
  quantityAllocated: Int!
}

"""订单库存锁定记录"""
type Allocation @doc(category: "Inventory") {
  id: ID!
  "锁定的库存记录"
  stock: Stock!
  "锁定数量"
  quantity: Int!
}

"""结算单（购物车）：下单前的商品与运费暂存状态"""
type Checkout @doc(category: "Orders") {
  id: ID!
  token: UUID!
  email: String
  "所属销售渠道"
  channel: Channel!
  "关联下单用户"
  user: User
  "收货地址"
  shippingAddress: Address
  "账单地址"
  billingAddress: Address
  "购物车明细行"
  lines: [CheckoutLine!]!
  created: DateTime!
  updatedAt: DateTime!
}

"""结算单明细行"""
type CheckoutLine @doc(category: "Orders") {
  id: ID!
  variant: ProductVariant!
  quantity: Int!
  totalPriceAmount: Decimal!
}

"""销售订单：聚合买家、渠道、履约与支付交易"""
type Order @doc(category: "Orders") {
  id: ID!
  "订单展示编号"
  number: String!
  "订单状态"
  status: OrderStatus!
  "支付状态"
  paymentStatus: PaymentChargeStatusEnum!
  "所属销售渠道"
  channel: Channel!
  "下单客户"
  user: User
  "收货地址"
  shippingAddress: Address
  "账单地址"
  billingAddress: Address
  "订单商品明细"
  lines: [OrderLine!]!
  "履约发货单"
  fulfillments: [Fulfillment!]!
  "支付交易记录"
  transactions: [TransactionItem!]!
  "订单应付总额"
  totalAmount: Decimal!
  created: DateTime!
}

"""订单商品明细行"""
type OrderLine @doc(category: "Orders") {
  id: ID!
  productName: String!
  variantName: String!
  quantity: Int!
  unitPriceAmount: Decimal!
  "关联的商品变体"
  variant: ProductVariant
  "库存锁定记录"
  allocations: [Allocation!]
}

"""订单履约发货单"""
type Fulfillment @doc(category: "Inventory") {
  id: ID!
  fulfillmentOrder: Int!
  status: FulfillmentStatus!
  trackingNumber: String!
  "出库仓库"
  warehouse: Warehouse
  created: DateTime!
}

"""支付交易流水（支持多笔扣款与退款）"""
type TransactionItem @doc(category: "Billing") {
  id: ID!
  name: String!
  pspReference: String!
  authorizedAmount: Decimal!
  chargedAmount: Decimal!
  refundedAmount: Decimal!
  "关联订单"
  order: Order
  createdAt: DateTime!
}

"""平台用户（买家与后台员工）"""
type User @doc(category: "Customers") {
  id: ID!
  email: String!
  firstName: String!
  lastName: String!
  isActive: Boolean!
  isStaff: Boolean!
  "默认收货地址"
  defaultShippingAddress: Address
  "默认账单地址"
  defaultBillingAddress: Address
  "常用地址簿"
  addresses: [Address!]
  "历史订单"
  orders: OrderCountableConnection
  dateJoined: DateTime!
}

"""地址实体：被用户、订单、结算单与仓库复用"""
type Address @doc(category: "Customers") {
  id: ID!
  firstName: String!
  lastName: String!
  streetAddress1: String!
  city: String!
  postalCode: String!
  country: String!
  phone: String
}

# Relay CountableConnection wrappers (folded by RELIX into 1:N relations)
type ProductCountableEdge { node: Product! cursor: String! }
type ProductCountableConnection { edges: [ProductCountableEdge!]! pageInfo: PageInfo! totalCount: Int }

type CategoryCountableEdge { node: Category! cursor: String! }
type CategoryCountableConnection { edges: [CategoryCountableEdge!]! pageInfo: PageInfo! totalCount: Int }

type StockCountableEdge { node: Stock! cursor: String! }
type StockCountableConnection { edges: [StockCountableEdge!]! pageInfo: PageInfo! totalCount: Int }

type OrderCountableEdge { node: Order! cursor: String! }
type OrderCountableConnection { edges: [OrderCountableEdge!]! pageInfo: PageInfo! totalCount: Int }

# Non-entity root & input types (filtered out by RELIX)
type Query {
  products: ProductCountableConnection
  orders: OrderCountableConnection
}
input ProductFilterInput {
  search: String
}
type ProductError {
  field: String
  message: String
}
`.trim();

export function createSaleorSnapshotSource(): SchemaSource {
  return {
    id: 'graphql:saleor:snapshot',
    provider: 'saleor',
    readsBusinessData: false,
    load(): LoadedSource {
      const schema = parseGraphQLSchema(SALEOR_CORE_SDL, {
        provider: 'saleor',
        schemaName: 'saleor',
        version: SALEOR_SNAPSHOT_VERSION,
        fetchedAt: SALEOR_SNAPSHOT_DATE,
      });
      const sourceKey = 'graphql:saleor:snapshot';
      return {
        schema,
        rawSql: SALEOR_CORE_SDL,
        rawFormat: 'graphql',
        sourceLabel: `Saleor GraphQL · ${SALEOR_SNAPSHOT_VERSION}`,
        sourceKey,
        config: loadPersistedConfig(sourceKey),
        spec: { type: 'graphql_snapshot', provider: 'saleor' },
        snapshotVersion: SALEOR_SNAPSHOT_VERSION,
        snapshotTime: SALEOR_SNAPSHOT_DATE,
      };
    },
  };
}

export function loadSaleorFromContent(content: string, label: string): LoadedSource {
  const fetchedAt = new Date().toISOString().slice(0, 10);
  const schema = parseGraphQLSchema(content, {
    provider: 'saleor',
    schemaName: 'saleor',
    version: label,
    fetchedAt,
  });
  const sourceKey = `graphql:saleor:file:${label}`;
  return {
    schema,
    rawSql: content,
    rawFormat: content.trim().startsWith('{') ? 'json' : 'graphql',
    sourceLabel: `Saleor · ${label}`,
    sourceKey,
    config: loadPersistedConfig(sourceKey),
    spec: { type: 'graphql_sdl', provider: 'saleor', label, content },
    snapshotVersion: label,
    snapshotTime: fetchedAt,
  };
}

export async function fetchSaleorLiveSource(
  endpoint: string,
  bearerToken?: string,
): Promise<LoadedSource> {
  const cleanToken = bearerToken?.trim() ?? '';
  const headers: Record<string, string> = {};
  if (cleanToken) {
    headers['Authorization'] = cleanToken.startsWith('Bearer ')
      ? cleanToken
      : `Bearer ${cleanToken}`;
  }

  const { schema, rawJson } = await fetchGraphQLIntrospection({
    provider: 'saleor',
    endpoint,
    headers,
    secretTokens: cleanToken ? [cleanToken] : [],
    version: 'Saleor Live Introspection',
  });

  const safeHost = (() => {
    try {
      return new URL(endpoint).host;
    } catch {
      return 'saleor';
    }
  })();

  const sourceKey = `graphql:saleor:live:${safeHost}`;
  return {
    schema,
    rawSql: rawJson,
    rawFormat: 'json',
    sourceLabel: `Saleor (${safeHost})`,
    sourceKey,
    config: loadPersistedConfig(sourceKey),
    // Never retain the bearer token inside persisted or reloadable state beyond memory if unneeded
    spec: { type: 'graphql_live', provider: 'saleor', endpoint, label: safeHost },
    snapshotVersion: 'Live Introspection',
    snapshotTime: schema.source_meta?.fetched_at,
  };
}
