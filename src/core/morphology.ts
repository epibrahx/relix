export interface MorphologyConfig {
  tablePrefixes: string[];
}

export const DEFAULT_MORPHOLOGY_CONFIG: MorphologyConfig = {
  tablePrefixes: ['tbl_', 't_'],
};

export interface ColumnStem {
  stem: string;
  suffix: '_id' | 'Id' | '_uuid' | 'Uuid';
}

function stripSuffixCi(s: string, suffix: string): string | null {
  if (s.length <= suffix.length) return null;
  const split = s.length - suffix.length;
  if (s.slice(split).toLowerCase() === suffix.toLowerCase()) {
    return s.slice(0, split);
  }
  return null;
}

export function toSnakeCase(ident: string): string {
  let out = '';
  for (let i = 0; i < ident.length; i++) {
    const ch = ident[i];
    const isUpper = ch >= 'A' && ch <= 'Z';
    if (isUpper) {
      const prev = i > 0 ? ident[i - 1] : '';
      const next = i + 1 < ident.length ? ident[i + 1] : '';
      const prevIsLowerOrDigit = (prev >= 'a' && prev <= 'z') || (prev >= '0' && prev <= '9');
      const nextIsLower = next >= 'a' && next <= 'z';
      const prevIsUpper = prev >= 'A' && prev <= 'Z';
      if (
        (prevIsLowerOrDigit || (prevIsUpper && nextIsLower)) &&
        !out.endsWith('_') &&
        out.length > 0
      ) {
        out += '_';
      }
      out += ch.toLowerCase();
    } else {
      out += ch;
    }
  }
  return out;
}

export function extractFkStem(colName: string): ColumnStem | null {
  const u1 = stripSuffixCi(colName, '_uuid');
  if (u1 && u1.length > 0) {
    return { stem: toSnakeCase(u1), suffix: '_uuid' };
  }
  if (colName.endsWith('Uuid') && colName.length > 4) {
    return { stem: toSnakeCase(colName.slice(0, -4)), suffix: 'Uuid' };
  }
  const i1 = stripSuffixCi(colName, '_id');
  if (i1 && i1.length > 0) {
    return { stem: toSnakeCase(i1), suffix: '_id' };
  }
  if (colName.endsWith('Id') && colName.length > 2) {
    return { stem: toSnakeCase(colName.slice(0, -2)), suffix: 'Id' };
  }
  return null;
}

export function normalizeTableStem(tableName: string, prefixes: string[]): string {
  const snake = toSnakeCase(tableName);
  for (const prefix of prefixes) {
    const pLower = prefix.toLowerCase();
    if (snake.startsWith(pLower) && snake.length > pLower.length) {
      return snake.slice(pLower.length);
    }
  }
  return snake;
}

const IRREGULAR_SINGULARS: Record<string, string> = {
  people: 'person',
  person: 'person',
  children: 'child',
  child: 'child',
  men: 'man',
  man: 'man',
  women: 'woman',
  woman: 'woman',
  mice: 'mouse',
  mouse: 'mouse',
  geese: 'goose',
  goose: 'goose',
  teeth: 'tooth',
  tooth: 'tooth',
  feet: 'foot',
  foot: 'foot',
  data: 'datum',
  datum: 'datum',
  indices: 'index',
  index: 'index',
  criteria: 'criterion',
  criterion: 'criterion',
  statuses: 'status',
  status: 'status',
  quizzes: 'quiz',
  quiz: 'quiz',
  oxen: 'ox',
  ox: 'ox',
  media: 'medium',
  medium: 'medium',
};

export function singularize(word: string): string {
  const w = word.toLowerCase();
  if (IRREGULAR_SINGULARS[w]) {
    return IRREGULAR_SINGULARS[w];
  }
  if (w.length > 4 && w.endsWith('ies')) {
    return `${w.slice(0, -3)}y`;
  }
  if (w.length > 4 && w.endsWith('ves')) {
    const stem = w.slice(0, -3);
    if (stem === 'kni' || stem === 'wi' || stem === 'li') {
      return `${stem}fe`;
    }
    return `${stem}f`;
  }
  if (
    w.length > 4 &&
    (w.endsWith('ches') ||
      w.endsWith('shes') ||
      w.endsWith('xes') ||
      w.endsWith('zes') ||
      w.endsWith('ses'))
  ) {
    return w.slice(0, -2);
  }
  if (
    w.length > 2 &&
    w.endsWith('s') &&
    !w.endsWith('ss') &&
    !w.endsWith('us') &&
    !w.endsWith('is')
  ) {
    return w.slice(0, -1);
  }
  return w;
}

function splitLastSegment(snake: string): [string, string] {
  const idx = snake.lastIndexOf('_');
  if (idx < 0) return ['', snake];
  return [snake.slice(0, idx), snake.slice(idx + 1)];
}

export function stemsMatch(colStem: string, tableStem: string): boolean {
  const a = toSnakeCase(colStem);
  const b = toSnakeCase(tableStem);
  if (a === b) return true;
  const [aHead, aTail] = splitLastSegment(a);
  const [bHead, bTail] = splitLastSegment(b);
  if (aHead !== bHead) return false;
  return singularize(aTail) === singularize(bTail);
}
