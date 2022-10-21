# MindustryLauncher
A custom launcher for Mindustry built with TypeScript and Node.
![image](https://user-images.githubusercontent.com/71201189/167357688-f3e038b4-d67e-4019-aef0-8a7e57a38669.png)

## Features
* [x] Logging
* [x] Version selection
* [x] Automatic version download
* [x] Build and copy external mods (configurable)
* [x] Restart automatically on mod file change (configurable)
* [x] Relaunch on command
* [x] Highly configurable
* [x] Open source
* [x] Compile a source directory before launching or when restarting (configurable)
* [x] Output highlighting
* [x] Remove username from logs (configurable)

## Installation

Warning: the installation is WIP and rather annoying if you are not tech-savvy.

Requirements: Node.JS, Git(for automatic update)

1. Download this folder somewhere, I recommend "C:\Mindustry\Launcher".
2. Copy the provided batch file(mindustry.bat) into a directory on your PATH. This is done so you can type `mindustry` instead of `node C:\Mindustry\Launcher\index.js`. (In other words, it's a path script.)
3. If you didn't download to C:\Mindustry\Launcher, open and edit the batch file in the way it says.
4. Edit the config.json file in this directory if you want to change the settings. You need to if you didn't download to C:\Mindustry\Launcher.

better installation coming soon

## Usage
CLI only.

`mindustry [--help] [--update] [--compile] --version <version> [-- jvmArgs...]`
