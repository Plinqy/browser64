import { Cia6526 } from '../cia/Cia6526';
import { KeyboardMatrix } from '../cia/KeyboardMatrix';
import { VicII, type VicMemory } from '../vic/VicII';
import { ColorRam } from './ColorRam';
import type { MemoryMappedDevice } from './Device';
import { OpenBusDevice } from './OpenBusDevice';
import { RegisterFileDevice } from './RegisterFileDevice';

/**
 * Routes CPU accesses inside the C64's $D000-$DFFF I/O window.
 *
 * v0.6 uses the timed graphics/sprite VIC-II device while
 * SID remains an explicit register-file placeholder until its later phase.
 */
export class C64Io implements MemoryMappedDevice {
  public readonly vic: VicII;
  public readonly sid = new RegisterFileDevice(0x20, 0x1f);
  public readonly colorRam = new ColorRam();
  public readonly cia1 = new Cia6526();
  public readonly cia2 = new Cia6526();
  public readonly keyboard = new KeyboardMatrix();
  public readonly io1 = new OpenBusDevice();
  public readonly io2 = new OpenBusDevice();

  private joystick1Pins = 0xff;
  private joystick2Pins = 0xff;

  constructor(vicMemory?: VicMemory) {
    this.vic = new VicII(vicMemory);

    // CIA1 Port A normally drives keyboard columns and shares pins with
    // joystick 2. Port B normally reads rows and shares pins with joystick 1.
    // The matrix is symmetric so reverse-direction scans work as well.
    this.cia1.setPortAInputProvider(
      () => this.keyboard.readColumns(this.cia1.portBOutputLowMask) & this.joystick2Pins
    );
    this.cia1.setPortBInputProvider(
      () => this.keyboard.readRows(this.cia1.portAOutputLowMask) & this.joystick1Pins
    );

    // CIA2's unmodeled IEC/user-port input lines are pulled high. This also
    // gives PA0/PA1 their stock reset input state, selecting VIC bank 0.
    this.cia2.setPortAInputProvider(() => 0xff);
    this.cia2.setPortBInputProvider(() => 0xff);
  }

  read(offset: number): number {
    const { device, deviceOffset } = this.resolve(offset);
    return device.read(deviceOffset);
  }

  peek(offset: number): number {
    const { device, deviceOffset } = this.resolve(offset);
    return device.peek(deviceOffset);
  }

  write(offset: number, value: number): void {
    const { device, deviceOffset } = this.resolve(offset);
    device.write(deviceOffset, value);
  }

  reset(): void {
    this.vic.reset();
    this.sid.reset();
    this.colorRam.reset();
    this.cia1.reset();
    this.cia2.reset();
    this.io1.reset();
    this.io2.reset();
  }

  tick(cycles: number): void {
    this.vic.tick(cycles);
    this.cia1.tick(cycles);
    this.cia2.tick(cycles);
  }

  /** Active-low CIA pin image for joystick port 1. */
  setJoystick1Pins(value: number): void {
    this.joystick1Pins = value & 0xff;
  }

  /** Active-low CIA pin image for joystick port 2. */
  setJoystick2Pins(value: number): void {
    this.joystick2Pins = value & 0xff;
  }

  get joystick1InputPins(): number {
    return this.joystick1Pins;
  }

  get joystick2InputPins(): number {
    return this.joystick2Pins;
  }

  private resolve(offset: number): { device: MemoryMappedDevice; deviceOffset: number } {
    const address = offset & 0x0fff;

    if (address < 0x0400) {
      return { device: this.vic, deviceOffset: address };
    }

    if (address < 0x0800) {
      return { device: this.sid, deviceOffset: address - 0x0400 };
    }

    if (address < 0x0c00) {
      return { device: this.colorRam, deviceOffset: address - 0x0800 };
    }

    if (address < 0x0d00) {
      return { device: this.cia1, deviceOffset: address - 0x0c00 };
    }

    if (address < 0x0e00) {
      return { device: this.cia2, deviceOffset: address - 0x0d00 };
    }

    if (address < 0x0f00) {
      return { device: this.io1, deviceOffset: address - 0x0e00 };
    }

    return { device: this.io2, deviceOffset: address - 0x0f00 };
  }
}
