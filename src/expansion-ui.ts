import type { RawCartridgeMode } from './core';
import { machine, sessionReady } from './main';
import { browserSessionStore } from './session/BrowserSession';

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
  <p id="expansion-context" class="control-context" aria-live="polite"></p>
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
  <p id="tape-context" class="control-context" aria-live="polite"></p>
`;
anchor.insertAdjacentElement('afterend', panel);

const crtInput = input('crt-file');
const rawInput = input('raw-cart-file');
const rawMode = select('raw-cart-mode');
const expansionStatus = element('expansion-status');
const expansionContext = element('expansion-context');
const freezeButton = button('freeze-cart');
const ejectCartridgeButton = button('eject-cart');
const tapeInput = input('tap-file');
const tapeStatus = element('tape-status');
const tapeContext = element('tape-context');
const tapeWriteProtect = input('tape-write-protect');
const tapeNew = button('tape-new');
const tapePlay = button('tape-play');
const tapeRecord = button('tape-record');
const tapeStop = button('tape-stop');
const tapeRewind = button('tape-rewind');
const tapeSave = button('tape-save');
const tapeEject = button('tape-eject');

let tapeFilename = 'recording.tap';

crtInput.addEventListener('change', async () => {
  const file = crtInput.files?.[0];
  if (file === undefined) return;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const crt = machine.mountCrt(bytes);
    await browserSessionStore.putAsset('cartridge', { name: file.name, bytes, mediaType: 'crt' });
    expansionStatus.textContent = `${crt.name || file.name} · HW ${crt.hardwareType} · ${machine.bus.configuration.cartridgeMode}`;
    expansionStatus.classList.add('ready');
    renderExpansionStatus();
  } catch (error) {
    showError(expansionStatus, error);
  }
});

rawInput.addEventListener('change', async () => {
  const file = rawInput.files?.[0];
  if (file === undefined) return;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const mode = rawMode.value as RawCartridgeMode;
    machine.mountRawCartridge(bytes, mode, file.name);
    await browserSessionStore.putAsset('cartridge', {
      name: file.name, bytes, mediaType: 'raw', rawCartridgeMode: mode
    });
    expansionStatus.textContent = `${file.name} · ${machine.bus.configuration.cartridgeMode}`;
    expansionStatus.classList.add('ready');
    renderExpansionStatus();
  } catch (error) {
    showError(expansionStatus, error);
  }
});

freezeButton.addEventListener('click', () => machine.pressCartridgeFreeze());
ejectCartridgeButton.addEventListener('click', () => {
  machine.ejectCartridge();
  void browserSessionStore.removeAsset('cartridge');
  crtInput.value = '';
  rawInput.value = '';
  expansionStatus.textContent = 'No cartridge';
  expansionStatus.classList.remove('ready');
  renderExpansionStatus();
});

tapeInput.addEventListener('change', async () => {
  const file = tapeInput.files?.[0];
  if (file === undefined) return;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const tap = machine.mountTap(bytes, tapeWriteProtect.checked);
    await browserSessionStore.putAsset('tape', {
      name: file.name, bytes, mediaType: 'tap', writeProtected: tapeWriteProtect.checked
    });
    tapeFilename = file.name;
    tapeStatus.textContent = `${file.name} · TAP v${tap.version} · ${tap.byteLength} bytes`;
    tapeStatus.classList.add('ready');
  } catch (error) {
    showError(tapeStatus, error);
  }
});

tapeNew.addEventListener('click', () => {
  machine.newBlankTape();
  const bytes = machine.exportTape();
  if (bytes !== null) void browserSessionStore.putAsset('tape', {
    name: 'recording.tap', bytes, mediaType: 'tap', writeProtected: false
  });
  tapeFilename = 'recording.tap';
  tapeInput.value = '';
  tapeWriteProtect.checked = false;
  renderTapeStatus();
});
tapePlay.addEventListener('click', () => machine.playTape());
tapeRecord.addEventListener('click', () => {
  try {
    machine.recordTape();
  } catch (error) {
    showError(tapeStatus, error);
  }
});
tapeStop.addEventListener('click', () => {
  machine.stopTape();
  void persistTape();
});
tapeRewind.addEventListener('click', () => machine.rewindTape());
tapeWriteProtect.addEventListener('change', () => {
  machine.setTapeWriteProtected(tapeWriteProtect.checked);
  void persistTape();
  renderTapeStatus();
});
tapeSave.addEventListener('click', () => {
  const bytes = machine.exportTape();
  if (bytes === null) return;
  downloadBytes(bytes, modifiedTapeName(tapeFilename));
  void persistTape();
});
tapeEject.addEventListener('click', () => {
  machine.ejectTape();
  void browserSessionStore.removeAsset('tape');
  tapeInput.value = '';
  tapeFilename = 'recording.tap';
  renderTapeStatus();
});

async function persistTape(): Promise<void> {
  const bytes = machine.exportTape();
  if (bytes === null) return;
  await browserSessionStore.putAsset('tape', {
    name: tapeFilename, bytes, mediaType: 'tap', writeProtected: tapeWriteProtect.checked
  });
}

void sessionReady.then((session) => {
  const cartridge = session.assets.cartridge;
  if (cartridge !== undefined) {
    expansionStatus.textContent = `${cartridge.name} · restored · ${machine.bus.configuration.cartridgeMode}`;
    expansionStatus.classList.add('ready');
    if (cartridge.mediaType === 'raw' && cartridge.rawCartridgeMode !== undefined) {
      rawMode.value = cartridge.rawCartridgeMode;
    }
  }
  const tape = session.assets.tape;
  if (tape !== undefined) {
    tapeFilename = tape.name;
    tapeWriteProtect.checked = tape.writeProtected ?? false;
  }
  renderExpansionStatus();
  renderTapeStatus();
});

function renderExpansionStatus(): void {
  const cartridge = machine.bus.expansion.cartridge;
  const hasCartridge = cartridge !== null;
  const supportsFreeze = cartridge?.freeze !== undefined;
  freezeButton.disabled = !supportsFreeze;
  freezeButton.title = !hasCartridge
    ? 'Unavailable: Mount a cartridge first.'
    : supportsFreeze
      ? 'Press the mounted cartridge FREEZE control.'
      : 'Unavailable: The mounted cartridge does not implement a FREEZE control.';
  ejectCartridgeButton.disabled = !hasCartridge;
  ejectCartridgeButton.title = hasCartridge ? 'Eject the mounted cartridge.' : 'Unavailable: No cartridge is mounted.';
  expansionContext.textContent = !hasCartridge
    ? 'Mount a CRT or raw cartridge to enable cartridge actions. FREEZE is enabled only for cartridge hardware that implements a freeze hook.'
    : supportsFreeze
      ? `${cartridge.name} is mounted; FREEZE and Eject Cartridge are available.`
      : `${cartridge.name} is mounted. Eject Cartridge is available; this cartridge has no implemented FREEZE hook.`;
  expansionContext.classList.toggle('blocked', !hasCartridge || !supportsFreeze);
}

function renderTapeStatus(): void {
  const tape = machine.bus.datasette.snapshot();
  tapeNew.title = 'Create and mount a new blank writable C64 TAP v1 image.';
  if (!tape.mounted) {
    tapeStatus.textContent = 'No tape';
    tapeStatus.classList.remove('ready');
    setTapeButton(tapePlay, 'Mount a TAP or create a blank tape first.', 'Start Datasette playback.');
    setTapeButton(tapeRecord, 'Mount a writable TAP or create a blank tape first.', 'Engage RECORD + PLAY.');
    setTapeButton(tapeStop, 'No tape is mounted.', 'Stop the Datasette transport.');
    setTapeButton(tapeRewind, 'No tape is mounted.', 'Rewind the mounted tape to the beginning.');
    setTapeButton(tapeSave, 'No tape is mounted.', 'Export the current TAP image.');
    setTapeButton(tapeEject, 'No tape is mounted.', 'Eject the mounted tape.');
    tapeWriteProtect.disabled = true;
    tapeWriteProtect.title = 'Mount a tape before changing write protection.';
    tapeContext.textContent = 'Mount a TAP file or choose NEW BLANK to enable Datasette transport controls.';
    tapeContext.classList.add('blocked');
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
  setTapeButton(tapePlay, null, 'Start or continue Datasette playback from the current tape position.');
  setTapeButton(tapeRecord, tape.writeProtected ? 'The mounted tape is write-protected.' : null, 'Engage RECORD + PLAY from the current tape position.');
  setTapeButton(tapeStop, null, 'Stop playback/recording and commit any pending recording pulses.');
  setTapeButton(tapeRewind, null, 'Rewind the mounted tape to the beginning.');
  setTapeButton(tapeSave, null, 'Export the current tape as a C64 TAP image.');
  setTapeButton(tapeEject, null, 'Eject the mounted tape.');
  tapeWriteProtect.disabled = false;
  tapeWriteProtect.title = 'Prevent or allow recording to the mounted tape.';
  tapeContext.textContent = tape.writeProtected
    ? 'Tape mounted and write-protected: PLAY/STOP/REWIND/SAVE/EJECT are available; RECORD is unavailable.'
    : 'Tape mounted and writable: PLAY, RECORD, STOP, REWIND, SAVE, and EJECT are available.';
  tapeContext.classList.toggle('blocked', tape.writeProtected);
}

/** Keep Datasette buttons disabled only when their physical prerequisite is missing. */
function setTapeButton(control: HTMLButtonElement, disabledReason: string | null, enabledHint: string): void {
  control.disabled = disabledReason !== null;
  control.title = disabledReason === null ? enabledHint : `Unavailable: ${disabledReason}`;
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
  renderExpansionStatus();
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

renderExpansionStatus();
renderTapeStatus();
requestAnimationFrame(tick);
