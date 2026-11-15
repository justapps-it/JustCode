import React, { useEffect, useRef, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import type { Config } from '../config.js';
import { BUDGET_STEPS, allowedModels, buildCatalog, fmtBudget, parseBudget, type CatalogEntry } from '../core/budget.js';
import { C, lerpColors } from './theme.js';

const LABELS = ['free', '1c', '2c', '5c', '10c', '25c', '50c', '$1', '$2', '$5', '$10', 'inf'];
const GAP = 6; // cells between two stops
// green (free) → yellow → orange → red (big budgets); block characters only (safe width everywhere)
const RAMP = ['#4ADE80', '#A3E635', '#FACC15', '#FF8A00', '#FF5A1F', '#F43F5E'];

/** Index of the stop at or below a value (custom amounts sit between stops). */
function stopIndex(v: number | null): number {
  if (v === null) return BUDGET_STEPS.length - 1;
  let i = 0;
  BUDGET_STEPS.forEach((s, k) => {
    if (s !== null && s <= v) i = k;
  });
  return i;
}

/**
 * Interactive budget slider for the terminal:
 * ←/→ move between stops, c types a custom amount, a toggles auto model choice, Enter saves, Esc cancels.
 */
export function BudgetSlider({ config, onDone, onCancel }: { config: Config; onDone: (c: Config) => void; onCancel: () => void }) {
  const [value, setValueState] = useState<number | null>(config.budget);
  const [auto, setAutoState] = useState(config.autoSubModels);
  // refs so fast key repeats see the latest value
  const v = useRef(value);
  const au = useRef(auto);
  const setValue = (x: number | null) => {
    v.current = x;
    setValueState(x);
  };
  const setAuto = (x: boolean) => {
    au.current = x;
    setAutoState(x);
  };
  const [custom, setCustom] = useState<string | null>(null);
  const [cat, setCat] = useState<CatalogEntry[] | null>(null);

  useEffect(() => {
    let alive = true;
    void buildCatalog(config).then((c) => alive && setCat(c));
    return () => {
      alive = false;
    };
  }, [config]);

  useInput((ch, key) => {
    if (custom !== null) {
      if (key.escape) setCustom(null);
      return;
    }
    const cur = v.current;
    const i = stopIndex(cur);
    if (key.leftArrow) setValue(BUDGET_STEPS[Math.max(0, cur !== null && BUDGET_STEPS[i] !== cur ? i : i - 1)]);
    else if (key.rightArrow) setValue(BUDGET_STEPS[Math.min(BUDGET_STEPS.length - 1, i + 1)]);
    else if (key.return) onDone({ ...config, budget: v.current, autoSubModels: au.current });
    else if (key.escape) onCancel();
    else if (ch === 'c') setCustom('');
    else if (ch === 'a') setAuto(!au.current);
  });

  const width = (BUDGET_STEPS.length - 1) * GAP;
  // thumb position: stop position, nudged for custom amounts between two stops
  const i = stopIndex(value);
  const a = BUDGET_STEPS[i];
  const b = BUDGET_STEPS[i + 1];
  const frac = value !== null && a !== null && b != null && b !== a ? (value - a) / (b - a) : 0;
  const pos = Math.round((i + frac) * GAP);

  const track = Array.from({ length: width + 1 }, (_, x) => {
    const col = lerpColors(RAMP, (x / (width + 1)) * 0.999);
    if (x === pos) return <Text key={x} color={C.white}>█</Text>;
    return x < pos ? <Text key={x} color={col}>█</Text> : <Text key={x} color={C.dim}>░</Text>;
  });
  const labels = LABELS.map((l, k) => {
    const start = k * GAP - Math.floor(l.length / 2);
    return { l, start: Math.max(0, start), on: k === i };
  });
  const labelLine: React.ReactNode[] = [];
  let at = 0;
  labels.forEach(({ l, start, on }, k) => {
    if (start > at) labelLine.push(<Text key={'s' + k}>{' '.repeat(start - at)}</Text>);
    labelLine.push(
      <Text key={k} color={on ? C.white : C.dim} bold={on}>
        {l}
      </Text>,
    );
    at = Math.max(at, start) + l.length;
  });

  const allowed = cat ? allowedModels(cat, value) : null;
  const free = allowed?.filter((c) => c.pricing.kind === 'free').length ?? 0;
  const unknown = allowed?.filter((c) => c.pricing.kind === 'unknown').length ?? 0;
  const big = value === null ? 'no limit' : value === 0 ? 'free only' : `$${value.toFixed(value < 0.01 ? 3 : 2)}`;

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={lerpColors(RAMP, (pos / (width + 1)) * 0.999)} paddingX={2} paddingY={1} alignSelf="flex-start">
      <Text>
        <Text color={C.orange} bold>
          {'◆ Budget per request'}
        </Text>
        <Text color={C.dim}>{'   the orchestrator picks sub-agent models within it'}</Text>
      </Text>
      <Box marginTop={1}>
        <Text bold color={lerpColors(RAMP, (pos / (width + 1)) * 0.999)}>
          {big}
        </Text>
        <Text color={C.dim}>{value !== null && value > 0 ? '  per request' : ''}</Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text>{track}</Text>
        <Text>{labelLine}</Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        {custom !== null ? (
          <Text>
            <Text color={C.orange}>{'amount: $'}</Text>
            <TextInput
              value={custom}
              onChange={setCustom}
              placeholder="0.30"
              onSubmit={(v) => {
                const p = parseBudget(v || '');
                if (p !== undefined) setValue(p);
                setCustom(null);
              }}
            />
          </Text>
        ) : (
          <Text color={C.gray}>
            {allowed === null
              ? 'loading models…'
              : `${allowed.length} models available (${free} free${unknown ? `, ${unknown} without a known price` : ''})`}
            {value === 0 && allowed && !allowed.length ? <Text color={C.yellow}>{' — mark a free-tier provider in the GUI or add a local model'}</Text> : null}
          </Text>
        )}
        <Text>
          <Text color={C.gray}>{'auto model choice: '}</Text>
          <Text color={auto ? C.green : C.dim} bold>
            {auto ? 'on' : 'off'}
          </Text>
          <Text color={C.dim}>{auto ? '  (the orchestrator picks per task)' : `  (always ${config.subagent.provider}:${config.subagent.model})`}</Text>
        </Text>
      </Box>
      <Text color={C.dim}>{'\n<- -> move · c custom amount · a auto on/off · Enter save · Esc cancel'}</Text>
    </Box>
  );
}

export { fmtBudget };
