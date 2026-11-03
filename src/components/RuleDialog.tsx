import { useState } from 'react';
import { Save } from 'lucide-react';

import { errorMessage } from '../api';
import { Dialog } from './Dialog';
import { Select } from './Select';
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

interface RuleDialogProps {
  initial: string | null;
  targets: string[];
  onSave: (rule: string) => Promise<void>;
  onClose: () => void;
}

function parseRule(rule: string | null): RuleDraft {
  if (!rule) {
    return { type: 'DOMAIN-SUFFIX', value: '', target: 'DIRECT', noResolve: false };
  }
  const parts = rule.split(',').map((part) => part.trim());
  const type = parts[0] || 'DOMAIN-SUFFIX';
  if (type === 'MATCH') {
    return { type, value: '', target: parts[1] || 'DIRECT', noResolve: false };
  }
  return {
    type,
    value: parts[1] || '',
    target: parts[2] || 'DIRECT',
    noResolve: parts[3] === 'no-resolve',
  };
}

export function RuleDialog({ initial, targets, onSave, onClose }: RuleDialogProps) {
  const [draft, setDraft] = useState<RuleDraft>(() => parseRule(initial));
  const [busy, setBusy] = useState(false);
  const targetOptions = Array.from(new Set(['DIRECT', 'REJECT', ...targets]));

  const rule =
    draft.type === 'MATCH'
      ? `MATCH,${draft.target}`
      : [
          draft.type,
          draft.value.trim(),
          draft.target,
          ...(draft.noResolve && IP_TYPES.has(draft.type) ? ['no-resolve'] : []),
        ]
          .filter(Boolean)
          .join(',');

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (draft.type !== 'MATCH' && !draft.value.trim()) {
      toast.error('请填写规则内容');
      return;
    }
    setBusy(true);
    try {
      await onSave(rule);
    } catch (reason) {
      toast.error(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title={initial ? '编辑规则' : '新增规则'} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="dialog-body">
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
                placeholder={
                  draft.type === 'GEOIP'
                    ? 'CN'
                    : draft.type === 'RULE-SET'
                      ? 'rule-set 名称'
                      : 'example.com'
                }
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
            <code>{rule}</code>
          </div>
        </div>
        <div className="dialog-foot">
          <button className="btn btn-primary" type="submit" disabled={busy}>
            <Save size={15} />
            {busy ? '保存中…' : '保存规则'}
          </button>
          <button className="btn btn-ghost" type="button" onClick={onClose}>
            取消
          </button>
        </div>
      </form>
    </Dialog>
  );
}
