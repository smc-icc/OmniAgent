import { expect, it } from 'vitest';
import { assertTwoPagePositions } from '../../integrations/ragflow/ragflow.contract.js';

it('accepts DeepDOC whitespace normalization of the synthetic markers while still rejecting swapped pages', () => {
  const observed = [
    { content: 'OMNI PAGE ONE', positions: [[1, 73, 276, 59, 106]] },
    { content: 'OMNI PAGE TWO', positions: [[2, 72, 275, 59, 106]] },
  ];
  expect(() => assertTwoPagePositions(observed)).not.toThrow();
  expect(() => assertTwoPagePositions(observed.map(c => ({ ...c, positions: c.positions.map(p => [3 - p[0]!, ...p.slice(1)]) })))).toThrow('pdf_position_contract_mismatch');
});

it('requires both PDF markers at their real one-based pages', () => {
  const chunks = [
    { content: 'OMNI_PAGE_ONE', positions: [[1, 10, 300, 40, 80]] },
    { content: 'OMNI_PAGE_TWO', positions: [[2, 10, 300, 40, 80]] },
  ];
  expect(() => assertTwoPagePositions(chunks)).not.toThrow();
  for (const invalid of [
    [], [chunks[0]],
    chunks.map(c => ({ ...c, positions: [] })),
    chunks.map(c => ({ ...c, positions: c.positions.map(p => [p[0]! - 1, ...p.slice(1)]) })),
    chunks.map(c => ({ ...c, positions: c.positions.map(p => [3 - p[0]!, ...p.slice(1)]) })),
    [...chunks, { content: 'extra', positions: [[3, 0, 1, 0, 1]] }],
    [...chunks, { content: 'bad', positions: [[1, 30, 10, 0, 1]] }],
  ]) expect(() => assertTwoPagePositions(invalid)).toThrow('pdf_position_contract_mismatch');
});
