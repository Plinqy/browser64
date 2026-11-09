import { describe, expect, it } from 'vitest';
import { C64Machine } from '../../src/core/machine/C64Machine';
import { KeyboardMatrix } from '../../src/core/cia/KeyboardMatrix';
import { parseD64 } from '../../src/core/disk/D64Image';
import { parseT64 } from '../../src/core/tape/T64Image';
import { HostInputController } from '../../src/input/HostInputController';
import { EMULATOR_VERSION } from '../../src/release';

const D64_SIZE_35 = 174_848;

describe('v1.0.1 release readiness', () => {
  it('publishes the v1.0.1 release version', () => {
    expect(EMULATOR_VERSION).toBe('1.0.1');
  });

  it('accepts the host-key classes needed to enter a BASIC program', () => {
    const keyboard = new KeyboardMatrix();
    const controller = new HostInputController(keyboard, {
      setRestorePressed: () => undefined,
      setJoystickControl: () => undefined
    });

    const representativeBasicKeys = [
      ['Digit1', '1'], ['Digit0', '0'], ['Space', ' '], ['KeyP', 'p'],
      ['KeyR', 'r'], ['KeyI', 'i'], ['KeyN', 'n'], ['KeyT', 't'],
      ['QuoteHost', '"'], ['KeyH', 'h'], ['KeyI', 'i'], ['QuoteHost', '"'],
      ['ColonHost', ':'], ['KeyG', 'g'], ['KeyO', 'o'], ['KeyT', 't'], ['KeyO', 'o'],
      ['Digit1', '1'], ['Digit0', '0'], ['Enter', 'Enter']
    ] as const;

    for (const [code, key] of representativeBasicKeys) {
      expect(controller.keyDown(code, key)).toBe(true);
      controller.keyUp(code);
    }
    expect(keyboard.readRows(0xff)).toBe(0xff);
  });

  it('extracts a BASIC PRG from D64 and loads it through the canonical machine loader', () => {
    const disk = parseD64(makeD64WithBasicPrg());
    const entry = disk.listDirectory()[0]!;
    const machine = new C64Machine();
    const result = machine.loadPrg(disk.readPrg(entry));

    expect(result.loadAddress).toBe(0x0801);
    expect(machine.bus.readPhysicalRam(0x0801)).toBe(0x07);
    expect(machine.bus.readPhysicalRam(0x002b)).toBe(0x01);
    expect(machine.bus.readPhysicalRam(0x002c)).toBe(0x08);
    expect(machine.launchPrg(result)).toBe('basic-run');
    expect(machine.bus.readPhysicalRam(0x0277)).toBe(0x52);
    expect(machine.bus.readPhysicalRam(0x00c6)).toBe(4);
  });

  it('extracts a BASIC PRG from T64 and loads it through the same machine loader', () => {
    const tape = parseT64(makeT64WithBasicPrg());
    const entry = tape.listDirectory()[0]!;
    const machine = new C64Machine();
    const result = machine.loadPrg(tape.readPrg(entry));

    expect(result.loadAddress).toBe(0x0801);
    expect(machine.bus.readPhysicalRam(0x0801)).toBe(0x07);
    expect(machine.bus.readPhysicalRam(0x002b)).toBe(0x01);
    expect(machine.bus.readPhysicalRam(0x002c)).toBe(0x08);
  });
});

function makeD64WithBasicPrg(): Uint8Array {
  const bytes = new Uint8Array(D64_SIZE_35);
  const directory = d64Sector(bytes, 18, 1);
  directory[0] = 0;
  directory[1] = 0xff;
  directory[2] = 0x82;
  directory[3] = 1;
  directory[4] = 0;
  writePetscii(directory, 5, 16, 'BASIC GAME');
  directory[30] = 1;

  const data = d64Sector(bytes, 1, 0);
  const prg = new Uint8Array([0x01, 0x08, 0x07, 0x08, 0x0a, 0x00, 0x99, 0x00, 0x00, 0x00]);
  data[0] = 0;
  data[1] = prg.length + 1;
  data.set(prg, 2);
  return bytes;
}

function makeT64WithBasicPrg(): Uint8Array {
  const bytes = new Uint8Array(0xc8);
  writeAscii(bytes, 0, 32, 'C64S tape image file');
  writeLe16(bytes, 32, 0x0101);
  writeLe16(bytes, 34, 1);
  writeLe16(bytes, 36, 1);
  writeAscii(bytes, 40, 24, 'BASIC TAPE');
  bytes[64] = 1;
  bytes[65] = 0x82;
  writeLe16(bytes, 66, 0x0801);
  writeLe16(bytes, 68, 0x0807);
  writeLe32(bytes, 72, 0xc0);
  writeAscii(bytes, 80, 16, 'BASIC GAME');
  bytes.set([0x07, 0x08, 0x0a, 0x00, 0x99, 0x00], 0xc0);
  return bytes;
}

function d64Sector(image: Uint8Array, track: number, sector: number): Uint8Array {
  let sectors = 0;
  for (let current = 1; current < track; current += 1) {
    sectors += current <= 17 ? 21 : current <= 24 ? 19 : current <= 30 ? 18 : 17;
  }
  const offset = (sectors + sector) * 256;
  return image.subarray(offset, offset + 256);
}

function writePetscii(target: Uint8Array, offset: number, width: number, value: string): void {
  target.fill(0xa0, offset, offset + width);
  for (let index = 0; index < Math.min(width, value.length); index += 1) {
    target[offset + index] = value.charCodeAt(index) & 0xff;
  }
}

function writeAscii(target: Uint8Array, offset: number, width: number, value: string): void {
  target.fill(0x20, offset, offset + width);
  for (let index = 0; index < Math.min(width, value.length); index += 1) {
    target[offset + index] = value.charCodeAt(index) & 0xff;
  }
}

function writeLe16(target: Uint8Array, offset: number, value: number): void {
  target[offset] = value & 0xff;
  target[offset + 1] = (value >>> 8) & 0xff;
}

function writeLe32(target: Uint8Array, offset: number, value: number): void {
  target[offset] = value & 0xff;
  target[offset + 1] = (value >>> 8) & 0xff;
  target[offset + 2] = (value >>> 16) & 0xff;
  target[offset + 3] = (value >>> 24) & 0xff;
}
