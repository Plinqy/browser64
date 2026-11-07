/**
 * Electrical model of the C64's 8x8 keyboard switch matrix.
 *
 * A pressed key connects one CIA1 port-A column to one port-B row. The matrix
 * does not know about browser key names; callers work with physical column/row
 * coordinates so host input mapping remains outside the emulator core.
 */
export class KeyboardMatrix {
  private readonly columns = new Uint8Array(8);

  press(column: number, row: number): void {
    this.validateCoordinate(column, row);
    this.columns[column] = (this.columns[column]! | (1 << row)) & 0xff;
  }

  release(column: number, row: number): void {
    this.validateCoordinate(column, row);
    this.columns[column] = (this.columns[column]! & ~(1 << row)) & 0xff;
  }

  setPressed(column: number, row: number, pressed: boolean): void {
    if (pressed) {
      this.press(column, row);
    } else {
      this.release(column, row);
    }
  }

  isPressed(column: number, row: number): boolean {
    this.validateCoordinate(column, row);
    return (this.columns[column]! & (1 << row)) !== 0;
  }

  clear(): void {
    this.columns.fill(0);
  }

  /**
   * Returns external PB pin levels when one or more PA columns are actively
   * driven low. Unselected rows remain pulled high.
   */
  readRows(activeLowColumns: number): number {
    let pins = 0xff;
    const selected = activeLowColumns & 0xff;

    for (let column = 0; column < 8; column += 1) {
      if ((selected & (1 << column)) !== 0) {
        pins &= ~this.columns[column]!;
      }
    }

    return pins & 0xff;
  }

  /**
   * Symmetric path used when software reverses the normal scan direction and
   * drives CIA1 port B while reading port A.
   */
  readColumns(activeLowRows: number): number {
    let pins = 0xff;
    const selectedRows = activeLowRows & 0xff;

    for (let column = 0; column < 8; column += 1) {
      if ((this.columns[column]! & selectedRows) !== 0) {
        pins &= ~(1 << column);
      }
    }

    return pins & 0xff;
  }

  private validateCoordinate(column: number, row: number): void {
    if (!Number.isInteger(column) || !Number.isInteger(row) || column < 0 || column > 7 || row < 0 || row > 7) {
      throw new RangeError(`Keyboard matrix coordinate must be 0..7; received column=${column}, row=${row}.`);
    }
  }
}
