import type { DnsDraft, DnsInput, DnsRuleInput } from '../types';

function list(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function toDnsInput(draft: DnsDraft): DnsInput {
  const settings: Record<string, unknown> = {
    enable: draft.settings.enable,
    'enhanced-mode': draft.settings.enhancedMode,
    'use-hosts': draft.settings.useHosts,
    'use-system-hosts': draft.settings.useSystemHosts,
  };

  if (draft.settings.listen.trim()) settings.listen = draft.settings.listen.trim();
  if (draft.settings.fakeIpRange.trim()) {
    settings['fake-ip-range'] = draft.settings.fakeIpRange.trim();
  }

  const fakeFilter = list(draft.settings.fakeIpFilter);
  if (fakeFilter.length) settings['fake-ip-filter'] = fakeFilter;

  const nameserver = list(draft.settings.nameserver);
  if (nameserver.length) settings.nameserver = nameserver;

  const defaultNameserver = list(draft.settings.defaultNameserver);
  if (defaultNameserver.length) settings['default-nameserver'] = defaultNameserver;

  const proxyServerNameserver = list(draft.settings.proxyServerNameserver);
  if (proxyServerNameserver.length) {
    settings['proxy-server-nameserver'] = proxyServerNameserver;
  }

  const fallback = list(draft.settings.fallback);
  if (fallback.length) settings.fallback = fallback;

  const rules: DnsRuleInput[] = draft.rules
    .filter((rule) => rule.enabled && rule.matchValue.trim())
    .map((rule) => {
      const action: Record<string, unknown> = { type: rule.actionType };
      if (rule.actionType === 'nameserver') action.servers = list(rule.actionValue);
      if (rule.actionType === 'fixed-ip') action.ips = list(rule.actionValue);
      return {
        id: rule.id,
        match: { type: rule.matchType, value: rule.matchValue.trim() },
        action,
      };
    });

  return {
    enabled: draft.enabled,
    settings,
    rules,
    hosts: {},
    'rule-sets': list(draft.rulesets),
  };
}
