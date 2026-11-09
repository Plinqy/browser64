import { describe, expect, it } from 'vitest';
import { Flag } from '../../src/core/cpu/Flags';
import { C1541Drive, C1541_ROM_SIZE } from '../../src/core/drive1541/C1541Drive';
import { IecBus } from '../../src/core/iec/IecBus';

function testRom(resetVector = 0x8000): Uint8Array {
  const rom = new Uint8Array(C1541_ROM_SIZE).fill(0xea);
  rom[0x3ffc] = resetVector & 0xff;
  rom[0x3ffd] = (resetVector >> 8) & 0xff;
  rom[0x3ffe] = resetVector & 0xff;
  rom[0x3fff] = (resetVector >> 8) & 0xff;
  return rom;
}

describe('C1541Drive IEC and CPU integration', () => {
  it('boots the independent 6502 from the user-supplied 1541 reset vector', () => {
    const drive = new C1541Drive(new IecBus());
    drive.loadRom(testRom(0x9000));
    expect(drive.powerOn()).toBe(7);
    expect(drive.cpu.pc).toBe(0x9000);

    drive.tick();
    drive.tick();
    expect(drive.cpu.pc).toBe(0x9001); // one NOP completed
  });

  it('maps device-address jumpers to VIA0 PB5/PB6', () => {
    for (const address of [8, 9, 10, 11] as const) {
      const drive = new C1541Drive(new IecBus(), address);
      expect((drive.via0.read(0x00) >> 5) & 0x03).toBe(address - 8);
    }
  });

  it('drives IEC CLOCK/DATA through VIA0 PB3/PB1 open-collector outputs', () => {
    const iec = new IecBus();
    const drive = new C1541Drive(iec);

    drive.via0.write(0x02, 0x0a); // PB1/PB3 outputs
    drive.via0.write(0x00, 0x02); // DATA asserted, CLOCK released
    expect(iec.dataHigh).toBe(false);
    expect(iec.clockHigh).toBe(true);

    drive.via0.write(0x00, 0x08);
    expect(iec.dataHigh).toBe(true);
    expect(iec.clockHigh).toBe(false);
  });

  it('implements the 1541 ATN acknowledge path onto DATA', () => {
    const iec = new IecBus();
    const drive = new C1541Drive(iec);
    const c64 = iec.createEndpoint('test-c64');

    drive.via0.write(0x02, 0x10); // PB4 ATNA output
    drive.via0.write(0x00, 0x00); // ATNA low
    c64.setPulledLow('atn', true);
    drive.tick();

    expect(drive.via0.read(0x00) & 0x80).toBe(0x80);
    expect(iec.dataHigh).toBe(false);

    drive.via0.write(0x00, 0x10); // acknowledge ATN state
    expect(iec.dataHigh).toBe(true);
  });

  it('turns a disk BYTE event into the 6502 SO/V flag', () => {
    const drive = new C1541Drive(new IecBus());
    drive.mountD64(new Uint8Array(174_848));
    drive.via1.write(0x02, 0x04);
    drive.via1.write(0x00, 0x04); // motor on
    drive.cpu.setFlag(Flag.Overflow, false);

    drive.tick();
    expect(drive.byteReady).toBe(true);
    expect(drive.cpu.getFlag(Flag.Overflow)).toBe(true);
  });

  it('responds to a falling IEC RESET line', () => {
    const iec = new IecBus();
    const drive = new C1541Drive(iec);
    drive.loadRom(testRom(0xa000));
    drive.powerOn();
    drive.cpu.setProgramCounter(0x8123);

    const resetter = iec.createEndpoint('resetter');
    resetter.setPulledLow('reset', true);
    drive.tick();
    expect(drive.cpu.pc).toBe(0xa000);
  });
});

it('routes VIA1 port A through the write gate into mounted raw media', () => {
  const drive = new C1541Drive(new IecBus());
  const raw = new Uint8Array(0x0c + 35 * 8);
  for (let index = 0; index < 8; index += 1) raw[index] = 'GCR-1541'.charCodeAt(index);
  raw[0x09] = 35;
  raw[0x0a] = 1;
  const image = drive.mountG64(raw);
  image.replaceHalfTrack(35, Uint8Array.of(0x11, 0x22, 0x33, 0x44), Uint8Array.of(3, 3, 3, 3));

  drive.via1.write(0x03, 0xff); // port A output
  drive.via1.write(0x01, 0xa5);
  drive.via1.write(0x02, 0x04); // PB2 motor output
  drive.via1.write(0x00, 0x04);
  drive.via1.write(0x0c, 0xc0); // CB2 manual low => write mode
  drive.tick();

  expect(drive.mechanism.dirty).toBe(true);
  expect([...image.readHalfTrack(35)!.bytes]).toContain(0xa5);
});
