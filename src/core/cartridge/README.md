# Cartridge and Expansion-Port Architecture

## Overview

`src/core/cartridge` models the C64 expansion port as a device interface rather than CPU special cases. Static generic cartridges and several common banked CRT families share the same GAME/EXROM, ROML/ROMH, and IO1/IO2 contract.

## Architecture

```text
CRT/raw ROM -> CartridgeDevice -> ExpansionPort -> C64Bus / PLA
                    |                |
                    +-- IO1/IO2      +-- IRQ / NMI / DMA
                    +-- banking      +-- FREEZE hook
```

## Implementation Discussion

Generic hardware type 0 supports raw/static 8 KiB, 16 KiB, and Ultimax mappings. Supported banked CRT families are Ocean type 1 (hardware 5), C64GS/System 3 (15), Dinamic (17), and Magic Desk (19). Each family implements its IO1 selection rule instead of flattening banked ROM into a generic image. Magic Desk bit 7 can release GAME/EXROM and disable the cartridge.

Debugger `peek()` reads are routed as side-effect-free IO accesses, so address-selected families such as C64GS and Dinamic do not accidentally change banks during inspection.

The device contract also exposes active-low IRQ/NMI/DMA state and an optional FREEZE button hook. IRQ is merged with motherboard IRQ sources and expansion NMI is edge-detected by `C64Machine`. DMA is exposed as an electrical hook, but active expansion-port DMA bus stealing and chip-specific freezer behavior remain outside the v1.0 claim.
