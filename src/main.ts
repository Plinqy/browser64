import './ui/styles.css';
import { Cpu6510, Disassembler, RamBus, TraceFormatter } from './core';

const app = document.querySelector<HTMLElement>('#app');
if (app === null) {
  throw new Error('Missing #app element.');
}

const bus = new RamBus();
const cpu = new Cpu6510(bus);
const disassembler = new Disassembler(bus);
const trace = new TraceFormatter(cpu);

// Small hand-authored smoke program. The browser UI is a development console,
// not C64 emulation yet: it deliberately exercises only the v0.1 CPU core.
const program = new Uint8Array([
  0xa2, 0x00,       // LDX #$00
  0xa9, 0x01,       // LDA #$01
  0x9d, 0x00, 0x04, // STA $0400,X
  0xe8,             // INX
  0x69, 0x01,       // ADC #$01
  0xe0, 0x10,       // CPX #$10
  0xd0, 0xf6,       // BNE $0804
  0x00              // BRK
]);

function initialize(): void {
  bus.clear();
  bus.load(program, 0x0800);
  bus.setVector(0xfffc, 0x0800);
  bus.setVector(0xfffe, 0x0900);
  bus.write(0x0900, 0x4c); // JMP $0900, stable BRK target for the demo.
  bus.write(0x0901, 0x00);
  bus.write(0x0902, 0x09);
  cpu.reset();
}

app.innerHTML = `
  <section class="shell">
    <header>
      <p class="eyebrow">FROM-SCRATCH C64 EMULATOR</p>
      <h1>MOS 6510 Development Console</h1>
      <p>v0.1 CPU, memory bus, disassembler, trace, and cycle accounting.</p>
    </header>

    <section class="toolbar">
      <button id="reset">Reset</button>
      <button id="step">Step</button>
      <button id="run100">Run 100</button>
    </section>

    <section class="grid">
      <article class="panel">
        <h2>CPU</h2>
        <pre id="registers"></pre>
      </article>
      <article class="panel">
        <h2>Next instructions</h2>
        <pre id="disassembly"></pre>
      </article>
    </section>

    <article class="panel trace-panel">
      <h2>Trace</h2>
      <pre id="trace"></pre>
    </article>
  </section>
`;

const registersElement = mustElement('registers');
const disassemblyElement = mustElement('disassembly');
const traceElement = mustElement('trace');
const traceLines: string[] = [];

function render(): void {
  registersElement.textContent = [
    `PC  $${hex(cpu.pc, 4)}`,
    `A   $${hex(cpu.a, 2)}`,
    `X   $${hex(cpu.x, 2)}`,
    `Y   $${hex(cpu.y, 2)}`,
    `SP  $${hex(cpu.sp, 2)}`,
    `P   %${cpu.status.toString(2).padStart(8, '0')}`,
    `CYC ${cpu.cycles}`
  ].join('\n');

  disassemblyElement.textContent = disassembler
    .disassembleRange(cpu.pc, 8)
    .map((entry) => `${hex(entry.address, 4)}  ${entry.bytes.map((byte) => hex(byte, 2)).join(' ').padEnd(8, ' ')} ${entry.text}`)
    .join('\n');

  traceElement.textContent = traceLines.slice(-18).join('\n');
}

function doStep(): void {
  traceLines.push(trace.formatCurrent());
  cpu.step();
  render();
}

mustElement('reset').addEventListener('click', () => {
  initialize();
  traceLines.length = 0;
  render();
});

mustElement('step').addEventListener('click', doStep);

mustElement('run100').addEventListener('click', () => {
  for (let i = 0; i < 100; i += 1) {
    doStep();
  }
});

initialize();
render();

function mustElement(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (element === null) {
    throw new Error(`Missing #${id} element.`);
  }
  return element;
}

function hex(value: number, width: number): string {
  return (value >>> 0).toString(16).toUpperCase().padStart(width, '0');
}
