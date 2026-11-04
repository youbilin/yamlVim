import { CATALOG_BY_ID } from './rule-catalog';

export interface TemplateGroup {
  name: string;
  type: string;
  proxies: string[];
  url?: string;
  interval?: number;
  lazy?: boolean;
}

export interface TemplateProvider {
  name: string;
  behavior: string;
  url: string;
  format: string;
}

export interface TemplateRule {
  provider: string;
  target: string;
  noResolve?: boolean;
}

interface RuleSpec {
  id: string;
  target: string;
  noResolve?: boolean;
}

const RULE_SPECS: RuleSpec[] = [
  { id: 'geosite:category-ads-all', target: '🛑 广告拦截' },
  { id: 'geosite:private', target: '🏠 私有网络' },
  { id: 'geoip:private', target: '🏠 私有网络', noResolve: true },
  { id: 'geosite:openai', target: '🤖 AI 服务' },
  { id: 'geosite:anthropic', target: '🤖 AI 服务' },
  { id: 'geosite:category-ai-chat-!cn', target: '🤖 AI 服务' },
  { id: 'geosite:geolocation-cn', target: '🔒 国内服务' },
  { id: 'geoip:cn', target: '🔒 国内服务', noResolve: true },
  { id: 'geosite:youtube', target: '📹 油管视频' },
  { id: 'geosite:google', target: '🔍 谷歌服务' },
  { id: 'geoip:google', target: '🔍 谷歌服务', noResolve: true },
  { id: 'geosite:telegram', target: '📲 电报消息' },
  { id: 'geoip:telegram', target: '📲 电报消息', noResolve: true },
  { id: 'geosite:github', target: '🐱 代码托管' },
  { id: 'geosite:gitlab', target: '🐱 代码托管' },
  { id: 'geosite:atlassian', target: '🐱 代码托管' },
  { id: 'geosite:microsoft', target: 'Ⓜ️ 微软服务' },
  { id: 'geosite:onedrive', target: 'Ⓜ️ 微软服务' },
  { id: 'geosite:apple', target: '🍏 苹果服务' },
  { id: 'geosite:icloud', target: '🍏 苹果服务' },
  { id: 'geosite:geolocation-!cn', target: '🌍 非中国' },
  { id: 'geosite:cn', target: '🔒 国内服务' },
];

const AUTO_GROUP = '⚡ 自动选择';
const MAIN_GROUP = '🚀 节点选择';
const MATCH_GROUP = '🐟 漏网之鱼';

export function buildGroupTemplate(nodes: string[]): {
  groups: TemplateGroup[];
  providers: TemplateProvider[];
  rules: TemplateRule[];
  matchTarget: string;
} {
  const standard = [MAIN_GROUP, AUTO_GROUP, 'DIRECT', 'REJECT', ...nodes];
  const directFirst = ['DIRECT', 'REJECT', MAIN_GROUP, AUTO_GROUP, ...nodes];

  const groups: TemplateGroup[] = [
    { name: MAIN_GROUP, type: 'select', proxies: [AUTO_GROUP, 'DIRECT', 'REJECT', ...nodes] },
    {
      name: AUTO_GROUP,
      type: 'url-test',
      proxies: nodes,
      url: 'https://www.gstatic.com/generate_204',
      interval: 300,
      lazy: false,
    },
    { name: '🛑 广告拦截', type: 'select', proxies: ['REJECT', 'DIRECT', MAIN_GROUP] },
    { name: '🤖 AI 服务', type: 'select', proxies: standard },
    { name: '📹 油管视频', type: 'select', proxies: standard },
    { name: '🔍 谷歌服务', type: 'select', proxies: standard },
    { name: 'Ⓜ️ 微软服务', type: 'select', proxies: standard },
    { name: '🍏 苹果服务', type: 'select', proxies: standard },
    { name: '📲 电报消息', type: 'select', proxies: standard },
    { name: '🐱 代码托管', type: 'select', proxies: standard },
    { name: '🏠 私有网络', type: 'select', proxies: directFirst },
    { name: '🔒 国内服务', type: 'select', proxies: directFirst },
    { name: '🌍 非中国', type: 'select', proxies: standard },
    { name: MATCH_GROUP, type: 'select', proxies: standard },
  ];

  const providers: TemplateProvider[] = [];
  const providerNames = new Set<string>();
  const rules: TemplateRule[] = [];

  for (const spec of RULE_SPECS) {
    const entry = CATALOG_BY_ID.get(spec.id);
    if (!entry) throw new Error(`规则集缺失：${spec.id}`);
    const provider = entry.providerName;
    if (!providerNames.has(provider)) {
      providerNames.add(provider);
      providers.push({
        name: provider,
        behavior: entry.behavior,
        url: entry.url,
        format: entry.format,
      });
    }
    rules.push({ provider, target: spec.target, noResolve: spec.noResolve });
  }

  return { groups, providers, rules, matchTarget: MATCH_GROUP };
}
