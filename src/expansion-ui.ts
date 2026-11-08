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
      <p>Mount generic CRT or raw 8K/16K/Ultimax cartridges, and play C64 TAP v0/v1 images through CIA1 FLAG timing.</p>
    </div>
    <div id="expansion-status" class="status-pill">No cartridge</div>
  </div>
  <div class="disk-controls">
    <label>
      Generic CRT
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
    <button id="eject-cart">Eject Cartridge</button>
  </div>
  <hr />
  <div class="panel-heading">
    <div>
      <h2>1530 Datasette</h2>
      <p>PLAY controls SENSE; the emulated 6510 controls the active-low motor line. Tape pulses reach CIA1 FLAG.</p>
    </div>
    <div id="tape-status" class="status-pill">No tape</div>
  </div>
  <div class="disk-controls">
    <input id="tap-file" type="file" accept=".tap,application/octet-stream" />
    <button id="tape-play">PLAY</button>
    <button id="tape-stop">STOP</button>
    <button id="tape-rewind">REWIND</button>
    <button id="tape-eject">EJECT</button>
  </div>
`;
anchor.insertAdjacentElement('afterend', panel);

const crtInput = input('crt-file');
const rawInput = input('raw-cart-file');
const rawMode = select('raw-cart-mode');
const expansionStatus = element('expansion-status');
const tapeInput = input('tap-file');
const tapeStatus = element('tape-status');

crtInput.addEventListener('change', async () => {
  const file = crtInput.files?.[0];
  if (file === undefined) return;
  try {
    const crt = machine.mountCrt(new Uint8Array(await file.arrayBuffer()));
    expansionStatus.textContent = `${crt.name || file.name} · ${machine.bus.configuration.cartridgeMode}`;
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
    const tap = machine.mountTap(new Uint8Array(await file.arrayBuffer()));
    tapeStatus.textContent = `${file.name} · TAP v${tap.version} · ${tap.byteLength} bytes`;
    tapeStatus.classList.add('ready');
  } catch (error) {
    showError(tapeStatus, error);
  }
});

button('tape-play').addEventListener('click', () => machine.playTape());
button('tape-stop').addEventListener('click', () => machine.stopTape());
button('tape-rewind').addEventListener('click', () => machine.rewindTape());
button('tape-eject').addEventListener('click', () => {
  machine.ejectTape();
  tapeInput.value = '';
  renderTapeStatus();
});

function renderTapeStatus(): void {
  const tape = machine.bus.datasette.snapshot();
  if (!tape.mounted) {
    tapeStatus.textContent = 'No tape';
    tapeStatus.classList.remove('ready');
    return;
  }
  tapeStatus.textContent = [
    tape.playPressed ? 'PLAY' : 'STOP',
    tape.motorOn ? 'motor on' : 'motor off',
    tape.atEnd ? 'end' : `offset ${tape.dataOffset}`
  ].join(' · ');
  tapeStatus.classList.add('ready');
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
