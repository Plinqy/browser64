# Cartridge and Expansion-Port Architecture

## Overview

`src/core/cartridge` models the C64 expansion port as an electrical/memory participant instead of baking cartridge special cases into the CPU. Version 0.12 adds static generic 8 KiB, 16 KiB, and Ultimax cartridges plus VICE-compatible generic `.CRT` parsing.

## Architecture

```text
CRT/raw ROM -> GenericCartridge -> ExpansionPort
                                   | GAME / EXROM
                                   | ROML / ROMH
                                   | IO1 / IO2
                                   v
                                 C64Bus
```

`ExpansionPort` is the stable attachment point. Later banked/freezer cartridges can implement the same `CartridgeDevice` contract and add device-specific IO1/IO2 state without changing PLA decoding throughout the emulator.

## Implementation Discussion

GAME and EXROM are physical line levels (`true` = released/high). `C64Bus` applies the real PLA configurations for no cartridge, 8 KiB, 16 KiB, and Ultimax operation. Normal cartridge ROM is read-selected: writes beneath ROML/ROMH still update motherboard RAM. Ultimax instead hides most motherboard RAM and leaves `$1000-$7FFF` and `$A000-$CFFF` electrically unmapped.

Generic CRT support intentionally accepts only hardware type 0, ROM CHIP packets, and bank 0. Other CRT hardware IDs describe real cartridge-specific banking logic and are rejected instead of being flattened into an inaccurate ROM image.

In Ultimax mode the VIC-II can see the upper 4 KiB of ROMH (`$F000-$FFFF`) at VIC-relative `$3000-$3FFF` in every VIC bank, while character ROM is unavailable. This is modeled separately from the CPU's `$E000-$FFFF` ROMH view.
