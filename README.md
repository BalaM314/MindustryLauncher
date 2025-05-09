# MindustryLauncher
A custom launcher for Mindustry built with TypeScript and Node.

![image](https://github.com/BalaM314/MindustryLauncher/assets/71201189/148c8ece-25a1-46a0-8e35-168a4e8a2eb3)


## Features
* [x] Logging
* [x] Version selection
* [x] Automatic version download
* [x] Build/copy external mods and restart (configurable)
* [x] Restart automatically on mod file change (configurable)
* [x] Relaunch on command
* [x] Highly configurable
* [x] Open source
* [x] Compile a source directory before launching or when restarting (configurable)
* [x] Output highlighting
* [x] Remove username from logs (configurable)
* [x] Default JVM args (configurable)
* [x] Schematic management features

## Installation

Supported operating systems: Windows, Linux, MacOS

Requirements: Node.JS and NPM

1. Run `npm i -g mindustrylauncher`
2. Run `mindustry config`.

## Supported version types:
* Vanilla: no prefix
* Bleeding edge: `be-`
* Foos v6: `foo-v6-`
* Foos v7: `foo-`
* Foos v8: `foo-v8-`

## Usage
CLI only.

`mindustry --version <version> [--compile] [--buildMods] [-- <jvmArgs>... [-- <mindustryArgs>...]]`

Run `mindustry help` for more information.
