import { RULE_COMBOS, type RuleCombo } from './rule-catalog';

const entries = (id: string): string[] =>
  RULE_COMBOS.find((combo) => combo.id === id)?.entries ?? [];

const merge = (...groups: string[][]): string[] => Array.from(new Set(groups.flat()));

export const EXTRA_COMBOS: RuleCombo[] = [
  {
    id: 'ai-dev',
    nameZh: 'AI + 开发',
    description: 'OpenAI、Claude、Gemini 与 GitHub、Docker 等开发服务一起走海外出口。',
    category: '推荐',
    entries: merge(entries('ai'), entries('dev')),
    entryCount: 0,
  },
  {
    id: 'media-social',
    nameZh: '影音社交',
    description: 'YouTube、Netflix、TikTok 与 Telegram、X、Discord 等影音社交组合。',
    category: '推荐',
    entries: merge(entries('streaming'), entries('social')),
    entryCount: 0,
  },
  {
    id: 'office',
    nameZh: '办公套件',
    description: 'Microsoft、Apple、Google 的账号、云盘与更新服务。',
    category: '办公',
    entries: merge(entries('microsoft'), entries('apple'), entries('google')),
    entryCount: 0,
  },
  {
    id: 'global',
    nameZh: '全球常用',
    description: 'Google、GitHub、Telegram 与海外社交，适合作为主出口的常用集合。',
    category: '推荐',
    entries: merge(entries('google'), entries('dev'), entries('telegram'), entries('social')),
    entryCount: 0,
  },
  {
    id: 'cn-private',
    nameZh: '国内与私有',
    description: '中国大陆站点、IP 段以及局域网、保留地址，统一走直连。',
    category: '国内',
    entries: merge(entries('cn-direct'), entries('private')),
    entryCount: 0,
  },
  {
    id: 'ads-private',
    nameZh: '广告与私有',
    description: '广告拦截走 REJECT，私有网络走 DIRECT，常作为基础分流。',
    category: '基础',
    entries: merge(entries('ads'), entries('private')),
    entryCount: 0,
  },
].map((combo) => ({ ...combo, entryCount: combo.entries.length }));

export const ALL_COMBOS: RuleCombo[] = [...RULE_COMBOS, ...EXTRA_COMBOS];
