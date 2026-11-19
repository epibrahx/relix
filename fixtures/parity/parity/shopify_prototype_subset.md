# RELIX Data Dictionary

- Dialect: `graphql`
- Snapshot: `Shopify Admin 2026-10` (2026-11-18)
- Tables / Views: `16`
- Relations: `33` (`33` declared foreign keys, `0` manual relations)

## Warnings

- 已自动折叠 9 个 GraphQL Connection 包装类型，仅展示核心业务实体与实体间关系。

## Table Overview

| Table | Schema | Kind | Columns | Primary Key | Comment |
| --- | --- | --- | ---: | --- | --- |
| `Collection` | `shopify` | Table | 6 | `id` | 商品集合（手动集合或智能规则集合） |
| `Customer` | `shopify` | Table | 10 | `id` | 客户档案（Customer） |
| `DiscountNode` | `shopify` | Table | 6 | `id` | 促销折扣节点（DiscountNode） |
| `DraftOrder` | `shopify` | Table | 8 | `id` | 草稿订单（DraftOrder）：用于 B2B 报价单或客服代下单 |
| `Fulfillment` | `shopify` | Table | 7 | `id` | 发货单（Fulfillment）：记录承运商、运单号与发货状态 |
| `FulfillmentOrder` | `shopify` | Table | 6 | `id` | 履约指令单（FulfillmentOrder）：分配给具体仓库执行的发货任务 |
| `InventoryItem` | `shopify` | Table | 8 | `id` | 库存条目（InventoryItem）：跨多仓位跟踪 SKU 成本与库存 |
| `InventoryLevel` | `shopify` | Table | 6 | `id` | 库位库存水位（InventoryLevel）：记录特定仓库下某 SKU 的可用量 |
| `LineItem` | `shopify` | Table | 7 | `id` | 订单商品明细行（LineItem） |
| `Location` | `shopify` | Table | 6 | `id` | 仓库与线下门店位置（Location） |
| `MailingAddress` | `shopify` | Table | 7 | `id` | 邮寄地址（MailingAddress） |
| `Market` | `shopify` | Table | 5 | `id` | 跨境市场（Market）：管理区域币种与定价目录 |
| `Media` | `shopify` | Table | 4 | `id` | 商品媒体资源（图片 / 3D 模型 / 视频） |
| `Order` | `shopify` | Table | 15 | `id` | Shopify 订单（Order）：连接买家、订单行、履约单与发货记录 |
| `Product` | `shopify` | Table | 11 | `id` | Shopify 商品主实体（Product）：包含标题、Handle、状态、变体与媒体资源 |
| `ProductVariant` | `shopify` | Table | 10 | `id` | Shopify 商品变体（SKU）：挂接商品与库存条目 |

## `shopify.Collection`

> 商品集合（手动集合或智能规则集合）

| Column | Type | Family | Nullable | Key | Default | Comment |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | `ID!` | `Text` | NOT NULL | PK | - | - |
| `handle` | `String!` | `Text` | NOT NULL | UQ | - | - |
| `title` | `String!` | `Text` | NOT NULL | - | - | - |
| `description` | `String` | `Text` | NULL | - | - | - |
| `products` | `[Product]` | `Other` | NOT NULL | FK | - | 集合内商品（Connection 折叠为 1:N 关系） |
| `updatedAt` | `DateTime!` | `Timestamp` | NOT NULL | - | - | - |

### Relations

- References `shopify.Product` (`products` → `id`) [source: declared]
- Referenced by `shopify.Product` (`collections` → `id`) [source: declared]

## `shopify.Customer`

> 客户档案（Customer）

| Column | Type | Family | Nullable | Key | Default | Comment |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | `ID!` | `Text` | NOT NULL | PK | - | - |
| `email` | `String` | `Text` | NULL | UQ | - | - |
| `firstName` | `String` | `Text` | NULL | - | - | - |
| `lastName` | `String` | `Text` | NULL | - | - | - |
| `phone` | `String` | `Text` | NULL | - | - | - |
| `numberOfOrders` | `UnsignedInt64!` | `Integer` | NOT NULL | - | - | 历史订单总数 |
| `defaultAddress` | `MailingAddress` | `Other` | NULL | FK | - | 默认收货地址 |
| `addresses` | `[MailingAddress!]!` | `Other` | NOT NULL | FK | - | 客户地址簿 |
| `orders` | `[Order]` | `Other` | NOT NULL | FK | - | 客户历史订单（Connection 折叠为 1:N 关系） |
| `createdAt` | `DateTime!` | `Timestamp` | NOT NULL | - | - | - |

### Relations

- References `shopify.MailingAddress` (`addresses` → `id`) [source: declared]
- References `shopify.MailingAddress` (`defaultAddress` → `id`) [source: declared]
- References `shopify.Order` (`orders` → `id`) [source: declared]
- Referenced by `shopify.Order` (`customer` → `id`) [source: declared]
- Referenced by `shopify.DraftOrder` (`customer` → `id`) [source: declared]

## `shopify.DiscountNode`

> 促销折扣节点（DiscountNode）

| Column | Type | Family | Nullable | Key | Default | Comment |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | `ID!` | `Text` | NOT NULL | PK | - | - |
| `title` | `String!` | `Text` | NOT NULL | - | - | - |
| `code` | `String` | `Text` | NULL | - | - | - |
| `status` | `String!` | `Text` | NOT NULL | - | - | - |
| `startsAt` | `DateTime!` | `Timestamp` | NOT NULL | - | - | - |
| `endsAt` | `DateTime` | `Timestamp` | NULL | - | - | - |

### Relations

- Referenced by `shopify.Order` (`discountNode` → `id`) [source: declared]

## `shopify.DraftOrder`

> 草稿订单（DraftOrder）：用于 B2B 报价单或客服代下单

| Column | Type | Family | Nullable | Key | Default | Comment |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | `ID!` | `Text` | NOT NULL | PK | - | - |
| `name` | `String!` | `Text` | NOT NULL | - | - | - |
| `status` | `String!` | `Text` | NOT NULL | - | - | - |
| `customer` | `Customer` | `Other` | NULL | FK | - | 关联客户 |
| `order` | `Order` | `Other` | NULL | FK | - | 转化生成的正式订单 |
| `lineItems` | `[LineItem]` | `Other` | NOT NULL | FK | - | 草稿商品行（Connection 折叠为 1:N 关系） |
| `shippingAddress` | `MailingAddress` | `Other` | NULL | FK | - | 收货地址 |
| `createdAt` | `DateTime!` | `Timestamp` | NOT NULL | - | - | - |

### Relations

- References `shopify.LineItem` (`lineItems` → `id`) [source: declared]
- References `shopify.MailingAddress` (`shippingAddress` → `id`) [source: declared]
- References `shopify.Customer` (`customer` → `id`) [source: declared]
- References `shopify.Order` (`order` → `id`) [source: declared]

## `shopify.Fulfillment`

> 发货单（Fulfillment）：记录承运商、运单号与发货状态

| Column | Type | Family | Nullable | Key | Default | Comment |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | `ID!` | `Text` | NOT NULL | PK | - | - |
| `status` | `String!` | `Text` | NOT NULL | - | - | - |
| `trackingCompany` | `String` | `Text` | NULL | - | - | - |
| `trackingNumber` | `String` | `Text` | NULL | - | - | - |
| `order` | `Order!` | `Other` | NOT NULL | FK | - | 所属订单 |
| `location` | `Location` | `Other` | NULL | FK | - | 出库仓库 |
| `createdAt` | `DateTime!` | `Timestamp` | NOT NULL | - | - | - |

### Relations

- References `shopify.Location` (`location` → `id`) [source: declared]
- References `shopify.Order` (`order` → `id`) [source: declared]
- Referenced by `shopify.Order` (`fulfillments` → `id`) [source: declared]
- Referenced by `shopify.FulfillmentOrder` (`fulfillments` → `id`) [source: declared]

## `shopify.FulfillmentOrder`

> 履约指令单（FulfillmentOrder）：分配给具体仓库执行的发货任务

| Column | Type | Family | Nullable | Key | Default | Comment |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | `ID!` | `Text` | NOT NULL | PK | - | - |
| `status` | `FulfillmentOrderStatus!` | `Text` | NOT NULL | - | - | 枚举值：OPEN, IN_PROGRESS, SCHEDULED, ON_HOLD, CLOSED, CANCELLED |
| `order` | `Order!` | `Other` | NOT NULL | FK | - | 所属订单 |
| `assignedLocation` | `Location!` | `Other` | NOT NULL | FK | - | 指派履约仓库 |
| `fulfillments` | `[Fulfillment]` | `Other` | NOT NULL | FK | - | 关联发货单（Connection 折叠为 1:N 关系） |
| `fulfillAt` | `DateTime` | `Timestamp` | NULL | - | - | - |

### Relations

- References `shopify.Order` (`order` → `id`) [source: declared]
- References `shopify.Fulfillment` (`fulfillments` → `id`) [source: declared]
- References `shopify.Location` (`assignedLocation` → `id`) [source: declared]
- Referenced by `shopify.Order` (`fulfillmentOrders` → `id`) [source: declared]

## `shopify.InventoryItem`

> 库存条目（InventoryItem）：跨多仓位跟踪 SKU 成本与库存

| Column | Type | Family | Nullable | Key | Default | Comment |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | `ID!` | `Text` | NOT NULL | PK | - | - |
| `sku` | `String` | `Text` | NULL | UQ | - | - |
| `tracked` | `Boolean!` | `Bool` | NOT NULL | - | - | 是否跟踪库存 |
| `requiresShipping` | `Boolean!` | `Bool` | NOT NULL | - | - | 是否需要物流配送 |
| `unitCostAmount` | `Decimal` | `Numeric` | NULL | - | - | 采购单位成本 |
| `variant` | `ProductVariant` | `Other` | NULL | FK | - | 所属变体 |
| `inventoryLevels` | `[InventoryLevel]` | `Other` | NOT NULL | FK | - | 各仓库/门店的库存水位（Connection 折叠为 1:N 关系） |
| `updatedAt` | `DateTime!` | `Timestamp` | NOT NULL | - | - | - |

### Relations

- References `shopify.ProductVariant` (`variant` → `id`) [source: declared]
- References `shopify.InventoryLevel` (`inventoryLevels` → `id`) [source: declared]
- Referenced by `shopify.ProductVariant` (`inventoryItem` → `id`) [source: declared]
- Referenced by `shopify.InventoryLevel` (`item` → `id`) [source: declared]

## `shopify.InventoryLevel`

> 库位库存水位（InventoryLevel）：记录特定仓库下某 SKU 的可用量

| Column | Type | Family | Nullable | Key | Default | Comment |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | `ID!` | `Text` | NOT NULL | PK | - | - |
| `available` | `Int!` | `Integer` | NOT NULL | - | - | 可用库存数量 |
| `incoming` | `Int!` | `Integer` | NOT NULL | - | - | 在途补货数量 |
| `item` | `InventoryItem!` | `Other` | NOT NULL | FK | - | 所属库存条目 |
| `location` | `Location!` | `Other` | NOT NULL | FK | - | 所在仓库/门店位置 |
| `updatedAt` | `DateTime!` | `Timestamp` | NOT NULL | - | - | - |

### Relations

- References `shopify.InventoryItem` (`item` → `id`) [source: declared]
- References `shopify.Location` (`location` → `id`) [source: declared]
- Referenced by `shopify.Location` (`inventoryLevels` → `id`) [source: declared]
- Referenced by `shopify.InventoryItem` (`inventoryLevels` → `id`) [source: declared]

## `shopify.LineItem`

> 订单商品明细行（LineItem）

| Column | Type | Family | Nullable | Key | Default | Comment |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | `ID!` | `Text` | NOT NULL | PK | - | - |
| `title` | `String!` | `Text` | NOT NULL | - | - | - |
| `sku` | `String` | `Text` | NULL | UQ | - | - |
| `quantity` | `Int!` | `Integer` | NOT NULL | - | - | - |
| `originalUnitPriceAmount` | `Decimal!` | `Numeric` | NOT NULL | - | - | - |
| `product` | `Product` | `Other` | NULL | FK | - | 关联商品 |
| `variant` | `ProductVariant` | `Other` | NULL | FK | - | 关联变体 |

### Relations

- References `shopify.ProductVariant` (`variant` → `id`) [source: declared]
- References `shopify.Product` (`product` → `id`) [source: declared]
- Referenced by `shopify.DraftOrder` (`lineItems` → `id`) [source: declared]
- Referenced by `shopify.Order` (`lineItems` → `id`) [source: declared]

## `shopify.Location`

> 仓库与线下门店位置（Location）

| Column | Type | Family | Nullable | Key | Default | Comment |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | `ID!` | `Text` | NOT NULL | PK | - | - |
| `name` | `String!` | `Text` | NOT NULL | - | - | - |
| `isActive` | `Boolean!` | `Bool` | NOT NULL | - | - | - |
| `fulfillsOnlineOrders` | `Boolean!` | `Bool` | NOT NULL | - | - | - |
| `address` | `MailingAddress!` | `Other` | NOT NULL | FK | - | 仓库物理地址 |
| `inventoryLevels` | `[InventoryLevel]` | `Other` | NOT NULL | FK | - | 该位置的全部库存水位（Connection 折叠为 1:N 关系） |

### Relations

- References `shopify.InventoryLevel` (`inventoryLevels` → `id`) [source: declared]
- References `shopify.MailingAddress` (`address` → `id`) [source: declared]
- Referenced by `shopify.Fulfillment` (`location` → `id`) [source: declared]
- Referenced by `shopify.FulfillmentOrder` (`assignedLocation` → `id`) [source: declared]
- Referenced by `shopify.InventoryLevel` (`location` → `id`) [source: declared]

## `shopify.MailingAddress`

> 邮寄地址（MailingAddress）

| Column | Type | Family | Nullable | Key | Default | Comment |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | `ID!` | `Text` | NOT NULL | PK | - | - |
| `address1` | `String` | `Text` | NULL | - | - | - |
| `city` | `String` | `Text` | NULL | - | - | - |
| `province` | `String` | `Text` | NULL | - | - | - |
| `country` | `String` | `Text` | NULL | - | - | - |
| `zip` | `String` | `Text` | NULL | - | - | - |
| `phone` | `String` | `Text` | NULL | - | - | - |

### Relations

- Referenced by `shopify.Order` (`billingAddress` → `id`) [source: declared]
- Referenced by `shopify.Customer` (`addresses` → `id`) [source: declared]
- Referenced by `shopify.DraftOrder` (`shippingAddress` → `id`) [source: declared]
- Referenced by `shopify.Customer` (`defaultAddress` → `id`) [source: declared]
- Referenced by `shopify.Location` (`address` → `id`) [source: declared]
- Referenced by `shopify.Order` (`shippingAddress` → `id`) [source: declared]

## `shopify.Market`

> 跨境市场（Market）：管理区域币种与定价目录

| Column | Type | Family | Nullable | Key | Default | Comment |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | `ID!` | `Text` | NOT NULL | PK | - | - |
| `name` | `String!` | `Text` | NOT NULL | - | - | - |
| `handle` | `String!` | `Text` | NOT NULL | UQ | - | - |
| `enabled` | `Boolean!` | `Bool` | NOT NULL | - | - | - |
| `primary` | `Boolean!` | `Bool` | NOT NULL | - | - | - |

## `shopify.Media`

> 商品媒体资源（图片 / 3D 模型 / 视频）

| Column | Type | Family | Nullable | Key | Default | Comment |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | `ID!` | `Text` | NOT NULL | PK | - | - |
| `alt` | `String` | `Text` | NULL | - | - | - |
| `mediaContentType` | `String!` | `Text` | NOT NULL | - | - | - |
| `previewUrl` | `URL` | `Text` | NULL | - | - | - |

### Relations

- Referenced by `shopify.Product` (`media` → `id`) [source: declared]

## `shopify.Order`

> Shopify 订单（Order）：连接买家、订单行、履约单与发货记录

| Column | Type | Family | Nullable | Key | Default | Comment |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | `ID!` | `Text` | NOT NULL | PK | - | - |
| `name` | `String!` | `Text` | NOT NULL | - | - | 订单展示号（如 #1001） |
| `email` | `String` | `Text` | NULL | UQ | - | - |
| `displayFinancialStatus` | `OrderDisplayFinancialStatus` | `Text` | NULL | - | - | 财务支付状态 · 枚举值：PENDING, AUTHORIZED, PARTIALLY_PAID, PAID, PARTIALLY_REFUNDED, REFUNDED… |
| `displayFulfillmentStatus` | `OrderDisplayFulfillmentStatus!` | `Text` | NOT NULL | - | - | 履约发货状态 · 枚举值：UNFULFILLED, PARTIALLY_FULFILLED, FULFILLED, ON_HOLD, SCHEDULED |
| `totalPriceAmount` | `Decimal!` | `Numeric` | NOT NULL | - | - | 订单实付总金额 |
| `currencyCode` | `String!` | `Text` | NOT NULL | - | - | 币种代码 |
| `customer` | `Customer` | `Other` | NULL | FK | - | 下单客户 |
| `shippingAddress` | `MailingAddress` | `Other` | NULL | FK | - | 收货地址 |
| `billingAddress` | `MailingAddress` | `Other` | NULL | FK | - | 账单地址 |
| `lineItems` | `[LineItem]` | `Other` | NOT NULL | FK | - | 订单商品明细行（Connection 折叠为 1:N 关系） |
| `fulfillmentOrders` | `[FulfillmentOrder]` | `Other` | NOT NULL | FK | - | 履约指令单（Connection 折叠为 1:N 关系） |
| `fulfillments` | `[Fulfillment!]!` | `Other` | NOT NULL | FK | - | 已生成的发货单 |
| `discountNode` | `DiscountNode` | `Other` | NULL | FK | - | 使用的促销折扣 |
| `createdAt` | `DateTime!` | `Timestamp` | NOT NULL | - | - | - |

### Relations

- References `shopify.MailingAddress` (`billingAddress` → `id`) [source: declared]
- References `shopify.DiscountNode` (`discountNode` → `id`) [source: declared]
- References `shopify.Fulfillment` (`fulfillments` → `id`) [source: declared]
- References `shopify.Customer` (`customer` → `id`) [source: declared]
- References `shopify.FulfillmentOrder` (`fulfillmentOrders` → `id`) [source: declared]
- References `shopify.LineItem` (`lineItems` → `id`) [source: declared]
- References `shopify.MailingAddress` (`shippingAddress` → `id`) [source: declared]
- Referenced by `shopify.FulfillmentOrder` (`order` → `id`) [source: declared]
- Referenced by `shopify.Fulfillment` (`order` → `id`) [source: declared]
- Referenced by `shopify.DraftOrder` (`order` → `id`) [source: declared]
- Referenced by `shopify.Customer` (`orders` → `id`) [source: declared]

## `shopify.Product`

> Shopify 商品主实体（Product）：包含标题、Handle、状态、变体与媒体资源

| Column | Type | Family | Nullable | Key | Default | Comment |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | `ID!` | `Text` | NOT NULL | PK | - | Shopify GID（gid://shopify/Product/...） |
| `handle` | `String!` | `Text` | NOT NULL | UQ | - | 商品 URL Handle |
| `title` | `String!` | `Text` | NOT NULL | - | - | 商品标题 |
| `vendor` | `String!` | `Text` | NOT NULL | - | - | 品牌/供应商 |
| `productType` | `String!` | `Text` | NOT NULL | - | - | 商品分类标签 |
| `status` | `ProductStatus!` | `Text` | NOT NULL | - | - | 上架状态（ACTIVE / DRAFT / ARCHIVED） · 枚举值：ACTIVE, ARCHIVED, DRAFT |
| `variants` | `[ProductVariant]` | `Other` | NOT NULL | FK | - | SKU 变体分页集合（Connection 折叠为 1:N 关系） |
| `collections` | `[Collection]` | `Other` | NOT NULL | FK | - | 所属集合（Connection 折叠为 1:N 关系） |
| `media` | `[Media]` | `Other` | NOT NULL | FK | - | 关联图片与视频媒体（Connection 折叠为 1:N 关系） |
| `createdAt` | `DateTime!` | `Timestamp` | NOT NULL | - | - | - |
| `updatedAt` | `DateTime!` | `Timestamp` | NOT NULL | - | - | - |

### Relations

- References `shopify.ProductVariant` (`variants` → `id`) [source: declared]
- References `shopify.Media` (`media` → `id`) [source: declared]
- References `shopify.Collection` (`collections` → `id`) [source: declared]
- Referenced by `shopify.LineItem` (`product` → `id`) [source: declared]
- Referenced by `shopify.ProductVariant` (`product` → `id`) [source: declared]
- Referenced by `shopify.Collection` (`products` → `id`) [source: declared]

## `shopify.ProductVariant`

> Shopify 商品变体（SKU）：挂接商品与库存条目

| Column | Type | Family | Nullable | Key | Default | Comment |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | `ID!` | `Text` | NOT NULL | PK | - | - |
| `title` | `String!` | `Text` | NOT NULL | - | - | - |
| `sku` | `String` | `Text` | NULL | UQ | - | SKU 货号 |
| `barcode` | `String` | `Text` | NULL | - | - | 条形码 |
| `price` | `Decimal!` | `Numeric` | NOT NULL | - | - | 销售单价 |
| `compareAtPrice` | `Decimal` | `Numeric` | NULL | - | - | 划线原价 |
| `inventoryQuantity` | `Int` | `Integer` | NULL | - | - | 可售库存总数 |
| `product` | `Product!` | `Other` | NOT NULL | FK | - | 所属商品 |
| `inventoryItem` | `InventoryItem!` | `Other` | NOT NULL | FK | - | 对应的库存管理条目 |
| `createdAt` | `DateTime!` | `Timestamp` | NOT NULL | - | - | - |

### Relations

- References `shopify.InventoryItem` (`inventoryItem` → `id`) [source: declared]
- References `shopify.Product` (`product` → `id`) [source: declared]
- Referenced by `shopify.InventoryItem` (`variant` → `id`) [source: declared]
- Referenced by `shopify.Product` (`variants` → `id`) [source: declared]
- Referenced by `shopify.LineItem` (`variant` → `id`) [source: declared]

