import React, { useEffect } from 'react';
import { Box, Text, useStdout } from 'ink';
import { RAINBOW, lerpColors, C } from './theme.js';
import { useTick } from './hooks.js';

// 5×7 pixel letters (same style as the just-Code wordmark); each pixel is drawn 2 cells wide = square
const FONT: Record<string, string[]> = {
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
};
const WORD = 'TURBO';
const SPARKS = ['✦', '✧', '⋆', '·', '⚡', '✺', '*'];
const FLAMES = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];

function rand(seed: number) {
  const x = Math.sin(seed * 9301 + 49297) * 233280;
  return x - Math.floor(x);
}

/** Colourful burst shown when turbo mode is switched on. Calls onDone after ~2.6s. */
export function TurboBurst({ onDone }: { onDone: () => void }) {
  const tick = useTick(50);
  useEffect(() => {
    const t = setTimeout(onDone, 2600);
    return () => clearTimeout(t);
  }, [onDone]);

  const { stdout } = useStdout();
  const px = (stdout?.columns ?? 80) >= 70 ? 2 : 1; // square pixels when there is room
  const width = WORD.length * 6 * px + 4;
  const sparkRow = (row: number) =>
    Array.from({ length: width }, (_, x) => {
      const r = rand(x * 31 + row * 7 + Math.floor(tick / 2) * 13);
      return r > 0.86 ? (
        <Text key={x} color={RAINBOW[Math.floor(r * 100) % RAINBOW.length]}>
          {SPARKS[Math.floor(r * 1000) % SPARKS.length]}
        </Text>
      ) : (
        <Text key={x}> </Text>
      );
    });

  // pixels pop in column by column (with a little jitter), like the GUI
  const cols = WORD.length * 6;
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={lerpColors(RAINBOW, tick / 30)} paddingX={2} marginY={1}>
      <Text>{sparkRow(0)}</Text>
      {Array.from({ length: 7 }, (_, row) => (
        <Text key={row}>
          {'  '}
          {Array.from({ length: cols }, (_, X) => {
            const ch = WORD[Math.floor(X / 6)];
            const on = FONT[ch][row][X % 6] === '#';
            const shown = X + rand(X * 7 + row) * 4 <= tick * 2.2;
            return (
              <Text key={X} color={lerpColors(RAINBOW, X / cols + tick / 25)}>
                {(on && shown ? '█' : ' ').repeat(px)}
              </Text>
            );
          })}
        </Text>
      ))}
      <Text>
        {Array.from({ length: width }, (_, x) => (
          <Text key={x} color={lerpColors([C.orange, '#FFD600', '#FF3B3B'], (x + tick) / 12)}>
            {FLAMES[Math.floor(rand(x * 17 + tick) * FLAMES.length)]}
          </Text>
        ))}
      </Text>
      <Text>{sparkRow(1)}</Text>
      <Text bold color={lerpColors(RAINBOW, tick / 15)}>
        {'   ⚡ TURBO MODE ON — agents act without asking ⚡'}
      </Text>
    </Box>
  );
}
