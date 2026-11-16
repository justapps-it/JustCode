import React, { useEffect, useRef, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { enableGenLang, isGenLangEnabled, listProjects, type GcpProject } from '../auth/gcp.js';
import { googleOAuth, type Config } from '../config.js';
import { C, SPINNER } from './theme.js';
import { useTick } from './hooks.js';

type Phase = { k: 'loading' } | { k: 'pick' } | { k: 'check'; id: string } | { k: 'error'; msg: string };

const MAX_ROWS = 10;

/**
 * Lists the Google Cloud projects of the signed-in account; type to filter, ↑/↓ to move,
 * Enter to choose. The chosen project is billed (its credits / free trial are used) and
 * the Gemini API is enabled on it if needed.
 */
export function ProjectPicker({
  config,
  onDone,
  onCancel,
}: {
  config: Config;
  onDone: (c: Config, message: string, ok: boolean) => void;
  onCancel: () => void;
}) {
  const [phase, setPhase] = useState<Phase>({ k: 'loading' });
  const [projects, setProjects] = useState<GcpProject[]>([]);
  const [filter, setFilter] = useState('');
  const [sel, setSel] = useState(0);
  const tick = useTick(80, phase.k === 'loading' || phase.k === 'check');
  const ctrl = useRef(new AbortController());

  useEffect(() => {
    const c = ctrl.current;
    listProjects(googleOAuth(config), c.signal)
      .then((p) => {
        setProjects(p);
        setPhase({ k: 'pick' });
      })
      .catch((e) => setPhase({ k: 'error', msg: (e as Error).message }));
    return () => c.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const shown = projects.filter((p) => !filter || `${p.projectId} ${p.name}`.toLowerCase().includes(filter.toLowerCase()));

  const choose = async (p: GcpProject) => {
    setPhase({ k: 'check', id: p.projectId });
    const next = { ...config, google: { ...config.google, quotaProject: p.projectId } };
    const g = googleOAuth(next);
    try {
      if (!(await isGenLangEnabled(g, p.projectId, ctrl.current.signal))) await enableGenLang(g, p.projectId, ctrl.current.signal);
      onDone(next, `✔ Gemini is ready — usage is billed to ${p.projectId} (its credits / free trial are used first).`, true);
    } catch (e) {
      // the project is still saved: the API can be enabled by hand
      onDone(next, `Project ${p.projectId} saved, but: ${(e as Error).message}`, false);
    }
  };

  useInput((ch, key) => {
    if (key.escape) return onCancel();
    if (phase.k !== 'pick') return;
    if (key.upArrow) setSel((i) => Math.max(0, i - 1));
    else if (key.downArrow) setSel((i) => Math.min(Math.max(0, shown.length - 1), i + 1));
    else if (key.return) {
      const p = shown[sel];
      if (p?.active) void choose(p);
    } else if (key.backspace || key.delete) {
      setFilter((f) => f.slice(0, -1));
      setSel(0);
    } else if (ch && !key.ctrl && !key.meta && /^[\w .:-]$/.test(ch)) {
      setFilter((f) => f + ch);
      setSel(0);
    }
  });

  const start = Math.max(0, Math.min(sel - Math.floor(MAX_ROWS / 2), shown.length - MAX_ROWS));
  const spin = SPINNER[tick % SPINNER.length];

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={C.orange} paddingX={2} paddingY={1} alignSelf="flex-start">
      <Text>
        <Text color={C.orange} bold>
          {'◆ Google Cloud project'}
        </Text>
        <Text color={C.dim}>{'   usage is billed here — its credits / free trial are used'}</Text>
      </Text>
      <Box marginTop={1} flexDirection="column">
        {phase.k === 'loading' && (
          <Text>
            <Text color={C.orange}>{spin} </Text>loading your projects…
          </Text>
        )}
        {phase.k === 'error' && (
          <>
            <Text color={C.red}>{'✘ ' + phase.msg}</Text>
            <Text color={C.dim}>{'You can also set it by hand: /project <project-id>'}</Text>
          </>
        )}
        {phase.k === 'check' && (
          <Text>
            <Text color={C.orange}>{spin} </Text>
            {`checking the Gemini API on ${phase.id}…`}
          </Text>
        )}
        {phase.k === 'pick' && (
          <>
            <Text>
              <Text color={C.gray}>{'filter: '}</Text>
              <Text color={C.white}>{filter}</Text>
              <Text color={C.orange}>{'█'}</Text>
            </Text>
            {!projects.length ? (
              <Text color={C.yellow}>
                {'No projects yet. Create one at https://console.cloud.google.com/projectcreate (a new account gets free trial credits), then /project.'}
              </Text>
            ) : !shown.length ? (
              <Text color={C.dim}>no project matches</Text>
            ) : (
              shown.slice(start, start + MAX_ROWS).map((p, k) => {
                const i = start + k;
                const on = i === sel;
                return (
                  <Text key={p.projectId} color={p.active ? undefined : C.dim}>
                    <Text color={on ? C.orange : C.dim}>{on ? '❯ ' : '  '}</Text>
                    <Text bold={on} color={on ? C.white : C.gray}>
                      {p.projectId}
                    </Text>
                    {p.name && p.name !== p.projectId ? <Text color={C.dim}>{'  ' + p.name}</Text> : null}
                    {!p.active ? <Text color={C.dim}>{'  (not active)'}</Text> : null}
                    {p.projectId === config.google.quotaProject ? <Text color={C.green}>{'  current'}</Text> : null}
                  </Text>
                );
              })
            )}
            {shown.length > MAX_ROWS ? <Text color={C.dim}>{`  … ${shown.length} projects`}</Text> : null}
          </>
        )}
      </Box>
      <Text color={C.dim}>{'\ntype to filter · up/down move · Enter use · Esc cancel'}</Text>
    </Box>
  );
}
