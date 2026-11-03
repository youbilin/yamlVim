import { useMemo, useState } from 'react';
import { Check } from 'lucide-react';

import { errorMessage } from '../api';
import type { RuleCatalogItem } from '../api';
import {
  CATALOG_BY_ID,
  RULE_CATALOG,
  type RuleCatalogEntry,
} from '../data/rule-catalog';
import { Select } from './Select';
import { SideSheet } from './SideSheet';
import { toast } from '../store/toast';

const RULE_TYPES = [
  'DOMAIN',
  'DOMAIN-SUFFIX',
  'DOMAIN-KEYWORD',
  'GEOIP',
  'GEOSITE',
  'IP-CIDR',
  'IP-CIDR6',
  'SRC-IP-CIDR',
  'PROCESS-NAME',
  'RULE-SET',
  'MATCH',
];

const IP_TYPES = new Set(['IP-CIDR', 'IP-CIDR6', 'SRC-IP-CIDR']);

interface RuleDraft {
  type: string;
  value: string;
  target: string;
  noResolve: boolean;
}

interface RuleSheetProps {
  initial: string | null;
  targets: string[];
  onSave: (rules: string[]) => Promise<void>;
  onAddRuleSets: (items: RuleCatalogItem[], target: string) => Promise<void>;
  onClose: () => void;
}

function parseRule(rule: string | null): RuleDraft {
  if (!rule) return { type: 'DOMAIN-SUFFIX', value: '', target: 'DIRECT', noResolve: false };
  const parts = rule.split(',').map((part) => part.trim());
  const type = parts[0] || 'DOMAIN-SUFFIX';
  if (type === 'MATCH') return { type, value: '', target: parts[1] || 'DIRECT', noResolve: false };
  return {
    type,
    value: parts[1] || '',
    target: parts[2] || 'DIRECT',
    noResolve: parts[3] === 'no-resolve',
  };
}

function buildRule(draft: RuleDraft): string {
  if (draft.type === 'MATCH') return ['MATCH', draft.target].join(',');
  return [
    draft.type,
    draft.value.trim(),
    draft.target,
    ...(draft.noResolve && IP_TYPES.has(draft.type) ? ['no-resolve'] : []),
  ]
    .filter(Boolean)
    .join(',');
}

function catalogItem(entry: RuleCatalogEntry): RuleCatalogItem {
  return {
    slug: entry.slug,
    providerName: entry.providerName,
    kind: entry.kind,
    behavior: entry.behavior,
    url: entry.url,
    format: entry.format,
    popular: entry.popular,
  };
}

export function RuleSheet({ initial, targets, onSave, onAddRuleSets, onClose }: RuleSheetProps) {
  const targetOptions = Array.from(new Set(['DIRECT', 'REJECT', ...targets]));
  const defaultTarget =
    targetOptions.find((target) => target !== 'DIRECT' && target !== 'REJECT') ?? 'DIRECT';
  const [tab, setTab] = useState<'catalog' | 'manual' | 'batch'>(
    initial ? 'manual' : 'catalog',
  );
  const [draft, setDraft] = useState<RuleDraft>(() => parseRule(initial));
  const [presetTarget, setPresetTarget] = useState(defaultTarget);
  const [selectedCatalog, setSelectedCatalog] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [batch, setBatch] = useState('');
  const [busy, setBusy] = useState(false);

  const categories = useMemo(
    () =>
      [...new Set(RULE_CATALOG.map((entry) => entry.category))].sort((left, right) =>
        left.localeCompare(right, 'zh-Hans-CN'),
      ),
    [],
  );

  const filteredCatalog = useMemo(() => {
    const term = query.trim().toLowerCase();
    return RULE_CATALOG.filter((entry) => {
      if (category && entry.category !== category) return false;
      if (!term) return true;
      return (
        entry.nameZh.toLowerCase().includes(term) ||
        entry.nameEn.toLowerCase().includes(term) ||
        entry.slug.toLowerCase().includes(term) ||
        entry.category.toLowerCase().includes(term) ||
        entry.descriptionZh.toLowerCase().includes(term)
      );
    })
      .sort((left, right) => {
        if (left.popular !== right.popular) return left.popular ? -1 : 1;
        return left.nameZh.localeCompare(right.nameZh, 'zh-Hans-CN');
      })
      .slice(0, 300);
  }, [query, category]);

  const selectedItems = useMemo(
    () =>
      [...selectedCatalog]
        .map((id) => CATALOG_BY_ID.get(id))
        .filter((entry): entry is RuleCatalogEntry => Boolean(entry)),
    [selectedCatalog],
  );

  const toggleCatalog = (id: string) => {
    setSelectedCatalog((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const addCatalog = async () => {
    if (!selectedItems.length) {
      toast.error('请选择规则集');
      return;
    }
    setBusy(true);
    try {
      await onAddRuleSets(selectedItems.map(catalogItem), presetTarget);
    } catch (reason) {
      toast.error(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const submit = async (rules: string[]) => {
    if (!rules.length) {
      toast.error('没有可添加的规则');
      return;
    }
    setBusy(true);
    try {
      await onSave(rules);
    } catch (reason) {
      toast.error(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const batchRules = batch
    .replace(String.fromCharCode(13), '')
    .split(String.fromCharCode(10))
    .map((line) => line.trim())
    .filter(Boolean);

  const saveManual = () => {
    if (draft.type !== 'MATCH' && !draft.value.trim()) {
      toast.error('请填写规则内容');
      return;
    }
    void submit([buildRule(draft)]);
  };

  return (
    <SideSheet title={initial ? '编辑规则' : '新增规则'} onClose={onClose}>
      {!initial ? (
        <div className="sheet-tabs">
          <button
            className={tab === 'catalog' ? 'sheet-tab active' : 'sheet-tab'}
            type="button"
            onClick={() => setTab('catalog')}
          >
            全部
          </button>
          <button
            className={tab === 'manual' ? 'sheet-tab active' : 'sheet-tab'}
            type="button"
            onClick={() => setTab('manual')}
          >
            手动
          </button>
          <button
            className={tab === 'batch' ? 'sheet-tab active' : 'sheet-tab'}
            type="button"
            onClick={() => setTab('batch')}
          >
            批量
          </button>
        </div>
      ) : null}

      {tab === 'catalog' ? (
        <div className="sheet-section">
          <div className="catalog-search">
            <input
              className="input"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索中文名、英文名或站点，例如：抖音、Google、广告"
              spellCheck={false}
            />
            <button className="btn btn-ghost" type="button">
              搜索
            </button>
          </div>
          <label className="field">
            <span>分类</span>
            <Select
              value={category}
              options={[
                { value: '', label: '全部分类' },
                ...categories.map((value) => ({ value, label: value })),
              ]}
              onChange={setCategory}
              ariaLabel="规则集分类"
            />
          </label>
          <label className="field">
            <span>目标</span>
            <Select
              value={presetTarget}
              options={targetOptions.map((value) => ({ value, label: value }))}
              onChange={setPresetTarget}
              ariaLabel="规则集目标"
            />
          </label>
          <div className="preset-list">
            {filteredCatalog.map((entry) => (
              <button
                type="button"
                key={entry.id}
                className={
                  selectedCatalog.has(entry.id) ? 'preset-row selected' : 'preset-row'
                }
                onClick={() => toggleCatalog(entry.id)}
              >
                <span className="preset-check">
                  {selectedCatalog.has(entry.id) ? <Check size={12} /> : null}
                </span>
                <span className="preset-main">
                  <strong>
                    {entry.nameZh}
                    {entry.popular ? <span className="catalog-popular">热门</span> : null}
                  </strong>
                  <span>
                    {entry.nameEn} · {entry.kind} · {entry.descriptionZh}
                  </span>
                </span>
              </button>
            ))}
          </div>
          {!filteredCatalog.length ? <div className="catalog-empty">没有匹配的规则集</div> : null}
          <div className="sheet-actions">
            <span className="sheet-foot-note">已选 {selectedItems.length} 个规则集</span>
            <button
              className="btn btn-primary"
              type="button"
              onClick={() => void addCatalog()}
              disabled={busy || !selectedItems.length}
            >
              {selectedItems.length
                ? '添加 ' + selectedItems.length + ' 个规则集'
                : '添加规则集'}
            </button>
          </div>
        </div>
      ) : null}

      {tab === 'manual' ? (
        <div className="sheet-section">
          <div className="form-grid two">
            <label className="field">
              <span>类型</span>
              <Select
                value={draft.type}
                options={RULE_TYPES.map((value) => ({ value, label: value }))}
                onChange={(value) =>
                  setDraft((current) => ({
                    ...current,
                    type: value,
                    value: value === 'MATCH' ? '' : current.value,
                  }))
                }
                ariaLabel="规则类型"
              />
            </label>
            <label className="field">
              <span>目标</span>
              <Select
                value={draft.target}
                options={targetOptions.map((value) => ({ value, label: value }))}
                onChange={(value) => setDraft((current) => ({ ...current, target: value }))}
                ariaLabel="规则目标"
              />
            </label>
          </div>
          {draft.type !== 'MATCH' ? (
            <label className="field">
              <span>内容</span>
              <input
                className="input mono"
                value={draft.value}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, value: event.target.value }))
                }
                placeholder="example.com"
                spellCheck={false}
                autoFocus
              />
            </label>
          ) : null}
          {IP_TYPES.has(draft.type) ? (
            <label className="check">
              <input
                type="checkbox"
                checked={draft.noResolve}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, noResolve: event.target.checked }))
                }
              />
              no-resolve
            </label>
          ) : null}
          <div className="rule-preview">
            <span>预览</span>
            <code>{buildRule(draft)}</code>
          </div>
          <div className="sheet-actions">
            <button className="btn btn-primary" type="button" onClick={saveManual} disabled={busy}>
              {initial ? '保存规则' : '添加规则'}
            </button>
          </div>
        </div>
      ) : null}

      {tab === 'batch' ? (
        <div className="sheet-section">
          <label className="field">
            <span>每行一条规则</span>
            <textarea
              className="textarea mono node-editor"
              value={batch}
              onChange={(event) => setBatch(event.target.value)}
              rows={12}
              placeholder="DOMAIN-SUFFIX,openai.com,DIRECT / GEOIP,CN,DIRECT / MATCH,DIRECT"
              spellCheck={false}
            />
          </label>
          <div className="sheet-actions">
            <button
              className="btn btn-primary"
              type="button"
              onClick={() => void submit(batchRules)}
              disabled={busy || !batchRules.length}
            >
              {batchRules.length
                ? '添加 ' + batchRules.length + ' 条规则'
                : '添加规则'}
            </button>
          </div>
        </div>
      ) : null}
    </SideSheet>
  );
}
