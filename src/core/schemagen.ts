import {
  Column,
  Schema,
  TypeFamily,
  createDeclaredRelation,
  createEmptySchema,
} from './model';

const DOMAINS = [
  'auth',
  'users',
  'billing',
  'orders',
  'catalog',
  'inventory',
  'shipping',
  'audit',
  'notify',
  'analytics',
];

const MASK_64 = (1n << 64n) - 1n;

class SplitMix64 {
  private state: bigint;

  constructor(seed: bigint) {
    this.state = seed & MASK_64;
  }

  nextU64(): bigint {
    this.state = (this.state + 0x9e3779b97f4a7c15n) & MASK_64;
    let z = this.state;
    z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK_64;
    z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & MASK_64;
    return (z ^ (z >> 31n)) & MASK_64;
  }

  nextUsize(bound: number): number {
    if (bound <= 1) return 0;
    return Number(this.nextU64() % BigInt(bound));
  }

  nextF64(): number {
    return Number(this.nextU64() >> 11n) / 9007199254740992;
  }
}

/**
 * Deterministic synthetic schema generator matching `tools/schemagen/src/lib.rs`.
 */
export function generateSyntheticSchema(
  tableCount: number,
  colsPerTable = 10,
  fkDensity = 1.4,
  seed = 20261117n,
): Schema {
  const rng = new SplitMix64(seed);
  const schema = createEmptySchema('postgres');
  const targetCols = Math.max(2, colsPerTable);
  const domainCount = tableCount <= 20 ? 3 : DOMAINS.length;

  for (let i = 0; i < tableCount; i++) {
    const domain = DOMAINS[i % domainCount];
    const padIdx = String(i).padStart(4, '0');
    const tableName = `${domain}_entity_${padIdx}`;
    const tableId = `public.${tableName}`;

    const columns: Column[] = [
      {
        name: 'id',
        data_type: 'bigint',
        type_family: 'integer',
        nullable: false,
        default: null,
        comment: null,
      },
    ];

    const fkTargets: Array<[string, string]> = [];
    let desiredFks = 0;
    if (i > 0) {
      const base = Math.floor(fkDensity);
      const frac = fkDensity - base;
      const extra = rng.nextF64() < frac ? 1 : 0;
      desiredFks = Math.min(base + extra, Math.max(0, targetCols - 2));
    }

    for (let fkIdx = 0; fkIdx < desiredFks; fkIdx++) {
      let targetIdx: number;
      if (i >= domainCount && rng.nextF64() < 0.75) {
        const sameDomainMax = Math.floor(i / domainCount);
        const step = rng.nextUsize(Math.max(1, sameDomainMax));
        targetIdx = Math.min(step * domainCount + (i % domainCount), i - 1);
      } else {
        targetIdx = rng.nextUsize(i);
      }

      const targetDomain = DOMAINS[targetIdx % domainCount];
      const targetPad = String(targetIdx).padStart(4, '0');
      const targetId = `public.${targetDomain}_entity_${targetPad}`;
      const colName =
        fkIdx === 0 ? `ref_${targetPad}_id` : `ref_${targetPad}_${fkIdx}_id`;

      columns.push({
        name: colName,
        data_type: 'bigint',
        type_family: 'integer',
        nullable: fkIdx % 2 === 1,
        default: null,
        comment: null,
      });
      fkTargets.push([colName, targetId]);
    }

    while (columns.length < targetCols) {
      const idx = columns.length;
      let dataType: string;
      let typeFamily: TypeFamily;
      switch (idx % 5) {
        case 0:
          dataType = 'varchar(128)';
          typeFamily = 'text';
          break;
        case 1:
          dataType = 'integer';
          typeFamily = 'integer';
          break;
        case 2:
          dataType = 'timestamp';
          typeFamily = 'timestamp';
          break;
        case 3:
          dataType = 'boolean';
          typeFamily = 'bool';
          break;
        default:
          dataType = 'numeric(10, 2)';
          typeFamily = 'numeric';
          break;
      }
      columns.push({
        name: `field_${String(idx).padStart(2, '0')}`,
        data_type: dataType,
        type_family: typeFamily,
        nullable: idx % 3 === 0,
        default: null,
        comment: null,
      });
    }

    for (const [fromCol, toTable] of fkTargets) {
      schema.relations.push(createDeclaredRelation(tableId, [fromCol], toTable, ['id']));
    }

    schema.tables.push({
      id: tableId,
      schema: 'public',
      name: tableName,
      kind: 'table',
      comment: null,
      columns,
      primary_key: ['id'],
      unique_keys: [],
      indexes: [
        {
          name: `idx_entity_${padIdx}_pk`,
          columns: ['id'],
          unique: true,
        },
      ],
    });
  }

  return schema;
}
