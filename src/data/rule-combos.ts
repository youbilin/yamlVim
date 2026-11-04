import type { RuleCombo } from './rule-catalog';

function combo(
  id: string,
  nameZh: string,
  description: string,
  entries: string[],
): RuleCombo {
  return {
    id,
    nameZh,
    description,
    category: '模板',
    entries,
    entryCount: entries.length,
  };
}

export const RECOMMENDED_COMBOS: RuleCombo[] = [
  combo('ads', '🛑 广告拦截', '常见广告、追踪与统计域名，通常指向 REJECT。', [
    'geosite:category-ads-all',
  ]),
  combo('ai', '🤖 AI 服务', 'ChatGPT、Claude、Gemini 等海外 AI 产品。', [
    'geosite:openai',
    'geosite:anthropic',
    'geosite:category-ai-chat-!cn',
  ]),
  combo('youtube', '📹 油管视频', 'YouTube 域名与视频流量。', ['geosite:youtube']),
  combo('google', '🔍 谷歌服务', 'Google 域名与公网 IP。', [
    'geosite:google',
    'geoip:google',
  ]),
  combo('microsoft', 'Ⓜ️ 微软服务', 'Microsoft、OneDrive 与 Windows 更新。', [
    'geosite:microsoft',
    'geosite:onedrive',
  ]),
  combo('apple', '🍏 苹果服务', 'Apple、iCloud 与 App Store。', [
    'geosite:apple',
    'geosite:icloud',
  ]),
  combo('telegram', '📲 电报消息', 'Telegram 域名与数据中心 IP。', [
    'geosite:telegram',
    'geoip:telegram',
  ]),
  combo('dev', '🐱 代码托管', 'GitHub、GitLab、Atlassian 等开发者服务。', [
    'geosite:github',
    'geosite:gitlab',
    'geosite:atlassian',
  ]),
  combo('private', '🏠 私有网络', '局域网与保留 IP，通常指向 DIRECT。', [
    'geosite:private',
    'geoip:private',
  ]),
  combo('cn', '🔒 国内服务', '中国大陆网站与 IP 段，通常指向 DIRECT。', [
    'geosite:geolocation-cn',
    'geoip:cn',
    'geosite:cn',
  ]),
  combo('non-cn', '🌍 非中国', '未被国内规则命中的海外域名。', [
    'geosite:geolocation-!cn',
  ]),
];
