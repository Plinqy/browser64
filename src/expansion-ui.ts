import type { RawCartridgeMode } from './core';
import { machine } from './main';

const anchor = document.querySelector<HTMLElement>('.drive1541-panel') ?? document.querySelector<HTMLElement>('.disk-panel');
if (anchor === null) throw new Error('Missing storage panel for expansion controls.');

const panel = document.createElement('article');
panel.className = 'panel expansion-panel';
panel.innerHTML = `
  <div class="panel-heading">
    <div>
      <h2>Expansion Port / Datasette</h2>
      <p>Mount generic, Ocean, C64GS/System 3, Dinamic, or Magic Desk CRT images. Expansion IRQ/NMI/DMA and FREEZE hooks are exposed for freezer hardware.</p>
    </div>
    <div id="expansion-status" class="status-pill">No cartridge</div>
  </div>
  <div class="disk-controls">
    <label>
      CRT
      <input id="crt-file" type="file" accept=".crt,application/octet-stream" />
    </label>
    <label>
      Raw ROM mode
      <select id="raw-cart-mode">
        <option value="8k">8K</option>
        <option value="16k">16K</option>
        <option value="ultimax">Ultimax 16K</option>
      </select>
    </label>
    <label>
      Raw ROM
      <input id="raw-cart-file" type="file" accept=".rom,.bin,application/octet-stream" />
    </label>
    <button id="freeze-cart" type="button">FREEZE</button>
    <button id="eject-cart" type="button">Eject Cartridge</button>
  </div>
  <hr />
  <div class="panel-heading">
    <div>
      <h2>1530 Datasette</h2>
      <p>Play C64 TAP v0/v1 images or record a cycle-timed C64 TAP v1 from the 6510 cassette WRITE line. TAP v2 is a C16/Plus4 half-wave extension and is intentionally not treated as a C64 format.</p>
    </div>
    <div id="tape-status" class="status-pill">No tape</div>
  </div>
  <div class="disk-controls">
    <input id="tap-file" type="file" accept=".tap,application/octet-stream" />
    <button id="tape-new" type="button">NEW BLANK</button>
    <button id="tape-play" type="button">PLAY</button>
    <button id="tape-record" type="button">RECORD</button>
    <button id="tape-stop" type="button">STOP</button>
    <button id="tape-rewind" type="button">REWIND</button>
    <label>
      <input id="tape-write-protect" type="checkbox" />
      Write protect
    </label>
    <button id="tape-save" type="button">SAVE TAP</button>
    <button id="tape-eject" type="button">EJECT</button>
  </div>
`;
anchor.insertAdjacentElement('afterend', panel);

const crtInput = input('crt-file');
const rawInput = input('raw-cart-file');
const rawMode = select('raw-cart-mode');
const expansionStatus = element('expansion-status');
const tapeInput = input('tap-file');
const tapeStatus = element('tape-status');
const tapeWriteProtect = input('tape-write-protect');
const tapeSave = button('tape-save');

let tapeFilename = 'recording.tap';

crtInput.addEventListener('change', async () => {
  const file = crtInput.files?.[0];
  if (file === undefined) return;
  try {
    const crt = machine.mountCrt(new Uint8Array(await file.arrayBuffer()));
    expansionStatus.textContent = `${crt.name || file.name} · HW ${crt.hardwareType} · ${machine.bus.configuration.cartridgeMode}`;
    expansionStatus.classList.add('ready');
  } catch (error) {
    showError(expansionStatus, error);
  }
});

rawInput.addEventListener('change', async () => {
  const file = rawInput.files?.[0];
  if (file === undefined) return;
  try {
    machine.mountRawCartridge(
      new Uint8Array(await file.arrayBuffer()),
      rawMode.value as RawCartridgeMode,
      file.name
    );
    expansionStatus.textContent = `${file.name} · ${machine.bus.configuration.cartridgeMode}`;
    expansionStatus.classList.add('ready');
  } catch (error) {
    showError(expansionStatus, error);
  }
});

button('freeze-cart').addEventListener('click', () => machine.pressCartridgeFreeze());
button('eject-cart').addEventListener('click', () => {
  machine.ejectCartridge();
  crtInput.value = '';
  rawInput.value = '';
  expansionStatus.textContent = 'No cartridge';
  expansionStatus.classList.remove('ready');
});

tapeInput.addEventListener('change', async () => {
  const file = tapeInput.files?.[0];
  if (file === undefined) return;
  try {
    const tap = machine.mountTap(new Uint8Array(await file.arrayBuffer()), tapeWriteProtect.checked);
    tapeFilename = file.name;
    tapeStatus.textContent = `${file.name} · TAP v${tap.version} · ${tap.byteLength} bytes`;
    tapeStatus.classList.add('ready');
  } catch (error) {
    showError(tapeStatus, error);
  }
});

button('tape-new').addEventListener('click', () => {
  machine.newBlankTape();
  tapeFilename = 'recording.tap';
  tapeInput.value = '';
  tapeWriteProtect.checked = false;
  renderTapeStatus();
});
button('tape-play').addEventListener('click', () => machine.playTape());
button('tape-record').addEventListener('click', () => {
  try {
    machine.recordTape();
  } catch (error) {
    showError(tapeStatus, error);
  }
});
button('tape-stop').addEventListener('click', () => machine.stopTape());
button('tape-rewind').addEventListener('click', () => machine.rewindTape());
tapeWriteProtect.addEventListener('change', () => {
  machine.setTapeWriteProtected(tapeWriteProtect.checked);
  renderTapeStatus();
});
tapeSave.addEventListener('click', () => {
  const bytes = machine.exportTape();
  if (bytes === null) return;
  downloadBytes(bytes, modifiedTapeName(tapeFilename));
});
button('tape-eject').addEventListener('click', () => {
  machine.ejectTape();
  tapeInput.value = '';
  tapeFilename = 'recording.tap';
  renderTapeStatus();
});

function renderTapeStatus(): void {
  const tape = machine.bus.datasette.snapshot();
  if (!tape.mounted) {
    tapeStatus.textContent = 'No tape';
    tapeStatus.classList.remove('ready');
    tapeSave.disabled = true;
    return;
  }
  tapeStatus.textContent = [
    tape.recordPressed ? 'RECORD' : tape.playPressed ? 'PLAY' : 'STOP',
    tape.motorOn ? 'motor on' : 'motor off',
    tape.writeProtected ? 'write protected' : 'writable',
    tape.dirty ? 'modified' : 'clean',
    tape.atEnd ? 'end' : `offset ${tape.dataOffset}`
  ].join(' · ');
  tapeStatus.classList.add('ready');
  tapeSave.disabled = false;
}

function modifiedTapeName(filename: string): string {
  return filename.toLowerCase().endsWith('.tap')
    ? `${filename.slice(0, -4)}-modified.tap`
    : `${filename}-modified.tap`;
}

function downloadBytes(bytes: Uint8Array, filename: string): void {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  const blob = new Blob([buffer], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const anchorElement = document.createElement('a');
  anchorElement.href = url;
  anchorElement.download = filename;
  anchorElement.click();
  URL.revokeObjectURL(url);
}

function tick(): void {
  renderTapeStatus();
  requestAnimationFrame(tick);
}

function element(id: string): HTMLElement {
  const value = document.getElementById(id);
  if (value === null) throw new Error(`Missing #${id}.`);
  return value;
}

function input(id: string): HTMLInputElement {
  const value = document.getElementById(id);
  if (!(value instanceof HTMLInputElement)) throw new Error(`Missing input #${id}.`);
  return value;
}

function select(id: string): HTMLSelectElement {
  const value = document.getElementById(id);
  if (!(value instanceof HTMLSelectElement)) throw new Error(`Missing select #${id}.`);
  return value;
}

function button(id: string): HTMLButtonElement {
  const value = document.getElementById(id);
  if (!(value instanceof HTMLButtonElement)) throw new Error(`Missing button #${id}.`);
  return value;
}

function showError(target: HTMLElement, error: unknown): void {
  target.textContent = error instanceof Error ? error.message : String(error);
  target.classList.remove('ready');
}

renderTapeStatus();
requestAnimationFrame(tick);
