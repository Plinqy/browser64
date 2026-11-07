import type { SidChipModel } from './SidModel';

const DAC_6581_8 = buildR2rDacTable(8, 2.2, false);
const DAC_6581_12 = buildR2rDacTable(12, 2.2, false);

/**
 * SID DAC transfer helpers.
 *
 * The tables are generated independently from the resistor network rather than
 * copied from another emulator. The 6581 uses an approximately 2.2× vertical
 * resistor ratio and lacks the LSB termination. The 8580's ~2.0× terminated
 * ladder is effectively ideal, so its digital value can pass through directly.
 */
export function sidEnvelopeDac(model: SidChipModel, value: number): number {
  const input = value & 0xff;
  return model === '8580' ? input : DAC_6581_8[input]!;
}

export function sidWaveDac(model: SidChipModel, value: number): number {
  const input = value & 0x0fff;
  return model === '8580' ? input : DAC_6581_12[input]!;
}

/** Build one normalized R-2R transfer table by solving unit-bit ladder weights. */
function buildR2rDacTable(bits: number, twoRRatio: number, terminated: boolean): Uint16Array {
  const weights = solveR2rWeights(bits, twoRRatio, terminated);
  const fullScale = weights.reduce((sum, weight) => sum + weight, 0);
  const table = new Uint16Array(1 << bits);

  for (let value = 0; value < table.length; value += 1) {
    let voltage = 0;
    for (let bit = 0; bit < bits; bit += 1) {
      if ((value & (1 << bit)) !== 0) voltage += weights[bit]!;
    }
    table[value] = Math.round((voltage / fullScale) * (table.length - 1));
  }

  return table;
}

/**
 * Solve the linear ladder once per bit. Node 0 is the LSB end; node N-1 is
 * the MSB/output end. Horizontal resistors are normalized to R=1 and every
 * digital leg is `twoRRatio * R`.
 */
function solveR2rWeights(bits: number, twoRRatio: number, terminated: boolean): Float64Array {
  const matrix = Array.from({ length: bits }, () => new Float64Array(bits));

  for (let node = 0; node < bits; node += 1) {
    let diagonal = 1 / twoRRatio;
    if (node > 0) {
      diagonal += 1;
      matrix[node]![node - 1] = -1;
    }
    if (node < bits - 1) {
      diagonal += 1;
      matrix[node]![node + 1] = -1;
    }
    if (node === 0 && terminated) diagonal += 1 / twoRRatio;
    matrix[node]![node] = diagonal;
  }

  const weights = new Float64Array(bits);
  for (let bit = 0; bit < bits; bit += 1) {
    const rhs = new Float64Array(bits);
    rhs[bit] = 1 / twoRRatio;
    weights[bit] = solveLinearSystem(matrix, rhs)[bits - 1]!;
  }
  return weights;
}

function solveLinearSystem(source: readonly Float64Array[], rhsSource: Float64Array): Float64Array {
  const size = source.length;
  const a = source.map((row) => Float64Array.from(row));
  const b = Float64Array.from(rhsSource);

  for (let pivot = 0; pivot < size; pivot += 1) {
    let best = pivot;
    for (let row = pivot + 1; row < size; row += 1) {
      if (Math.abs(a[row]![pivot]!) > Math.abs(a[best]![pivot]!)) best = row;
    }
    if (best !== pivot) {
      [a[pivot], a[best]] = [a[best]!, a[pivot]!];
      const temp = b[pivot]!;
      b[pivot] = b[best]!;
      b[best] = temp;
    }

    const pivotRow = a[pivot]!;
    const divisor = pivotRow[pivot]!;
    for (let column = pivot; column < size; column += 1) {
      pivotRow[column] = pivotRow[column]! / divisor;
    }
    b[pivot] = b[pivot]! / divisor;

    for (let row = 0; row < size; row += 1) {
      if (row === pivot) continue;
      const factor = a[row]![pivot]!;
      if (factor === 0) continue;
      const targetRow = a[row]!;
      for (let column = pivot; column < size; column += 1) {
        targetRow[column] = targetRow[column]! - factor * pivotRow[column]!;
      }
      b[row] = b[row]! - factor * b[pivot]!;
    }
  }

  return b;
}
