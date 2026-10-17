export type LogFilters = {
  players: string[]; actions: string[]; sources: string[];
  outcome: string; from: string; to: string; page: number; limit: number;
  sort: 'date' | 'player' | 'outcome'; direction: 'asc' | 'desc';
};
export const defaultLogFilters: LogFilters = {
  players: [], actions: [], sources: [], outcome: '', from: '', to: '',
  page: 1, limit: 25, sort: 'date', direction: 'desc',
};

export function parseLogFilters(params: URLSearchParams): LogFilters {
  const list = (key: string) => [...new Set(params.getAll(key).flatMap(value => value.split(',')).filter(Boolean))];
  const validDate = (key: string) => {
    const value = params.get(key) || '';
    return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) ? value : '';
  };
  const page = Number(params.get('page'));
  return {
    players: list('players'), actions: list('actions'), sources: list('source'),
    outcome: ['success', 'failed', 'denied'].includes(params.get('outcome') || '') ? params.get('outcome')! : '',
    from: validDate('from'), to: validDate('to'),
    page: Number.isSafeInteger(page) && page > 0 ? page : 1,
    limit: [25, 50, 100].includes(Number(params.get('limit'))) ? Number(params.get('limit')) : 25,
    sort: ['date', 'player', 'outcome'].includes(params.get('sort') || '') ? params.get('sort') as LogFilters['sort'] : 'date',
    direction: params.get('direction') === 'asc' ? 'asc' : 'desc',
  };
}

export function logQuery(filters: LogFilters, login?: string, category?: string) {
  const params = new URLSearchParams({ page: String(filters.page), limit: String(filters.limit), sort: filters.sort, direction: filters.direction });
  if (login) params.set('login', login);
  if (category) params.set('category', category);
  for (const key of ['players', 'actions', 'sources'] as const)
    for (const value of filters[key]) params.append(key === 'sources' ? 'source' : key, value);
  if (filters.outcome) params.set('outcome', filters.outcome);
  if (filters.from) params.set('from', `${filters.from}T00:00:00+03:00`);
  if (filters.to) params.set('to', `${filters.to}T23:59:59.999+03:00`);
  return params;
}
