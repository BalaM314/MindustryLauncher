/* @license
Copyright © <BalaM314>, 2024.
This file is part of MindustryLauncher.
MindustryLauncher is free software: you can redistribute it and/or modify it under the terms of the GNU Lesser General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.
MindustryLauncher is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU Lesser General Public License for more details.
You should have received a copy of the GNU Lesser General Public License along with MindustryLauncher. If not, see <https://www.gnu.org/licenses/>.

Contains the mindustrylauncher Application.
*/
import * as fs from "fs";
import { promises as fsP } from "fs";
import * as path from "path";
import { spawnSync } from "child_process";
import { Application } from "cli-app";
import { AppError, askYesOrNo, crash, error, formatFileSize, log, stringifyError, throwIfError } from "./funcs.js";
import { compileDirectory, copyMods, init, launch, Version } from "./mindustrylauncher.js";
export const mindustrylauncher = new Application("mindustrylauncher", "A launcher for Mindustry built with Node and TS.");
mindustrylauncher.command("version", "Displays the version of MindustryLauncher.", (opts, app) => {
    const packagePath = path.join(app.sourceDirectory, "package.json");
    try {
        const fileData = fs.readFileSync(packagePath, "utf-8");
        const packageData = JSON.parse(fileData);
        log(`MindustryLauncher version ${packageData["version"]}`);
    }
    catch (err) {
        if (err && err.code == "ENOENT") {
            error("Package.json file does not exist! This is likely caused by an improper or corrupt installation.");
        }
        else if (err instanceof SyntaxError) {
            error("Package.json file is invalid! This is likely caused by an improper or corrupt installation.");
        }
        return 1;
    }
}, false, {}, ["v"]);
mindustrylauncher.command("versions", "Opens the versions folder.", async (opts, app) => {
    const state = init(opts, app);
    if ("info" in opts.namedArgs) {
        const jarFiles = (await fsP.readdir(state.settings.mindustryJars.folderPath))
            .filter(filename => filename.startsWith("v") && path.extname(filename) == ".jar");
        //Only show mindustry version jar files
        const fileData = await Promise.all(jarFiles.map(file => fsP.stat(path.join(state.settings.mindustryJars.folderPath, file))));
        log(`List of installed versions:
${jarFiles.map(f => f.split(".")[0]).join(", ")}
You have ${jarFiles.length} version files, taking up a total file size of ${formatFileSize(fileData.reduce((acc, item) => acc + item.size, 0))}`);
    }
    else {
        log(`Opening versions folder: ${state.settings.mindustryJars.folderPath}\nUse --info to get information about installed versions.`);
        spawnSync(process.platform == "win32" ? "explorer" : "open", [state.settings.mindustryJars.folderPath]);
    }
}, false, {
    namedArgs: {
        info: {
            needsValue: false,
            description: "Shows information about your versions instead of opening the versions folder.",
            aliases: ["i"]
        }
    }
}, ["vs"]);
mindustrylauncher.command("mods", "Opens the mods folder.", async (opts, app) => {
    const state = init(opts, app);
    if ("info" in opts.namedArgs) {
        const modData = await fsP.readdir(state.modsDirectory);
        const fileData = await Promise.all(modData.map(file => fsP.stat(path.join(state.modsDirectory, file))));
        log(`List of installed mods:
${modData.join(", ")}
You have ${modData.length} mod files, taking up a total file size of ${formatFileSize(fileData.reduce((acc, item) => acc + item.size, 0))}`);
    }
    else if ("disable" in opts.namedArgs) {
        const modData = await fsP.readdir(state.modsDirectory);
        const modfile = modData.find(f => f.toLowerCase().includes(opts.namedArgs["disable"]));
        if (modfile) {
            const modfilePath = path.join(state.modsDirectory, modfile);
            if ((await fsP.stat(modfilePath)).isFile()) {
                await fsP.rename(modfilePath, modfilePath + ".disabled");
                log(`Disabled mod ${modfile}`);
            }
            else {
                error(`Cannot disable a directory mod.`);
            }
        }
    }
    else {
        log(`Opening mods folder: ${state.modsDirectory}\nUse --info to get information about installed mods.`);
        spawnSync(process.platform == "win32" ? "explorer" : "open", [state.modsDirectory]);
    }
}, false, {
    namedArgs: {
        info: {
            needsValue: false,
            description: "Shows information about your mods instead of opening the mods folder.",
            aliases: ["i"]
        },
        disable: {
            description: "Force disable a mod by putting .disabled in the file extension.",
            aliases: ["d"],
            required: false
        }
    }
}, ["m"]);
mindustrylauncher.command("config", "Opens the launcher's config.json file.", (opts, app) => {
    const state = init(opts, app);
    const settingsPath = path.join(state.launcherDataPath, "config.json");
    log(`Opening ${settingsPath}`);
    function openEditor(editor) {
        try {
            throwIfError(spawnSync(editor, [settingsPath], { stdio: "inherit" }));
            log(`Editor closed.`);
            return true;
        }
        catch (err) {
            if (!stringifyError(err).includes("ENOENT"))
                error(stringifyError(err));
            return false;
        }
    }
    log(`Editor closed.`);
    if (process.env["EDITOR"])
        openEditor(process.env["EDITOR"]);
    else {
        //try some defaults
        const defaults = ["nvim", "code", "code.cmd", "notepad", "nano", "vim"];
        for (const cmd of defaults) {
            if (openEditor(cmd))
                return 0;
        }
        error(`Could not find an editor. Please set the EDITOR environment variable and try again.`);
    }
}, false, {}, ["c"]);
mindustrylauncher.command("logs", "Opens the logs folder", async (opts, app) => {
    const state = init(opts, app);
    if ("info" in opts.namedArgs) {
        const files = (await fsP.readdir(state.settings.logging.path))
            .map(filename => path.join(state.settings.logging.path, filename));
        const fileData = await Promise.all(files.map(file => fsP.stat(file)));
        log(`You have ${files.length} log files, taking up a total file size of ${formatFileSize(fileData.reduce((acc, item) => acc + item.size, 0))}`);
    }
    else {
        spawnSync(process.platform == "win32" ? "explorer" : "open", [state.settings.logging.path]);
    }
}, false, {
    namedArgs: {
        info: {
            needsValue: false,
            description: "Shows information about your logs instead of the logs folder.",
            aliases: ["i"]
        }
    }
}, ["l"]);
mindustrylauncher.command("launch", "Launches Mindustry.", async (opts, app) => {
    const state = init(opts, app);
    state.version = await Version.fromInput(opts.namedArgs.version, state);
    if (state.version.isSourceDirectory) {
        if ("compile" in opts.namedArgs) {
            const output = await compileDirectory(state.version.path);
            if (!output)
                return 1;
        }
        if (!state.version.exists()) {
            if ("compile" in opts.namedArgs)
                error(`Unable to find a Mindustry.jar in ${state.version.jarFilePath()}. Are you sure this is a Mindustry source directory?`);
            else
                error(`Unable to find a Mindustry.jar in ${state.version.jarFilePath()}. Are you sure this is a Mindustry source directory? You may need to compile first.`);
            return 1;
        }
        //Jar file exists, all good
    }
    if (!state.version.exists()) {
        error(`Version ${state.version.name()} has not been downloaded.`);
        if (state.version.isCustom) {
            throw new Error(`Logic error: nonexistent custom version not caught in fromInput`);
        }
        if (await askYesOrNo("Would you like to download the file? [y/n]:")) {
            const downloaded = await state.version.download(state);
            if (!downloaded)
                return 1;
            //Download was successful
            if (!state.version.exists())
                crash(`Downloaded file doesn't exist! Attempted to download version ${opts.namedArgs.version} to ${state.version.jarFilePath()}`);
        }
        else {
            return 1;
        }
    }
    try {
        await copyMods(state);
        launch(state);
    }
    catch (err) {
        if (err instanceof AppError) {
            error(err.message);
            return 1;
        }
        else {
            throw err;
        }
    }
    //copy mods and launch
}, true, {
    namedArgs: {
        version: {
            description: "The version to launch, like 141.3, be-22456, foo-latest, foo-v6-1000, etc",
            required: true,
        },
        compile: {
            description: "Whether or not to compile a version before launching, if it points to a Mindustry source directory.",
            needsValue: false
        },
        buildMods: {
            description: "Whether or not to compile Java mod directories before copying.",
            needsValue: false
        }
    },
    positionalArgs: [],
    aliases: {
        c: "compile",
        v: "version",
        b: "buildMods",
    }
});
