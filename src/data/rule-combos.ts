import { RULE_COMBOS, type RuleCombo } from './rule-catalog';

const RECOMMENDED_IDS = [
  'ai',
  'streaming',
  'social',
  'dev',
  'google',
  'telegram',
  'cn-direct',
  'ads',
];

export const RECOMMENDED_COMBOS: RuleCombo[] = RECOMMENDED_IDS.map((id) =>
  RULE_COMBOS.find((combo) => combo.id === id),
).filter((combo): combo is RuleCombo => Boolean(combo));
