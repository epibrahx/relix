# RELIX Data Dictionary

- Dialect: `graphql`
- Snapshot: `Saleor 3.20 (Core SDL)` (2026-11-18)
- Tables / Views: `19`
- Relations: `43` (`43` declared foreign keys, `0` manual relations)

## Warnings

- 已自动折叠 4 个 GraphQL Connection 包装类型，仅展示核心业务实体与实体间关系。

## Table Overview

| Table | Schema | Kind | Columns | Primary Key | Comment |
| --- | --- | --- | ---: | --- | --- |
| `Address` | `saleor` | Table | 8 | `id` | 地址实体：被用户、订单、结算单与仓库复用 |
| `Allocation` | `saleor` | Table | 3 | `id` | 订单库存锁定记录 |
| `Category` | `saleor` | Table | 7 | `id` | 商品类目树：支持多级父子类目 |
| `Channel` | `saleor` | Table | 6 | `id` | 销售渠道：按国家、币种隔离定价与库存 |
| `Checkout` | `saleor` | Table | 10 | `id` | 结算单（购物车）：下单前的商品与运费暂存状态 |
| `CheckoutLine` | `saleor` | Table | 4 | `id` | 结算单明细行 |
| `Collection` | `saleor` | Table | 4 | `id` | 营销商品集合 |
| `Fulfillment` | `saleor` | Table | 6 | `id` | 订单履约发货单 |
| `Order` | `saleor` | Table | 13 | `id` | 销售订单：聚合买家、渠道、履约与支付交易 |
| `OrderLine` | `saleor` | Table | 7 | `id` | 订单商品明细行 |
| `Product` | `saleor` | Table | 12 | `id` | 商品主表（SPU）：定义商品名称、类目、商品类型与多渠道上架信息 |
| `ProductChannelListing` | `saleor` | Table | 5 | `id` | 商品渠道上架与可见性配置 |
| `ProductType` | `saleor` | Table | 6 | `id` | 商品类型：决定商品及变体的属性模板与物流属性 |
| `ProductVariant` | `saleor` | Table | 8 | `id` | 商品变体（SKU）：定义货号、库存与渠道价格 |
| `ProductVariantChannelListing` | `saleor` | Table | 4 | `id` | 变体渠道售价配置 |
| `Stock` | `saleor` | Table | 5 | `id` | SKU 仓库库存：记录在库量与已锁定配额 |
| `TransactionItem` | `saleor` | Table | 8 | `id` | 支付交易流水（支持多笔扣款与退款） |
| `User` | `saleor` | Table | 11 | `id` | 平台用户（买家与后台员工） |
| `Warehouse` | `saleor` | Table | 6 | `id` | 仓库：管理实体库位与可履约区域 |

## `saleor.Address`

> 地址实体：被用户、订单、结算单与仓库复用

| Column | Type | Family | Nullable | Key | Default | Comment |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | `ID!` | `Text` | NOT NULL | PK | - | - |
| `firstName` | `String!` | `Text` | NOT NULL | - | - | - |
| `lastName` | `String!` | `Text` | NOT NULL | - | - | - |
| `streetAddress1` | `String!` | `Text` | NOT NULL | - | - | - |
| `city` | `String!` | `Text` | NOT NULL | - | - | - |
| `postalCode` | `String!` | `Text` | NOT NULL | - | - | - |
| `country` | `String!` | `Text` | NOT NULL | - | - | - |
| `phone` | `String` | `Text` | NULL | - | - | - |

### Relations

- Referenced by `saleor.Checkout` (`billingAddress` → `id`) [source: declared]
- Referenced by `saleor.User` (`defaultShippingAddress` → `id`) [source: declared]
- Referenced by `saleor.Checkout` (`shippingAddress` → `id`) [source: declared]
- Referenced by `saleor.Warehouse` (`address` → `id`) [source: declared]
- Referenced by `saleor.Order` (`shippingAddress` → `id`) [source: declared]
- Referenced by `saleor.User` (`defaultBillingAddress` → `id`) [source: declared]
- Referenced by `saleor.Order` (`billingAddress` → `id`) [source: declared]
- Referenced by `saleor.User` (`addresses` → `id`) [source: declared]

## `saleor.Allocation`

> 订单库存锁定记录

| Column | Type | Family | Nullable | Key | Default | Comment |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | `ID!` | `Text` | NOT NULL | PK | - | - |
| `stock` | `Stock!` | `Other` | NOT NULL | FK | - | 锁定的库存记录 |
| `quantity` | `Int!` | `Integer` | NOT NULL | - | - | 锁定数量 |

### Relations

- References `saleor.Stock` (`stock` → `id`) [source: declared]
- Referenced by `saleor.OrderLine` (`allocations` → `id`) [source: declared]

## `saleor.Category`

> 商品类目树：支持多级父子类目

| Column | Type | Family | Nullable | Key | Default | Comment |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | `ID!` | `Text` | NOT NULL | PK | - | - |
| `name` | `String!` | `Text` | NOT NULL | - | - | - |
| `slug` | `String!` | `Text` | NOT NULL | UQ | - | - |
| `level` | `Int!` | `Integer` | NOT NULL | - | - | - |
| `parent` | `Category` | `Other` | NULL | FK | - | 上级类目 |
| `children` | `[Category]` | `Other` | NULL | FK | - | 下级子类目（Connection 折叠为 1:N 关系） |
| `products` | `[Product]` | `Other` | NULL | FK | - | 类目下的商品（Connection 折叠为 1:N 关系） |

### Relations

- References `saleor.Product` (`products` → `id`) [source: declared]
- References `saleor.Category` (`children` → `id`) [source: declared]
- References `saleor.Category` (`parent` → `id`) [source: declared]
- Referenced by `saleor.Product` (`category` → `id`) [source: declared]
- Referenced by `saleor.Category` (`children` → `id`) [source: declared]
- Referenced by `saleor.Category` (`parent` → `id`) [source: declared]

## `saleor.Channel`

> 销售渠道：按国家、币种隔离定价与库存

| Column | Type | Family | Nullable | Key | Default | Comment |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | `ID!` | `Text` | NOT NULL | PK | - | - |
| `slug` | `String!` | `Text` | NOT NULL | UQ | - | - |
| `name` | `String!` | `Text` | NOT NULL | - | - | - |
| `isActive` | `Boolean!` | `Bool` | NOT NULL | - | - | - |
| `currencyCode` | `String!` | `Text` | NOT NULL | - | - | 默认币种代码（如 USD / CNY） |
| `warehouses` | `[Warehouse!]!` | `Other` | NOT NULL | FK | - | 关联的履约仓库 |

### Relations

- References `saleor.Warehouse` (`warehouses` → `id`) [source: declared]
- Referenced by `saleor.ProductChannelListing` (`channel` → `id`) [source: declared]
- Referenced by `saleor.Order` (`channel` → `id`) [source: declared]
- Referenced by `saleor.Checkout` (`channel` → `id`) [source: declared]
- Referenced by `saleor.ProductVariantChannelListing` (`channel` → `id`) [source: declared]

## `saleor.Checkout`

> 结算单（购物车）：下单前的商品与运费暂存状态

| Column | Type | Family | Nullable | Key | Default | Comment |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | `ID!` | `Text` | NOT NULL | PK | - | - |
| `token` | `UUID!` | `Uuid` | NOT NULL | - | - | - |
| `email` | `String` | `Text` | NULL | UQ | - | - |
| `channel` | `Channel!` | `Other` | NOT NULL | FK | - | 所属销售渠道 |
| `user` | `User` | `Other` | NULL | FK | - | 关联下单用户 |
| `shippingAddress` | `Address` | `Other` | NULL | FK | - | 收货地址 |
| `billingAddress` | `Address` | `Other` | NULL | FK | - | 账单地址 |
| `lines` | `[CheckoutLine!]!` | `Other` | NOT NULL | FK | - | 购物车明细行 |
| `created` | `DateTime!` | `Timestamp` | NOT NULL | - | - | - |
| `updatedAt` | `DateTime!` | `Timestamp` | NOT NULL | - | - | - |

### Relations

- References `saleor.Address` (`billingAddress` → `id`) [source: declared]
- References `saleor.Address` (`shippingAddress` → `id`) [source: declared]
- References `saleor.CheckoutLine` (`lines` → `id`) [source: declared]
- References `saleor.Channel` (`channel` → `id`) [source: declared]
- References `saleor.User` (`user` → `id`) [source: declared]

## `saleor.CheckoutLine`

> 结算单明细行

| Column | Type | Family | Nullable | Key | Default | Comment |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | `ID!` | `Text` | NOT NULL | PK | - | - |
| `variant` | `ProductVariant!` | `Other` | NOT NULL | FK | - | - |
| `quantity` | `Int!` | `Integer` | NOT NULL | - | - | - |
| `totalPriceAmount` | `Decimal!` | `Numeric` | NOT NULL | - | - | - |

### Relations

- References `saleor.ProductVariant` (`variant` → `id`) [source: declared]
- Referenced by `saleor.Checkout` (`lines` → `id`) [source: declared]

## `saleor.Collection`

> 营销商品集合

| Column | Type | Family | Nullable | Key | Default | Comment |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | `ID!` | `Text` | NOT NULL | PK | - | - |
| `name` | `String!` | `Text` | NOT NULL | - | - | - |
| `slug` | `String!` | `Text` | NOT NULL | UQ | - | - |
| `products` | `[Product]` | `Other` | NULL | FK | - | 集合内商品（Connection 折叠为 1:N 关系） |

### Relations

- References `saleor.Product` (`products` → `id`) [source: declared]
- Referenced by `saleor.Product` (`collections` → `id`) [source: declared]

## `saleor.Fulfillment`

> 订单履约发货单

| Column | Type | Family | Nullable | Key | Default | Comment |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | `ID!` | `Text` | NOT NULL | PK | - | - |
| `fulfillmentOrder` | `Int!` | `Integer` | NOT NULL | - | - | - |
| `status` | `FulfillmentStatus!` | `Text` | NOT NULL | - | - | 枚举值：FULFILLED, REFUNDED, RETURNED, CANCELED, WAITING_FOR_APPROVAL |
| `trackingNumber` | `String!` | `Text` | NOT NULL | - | - | - |
| `warehouse` | `Warehouse` | `Other` | NULL | FK | - | 出库仓库 |
| `created` | `DateTime!` | `Timestamp` | NOT NULL | - | - | - |

### Relations

- References `saleor.Warehouse` (`warehouse` → `id`) [source: declared]
- Referenced by `saleor.Order` (`fulfillments` → `id`) [source: declared]

## `saleor.Order`

> 销售订单：聚合买家、渠道、履约与支付交易

| Column | Type | Family | Nullable | Key | Default | Comment |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | `ID!` | `Text` | NOT NULL | PK | - | - |
| `number` | `String!` | `Text` | NOT NULL | - | - | 订单展示编号 |
| `status` | `OrderStatus!` | `Text` | NOT NULL | - | - | 订单状态 · 枚举值：DRAFT, UNCONFIRMED, UNFULFILLED, PARTIALLY_FULFILLED, FULFILLED, CANCELED |
| `paymentStatus` | `PaymentChargeStatusEnum!` | `Text` | NOT NULL | - | - | 支付状态 · 枚举值：NOT_CHARGED, PENDING, PARTIALLY_CHARGED, FULLY_CHARGED, PARTIALLY_REFUNDED, FULLY_REFUNDED |
| `channel` | `Channel!` | `Other` | NOT NULL | FK | - | 所属销售渠道 |
| `user` | `User` | `Other` | NULL | FK | - | 下单客户 |
| `shippingAddress` | `Address` | `Other` | NULL | FK | - | 收货地址 |
| `billingAddress` | `Address` | `Other` | NULL | FK | - | 账单地址 |
| `lines` | `[OrderLine!]!` | `Other` | NOT NULL | FK | - | 订单商品明细 |
| `fulfillments` | `[Fulfillment!]!` | `Other` | NOT NULL | FK | - | 履约发货单 |
| `transactions` | `[TransactionItem!]!` | `Other` | NOT NULL | FK | - | 支付交易记录 |
| `totalAmount` | `Decimal!` | `Numeric` | NOT NULL | - | - | 订单应付总额 |
| `created` | `DateTime!` | `Timestamp` | NOT NULL | - | - | - |

### Relations

- References `saleor.OrderLine` (`lines` → `id`) [source: declared]
- References `saleor.Channel` (`channel` → `id`) [source: declared]
- References `saleor.User` (`user` → `id`) [source: declared]
- References `saleor.Fulfillment` (`fulfillments` → `id`) [source: declared]
- References `saleor.Address` (`shippingAddress` → `id`) [source: declared]
- References `saleor.TransactionItem` (`transactions` → `id`) [source: declared]
- References `saleor.Address` (`billingAddress` → `id`) [source: declared]
- Referenced by `saleor.TransactionItem` (`order` → `id`) [source: declared]
- Referenced by `saleor.User` (`orders` → `id`) [source: declared]

## `saleor.OrderLine`

> 订单商品明细行

| Column | Type | Family | Nullable | Key | Default | Comment |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | `ID!` | `Text` | NOT NULL | PK | - | - |
| `productName` | `String!` | `Text` | NOT NULL | - | - | - |
| `variantName` | `String!` | `Text` | NOT NULL | - | - | - |
| `quantity` | `Int!` | `Integer` | NOT NULL | - | - | - |
| `unitPriceAmount` | `Decimal!` | `Numeric` | NOT NULL | - | - | - |
| `variant` | `ProductVariant` | `Other` | NULL | FK | - | 关联的商品变体 |
| `allocations` | `[Allocation!]` | `Other` | NULL | FK | - | 库存锁定记录 |

### Relations

- References `saleor.Allocation` (`allocations` → `id`) [source: declared]
- References `saleor.ProductVariant` (`variant` → `id`) [source: declared]
- Referenced by `saleor.Order` (`lines` → `id`) [source: declared]

## `saleor.Product`

> 商品主表（SPU）：定义商品名称、类目、商品类型与多渠道上架信息

| Column | Type | Family | Nullable | Key | Default | Comment |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | `ID!` | `Text` | NOT NULL | PK | - | 全局唯一 ID |
| `slug` | `String!` | `Text` | NOT NULL | UQ | - | 商品 URL Slug |
| `name` | `String!` | `Text` | NOT NULL | - | - | 商品名称 |
| `description` | `JSONString` | `Json` | NULL | - | - | 富文本描述（EditorJS JSON） |
| `productType` | `ProductType!` | `Other` | NOT NULL | FK | - | 所属商品类型 |
| `category` | `Category` | `Other` | NULL | FK | - | 所属商品类目 |
| `defaultVariant` | `ProductVariant` | `Other` | NULL | FK | - | 默认 SKU 变体 |
| `variants` | `[ProductVariant!]` | `Other` | NULL | FK | - | 下属 SKU 变体列表 |
| `collections` | `[Collection!]` | `Other` | NULL | FK | - | 所属营销集合 |
| `channelListings` | `[ProductChannelListing!]` | `Other` | NULL | FK | - | 渠道定价与上架配置 |
| `isAvailableForPurchase` | `Boolean` | `Bool` | NULL | - | - | 是否可销售 |
| `updatedAt` | `DateTime!` | `Timestamp` | NOT NULL | - | - | 最后更新时间 |

### Relations

- References `saleor.Category` (`category` → `id`) [source: declared]
- References `saleor.Collection` (`collections` → `id`) [source: declared]
- References `saleor.ProductType` (`productType` → `id`) [source: declared]
- References `saleor.ProductVariant` (`defaultVariant` → `id`) [source: declared]
- References `saleor.ProductVariant` (`variants` → `id`) [source: declared]
- References `saleor.ProductChannelListing` (`channelListings` → `id`) [source: declared]
- Referenced by `saleor.Category` (`products` → `id`) [source: declared]
- Referenced by `saleor.Collection` (`products` → `id`) [source: declared]
- Referenced by `saleor.ProductVariant` (`product` → `id`) [source: declared]
- Referenced by `saleor.ProductType` (`products` → `id`) [source: declared]

## `saleor.ProductChannelListing`

> 商品渠道上架与可见性配置

| Column | Type | Family | Nullable | Key | Default | Comment |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | `ID!` | `Text` | NOT NULL | PK | - | - |
| `channel` | `Channel!` | `Other` | NOT NULL | FK | - | - |
| `isPublished` | `Boolean!` | `Bool` | NOT NULL | - | - | - |
| `visibleInListings` | `Boolean!` | `Bool` | NOT NULL | - | - | - |
| `availableForPurchaseAt` | `DateTime` | `Timestamp` | NULL | - | - | - |

### Relations

- References `saleor.Channel` (`channel` → `id`) [source: declared]
- Referenced by `saleor.Product` (`channelListings` → `id`) [source: declared]

## `saleor.ProductType`

> 商品类型：决定商品及变体的属性模板与物流属性

| Column | Type | Family | Nullable | Key | Default | Comment |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | `ID!` | `Text` | NOT NULL | PK | - | - |
| `name` | `String!` | `Text` | NOT NULL | - | - | - |
| `slug` | `String!` | `Text` | NOT NULL | UQ | - | - |
| `isShippingRequired` | `Boolean!` | `Bool` | NOT NULL | - | - | 是否需要物流配送 |
| `isDigital` | `Boolean!` | `Bool` | NOT NULL | - | - | 是否为数字商品 |
| `products` | `[Product]` | `Other` | NULL | FK | - | 该类型下的商品（Connection 折叠为 1:N 关系） |

### Relations

- References `saleor.Product` (`products` → `id`) [source: declared]
- Referenced by `saleor.Product` (`productType` → `id`) [source: declared]

## `saleor.ProductVariant`

> 商品变体（SKU）：定义货号、库存与渠道价格

| Column | Type | Family | Nullable | Key | Default | Comment |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | `ID!` | `Text` | NOT NULL | PK | - | - |
| `sku` | `String` | `Text` | NULL | UQ | - | SKU 编码 |
| `name` | `String!` | `Text` | NOT NULL | - | - | 变体名称 |
| `product` | `Product!` | `Other` | NOT NULL | FK | - | 所属商品 SPU |
| `trackInventory` | `Boolean!` | `Bool` | NOT NULL | - | - | 是否跟踪库存 |
| `stocks` | `[Stock!]` | `Other` | NULL | FK | - | 各仓库库存记录 |
| `channelListings` | `[ProductVariantChannelListing!]` | `Other` | NULL | FK | - | 渠道售价配置 |
| `updatedAt` | `DateTime!` | `Timestamp` | NOT NULL | - | - | - |

### Relations

- References `saleor.Stock` (`stocks` → `id`) [source: declared]
- References `saleor.ProductVariantChannelListing` (`channelListings` → `id`) [source: declared]
- References `saleor.Product` (`product` → `id`) [source: declared]
- Referenced by `saleor.Stock` (`productVariant` → `id`) [source: declared]
- Referenced by `saleor.CheckoutLine` (`variant` → `id`) [source: declared]
- Referenced by `saleor.Product` (`defaultVariant` → `id`) [source: declared]
- Referenced by `saleor.OrderLine` (`variant` → `id`) [source: declared]
- Referenced by `saleor.Product` (`variants` → `id`) [source: declared]

## `saleor.ProductVariantChannelListing`

> 变体渠道售价配置

| Column | Type | Family | Nullable | Key | Default | Comment |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | `ID!` | `Text` | NOT NULL | PK | - | - |
| `channel` | `Channel!` | `Other` | NOT NULL | FK | - | - |
| `priceAmount` | `Decimal!` | `Numeric` | NOT NULL | - | - | - |
| `costPriceAmount` | `Decimal` | `Numeric` | NULL | - | - | - |

### Relations

- References `saleor.Channel` (`channel` → `id`) [source: declared]
- Referenced by `saleor.ProductVariant` (`channelListings` → `id`) [source: declared]

## `saleor.Stock`

> SKU 仓库库存：记录在库量与已锁定配额

| Column | Type | Family | Nullable | Key | Default | Comment |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | `ID!` | `Text` | NOT NULL | PK | - | - |
| `warehouse` | `Warehouse!` | `Other` | NOT NULL | FK | - | - |
| `productVariant` | `ProductVariant!` | `Other` | NOT NULL | FK | - | - |
| `quantity` | `Int!` | `Integer` | NOT NULL | - | - | 在库总数量 |
| `quantityAllocated` | `Int!` | `Integer` | NOT NULL | - | - | 已被订单锁定的数量 |

### Relations

- References `saleor.Warehouse` (`warehouse` → `id`) [source: declared]
- References `saleor.ProductVariant` (`productVariant` → `id`) [source: declared]
- Referenced by `saleor.ProductVariant` (`stocks` → `id`) [source: declared]
- Referenced by `saleor.Allocation` (`stock` → `id`) [source: declared]
- Referenced by `saleor.Warehouse` (`stocks` → `id`) [source: declared]

## `saleor.TransactionItem`

> 支付交易流水（支持多笔扣款与退款）

| Column | Type | Family | Nullable | Key | Default | Comment |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | `ID!` | `Text` | NOT NULL | PK | - | - |
| `name` | `String!` | `Text` | NOT NULL | - | - | - |
| `pspReference` | `String!` | `Text` | NOT NULL | - | - | - |
| `authorizedAmount` | `Decimal!` | `Numeric` | NOT NULL | - | - | - |
| `chargedAmount` | `Decimal!` | `Numeric` | NOT NULL | - | - | - |
| `refundedAmount` | `Decimal!` | `Numeric` | NOT NULL | - | - | - |
| `order` | `Order` | `Other` | NULL | FK | - | 关联订单 |
| `createdAt` | `DateTime!` | `Timestamp` | NOT NULL | - | - | - |

### Relations

- References `saleor.Order` (`order` → `id`) [source: declared]
- Referenced by `saleor.Order` (`transactions` → `id`) [source: declared]

## `saleor.User`

> 平台用户（买家与后台员工）

| Column | Type | Family | Nullable | Key | Default | Comment |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | `ID!` | `Text` | NOT NULL | PK | - | - |
| `email` | `String!` | `Text` | NOT NULL | UQ | - | - |
| `firstName` | `String!` | `Text` | NOT NULL | - | - | - |
| `lastName` | `String!` | `Text` | NOT NULL | - | - | - |
| `isActive` | `Boolean!` | `Bool` | NOT NULL | - | - | - |
| `isStaff` | `Boolean!` | `Bool` | NOT NULL | - | - | - |
| `defaultShippingAddress` | `Address` | `Other` | NULL | FK | - | 默认收货地址 |
| `defaultBillingAddress` | `Address` | `Other` | NULL | FK | - | 默认账单地址 |
| `addresses` | `[Address!]` | `Other` | NULL | FK | - | 常用地址簿 |
| `orders` | `[Order]` | `Other` | NULL | FK | - | 历史订单（Connection 折叠为 1:N 关系） |
| `dateJoined` | `DateTime!` | `Timestamp` | NOT NULL | - | - | - |

### Relations

- References `saleor.Address` (`defaultShippingAddress` → `id`) [source: declared]
- References `saleor.Order` (`orders` → `id`) [source: declared]
- References `saleor.Address` (`defaultBillingAddress` → `id`) [source: declared]
- References `saleor.Address` (`addresses` → `id`) [source: declared]
- Referenced by `saleor.Order` (`user` → `id`) [source: declared]
- Referenced by `saleor.Checkout` (`user` → `id`) [source: declared]

## `saleor.Warehouse`

> 仓库：管理实体库位与可履约区域

| Column | Type | Family | Nullable | Key | Default | Comment |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | `ID!` | `Text` | NOT NULL | PK | - | - |
| `name` | `String!` | `Text` | NOT NULL | - | - | - |
| `slug` | `String!` | `Text` | NOT NULL | UQ | - | - |
| `email` | `String!` | `Text` | NOT NULL | UQ | - | - |
| `address` | `Address!` | `Other` | NOT NULL | FK | - | 仓库地址 |
| `stocks` | `[Stock]` | `Other` | NULL | FK | - | 仓库内 SKU 库存（Connection 折叠为 1:N 关系） |

### Relations

- References `saleor.Address` (`address` → `id`) [source: declared]
- References `saleor.Stock` (`stocks` → `id`) [source: declared]
- Referenced by `saleor.Stock` (`warehouse` → `id`) [source: declared]
- Referenced by `saleor.Fulfillment` (`warehouse` → `id`) [source: declared]
- Referenced by `saleor.Channel` (`warehouses` → `id`) [source: declared]

