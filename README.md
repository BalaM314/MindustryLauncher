# MindustryLauncher
A custom launcher for Mindustry built with TypeScript and Node.JS.

## Features
* [x] Logging
* [x] Version selection
* [ ] Automatic version download
* [x] Automatically copies external mods on file update and relaunches
* [x] Relaunch on command
* [x] Highly configurable
* [x] Open source
* [ ] Discord RPC
* [ ] Steam achievement support

## Installation

Warning: the installation is WIP and rather annoying if you are not tech-savvy.

Requirements: Node.JS

1. Download this folder somewhere, I recommend "C:\Mindustry\Launcher".
2. Copy the provided batch file(mindustry.bat) into a directory on your PATH. This is done so you can type `mindustry` instead of `node C:\Mindustry\Launcher\index.js`.
3. If you didn't download to C:\Mindustry\Launcher, open and edit the batch file in the way it says.
4. Open a command prompt/terminal and run `mindustry --install`. If you get an error saying "'mindustry' is not recognized as an internal or external command", then relaunch the terminal, or the directory you put the batch file in isn't on the PATH.
5. It will open config.json in a notepad document so you can complete the install.

better installation coming soon

## Usage
CLI only.

`mindustry [--help] [--version <version>]`
