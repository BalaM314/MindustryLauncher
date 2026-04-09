# MindustryLauncher
A custom launcher for Mindustry built with TypeScript and Node.

![image](https://github.com/BalaM314/MindustryLauncher/assets/71201189/148c8ece-25a1-46a0-8e35-168a4e8a2eb3)


## Features
* [x] Logging
* [x] Version selection
  * [x] Vanilla, Bleeding edge, Foo's Client v6-v8
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
2. (optional) Run `mindustry config` if you want to change the settings.
3. Restart your terminal (close and reopen it).

## Usage
CLI only: you can only use this from the terminal, by typing commands.

### Quick Start

Run `mindustry`. The launcher will use the latest official release version.

### Specifying version

`mindustry --version 156.2`

List of supported versions:
* Vanilla: `___._`
* Bleeding edge: `be-_____`
* Foos v6: `foo-v6-____`
* Foos v7: `foo-____`
* Foos v8: `foo-v8-____`

Specify "latest" instead of the number to fetch the latest version.

### Runtime commands

Type `rs` while the game is running to restart.

### Specifying JVM arguments

Use the arg separator "--" to separate arguments for MindustryLauncher from JVM arguments, like this: `mindustry --version 146 -- -Xmx2G -Xms1G`

JVM arguments can be saved in the config file: run `mindustry config` to edit it.

### Logging

Enable logging in the config file.

All output will be logged, including errors and chat messages.

Run `mindustry logs` to open your logs folder.

### Custom versions

You can specify a custom version in the config file. If you provide a Mindustry source directory, you can use the `--compile` flag to compile it before launching, or type `rc` while the game is running to exit, compile, and relaunch.

### Mod development

You can provide a list of mods which will be copied to your mods directory before launching. If you provide a Java mod's source directory, you can use the `--buildMods` flag to build mods before copying, or type `rb` while the game is running to exit, rebuild mods, and relaunch.

### More information

There are a few other commands:
* `mindustry mods` opens your mods folder
* `mindustry versions` opens your versions folder
* `mindustry v` prints the version of MindustryLauncher

Run `mindustry help launch` for more information. For a full list of commands, run `mindustry help`.
